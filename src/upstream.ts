import type { IncomingHttpHeaders } from "node:http";
import type { Protocol, RouteKind } from "./types.js";

const HOP = new Set([
  "host",
  "content-length",
  "connection",
  "transfer-encoding",
  "keep-alive",
  "upgrade",
  "proxy-connection",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "expect",
]);

export function routeKind(pathname: string): RouteKind {
  let path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  if (path === "/v1/chat/completions" || path === "/chat/completions") return "openai.chat";
  if (
    path === "/v1/messages" ||
    path === "/messages" ||
    path === "/v1/messages/count_tokens" ||
    path === "/messages/count_tokens"
  ) {
    return "anthropic.messages";
  }
  return "other";
}

export function protocolFor(route: RouteKind): Protocol {
  if (route === "openai.chat") return "openai";
  if (route === "anthropic.messages") return "anthropic";
  return "other";
}

export function resolveUpstreamUrl(base: string, pathname: string, search = ""): string {
  let baseUrl: URL;
  try {
    baseUrl = new URL(base);
  } catch {
    throw new Error(`Invalid upstream base URL: ${base}`);
  }
  if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
    throw new Error(`Unsupported upstream protocol: ${baseUrl.protocol}`);
  }
  const basePath = baseUrl.pathname.replace(/\/+$/, "");
  let path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  const baseIsV1 = basePath === "/v1" || basePath.endsWith("/v1");
  if (baseIsV1 && (path === "/v1" || path.startsWith("/v1/"))) {
    path = path.slice(3) || "/";
  }
  const joined = `${basePath}/${path.replace(/^\//, "")}`.replace(/\/{2,}/g, "/");
  baseUrl.pathname = joined.startsWith("/") ? joined : `/${joined}`;
  baseUrl.search = search;
  baseUrl.hash = "";
  return baseUrl.toString();
}

export interface UpstreamAuth {
  /** When set, replaces the client key. */
  overrideKey?: string;
  openaiKey?: string;
  anthropicKey?: string;
}

function headerString(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

export function buildUpstreamHeaders(
  incoming: IncomingHttpHeaders,
  protocol: Protocol,
  auth: UpstreamAuth,
): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming)) {
    if (value === undefined) continue;
    const lname = name.toLowerCase();
    if (HOP.has(lname) || lname.startsWith("x-grunt")) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }

  const fallback = protocol === "anthropic" ? auth.anthropicKey : auth.openaiKey;
  const clientHasKey = headerString(incoming.authorization) || headerString(incoming["x-api-key"]);
  const key = auth.overrideKey || (!clientHasKey ? fallback : undefined);
  if (key) {
    headers.delete("authorization");
    headers.delete("x-api-key");
    headers.set("authorization", `Bearer ${key}`);
    headers.set("x-api-key", key);
  }
  if (protocol === "anthropic" && !headers.has("anthropic-version")) {
    headers.set("anthropic-version", "2023-06-01");
  }
  return headers;
}

const RESPONSE_SKIP = new Set([...HOP, "content-encoding"]);

export function copyResponseHeaders(upstream: Headers, extra: Record<string, string>): Headers {
  const headers = new Headers();
  upstream.forEach((value, name) => {
    if (RESPONSE_SKIP.has(name.toLowerCase())) return;
    headers.append(name, value);
  });
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return headers;
}
