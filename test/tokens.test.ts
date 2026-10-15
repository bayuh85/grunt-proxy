import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estimateTokens } from "../src/tokens.js";

describe("estimateTokens", () => {
  it("counts empty text as zero and grows with more words", () => {
    assert.equal(estimateTokens(""), 0);
    assert.equal(estimateTokens("   "), 0);
    const hello = estimateTokens("hello");
    assert.ok(hello >= 1);
    assert.ok(estimateTokens("hello world") > hello);
    assert.equal(estimateTokens("hello"), estimateTokens("hello"));
  });
});
