import { randomUUID } from "node:crypto";
import { projectOutputSavings, tokenUsd } from "./pricing.js";
import type { ModelSavings, PriceSource, RequestRecord, RouteKind, SavingsReport } from "./types.js";

export interface RecordInput {
  route: RouteKind;
  model: string;
  ok: boolean;
  status: number;
  stream: boolean;
  level: number;
  terse: boolean;
  originalTokens: number;
  compressedTokens: number;
  promptChanged: boolean;
  actualPromptTokens?: number;
  actualCompletionTokens?: number;
  priceInPerMillion: number;
  priceOutPerMillion: number;
  priceSource: PriceSource;
  assumeOutputCut: number;
  upstreamCostUsd?: number;
}

export function buildRecord(input: RecordInput): RequestRecord {
  const delta = input.promptChanged ? input.originalTokens - input.compressedTokens : 0;
  const inputTokensSaved = input.ok ? delta : 0;
  const outputTokens = input.ok ? input.actualCompletionTokens ?? 0 : 0;
  const projected = input.ok
    ? projectOutputSavings(outputTokens, input.assumeOutputCut, input.priceOutPerMillion)
    : { tokens: 0, usd: 0 };
  const inputUsdSaved = input.ok ? tokenUsd(inputTokensSaved, input.priceInPerMillion) : 0;
  const record: RequestRecord = {
    id: randomUUID(),
    at: new Date().toISOString(),
    route: input.route,
    model: input.model,
    ok: input.ok,
    status: input.status,
    stream: input.stream,
    level: input.level,
    terse: input.terse,
    originalTokens: input.originalTokens,
    compressedTokens: input.compressedTokens,
    inputTokensSaved,
    outputTokens,
    outputTokensProjected: projected.tokens,
    inputUsdSaved,
    outputUsdProjected: projected.usd,
    usdSaved: inputUsdSaved + projected.usd,
    priceInPerMillion: input.priceInPerMillion,
    priceOutPerMillion: input.priceOutPerMillion,
    priceSource: input.priceSource,
  };
  if (input.actualPromptTokens !== undefined) record.actualPromptTokens = input.actualPromptTokens;
  if (input.actualCompletionTokens !== undefined) record.actualCompletionTokens = input.actualCompletionTokens;
  if (input.upstreamCostUsd !== undefined) record.upstreamCostUsd = input.upstreamCostUsd;
  return record;
}

function blankModel(): ModelSavings {
  return {
    requests: 0,
    failed: 0,
    originalTokens: 0,
    compressedTokens: 0,
    inputTokensSaved: 0,
    outputTokens: 0,
    usdSaved: 0,
  };
}

export function summarize(records: readonly RequestRecord[]): SavingsReport {
  const report: SavingsReport = {
    requests: 0,
    failed: 0,
    originalTokens: 0,
    compressedTokens: 0,
    inputTokensSaved: 0,
    outputTokens: 0,
    inputUsdSaved: 0,
    outputUsdProjected: 0,
    usdSaved: 0,
    upstreamBilledUsd: 0,
    upstreamCostRequests: 0,
    byModel: {},
  };
  for (const record of records) {
    const bucket = report.byModel[record.model] ?? blankModel();
    report.byModel[record.model] = bucket;
    if (!record.ok) {
      report.failed += 1;
      bucket.failed += 1;
      continue;
    }
    report.requests += 1;
    report.originalTokens += record.originalTokens;
    report.compressedTokens += record.compressedTokens;
    report.inputTokensSaved += record.inputTokensSaved;
    report.outputTokens += record.outputTokens;
    report.inputUsdSaved += record.inputUsdSaved;
    report.outputUsdProjected += record.outputUsdProjected;
    report.usdSaved += record.usdSaved;
    bucket.requests += 1;
    bucket.originalTokens += record.originalTokens;
    bucket.compressedTokens += record.compressedTokens;
    bucket.inputTokensSaved += record.inputTokensSaved;
    bucket.outputTokens += record.outputTokens;
    bucket.usdSaved += record.usdSaved;
    if (record.upstreamCostUsd !== undefined) {
      report.upstreamBilledUsd += record.upstreamCostUsd;
      report.upstreamCostRequests += 1;
    }
  }
  return report;
}

export function parseLedger(text: string): RequestRecord[] {
  const records: RequestRecord[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const value = JSON.parse(trimmed) as unknown;
      if (!isRequestRecord(value)) continue;
      records.push(value);
    } catch {
      // Ignore a torn final line if the process stopped mid-append.
    }
  }
  return records;
}

function isRequestRecord(value: unknown): value is RequestRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<RequestRecord>;
  return typeof record.model === "string" && typeof record.originalTokens === "number" && typeof record.ok === "boolean";
}

export class Ledger {
  readonly records: RequestRecord[] = [];

  add(record: RequestRecord): void {
    this.records.push(record);
  }

  summary(): SavingsReport {
    return summarize(this.records);
  }
}
