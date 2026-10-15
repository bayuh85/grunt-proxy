export type RouteKind = "openai.chat" | "anthropic.messages" | "other";

export type Protocol = "openai" | "anthropic" | "other";

export type TerseMode = "auto" | "always" | "off";

export type PriceSource = "env" | "table" | "default";

export interface RequestRecord {
  id: string;
  at: string;
  route: RouteKind;
  model: string;
  ok: boolean;
  status: number;
  stream: boolean;
  level: number;
  terse: boolean;
  originalTokens: number;
  compressedTokens: number;
  inputTokensSaved: number;
  outputTokens: number;
  outputTokensProjected: number;
  inputUsdSaved: number;
  outputUsdProjected: number;
  usdSaved: number;
  priceInPerMillion: number;
  priceOutPerMillion: number;
  priceSource: PriceSource;
  actualPromptTokens?: number;
  actualCompletionTokens?: number;
  upstreamCostUsd?: number;
}

export interface ModelSavings {
  requests: number;
  failed: number;
  originalTokens: number;
  compressedTokens: number;
  inputTokensSaved: number;
  outputTokens: number;
  usdSaved: number;
}

export interface SavingsReport {
  requests: number;
  failed: number;
  originalTokens: number;
  compressedTokens: number;
  inputTokensSaved: number;
  outputTokens: number;
  inputUsdSaved: number;
  outputUsdProjected: number;
  usdSaved: number;
  upstreamBilledUsd: number;
  upstreamCostRequests: number;
  byModel: Record<string, ModelSavings>;
}
