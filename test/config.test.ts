import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { parseArgs, parseLevel, resolveConfig } from "../src/config.js";
import { loadEnvFile } from "../src/envfile.js";
import { directiveForLevel } from "../src/glossary.js";

describe("config", () => {
  it("defaults to AtmoRouter on localhost", () => {
    const config = resolveConfig({});
    assert.equal(config.upstreamBaseUrl, "https://atmorouter.dev/v1");
    assert.equal(config.host, "127.0.0.1");
    assert.equal(config.port, 8642);
    assert.equal(config.level, 2);
    assert.equal(config.terse, "auto");
    assert.equal(config.overrideKey, undefined);
    assert.equal(config.assumeOutputCut, 0);
  });

  it("prefers GRUNT_API_KEY, then ATMOROUTER_API_KEY, and keeps CLI flags ahead of env", () => {
    assert.equal(resolveConfig({ GRUNT_API_KEY: "  " }).overrideKey, undefined);
    assert.equal(resolveConfig({ ATMOROUTER_API_KEY: "ar-b" }).overrideKey, "ar-b");
    assert.equal(resolveConfig({ GRUNT_API_KEY: "ar-a", ATMOROUTER_API_KEY: "ar-b" }).overrideKey, "ar-a");
    const config = resolveConfig({ GRUNT_PORT: "9000", GRUNT_LEVEL: "1" }, parseArgs(["--port", "8643", "--level", "3"]));
    assert.equal(config.port, 8643);
    assert.equal(config.level, 3);
  });

  it("rejects bad values", () => {
    assert.throws(() => resolveConfig({ GRUNT_PORT: "70000" }), /Invalid port/);
    assert.throws(() => parseLevel("9"), /GRUNT_LEVEL/);
    assert.throws(() => resolveConfig({ GRUNT_TERSE: "loud" }), /GRUNT_TERSE/);
    assert.throws(() => resolveConfig({ GRUNT_ASSUME_OUTPUT_CUT: "0.95" }), /GRUNT_ASSUME_OUTPUT_CUT/);
    assert.throws(() => parseArgs(["--nope"]), /Unknown argument/);
  });

  it("loads a dotenv file without overriding the real environment", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "grunt-env-"));
    const file = path.join(dir, ".env");
    await writeFile(file, '# comment\nGRUNT_PORT=8642\nGRUNT_LEVEL="3"\nGRUNT_API_KEY=\'ar-file\'\n');
    const env: NodeJS.ProcessEnv = { GRUNT_PORT: "1" };
    loadEnvFile(file, env);
    assert.equal(env.GRUNT_PORT, "1");
    assert.equal(env.GRUNT_LEVEL, "3");
    assert.equal(env.GRUNT_API_KEY, "ar-file");
  });

  it("keeps the terse directive to a single cache-stable paragraph", () => {
    const level2 = directiveForLevel(2);
    const level3 = directiveForLevel(3);
    assert.equal(level2.includes("\n"), false);
    assert.match(level2, /config configuration/);
    assert.equal(level2.includes("btwn"), false);
    assert.match(level3, /btwn between/);
    assert.equal(directiveForLevel(2), level2);
  });
});
