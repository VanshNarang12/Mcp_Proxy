import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { homedir } from "node:os";
import { load as yamlLoad } from "js-yaml";
import { z } from "zod";

const TargetSchema = z
  .object({
    command: z.string().min(1, "must be a non-empty string"),
    args: z.array(z.string()).default([]),
    env: z.record(z.string()).default({}),
    cwd: z.string().optional(),
  })
  .strict();

const BlockSchema = z
  .object({
    tools: z.array(z.string()).default([]),
  })
  .strict();

const AuditSchema = z
  .object({
    sink: z.string().min(1, "must be a non-empty path"),
    identity: z.record(z.string()).optional(),
    logRawArgs: z.boolean().default(false),
  })
  .strict();

const RedactRuleSchema = z
  .object({
    name: z.string().min(1),
    pattern: z.string().min(1),
    replacement: z.string().optional(),
  })
  .strict();

const RedactSchema = z
  .object({
    rules: z.array(RedactRuleSchema).default([]),
    defaultReplacement: z.string().optional(),
  })
  .strict();

const InstructionRuleSchema = z
  .object({
    tool: z.string().min(1),
    prepend: z.string().optional(),
    append: z.string().optional(),
    replace: z.string().optional(),
  })
  .strict()
  .refine(
    (r) =>
      r.prepend !== undefined ||
      r.append !== undefined ||
      r.replace !== undefined,
    { message: "must set at least one of prepend, append, or replace" },
  );

const InstructionsSchema = z
  .object({
    rules: z.array(InstructionRuleSchema).default([]),
  })
  .strict();

const SqlGuardSchema = z
  .object({
    tools: z.array(z.string()).default([]),
    sqlArg: z.string().min(1).default("sql"),
    readOnly: z.boolean().default(true),
    mode: z.enum(["allowlist", "denylist"]).default("allowlist"),
    extraWriteKeywords: z.array(z.string()).default([]),
    extraReadVerbs: z.array(z.string()).default([]),
  })
  .strict();

const RateLimitRuleSchema = z
  .object({
    tool: z.string().min(1),
    perMinute: z.number().positive(),
  })
  .strict();

const RateLimitSchema = z.array(RateLimitRuleSchema);

export const OverlayConfigSchema = z
  .object({
    target: TargetSchema,
    block: BlockSchema.optional(),
    audit: AuditSchema.optional(),
    // FR-PIPE-016 order: audit, then gates (block, sqlGuard, rateLimit), then
    // observers (instructions), then redact last.
    sqlGuard: SqlGuardSchema.optional(),
    rateLimit: RateLimitSchema.optional(),
    instructions: InstructionsSchema.optional(),
    redact: RedactSchema.optional(),
  })
  .strict();

export type OverlayConfig = z.infer<typeof OverlayConfigSchema>;

const ENV_REF = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;

function substituteEnvInString(
  value: string,
  env: NodeJS.ProcessEnv,
): string {
  return value.replace(ENV_REF, (_match, braced, bare) => {
    const key = (braced as string | undefined) ?? (bare as string | undefined);
    if (!key) return "";
    const v = env[key];
    if (v === undefined) {
      process.stderr.write(
        `[mcp-middleware] warning: env var ${key} is unset; using empty string\n`,
      );
      return "";
    }
    return v;
  });
}

function walkAndSubstitute(value: unknown, env: NodeJS.ProcessEnv): unknown {
  if (typeof value === "string") return substituteEnvInString(value, env);
  if (Array.isArray(value)) {
    return value.map((v) => walkAndSubstitute(v, env));
  }
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = walkAndSubstitute(v, env);
    }
    return out;
  }
  return value;
}

function normalizePath(p: string, configDir: string): string {
  if (p.startsWith("~/")) {
    return resolve(homedir(), p.slice(2));
  }
  if (isAbsolute(p)) return p;
  return resolve(configDir, p);
}

function parseFile(path: string, raw: string): unknown {
  const lower = path.toLowerCase();
  if (lower.endsWith(".json")) {
    try {
      return JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `Failed to parse JSON at ${path}: ${(err as Error).message}`,
      );
    }
  }
  try {
    return yamlLoad(raw);
  } catch (err) {
    throw new Error(
      `Failed to parse YAML at ${path}: ${(err as Error).message}`,
    );
  }
}

function formatZodError(err: z.ZodError): string {
  return err.errors
    .map(
      (e, i) => `  ${i + 1}. ${e.path.join(".") || "(root)"}: ${e.message}`,
    )
    .join("\n");
}

export function validateConfig(input: unknown): OverlayConfig {
  return OverlayConfigSchema.parse(input);
}

export function loadConfig(
  configPath: string,
  env: NodeJS.ProcessEnv = process.env,
): OverlayConfig {
  const absolutePath = resolve(configPath);
  const configDir = dirname(absolutePath);

  const raw = readFileSync(absolutePath, "utf8");
  const parsed = parseFile(absolutePath, raw);
  const substituted = walkAndSubstitute(parsed, env);

  let validated: OverlayConfig;
  try {
    validated = OverlayConfigSchema.parse(substituted);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new Error(
        `Config validation failed at ${configPath}:\n${formatZodError(err)}`,
      );
    }
    throw err;
  }

  if (validated.target.cwd) {
    validated.target.cwd = normalizePath(validated.target.cwd, configDir);
  }
  if (validated.audit) {
    validated.audit.sink = normalizePath(validated.audit.sink, configDir);
  }

  return validated;
}
