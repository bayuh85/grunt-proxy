import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { directiveForLevel, GRUNT_MARK } from "../src/glossary.js";
import { isRecord } from "../src/guard.js";
import { rewriteBody } from "../src/rewrite.js";

const FLUFFY =
  "Could you please update the configuration parameter in the application environment and write a function that returns the previous information? Thank you so much for the help with this task!";

function textOf(body: unknown): string {
  return JSON.stringify(body);
}

describe("rewriteBody", () => {
  it("does not mutate the caller payload", () => {
    const body = { model: "gpt-4o-mini", messages: [{ role: "user", content: FLUFFY }] };
    const snapshot = structuredClone(body);
    rewriteBody(body, { level: 2, terse: "always", protocol: "openai" });
    assert.deepEqual(body, snapshot);
  });

  it("compresses chat text, inserts one terse directive, and leaves tool payloads alone", () => {
    const body = {
      model: "gpt-4o-mini",
      messages: [
        { role: "user", content: FLUFFY },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "set", arguments: '{"configuration":"the previous"}' },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_1",
          content: '{"configuration":"keep the previous information exactly in this json payload"}',
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "set",
            description:
              "Update the configuration parameter for the application database and return the previous information to the caller please",
            parameters: {
              type: "object",
              properties: { configuration: { type: "string", description: "the configuration value" } },
            },
          },
        },
      ],
    };
    const result = rewriteBody(body, { level: 2, terse: "always", protocol: "openai" });
    assert.equal(result.directiveAdded, true);
    assert.equal(result.promptChanged, true);
    assert.ok(result.originalTokens > 0);
    assert.ok(isRecord(result.body) && Array.isArray(result.body.messages));
    const messages = result.body.messages as Array<Record<string, unknown>>;
    const assistant = messages.find((message) => message.role === "assistant");
    const toolCalls = assistant?.tool_calls as Array<Record<string, unknown>> | undefined;
    const call = toolCalls?.[0];
    const fn = isRecord(call?.function) ? call.function : undefined;
    assert.equal(fn?.arguments, '{"configuration":"the previous"}');
    const toolMessage = messages.find((message) => message.role === "tool");
    assert.equal(
      toolMessage?.content,
      '{"configuration":"keep the previous information exactly in this json payload"}',
    );
    const tools = (result.body as { tools: Array<{ function: { description: string; parameters: { properties: { configuration: { description: string } } } } }> }).tools;
    assert.equal(tools[0]?.function.parameters.properties.configuration.description, "the configuration value");
    assert.doesNotMatch(tools[0]?.function.description ?? "", /\bplease\b/i);
    const encoded = textOf(result.body);
    assert.equal(encoded.split(GRUNT_MARK).length - 1, 1);
    const again = rewriteBody(result.body, { level: 2, terse: "always", protocol: "openai" });
    assert.equal(textOf(again.body), encoded);
  });

  it("asks for usage on streamed OpenAI calls and preserves an explicit false", () => {
    const on = rewriteBody(
      { model: "gpt-4o-mini", stream: true, messages: [{ role: "user", content: "Hi" }] },
      { level: 0, terse: "off", protocol: "openai" },
    );
    assert.equal(isRecord(on.body) && isRecord(on.body.stream_options) && on.body.stream_options.include_usage, true);
    const off = rewriteBody(
      {
        model: "gpt-4o-mini",
        stream: true,
        stream_options: { include_usage: false },
        messages: [{ role: "user", content: "Hi" }],
      },
      { level: 0, terse: "off", protocol: "openai" },
    );
    assert.equal(isRecord(off.body) && isRecord(off.body.stream_options) && off.body.stream_options.include_usage, false);
    assert.equal(off.mutated, false);
  });

  it("compresses Anthropic system text and leaves tool_use input untouched", () => {
    const body = {
      model: "ag/claude-sonnet-4-5",
      max_tokens: 256,
      system: "Could you please keep the configuration parameter of the application environment in mind? Thank you.",
      messages: [
        {
          role: "assistant",
          content: [
            { type: "text", text: "Checking the configuration parameter for the application environment now." },
            { type: "tool_use", id: "toolu_1", name: "read", input: { path: "the configuration" } },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_1",
              content: "Please summarize the configuration parameter for the application environment. Thank you.",
            },
          ],
        },
      ],
    };
    const result = rewriteBody(body, { level: 2, terse: "always", protocol: "anthropic" });
    assert.equal(result.directiveAdded, true);
    const next = result.body;
    assert.ok(isRecord(next));
    assert.equal(typeof next.system, "string");
    assert.ok(String(next.system).startsWith(directiveForLevel(2)));
    const encoded = textOf(next);
    assert.ok(encoded.includes('"path":"the configuration"'));
    assert.equal(encoded.split(GRUNT_MARK).length - 1, 1);
    const twice = rewriteBody(next, { level: 2, terse: "always", protocol: "anthropic" });
    assert.equal(textOf(twice.body), encoded);
  });

  it("skips the terse instruction in auto mode when the prompt is small", () => {
    const result = rewriteBody(
      { model: "gpt-4o-mini", messages: [{ role: "user", content: FLUFFY }] },
      { level: 2, terse: "auto", protocol: "openai" },
    );
    assert.equal(result.directiveAdded, false);
    assert.equal(String(textOf(result.body)).includes(GRUNT_MARK), false);
    assert.equal(result.promptChanged, true);
  });
});
