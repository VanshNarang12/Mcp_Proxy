import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadConfig, validateConfig } from "../src/config.js";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mcp-config-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeTmp(name: string, content: string): string {
  const path = join(tmpDir, name);
  writeFileSync(path, content, "utf8");
  return path;
}

describe("validateConfig", () => {
  it("accepts a minimal valid config and applies defaults", () => {
    const result = validateConfig({ target: { command: "python" } });
    expect(result.target.command).toBe("python");
    expect(result.target.args).toEqual([]);
    expect(result.target.env).toEqual({});
    expect(result.block).toBeUndefined();
  });

  it("preserves a provided block.tools list", () => {
    const result = validateConfig({
      target: { command: "python" },
      block: { tools: ["admin_*", "delete_db"] },
    });
    expect(result.block?.tools).toEqual(["admin_*", "delete_db"]);
  });

  it("rejects a missing target", () => {
    expect(() => validateConfig({})).toThrow();
  });

  it("rejects a missing target.command", () => {
    expect(() => validateConfig({ target: {} })).toThrow();
  });

  it("rejects an empty target.command", () => {
    expect(() => validateConfig({ target: { command: "" } })).toThrow();
  });

  it("rejects unknown top-level keys (strict mode)", () => {
    expect(() =>
      validateConfig({
        target: { command: "python" },
        unknown_key: "value",
      }),
    ).toThrow();
  });

  it("rejects unknown keys inside target", () => {
    expect(() =>
      validateConfig({
        target: { command: "python", typo_key: "x" },
      }),
    ).toThrow();
  });

  it("rejects unknown keys inside block", () => {
    expect(() =>
      validateConfig({
        target: { command: "python" },
        block: { tools: [], unknown: 1 },
      }),
    ).toThrow();
  });

  it("rejects a wrong type for target.args (string instead of array)", () => {
    expect(() =>
      validateConfig({
        target: { command: "python", args: "not-an-array" },
      }),
    ).toThrow();
  });

  it("accepts an empty block.tools array", () => {
    const result = validateConfig({
      target: { command: "python" },
      block: { tools: [] },
    });
    expect(result.block?.tools).toEqual([]);
  });
});

describe("loadConfig", () => {
  describe("file format detection", () => {
    it("loads a YAML file with .yaml extension", () => {
      const path = writeTmp(
        "config.yaml",
        "target:\n  command: python\n  args:\n    - server.py\n",
      );
      const result = loadConfig(path);
      expect(result.target.command).toBe("python");
      expect(result.target.args).toEqual(["server.py"]);
    });

    it("loads a YAML file with .yml extension", () => {
      const path = writeTmp("config.yml", "target:\n  command: node\n");
      const result = loadConfig(path);
      expect(result.target.command).toBe("node");
    });

    it("loads a JSON file with .json extension", () => {
      const path = writeTmp(
        "config.json",
        JSON.stringify({ target: { command: "deno" } }),
      );
      const result = loadConfig(path);
      expect(result.target.command).toBe("deno");
    });
  });

  describe("error handling", () => {
    it("throws ENOENT for a missing file", () => {
      expect(() => loadConfig(join(tmpDir, "does-not-exist.yaml"))).toThrow(
        /ENOENT/,
      );
    });

    it("throws a clear error for malformed YAML", () => {
      const path = writeTmp(
        "bad.yaml",
        "target:\n  command: python\nexit\n",
      );
      expect(() => loadConfig(path)).toThrow(/Failed to parse YAML/);
    });

    it("throws a clear error for malformed JSON", () => {
      const path = writeTmp("bad.json", "{ not valid json");
      expect(() => loadConfig(path)).toThrow(/Failed to parse JSON/);
    });

    it("includes the config path in validation errors", () => {
      const path = writeTmp("invalid.yaml", 'target:\n  command: ""\n');
      expect(() => loadConfig(path)).toThrow(/Config validation failed/);
      expect(() => loadConfig(path)).toThrow(path);
    });
  });

  describe("env var substitution", () => {
    it("substitutes ${VAR} form", () => {
      const path = writeTmp(
        "envs.yaml",
        "target:\n  command: ${MY_PY}\n",
      );
      const result = loadConfig(path, { MY_PY: "/usr/bin/python" });
      expect(result.target.command).toBe("/usr/bin/python");
    });

    it("substitutes $VAR form", () => {
      const path = writeTmp("envs.yaml", "target:\n  command: $MY_PY\n");
      const result = loadConfig(path, { MY_PY: "/usr/bin/python" });
      expect(result.target.command).toBe("/usr/bin/python");
    });

    it("substitutes inside a larger string", () => {
      const path = writeTmp(
        "envs.yaml",
        "target:\n  command: ${HOME}/bin/python\n",
      );
      const result = loadConfig(path, { HOME: "/Users/test" });
      expect(result.target.command).toBe("/Users/test/bin/python");
    });

    it("warns and substitutes empty string for a missing env var", () => {
      const path = writeTmp(
        "envs.yaml",
        "target:\n  command: python\n  args:\n    - ${MISSING_VAR}\n",
      );

      const spy = vi
        .spyOn(process.stderr, "write")
        .mockReturnValue(true as never);
      try {
        const result = loadConfig(path, {});
        expect(result.target.args).toEqual([""]);
        const captured = spy.mock.calls
          .map((c) => String(c[0]))
          .join("");
        expect(captured).toMatch(/MISSING_VAR/);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe("path normalization", () => {
    it("expands ~/ in target.cwd to the home directory", () => {
      const path = writeTmp(
        "cwd.yaml",
        "target:\n  command: python\n  cwd: ~/subdir\n",
      );
      const result = loadConfig(path);
      expect(result.target.cwd).toBe(join(homedir(), "subdir"));
    });

    it("resolves relative target.cwd against the config file's directory", () => {
      const path = writeTmp(
        "cwd.yaml",
        "target:\n  command: python\n  cwd: ./subdir\n",
      );
      const result = loadConfig(path);
      expect(result.target.cwd).toBe(join(tmpDir, "subdir"));
    });

    it("leaves an absolute target.cwd unchanged", () => {
      const path = writeTmp(
        "cwd.yaml",
        "target:\n  command: python\n  cwd: /opt/foo\n",
      );
      const result = loadConfig(path);
      expect(result.target.cwd).toBe("/opt/foo");
    });
  });
});
