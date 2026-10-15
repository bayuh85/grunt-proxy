import type { PriceSource } from "./types.js";

export interface ModelPrice {
  inputPerMillion: number;
  outputPerMillion: number;
  source: PriceSource;
}

interface PriceRow {
  id: string;
  input: number;
  output: number;
}

/**
 * Approximate public list prices in USD per 1M tokens, most specific first.
 * These are estimates for the savings report, not an invoice. AtmoRouter's
 * own rate is often lower — set GRUNT_PRICE_IN and GRUNT_PRICE_OUT to match it.
 */
const TABLE: readonly PriceRow[] = [
  { id: "gpt-4o-mini", input: 0.15, output: 0.6 },
  { id: "gpt-4o", input: 2.5, output: 10 },
  { id: "gpt-4.1-nano", input: 0.1, output: 0.4 },
  { id: "gpt-4.1-mini", input: 0.4, output: 1.6 },
  { id: "gpt-4.1", input: 2, output: 8 },
  { id: "o4-mini", input: 1.1, output: 4.4 },
  { id: "o3-mini", input: 1.1, output: 4.4 },
  { id: "o1-mini", input: 1.1, output: 4.4 },
  { id: "claude-opus", input: 15, output: 75 },
  { id: "opus", input: 15, output: 75 },
  { id: "claude-sonnet", input: 3, output: 15 },
  { id: "sonnet", input: 3, output: 15 },
  { id: "haiku", input: 0.8, output: 4 },
  { id: "gemini-2.5-pro", input: 1.25, output: 10 },
  { id: "gemini-2.5-flash", input: 0.15, output: 0.6 },
  { id: "gemini-2.0-flash", input: 0.1, output: 0.4 },
  { id: "deepseek", input: 0.27, output: 1.1 },
];

const DEFAULT_PRICE: ModelPrice = {
  inputPerMillion: 1,
  outputPerMillion: 3,
  source: "default",
};

export function lookupTablePrice(model: string): ModelPrice | undefined {
  const id = model.toLowerCase();
  for (const row of TABLE) {
    if (id.includes(row.id)) {
      return { inputPerMillion: row.input, outputPerMillion: row.output, source: "table" };
    }
  }
  return undefined;
}

export function resolvePrice(
  model: string,
  override: { input?: number; output?: number } = {},
): ModelPrice {
  const base = lookupTablePrice(model) ?? { ...DEFAULT_PRICE };
  const hasIn = override.input !== undefined;
  const hasOut = override.output !== undefined;
  if (!hasIn && !hasOut) return base;
  return {
    inputPerMillion: hasIn ? override.input ?? base.inputPerMillion : base.inputPerMillion,
    outputPerMillion: hasOut ? override.output ?? base.outputPerMillion : base.outputPerMillion,
    source: "env",
  };
}

export function tokenUsd(tokens: number, perMillion: number): number {
  return (tokens / 1_000_000) * perMillion;
}

export function projectOutputSavings(
  completionTokens: number,
  cut: number,
  outputPerMillion: number,
): { tokens: number; usd: number } {
  if (!(cut > 0) || cut >= 0.9 || !(completionTokens > 0)) return { tokens: 0, usd: 0 };
  const tokens = completionTokens * (cut / (1 - cut));
  return { tokens, usd: tokenUsd(tokens, outputPerMillion) };
}

export function parseCostHeader(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value.trim().replace(/^\$/, "").replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}
