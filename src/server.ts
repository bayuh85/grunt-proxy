import { once } from "node:events";
import { appendFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Config } from "./config.js";
import { buildRecord, Ledger, type RecordInput } from "./ledger.js";
import { parseCostHeader, resolvePrice } from "./pricing.js";
import { formatReport, formatRequestLine } from "./report.js";
import { rewriteBody, type RewriteResult } from "./rewrite.js";
import { estimateTokens } from "./tokens.js";
import type { Protocol, TerseMode } from "./types.js";
import {
  buildUpstreamHeaders,
  copyResponseHeaders,
  protocolFor,
  resolveUpstreamUrl,
  routeKind,
} from "./upstream.js";
import { createSseParser, mergeUsage, usageFromJson, type Usage } from "./usage.js";
import { isRecord } from "./guard.js";

export class HttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export interface RunningServer {
  port: number;
  url: string;
  ledger: Ledger;
  close: () => Promise<void>;
}

export interface StartOptions {
  config: Config;
  ledger?: Ledger;
  log?: (line: string) => void;
}

interface Policy {
  bypass: boolean;
  level: number;
  terse: TerseMode;
}

export async function startServer(options: StartOptions): Promise<RunningServer> {
  const ledger = options.ledger ?? new Ledger();
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const { config } = options;
  let boundPort = config.port;

  const server = createServer((req, res) => {
    handle(req, res, config, ledger, log, () => boundPort).catch((error: unknown) => {
      if (res.headersSent || res.writableEnded) {
        res.destroy();
        return;
      }
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof Error ? error.message : "internal error";
      const type = status === 413 ? "grunt_body_too_large" : status === 502 ? "grunt_upstream_error" : "grunt_proxy_error";
      sendJson(res, status, { error: { message, type } });
    });
  });
  server.requestTimeout = 0;
  server.headersTimeout = 0;
  server.timeout = 0;

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once("error", onError);
    server.listen(config.port, config.host, () => {
      server.off("error", onError);
      resolve();
    });
  });

  const address = server.address();
  if (address && typeof address !== "string") boundPort = address.port;
  const shownHost = config.host === "0.0.0.0" || config.host === "::" ? "127.0.0.1" : config.host;

  return {
    port: boundPort,
    url: `http://${shownHost}:${boundPort}`,
    ledger,
    close: () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  config: Config,
  ledger: Ledger,
  log: (line: string) => void,
  boundPort: () => number,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method === "GET" && isLocalPath(url.pathname)) {
    serveLocal(url.pathname, config, ledger, res, boundPort());
    return;
  }

  const route = routeKind(url.pathname);
  const protocol = protocolFor(route);
  const raw = await readBody(req, config.maxBodyBytes);
  const policy = requestPolicy(req, config);
  const compressible =
    route !== "other" && (req.method === "POST" || req.method === "PUT" || req.method === "PATCH");

  let forwardBody = raw.length > 0 ? raw.toString("utf8") : undefined;
  let stats = emptyStats();
  if (compressible && raw.length > 0) {
    const parsed = tryParseJson(raw, headerValue(req, "content-type") ?? "");
    if (isRecord(parsed)) {
      const prepared = applyRewrite(parsed, protocol, policy);
      stats = prepared.stats;
      if (prepared.forward !== undefined) forwardBody = prepared.forward;
    }
  }

  const upstreamUrl = resolveUpstreamUrl(config.upstreamBaseUrl, url.pathname, url.search);
  const headers = buildUpstreamHeaders(req.headers, protocol, {
    ...(config.overrideKey ? { overrideKey: config.overrideKey } : {}),
    ...(config.openaiKey ? { openaiKey: config.openaiKey } : {}),
    ...(config.anthropicKey ? { anthropicKey: config.anthropicKey } : {}),
  });
  if (forwardBody !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const ac = new AbortController();
  let finished = false;
  res.on("close", () => {
    if (!finished) ac.abort();
  });
  const signals = [ac.signal];
  if (config.timeoutMs > 0) signals.push(AbortSignal.timeout(config.timeoutMs));

  let upstream: Response;
  try {
    const method = req.method ?? "GET";
    upstream = await fetch(upstreamUrl, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : forwardBody,
      signal: AbortSignal.any(signals),
    });
  } catch (error) {
    finished = true;
    const message = error instanceof Error ? error.message : "upstream request failed";
    throw new HttpError(`upstream request failed: ${message}`, 502);
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  const extra = route === "other" ? { "x-grunt-proxy": "1" } : responseExtras(stats, policy.bypass);
  const ok = upstream.status >= 200 && upstream.status < 300;

  const note = async (usage: Usage, streamed: boolean): Promise<void> => {
    if (route === "other") return;
    const price = resolvePrice(stats.model, { input: config.priceIn, output: config.priceOut });
    const input: RecordInput = {
      route,
      model: stats.model,
      ok,
      status: upstream.status,
      stream: streamed || stats.stream,
      level: policy.bypass ? 0 : policy.level,
      terse: stats.terse,
      originalTokens: stats.originalTokens,
      compressedTokens: stats.compressedTokens,
      promptChanged: stats.promptChanged,
      priceInPerMillion: price.inputPerMillion,
      priceOutPerMillion: price.outputPerMillion,
      priceSource: price.source,
      assumeOutputCut: config.assumeOutputCut,
    };
    if (usage.promptTokens !== undefined) input.actualPromptTokens = usage.promptTokens;
    if (usage.completionTokens !== undefined) input.actualCompletionTokens = usage.completionTokens;
    if (ok) {
      const cost = parseCostHeader(upstream.headers.get("x-atmorouter-cost"));
      if (cost !== undefined) input.upstreamCostUsd = cost;
    }
    const record = buildRecord(input);
    ledger.add(record);
    log(formatRequestLine(record));
    if (!config.logFile) return;
    try {
      await appendFile(config.logFile, `${JSON.stringify(record)}\n`, "utf8");
    } catch (error) {
      const message = error instanceof Error ? error.message : "log failed";
      log(`grunt  ledger write failed: ${message}`);
    }
  };

  if (contentType.includes("text/event-stream") && upstream.body) {
    res.writeHead(upstream.status, headersToNode(copyResponseHeaders(upstream.headers, extra)));
    let usage: Usage = {};
    const parser = createSseParser(protocol, (next) => {
      usage = mergeUsage(usage, next);
    });
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || res.destroyed || res.writableEnded) continue;
        parser.push(decoder.decode(value, { stream: true }));
        const wrote = res.write(value);
        if (!wrote) {
          await Promise.race([once(res, "drain"), once(res, "close")]);
        }
      }
      parser.push(decoder.decode());
    } finally {
      finished = true;
      if (!res.writableEnded) res.end();
    }
    await note(usage, true);
    return;
  }

  const buf = Buffer.from(await upstream.arrayBuffer());
  let usage: Usage = {};
  if (contentType.includes("json") || looksLikeJsonBuffer(buf)) {
    try {
      const parsed = usageFromJson(JSON.parse(buf.toString("utf8")) as unknown, protocol);
      if (parsed) usage = parsed;
    } catch {
      // Error bodies are forwarded as the upstream sent them.
    }
  }
  const outHeaders = headersToNode(copyResponseHeaders(upstream.headers, extra));
  res.writeHead(upstream.status, outHeaders);
  res.end(buf);
  finished = true;
  await note(usage, false);
}

function applyRewrite(
  parsed: Record<string, unknown>,
  protocol: Protocol,
  policy: Policy,
): { stats: RewriteResult; forward?: string } {
  const model = typeof parsed.model === "string" && parsed.model.length > 0 ? parsed.model : "unknown";
  const stream = parsed.stream === true;
  if (policy.bypass || protocol === "other") {
    const tokens = estimateTokens(JSON.stringify(parsed));
    return { stats: { ...emptyStats(), model, stream, originalTokens: tokens, compressedTokens: tokens, level: 0 } };
  }
  const result = rewriteBody(parsed, { level: policy.level, terse: policy.terse, protocol });
  if (!result.mutated) return { stats: result };
  return { stats: result, forward: JSON.stringify(result.body) };
}

function emptyStats(): RewriteResult {
  return {
    body: undefined,
    mutated: false,
    model: "unknown",
    stream: false,
    originalTokens: 0,
    compressedTokens: 0,
    promptChanged: false,
    directiveAdded: false,
    level: 0,
    terse: false,
  };
}

function responseExtras(stats: RewriteResult, bypass: boolean): Record<string, string> {
  if (bypass) return { "x-grunt-proxy": "1", "x-grunt-bypass": "1" };
  return {
    "x-grunt-proxy": "1",
    "x-grunt-original-tokens": String(stats.originalTokens),
    "x-grunt-compressed-tokens": String(stats.compressedTokens),
    "x-grunt-saved-tokens": String(stats.originalTokens - stats.compressedTokens),
    "x-grunt-terse": stats.terse ? "1" : "0",
  };
}

function isLocalPath(pathname: string): boolean {
  return pathname === "/" || pathname === "/health" || pathname === "/savings" || pathname === "/savings.txt";
}

function serveLocal(
  pathname: string,
  config: Config,
  ledger: Ledger,
  res: ServerResponse,
  port: number,
): void {
  if (pathname === "/health") {
    sendJson(res, 200, { ok: true, service: "grunt-proxy" });
    return;
  }
  if (pathname === "/savings") {
    sendJson(res, 200, ledger.summary());
    return;
  }
  if (pathname === "/savings.txt") {
    const body = `${formatReport(ledger.summary())}\n`;
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "x-grunt-proxy": "1" });
    res.end(body);
    return;
  }
  const host = config.host === "0.0.0.0" || config.host === "::" ? "127.0.0.1" : config.host;
  const text = [
    "grunt-proxy",
    "OpenAI-compatible compressing proxy",
    "",
    `listening  http://${host}:${port}`,
    `upstream   ${config.upstreamBaseUrl}`,
    `compress   level ${config.level} · terse ${config.terse}`,
    "",
    "OpenAI clients     this origin + /v1",
    "Anthropic clients  this origin (they append /v1/messages)",
    "",
    "GET /health",
    "GET /savings",
    "GET /savings.txt",
    "",
  ].join("\n");
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "x-grunt-proxy": "1" });
  res.end(text);
}

function requestPolicy(req: IncomingMessage, config: Config): Policy {
  const grunt = headerValue(req, "x-grunt")?.toLowerCase();
  if (grunt === "off" || grunt === "0" || grunt === "bypass") {
    return { bypass: true, level: 0, terse: "off" };
  }
  let level = config.level;
  const levelHeader = headerValue(req, "x-grunt-level");
  if (levelHeader && /^[0-3]$/.test(levelHeader)) level = Number(levelHeader);
  let terse = config.terse;
  const terseHeader = headerValue(req, "x-grunt-terse")?.toLowerCase();
  if (terseHeader === "off" || terseHeader === "auto" || terseHeader === "always") terse = terseHeader;
  return { bypass: false, level, terse };
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function tryParseJson(raw: Buffer, contentType: string): unknown | undefined {
  const text = raw.toString("utf8");
  const trimmed = text.trimStart();
  const looks = contentType.toLowerCase().includes("json") || trimmed.startsWith("{") || trimmed.startsWith("[");
  if (!looks) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function looksLikeJsonBuffer(buf: Buffer): boolean {
  const trimmed = buf.toString("utf8").trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    req.on("data", (chunk: Buffer | string) => {
      if (settled) return;
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      total += buf.length;
      if (total > max) {
        settled = true;
        req.resume();
        reject(new HttpError("request body exceeds GRUNT_MAX_BODY_BYTES", 413));
        return;
      }
      chunks.push(buf);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "x-grunt-proxy": "1",
  });
  res.end(payload);
}

function headersToNode(headers: Headers): Record<string, string | string[]> {
  const seen = new Map<string, string[]>();
  headers.forEach((value, key) => {
    const list = seen.get(key) ?? [];
    list.push(value);
    seen.set(key, list);
  });
  const out: Record<string, string | string[]> = {};
  for (const [key, values] of seen) {
    const single = values[0];
    if (single === undefined) continue;
    out[key] = values.length === 1 ? single : values;
  }
  return out;
}
