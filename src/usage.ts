import { asNumber, isRecord } from "./guard.js";
import type { Protocol } from "./types.js";

export interface Usage {
  promptTokens?: number;
  completionTokens?: number;
}

export function mergeUsage(current: Usage, next: Usage): Usage {
  const merged: Usage = {};
  const prompt = next.promptTokens ?? current.promptTokens;
  const completion = next.completionTokens ?? current.completionTokens;
  if (prompt !== undefined) merged.promptTokens = prompt;
  if (completion !== undefined) merged.completionTokens = completion;
  return merged;
}

export function usageFromJson(json: unknown, protocol: Protocol): Usage | undefined {
  if (!isRecord(json)) return undefined;
  if (protocol === "anthropic") return anthropicUsage(json);
  return openaiUsage(json);
}

function openaiUsage(json: Record<string, unknown>): Usage | undefined {
  if (!isRecord(json.usage)) return undefined;
  const prompt = asNumber(json.usage.prompt_tokens);
  const completion = asNumber(json.usage.completion_tokens);
  if (prompt === undefined && completion === undefined) return undefined;
  const usage: Usage = {};
  if (prompt !== undefined) usage.promptTokens = prompt;
  if (completion !== undefined) usage.completionTokens = completion;
  return usage;
}

function anthropicUsage(json: Record<string, unknown>): Usage | undefined {
  let prompt: number | undefined;
  let completion: number | undefined;
  const take = (record: Record<string, unknown>): void => {
    const input = asNumber(record.input_tokens);
    const output = asNumber(record.output_tokens);
    if (input !== undefined) prompt = input;
    if (output !== undefined) completion = output;
  };
  if (isRecord(json.usage)) take(json.usage);
  if (isRecord(json.message) && isRecord(json.message.usage)) take(json.message.usage);
  const topIn = asNumber(json.input_tokens);
  const topOut = asNumber(json.output_tokens);
  if (topIn !== undefined) prompt = topIn;
  if (topOut !== undefined) completion = topOut;
  if (prompt === undefined && completion === undefined) return undefined;
  const usage: Usage = {};
  if (prompt !== undefined) usage.promptTokens = prompt;
  if (completion !== undefined) usage.completionTokens = completion;
  return usage;
}

export function createSseParser(protocol: Protocol, onUsage: (usage: Usage) => void): {
  push(text: string): void;
} {
  let buf = "";
  const consume = (event: string): void => {
    const data = event
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") return;
    try {
      const usage = usageFromJson(JSON.parse(data) as unknown, protocol);
      if (usage) onUsage(usage);
    } catch {
      // Non-JSON SSE frames are forwarded unchanged; they just don't carry usage.
    }
  };
  return {
    push(text: string): void {
      buf += text.replace(/\r\n/g, "\n");
      while (true) {
        const idx = buf.indexOf("\n\n");
        if (idx < 0) break;
        const event = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        consume(event);
      }
    },
  };
}
