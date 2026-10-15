import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lookupTablePrice, parseCostHeader, projectOutputSavings, resolvePrice, tokenUsd } from "../src/pricing.js";

describe("pricing", () => {
  it("matches the more specific model id", () => {
    assert.equal(lookupTablePrice("openai/gpt-4o-mini")?.inputPerMillion, 0.15);
    assert.equal(lookupTablePrice("gpt-4o-2024-08-06")?.inputPerMillion, 2.5);
    assert.equal(lookupTablePrice("ag/claude-opus-4-6-thinking")?.inputPerMillion, 15);
    assert.equal(lookupTablePrice("claude-3-5-sonnet")?.inputPerMillion, 3);
    assert.equal(lookupTablePrice("atmo/deepseek-v4.1-flash")?.inputPerMillion, 0.27);
  });

  it("lets env prices override the table", () => {
    const price = resolvePrice("gpt-4o", { input: 0.4 });
    assert.equal(price.source, "env");
    assert.equal(price.inputPerMillion, 0.4);
    assert.equal(price.outputPerMillion, 10);
  });

  it("uses a labeled default when the model is unknown", () => {
    const price = resolvePrice("cbcn/glm-5.3");
    assert.equal(price.source, "default");
    assert.equal(price.inputPerMillion, 1);
    assert.equal(price.outputPerMillion, 3);
  });

  it("converts tokens to dollars and projects output only when asked", () => {
    assert.equal(tokenUsd(1_000_000, 2.5), 2.5);
    assert.equal(tokenUsd(1_000, 2.5), 0.0025);
    assert.deepEqual(projectOutputSavings(100, 0, 10), { tokens: 0, usd: 0 });
    const projected = projectOutputSavings(75, 0.25, 10);
    assert.ok(Math.abs(projected.tokens - 25) < 1e-9);
    assert.ok(Math.abs(projected.usd - 0.00025) < 1e-12);
  });

  it("parses an upstream cost header", () => {
    assert.equal(parseCostHeader("0.002000"), 0.002);
    assert.equal(parseCostHeader("$0.15"), 0.15);
    assert.equal(parseCostHeader("nope"), undefined);
    assert.equal(parseCostHeader(null), undefined);
  });
});
