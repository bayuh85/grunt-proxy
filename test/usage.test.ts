import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSseParser, usageFromJson } from "../src/usage.js";

describe("usage", () => {
  it("reads OpenAI and Anthropic JSON usage", () => {
    assert.deepEqual(
      usageFromJson({ usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }, "openai"),
      { promptTokens: 10, completionTokens: 2 },
    );
    assert.deepEqual(usageFromJson({ usage: { input_tokens: 8, output_tokens: 3 } }, "anthropic"), {
      promptTokens: 8,
      completionTokens: 3,
    });
    assert.deepEqual(usageFromJson({ input_tokens: 4 }, "anthropic"), { promptTokens: 4 });
  });

  it("reads usage split across SSE chunks", () => {
    const seen: Array<{ promptTokens?: number; completionTokens?: number }> = [];
    const parser = createSseParser("openai", (usage) => seen.push(usage));
    const raw =
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n' +
      'data: {"usage":{"prompt_tokens":12,"completion_tokens":1,"total_tokens":13}}\n\n' +
      "data: [DONE]\n\n";
    parser.push(raw.slice(0, 20));
    parser.push(raw.slice(20));
    assert.deepEqual(seen, [{ promptTokens: 12, completionTokens: 1 }]);
  });

  it("keeps the latest Anthropic output total", () => {
    const seen: Array<{ promptTokens?: number; completionTokens?: number }> = [];
    const parser = createSseParser("anthropic", (usage) => seen.push(usage));
    parser.push(
      'data: {"type":"message_start","message":{"usage":{"input_tokens":20,"output_tokens":1}}}\n\n' +
        'data: {"type":"message_delta","usage":{"output_tokens":9}}\n\n',
    );
    assert.equal(seen[0]?.promptTokens, 20);
    assert.equal(seen[1]?.completionTokens, 9);
  });
});
