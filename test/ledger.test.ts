import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildRecord, parseLedger, summarize } from "../src/ledger.js";
import { formatReport, formatRequestLine, formatUsd } from "../src/report.js";
import type { RecordInput } from "../src/ledger.js";

function input(overrides: Partial<RecordInput> = {}): RecordInput {
  return {
    route: "openai.chat",
    model: "gpt-4o",
    ok: true,
    status: 200,
    stream: false,
    level: 2,
    terse: true,
    originalTokens: 1000,
    compressedTokens: 600,
    promptChanged: true,
    actualCompletionTokens: 50,
    priceInPerMillion: 2.5,
    priceOutPerMillion: 10,
    priceSource: "table",
    assumeOutputCut: 0,
    ...overrides,
  };
}

describe("ledger and report", () => {
  it("prices the input delta and ignores failed calls in the totals", () => {
    const ok = buildRecord(input());
    assert.equal(ok.inputTokensSaved, 400);
    assert.equal(ok.inputUsdSaved, 0.001);
    assert.equal(ok.usdSaved, 0.001);
    assert.equal(ok.outputTokens, 50);

    const failed = buildRecord(input({ ok: false, status: 401, upstreamCostUsd: 0.2 }));
    assert.equal(failed.usdSaved, 0);
    assert.equal(failed.inputTokensSaved, 0);

    const longer = buildRecord(input({ originalTokens: 100, compressedTokens: 180 }));
    assert.equal(longer.inputTokensSaved, -80);
    assert.ok(longer.usdSaved < 0);

    const unchanged = buildRecord(input({ promptChanged: false, originalTokens: 10, compressedTokens: 99 }));
    assert.equal(unchanged.inputTokensSaved, 0);

    const projected = buildRecord(input({ assumeOutputCut: 0.25 }));
    assert.ok(Math.abs(projected.outputTokensProjected - (50 * 0.25) / 0.75) < 1e-9);
    assert.ok(projected.usdSaved > projected.inputUsdSaved);

    const report = summarize([ok, failed, longer]);
    assert.equal(report.requests, 2);
    assert.equal(report.failed, 1);
    assert.equal(report.inputTokensSaved, 400 - 80);
    assert.equal(report.byModel["gpt-4o"]?.requests, 2);
    const text = formatReport(report);
    assert.match(text, /grunt-proxy savings/);
    assert.match(text, /gpt-4o/);
    assert.match(formatRequestLine(ok), /gpt-4o/);
    assert.match(formatRequestLine(ok), /saved \$0\.001000/);
    assert.match(formatRequestLine(failed), /upstream 401/);
    assert.equal(formatUsd(0), "$0.000000");
  });

  it("round-trips a ledger file and skips torn lines", () => {
    const record = buildRecord(input({ model: "claude-sonnet-4", upstreamCostUsd: 0.004 }));
    const text = `not json\n\n${JSON.stringify(record)}\n{"ok":true}\n`;
    const parsed = parseLedger(text);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.model, "claude-sonnet-4");
    assert.equal(summarize(parsed).upstreamBilledUsd, 0.004);
    assert.equal(summarize(parsed).upstreamCostRequests, 1);
  });
});
