import { resolveUpstreamUrl } from "./upstream.js";
import type { TerseMode } from "./types.js";

export interface Config {
  host: string;
  port: number;
  upstreamBaseUrl: string;
  overrideKey?: string;
  openaiKey?: string;
  anthropicKey?: string;
  level: number;
  terse: TerseMode;
  logFile?: string;
  priceIn?: number;
  priceOut?: number;
  assumeOutputCut: number;
  maxBodyBytes: number;
  timeoutMs: number;
}

export interface CliArgs {
  help: boolean;
  report?: string | true;
  host?: string;
  port?: number;
  level?: number;
  terse?: TerseMode;
  upstream?: string;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined) continue;
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (token === "--report") {
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        args.report = next;
        i += 1;
      } else {
        args.report = true;
      }
      continue;
    }
    const value = valueOf(argv, token, i);
    if (value.consumed) i += 1;
    switch (token) {
      case "--host":
        args.host = required(token, value.value);
        break;
      case "--port":
        args.port = parsePort(required(token, value.value));
        break;
      case "--level":
        args.level = parseLevel(required(token, value.value));
        break;
      case "--terse":
        args.terse = parseTerse(required(token, value.value));
        break;
      case "--upstream":
        args.upstream = required(token, value.value);
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

function valueOf(argv: readonly string[], token: string, index: number): { value?: string; consumed: boolean } {
  if (token === "--help" || token === "-h" || token === "--report") return { consumed: false };
  const next = argv[index + 1];
  if (next === undefined || next.startsWith("-")) return { consumed: false };
  return { value: next, consumed: true };
}

function required(flag: string, value: string | undefined): string {
  if (value === undefined) throw new Error(`${flag} needs a value`);
  return value;
}

export function resolveConfig(env: NodeJS.ProcessEnv, args: CliArgs = { help: false }): Config {
  const host = args.host ?? env.GRUNT_HOST ?? "127.0.0.1";
  const port = args.port ?? (env.GRUNT_PORT ? parsePort(env.GRUNT_PORT) : 8642);
  const upstreamBaseUrl = args.upstream ?? env.GRUNT_UPSTREAM_BASE_URL ?? "https://atmorouter.dev/v1";
  resolveUpstreamUrl(upstreamBaseUrl, "/v1/models");
  const level = args.level ?? (env.GRUNT_LEVEL ? parseLevel(env.GRUNT_LEVEL) : 2);
  const terse = args.terse ?? (env.GRUNT_TERSE ? parseTerse(env.GRUNT_TERSE) : "auto");
  const priceIn = env.GRUNT_PRICE_IN ? parseNonNegative(env.GRUNT_PRICE_IN, "GRUNT_PRICE_IN") : undefined;
  const priceOut = env.GRUNT_PRICE_OUT ? parseNonNegative(env.GRUNT_PRICE_OUT, "GRUNT_PRICE_OUT") : undefined;
  const assumeOutputCut = env.GRUNT_ASSUME_OUTPUT_CUT ? parseCut(env.GRUNT_ASSUME_OUTPUT_CUT) : 0;
  const maxBodyBytes = env.GRUNT_MAX_BODY_BYTES
    ? parsePositiveInt(env.GRUNT_MAX_BODY_BYTES, "GRUNT_MAX_BODY_BYTES")
    : 32 * 1024 * 1024;
  const timeoutMs = env.GRUNT_TIMEOUT_MS ? parseNonNegativeInt(env.GRUNT_TIMEOUT_MS, "GRUNT_TIMEOUT_MS") : 0;
  const override = blankToUndefined(env.GRUNT_API_KEY) ?? blankToUndefined(env.ATMOROUTER_API_KEY);
  const config: Config = {
    host,
    port,
    upstreamBaseUrl,
    level,
    terse,
    assumeOutputCut,
    maxBodyBytes,
    timeoutMs,
  };
  if (override) config.overrideKey = override;
  const openai = blankToUndefined(env.OPENAI_API_KEY);
  const anthropic = blankToUndefined(env.ANTHROPIC_API_KEY);
  const logFile = blankToUndefined(env.GRUNT_LOG_FILE);
  if (openai) config.openaiKey = openai;
  if (anthropic) config.anthropicKey = anthropic;
  if (logFile) config.logFile = logFile;
  if (priceIn !== undefined) config.priceIn = priceIn;
  if (priceOut !== undefined) config.priceOut = priceOut;
  return config;
}

export function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

export function parseLevel(value: string): number {
  if (!/^[0-3]$/.test(value)) throw new Error(`Invalid GRUNT_LEVEL: ${value}`);
  return Number(value);
}

export function parseTerse(value: string): TerseMode {
  if (value === "auto" || value === "always" || value === "off") return value;
  throw new Error(`Invalid GRUNT_TERSE: ${value}`);
}

function parseCut(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n >= 0.9) {
    throw new Error(`Invalid GRUNT_ASSUME_OUTPUT_CUT: ${value}`);
  }
  return n;
}

function parseNonNegative(value: string, name: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid ${name}: ${value}`);
  return n;
}

function parsePositiveInt(value: string, name: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Invalid ${name}: ${value}`);
  return n;
}

function parseNonNegativeInt(value: string, name: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`Invalid ${name}: ${value}`);
  return n;
}

function blankToUndefined(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
