import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildUpstreamHeaders, resolveUpstreamUrl, routeKind } from "../src/upstream.js";

describe("upstream routing", () => {
  it("classifies chat, messages, and everything else", () => {
    assert.equal(routeKind("/v1/chat/completions"), "openai.chat");
    assert.equal(routeKind("/chat/completions/"), "openai.chat");
    assert.equal(routeKind("/v1/messages"), "anthropic.messages");
    assert.equal(routeKind("/v1/messages/count_tokens"), "anthropic.messages");
    assert.equal(routeKind("/v1/models"), "other");
  });

  it("joins the default AtmoRouter base with OpenAI and Anthropic paths", () => {
    const base = "https://atmorouter.dev/v1";
    assert.equal(
      resolveUpstreamUrl(base, "/v1/chat/completions"),
      "https://atmorouter.dev/v1/chat/completions",
    );
    assert.equal(resolveUpstreamUrl(base, "/v1/messages"), "https://atmorouter.dev/v1/messages");
    assert.equal(
      resolveUpstreamUrl("https://atmorouter.dev", "/v1/messages", "?beta=true"),
      "https://atmorouter.dev/v1/messages?beta=true",
    );
    assert.equal(
      resolveUpstreamUrl("https://api.openai.com/v1/", "/v1/models"),
      "https://api.openai.com/v1/models",
    );
  });

  it("rejects a non-http upstream", () => {
    assert.throws(() => resolveUpstreamUrl("ftp://example.com", "/v1/models"), /Unsupported upstream protocol/);
  });

  it("applies the env key, otherwise forwards the client key", () => {
    const overridden = buildUpstreamHeaders({ authorization: "Bearer client" }, "openai", { overrideKey: "ar-env" });
    assert.equal(overridden.get("authorization"), "Bearer ar-env");
    assert.equal(overridden.get("x-api-key"), "ar-env");

    const forwarded = buildUpstreamHeaders(
      { authorization: "Bearer client", "x-grunt-level": "3" },
      "openai",
      { openaiKey: "sk-fallback" },
    );
    assert.equal(forwarded.get("authorization"), "Bearer client");
    assert.equal(forwarded.get("x-grunt-level"), null);

    const fallback = buildUpstreamHeaders({}, "anthropic", { anthropicKey: "ar-anth" });
    assert.equal(fallback.get("x-api-key"), "ar-anth");
    assert.equal(fallback.get("anthropic-version"), "2023-06-01");

    const versioned = buildUpstreamHeaders({ "anthropic-version": "2024-10-22" }, "anthropic", {});
    assert.equal(versioned.get("anthropic-version"), "2024-10-22");
    assert.equal(versioned.get("authorization"), null);
  });
});
