import type { RequestRecord, SavingsReport } from "./types.js";

export function formatInt(value: number): string {
  const sign = value < 0 ? "-" : "";
  const digits = Math.abs(Math.round(value)).toString();
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "$0.000000";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs !== 0 && abs < 0.000001) return `${sign}$${abs.toExponential(2)}`;
  return `${sign}$${abs.toFixed(6)}`;
}

function percentLabel(original: number, compressed: number): string {
  if (original <= 0) return "0.0%";
  const pct = (100 * (original - compressed)) / original;
  const body = `${Math.abs(pct).toFixed(1)}%`;
  if (pct > 0) return `−${body}`;
  if (pct < 0) return `+${body}`;
  return body;
}

export function formatRequestLine(record: RequestRecord): string {
  const out = record.ok && record.actualCompletionTokens !== undefined ? formatInt(record.outputTokens) : "–";
  const status = record.ok ? "" : `  upstream ${record.status}`;
  const billed = record.upstreamCostUsd !== undefined ? `  billed ${formatUsd(record.upstreamCostUsd)}` : "";
  const pct = percentLabel(record.originalTokens, record.compressedTokens);
  return `grunt  ${record.model}  in ${formatInt(record.originalTokens)}→${formatInt(record.compressedTokens)} (${pct})  out ${out}  saved ${formatUsd(record.usdSaved)}${billed}${status}`;
}

export function formatReport(report: SavingsReport): string {
  const lines = [
    "grunt-proxy savings",
    row("requests", formatInt(report.requests)),
    row("failed", formatInt(report.failed)),
    row(
      "input tokens",
      `${formatInt(report.originalTokens)} → ${formatInt(report.compressedTokens)}  (${percentLabel(report.originalTokens, report.compressedTokens)})`,
    ),
    row("input tokens saved", formatInt(report.inputTokensSaved)),
    row("output tokens", formatInt(report.outputTokens)),
    row("est. input $ saved", formatUsd(report.inputUsdSaved)),
    row("projected output $", formatUsd(report.outputUsdProjected)),
    row("est. $ saved", formatUsd(report.usdSaved)),
    row(
      "upstream billed",
      report.upstreamCostRequests > 0
        ? `${formatUsd(report.upstreamBilledUsd)}  (${formatInt(report.upstreamCostRequests)} of ${formatInt(report.requests)} ok)`
        : "–",
    ),
  ];
  const models = Object.entries(report.byModel).sort((a, b) => b[1].usdSaved - a[1].usdSaved || a[0].localeCompare(b[0]));
  if (models.length > 0) {
    lines.push("", "by model");
    for (const [model, bucket] of models) {
      lines.push(
        `  ${model}  ${formatInt(bucket.requests)} ok  ${formatInt(bucket.failed)} failed  saved ${formatInt(bucket.inputTokensSaved)} in  ${formatUsd(bucket.usdSaved)}`,
      );
    }
  }
  return lines.join("\n");
}

function row(label: string, value: string): string {
  return `${label.padEnd(22)}${value}`;
}
