import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { buildRecord } from "../src/ledger.js";

const root = fileURLToPath(new URL("..", import.meta.url));

function run(args: string[], env: NodeJS.ProcessEnv = {}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts", ...args], {
      cwd: root,
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("cli", () => {
  it("prints help", async () => {
    const result = await run(["--help"]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /grunt-proxy/);
    assert.match(result.stdout, /8642/);
    assert.match(result.stdout, /atmorouter\.dev/);
  });

  it("prints a savings report from a ledger file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "grunt-report-"));
    const file = path.join(dir, "savings.jsonl");
    const record = buildRecord({
      route: "openai.chat",
      model: "gpt-4o-mini",
      ok: true,
      status: 200,
      stream: false,
      level: 2,
      terse: false,
      originalTokens: 200,
      compressedTokens: 80,
      promptChanged: true,
      priceInPerMillion: 0.15,
      priceOutPerMillion: 0.6,
      priceSource: "table",
      assumeOutputCut: 0,
    });
    await writeFile(file, `${JSON.stringify(record)}\n`);
    const result = await run(["--report", file]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /grunt-proxy savings/);
    assert.match(result.stdout, /gpt-4o-mini/);
    assert.match(result.stdout, /120/);
  });
});
