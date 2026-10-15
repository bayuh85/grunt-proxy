import { compressDetailed } from "./compress.js";
import { containsGruntDirective, directiveForLevel, shouldRequestTerse } from "./glossary.js";
import { isRecord } from "./guard.js";
import { estimateTokens } from "./tokens.js";
import type { Protocol, TerseMode } from "./types.js";

export interface RewriteOptions {
  level: number;
  terse: TerseMode;
  protocol: Extract<Protocol, "openai" | "anthropic">;
}

export interface RewriteResult {
  body: unknown;
  mutated: boolean;
  model: string;
  stream: boolean;
  originalTokens: number;
  compressedTokens: number;
  promptChanged: boolean;
  directiveAdded: boolean;
  level: number;
  terse: boolean;
}

interface Acc {
  originalTokens: number;
  compressedTokens: number;
  textChanged: boolean;
}

function modelOf(body: Record<string, unknown>): string {
  return typeof body.model === "string" && body.model.length > 0 ? body.model : "unknown";
}

function compressField(holder: Record<string, unknown>, key: string, level: number, acc: Acc): void {
  const value = holder[key];
  if (typeof value !== "string") return;
  acc.originalTokens += estimateTokens(value);
  const result = compressDetailed(value, level);
  acc.compressedTokens += estimateTokens(result.text);
  if (result.changed) {
    holder[key] = result.text;
    acc.textChanged = true;
  }
}

function compressContent(contentHolder: Record<string, unknown>, key: string, level: number, acc: Acc): void {
  const content = contentHolder[key];
  if (typeof content === "string") {
    compressField(contentHolder, key, level, acc);
    return;
  }
  if (!Array.isArray(content)) return;
  for (const part of content) {
    if (!isRecord(part)) continue;
    if (part.type === "tool_result") {
      compressContent(part, "content", level, acc);
      continue;
    }
    if (part.type === "thinking" || part.type === "redacted_thinking" || part.type === "tool_use") continue;
    if (part.type === "image" || part.type === "image_url" || part.type === "input_audio") continue;
    const type = part.type;
    const textLike = type === undefined || type === "text" || type === "input_text" || type === "output_text";
    if (!textLike) continue;
    if (typeof part.text === "string") compressField(part, "text", level, acc);
    else if (typeof part.content === "string") compressField(part, "content", level, acc);
  }
}

function compressToolList(tools: unknown, level: number, acc: Acc): void {
  if (!Array.isArray(tools)) return;
  for (const tool of tools) {
    if (!isRecord(tool)) continue;
    if (isRecord(tool.function)) compressField(tool.function, "description", level, acc);
    else compressField(tool, "description", level, acc);
  }
}

function systemText(body: Record<string, unknown>, protocol: RewriteOptions["protocol"]): string {
  if (protocol === "anthropic") {
    const system = body.system;
    if (typeof system === "string") return system;
    if (!Array.isArray(system)) return "";
    return system
      .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
      .join("\n");
  }
  const messages = body.messages;
  if (!Array.isArray(messages)) return "";
  const chunks: string[] = [];
  for (const message of messages) {
    if (!isRecord(message) || message.role !== "system") continue;
    const content = message.content;
    if (typeof content === "string") chunks.push(content);
    else if (Array.isArray(content)) {
      for (const part of content) {
        if (isRecord(part) && typeof part.text === "string") chunks.push(part.text);
      }
    }
  }
  return chunks.join("\n");
}

function insertOpenAIDirective(body: Record<string, unknown>, directive: string): void {
  const messages = body.messages;
  if (!Array.isArray(messages)) {
    body.messages = [{ role: "system", content: directive }];
    return;
  }
  const first = messages[0];
  if (isRecord(first) && first.role === "system") {
    if (typeof first.content === "string") {
      first.content = `${directive}\n\n${first.content}`;
      return;
    }
    if (Array.isArray(first.content)) {
      first.content = [{ type: "text", text: directive }, ...first.content];
      return;
    }
    first.content = directive;
    return;
  }
  messages.unshift({ role: "system", content: directive });
}

function insertAnthropicDirective(body: Record<string, unknown>, directive: string): void {
  const system = body.system;
  if (typeof system === "string") {
    body.system = system.length > 0 ? `${directive}\n\n${system}` : directive;
    return;
  }
  if (Array.isArray(system)) {
    body.system = [{ type: "text", text: directive }, ...system];
    return;
  }
  body.system = directive;
}

function enableUsage(body: Record<string, unknown>): boolean {
  if (body.stream !== true) return false;
  const current = body.stream_options;
  if (current === undefined) {
    body.stream_options = { include_usage: true };
    return true;
  }
  if (!isRecord(current)) return false;
  if (current.include_usage === false) return false;
  if (current.include_usage === true) return false;
  current.include_usage = true;
  return true;
}

export function rewriteBody(input: unknown, options: RewriteOptions): RewriteResult {
  const empty: RewriteResult = {
    body: input,
    mutated: false,
    model: isRecord(input) ? modelOf(input) : "unknown",
    stream: isRecord(input) && input.stream === true,
    originalTokens: 0,
    compressedTokens: 0,
    promptChanged: false,
    directiveAdded: false,
    level: options.level,
    terse: false,
  };
  if (!isRecord(input)) return empty;

  const body = structuredClone(input);
  const acc: Acc = { originalTokens: 0, compressedTokens: 0, textChanged: false };

  if (options.protocol === "anthropic") {
    if (typeof body.system === "string" || Array.isArray(body.system)) {
      compressContent(body, "system", options.level, acc);
    }
  }
  if (Array.isArray(body.messages)) {
    for (const message of body.messages) {
      if (!isRecord(message)) continue;
      compressContent(message, "content", options.level, acc);
    }
  }
  compressToolList(body.tools, options.level, acc);
  compressToolList(body.functions, options.level, acc);

  const savedBeforeDirective = acc.originalTokens - acc.compressedTokens;
  let directiveAdded = false;
  const directive = directiveForLevel(options.level);
  const wantTerse = shouldRequestTerse(
    options.terse,
    acc.originalTokens,
    savedBeforeDirective,
    estimateTokens(directive),
  );
  if (wantTerse && !containsGruntDirective(systemText(body, options.protocol))) {
    if (options.protocol === "anthropic") insertAnthropicDirective(body, directive);
    else insertOpenAIDirective(body, directive);
    acc.compressedTokens += estimateTokens(directive);
    directiveAdded = true;
  }

  let streamMutated = false;
  if (options.protocol === "openai") streamMutated = enableUsage(body);

  const promptChanged = acc.textChanged || directiveAdded;
  return {
    body,
    mutated: promptChanged || streamMutated,
    model: modelOf(body),
    stream: body.stream === true,
    originalTokens: acc.originalTokens,
    compressedTokens: acc.compressedTokens,
    promptChanged,
    directiveAdded,
    level: options.level,
    terse: directiveAdded,
  };
}
