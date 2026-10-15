import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { Config } from "../src/config.js";
import { startServer, type RunningServer } from "../src/server.js";

const FLUFFY =
  "Could you please update the configuration parameter in the application environment and write a function that returns the previous information? Thank you so much!\n\n```ts\nconst the = 1;\nfunction configuration() { return the; }\n```\n";

interface Hit {
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}

function proxyConfig(upstreamBaseUrl: string, extra: Partial<Config> = {}): Config {
  return {
    host: "127.0.0.1",
    port: 0,
    upstreamBaseUrl,
    level: 2,
    terse: "always",
    assumeOutputCut: 0,
    maxBodyBytes: 32 * 1024 * 1024,
    timeoutMs: 0,
    overrideKey: "ar-test",
    ...extra,
  };
}

async function listen(server: ReturnType<typeof createServer>): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  return address.port;
}

async function startMock(
  handler: (req: IncomingMessage, res: ServerResponse, body: string) => void,
): Promise<{ origin: string; hits: Hit[]; close: () => Promise<void> }> {
  const hits: Hit[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      hits.push({ url: req.url ?? "", headers: req.headers, body });
      handler(req, res, body);
    });
  });
  const port = await listen(server);
  return {
    origin: `http://127.0.0.1:${port}`,
    hits,
    close: () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function closeProxy(proxy: RunningServer): Promise<void> {
  await proxy.close();
}

describe("server", () => {
  it("compresses chat completions, forwards to the /v1 upstream, and records savings", async () => {
    const lines: string[] = [];
    const dir = await mkdtemp(path.join(tmpdir(), "grunt-log-"));
    const logFile = path.join(dir, "savings.jsonl");
    const mock = await startMock((_req, res) => {
      res.writeHead(200, {
        "content-type": "application/json",
        "x-atmorouter-cost": "0.002",
      });
      res.end(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "Done." } }],
          usage: { prompt_tokens: 90, completion_tokens: 4, total_tokens: 94 },
        }),
      );
    });
    const proxy = await startServer({
      config: proxyConfig(`${mock.origin}/v1`, { logFile, priceIn: 3, priceOut: 15 }),
      log: (line) => lines.push(line),
    });
    try {
      const response = await fetch(`${proxy.url}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer client-secret",
        },
        body: JSON.stringify({
          model: "ag/claude-sonnet-4-5",
          messages: [{ role: "user", content: FLUFFY }],
        }),
      });
      const payload = (await response.json()) as { choices: Array<{ message: { content: string } }> };
      assert.equal(response.status, 200);
      assert.equal(payload.choices[0]?.message.content, "Done.");
      assert.equal(response.headers.get("x-grunt-proxy"), "1");
      assert.equal(response.headers.get("x-grunt-terse"), "1");
      const saved = Number(response.headers.get("x-grunt-saved-tokens"));
      assert.ok(Number.isFinite(saved));

      const hit = mock.hits[0];
      assert.ok(hit);
      assert.equal(hit.url, "/v1/chat/completions");
      assert.equal(hit.headers.authorization, "Bearer ar-test");
      const forwarded = JSON.parse(hit.body) as { messages: Array<{ role: string; content: string }> };
      const joined = forwarded.messages.map((message) => message.content).join("\n");
      assert.match(joined, /\[grunt\]/);
      assert.ok(joined.includes("```ts\nconst the = 1;\nfunction configuration() { return the; }\n```"));
      assert.doesNotMatch(joined, /\bplease\b/i);
      assert.equal(hit.body.includes("client-secret"), false);

      const savings = (await (await fetch(`${proxy.url}/savings`)).json()) as {
        requests: number;
        outputTokens: number;
        upstreamBilledUsd: number;
        usdSaved: number;
      };
      assert.equal(savings.requests, 1);
      assert.equal(savings.outputTokens, 4);
      assert.equal(savings.upstreamBilledUsd, 0.002);
      assert.ok(savings.usdSaved !== 0);
      assert.match(lines[0] ?? "", /^grunt  ag\/claude-sonnet-4-5/);
      assert.match(lines[0] ?? "", /billed \$0\.002000/);

      const text = await (await fetch(`${proxy.url}/savings.txt`)).text();
      assert.match(text, /grunt-proxy savings/);
      const ledger = await readFile(logFile, "utf8");
      assert.match(ledger, /ag\/claude-sonnet-4-5/);

      const home = await (await fetch(proxy.url)).text();
      assert.match(home, /OpenAI-compatible compressing proxy/);
      const health = (await (await fetch(`${proxy.url}/health`)).json()) as { ok: boolean };
      assert.equal(health.ok, true);
    } finally {
      await closeProxy(proxy);
      await mock.close();
    }
  });

  it("speaks Anthropic messages and streams bytes unchanged", async () => {
    const sse =
      'data: {"type":"message_start","message":{"usage":{"input_tokens":30,"output_tokens":1}}}\n\n' +
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Ok"}}\n\n' +
      'data: {"type":"message_delta","usage":{"output_tokens":6}}\n\n';
    const mock = await startMock((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(sse);
    });
    const proxy = await startServer({
      config: proxyConfig(mock.origin, { overrideKey: undefined, terse: "off", level: 1 }),
      log: () => undefined,
    });
    try {
      const response = await fetch(`${proxy.url}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": "ar-client" },
        body: JSON.stringify({
          model: "ag/claude-haiku",
          max_tokens: 32,
          stream: true,
          messages: [
            {
              role: "user",
              content: "Could you please summarize the configuration parameter for the application environment? Thank you!",
            },
          ],
        }),
      });
      const body = await response.text();
      assert.equal(body, sse);
      assert.equal(mock.hits[0]?.url, "/v1/messages");
      assert.equal(mock.hits[0]?.headers["x-api-key"], "ar-client");
      assert.equal(mock.hits[0]?.headers["anthropic-version"], "2023-06-01");
      const forwarded = JSON.parse(mock.hits[0]?.body ?? "{}") as { messages: Array<{ content: string }> };
      assert.doesNotMatch(forwarded.messages[0]?.content ?? "", /\bplease\b/i);
      const savings = (await (await fetch(`${proxy.url}/savings`)).json()) as {
        outputTokens: number;
        requests: number;
      };
      assert.equal(savings.requests, 1);
      assert.equal(savings.outputTokens, 6);
    } finally {
      await closeProxy(proxy);
      await mock.close();
    }
  });

  it("can bypass compression and can pass other routes through", async () => {
    const mock = await startMock((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [] }));
    });
    const proxy = await startServer({
      config: proxyConfig(`${mock.origin}/v1`),
      log: () => undefined,
    });
    try {
      const raw = JSON.stringify({
        model: "gpt-4o-mini",
        stream: true,
        messages: [{ role: "user", content: FLUFFY }],
      });
      const bypassed = await fetch(`${proxy.url}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-grunt": "off" },
        body: raw,
      });
      assert.equal(bypassed.headers.get("x-grunt-bypass"), "1");
      assert.equal(mock.hits[0]?.body, raw);
      const parsed = JSON.parse(mock.hits[0]?.body ?? "{}") as { stream_options?: unknown };
      assert.equal(parsed.stream_options, undefined);

      const models = await fetch(`${proxy.url}/v1/models?limit=2`);
      assert.equal(models.status, 200);
      assert.equal(mock.hits[1]?.url, "/v1/models?limit=2");
      assert.equal(mock.hits[1]?.headers.authorization, "Bearer ar-test");
      const savings = (await (await fetch(`${proxy.url}/savings`)).json()) as { requests: number; failed: number };
      assert.equal(savings.requests, 1);
      assert.equal(savings.failed, 0);
    } finally {
      await closeProxy(proxy);
      await mock.close();
    }
  });

  it("forwards upstream errors and answers 413 and 502 locally", async () => {
    const mock = await startMock((_req, res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "bad key" } }));
    });
    const proxy = await startServer({
      config: proxyConfig(`${mock.origin}/v1`, { terse: "off", level: 0 }),
      log: () => undefined,
    });
    try {
      const denied = await fetch(`${proxy.url}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: "Hello" }] }),
      });
      assert.equal(denied.status, 401);
      const deniedBody = (await denied.json()) as { error: { message: string } };
      assert.equal(deniedBody.error.message, "bad key");
      const savings = (await (await fetch(`${proxy.url}/savings`)).json()) as { requests: number; failed: number; usdSaved: number };
      assert.equal(savings.failed, 1);
      assert.equal(savings.requests, 0);
      assert.equal(savings.usdSaved, 0);
    } finally {
      await closeProxy(proxy);
      await mock.close();
    }

    const small = await startServer({
      config: proxyConfig("http://127.0.0.1:9/v1", { maxBodyBytes: 32 }),
      log: () => undefined,
    });
    try {
      const response = await fetch(`${small.url}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "x".repeat(80),
      });
      assert.equal(response.status, 413);
      const body = (await response.json()) as { error: { type: string } };
      assert.equal(body.error.type, "grunt_body_too_large");
    } finally {
      await closeProxy(small);
    }

    const down = await startServer({
      config: proxyConfig("http://127.0.0.1:9/v1", { timeoutMs: 1000 }),
      log: () => undefined,
    });
    try {
      const response = await fetch(`${down.url}/v1/models`);
      assert.equal(response.status, 502);
      const body = (await response.json()) as { error: { type: string } };
      assert.equal(body.error.type, "grunt_upstream_error");
    } finally {
      await closeProxy(down);
    }
  });

  it("aborts an upstream that never responds", async () => {
    const hanging = createServer(() => {
      // Leave the socket open until the proxy aborts.
    });
    const port = await listen(hanging);
    const proxy = await startServer({
      config: proxyConfig(`http://127.0.0.1:${port}/v1`, { timeoutMs: 200 }),
      log: () => undefined,
    });
    try {
      const response = await fetch(`${proxy.url}/v1/models`);
      assert.equal(response.status, 502);
    } finally {
      await closeProxy(proxy);
      hanging.closeAllConnections();
      await new Promise<void>((resolve, reject) => hanging.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
