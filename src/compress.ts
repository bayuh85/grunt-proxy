import { glossaryForLevel } from "./glossary.js";

/** Skip tiny strings. The fixed terse instruction would cost more than they save. */
export const MIN_CHARS = 48;

export interface CompressResult {
  text: string;
  used: Array<[string, string]>;
  changed: boolean;
}

const STOP_2 = [
  "a",
  "an",
  "the",
  "just",
  "really",
  "very",
  "basically",
  "actually",
  "simply",
  "currently",
  "essentially",
];

const STOP_3 = ["of", "that"];

const PHRASES: ReadonlyArray<readonly [string, string]> = [
  ["i would like you to", ""],
  ["i want you to", ""],
  ["i need you to", ""],
  ["could you please", ""],
  ["would you please", ""],
  ["can you please", ""],
  ["please could you", ""],
  ["in spite of the fact that", "although"],
  ["it is important to note that", ""],
  ["due to the fact that", "because"],
  ["at this point in time", "now"],
  ["a large number of", "many"],
  ["in the event that", "if"],
  ["for the purpose of", "to"],
  ["as a matter of fact", ""],
  ["i was wondering if", ""],
  ["it would be great if", ""],
  ["with regard to", "about"],
  ["with respect to", "about"],
  ["whether or not", "whether"],
  ["at the end of the day", ""],
  ["as soon as possible", "soon"],
  ["each and every", "every"],
  ["in the process of", ""],
  ["in terms of", "for"],
  ["in order to", "to"],
  ["the fact that", "that"],
  ["be able to", ""],
  ["prior to", "before"],
  ["subsequent to", "after"],
  ["make sure that", "ensure"],
  ["make sure to", "ensure"],
  ["take a look at", "review"],
  ["let me know if", "say if"],
  ["let me know", "say"],
  ["feel free to", ""],
  ["a lot of", "many"],
  ["so much", ""],
  ["going forward", ""],
];

interface Seg {
  kind: "raw" | "prose";
  text: string;
}

function isTokenStart(input: string, index: number): boolean {
  if (index === 0) return true;
  return /[\s("'[(]/.test(input[index - 1] ?? "");
}

function isLineStart(input: string, index: number): boolean {
  return index === 0 || input[index - 1] === "\n";
}

/**
 * Leave code, URLs, paths, and filenames untouched.
 * Indented (4-space or tab) lines are treated as code.
 */
export function segment(input: string): Seg[] {
  const segs: Seg[] = [];
  let i = 0;
  let prose = "";
  const flush = (): void => {
    if (!prose) return;
    segs.push({ kind: "prose", text: prose });
    prose = "";
  };
  const raw = (text: string): void => {
    flush();
    segs.push({ kind: "raw", text });
  };

  while (i < input.length) {
    if (input.startsWith("```", i)) {
      const end = input.indexOf("```", i + 3);
      const stop = end === -1 ? input.length : end + 3;
      raw(input.slice(i, stop));
      i = stop;
      continue;
    }
    if (input[i] === "`") {
      const end = input.indexOf("`", i + 1);
      if (end !== -1 && end - i <= 500 && !input.slice(i + 1, end).includes("\n")) {
        raw(input.slice(i, end + 1));
        i = end + 1;
        continue;
      }
    }
    if (isLineStart(input, i)) {
      const line = /^(?: {4}|\t).*(?:\n|$)/.exec(input.slice(i));
      if (line?.[0]) {
        raw(line[0]);
        i += line[0].length;
        continue;
      }
    }
    if (isTokenStart(input, i)) {
      const rest = input.slice(i);
      const url = /^https?:\/\/[^\s)]+/.exec(rest);
      if (url?.[0]) {
        const u = url[0].replace(/[.,;:!?]+$/g, "");
        raw(u);
        i += u.length;
        continue;
      }
      const file =
        /^(?:(?:[A-Za-z]:)?(?:\.?\.?\/)?(?:[\w.+-]+\/)+[\w.+-]+|[\w.+-]+\.[A-Za-z][A-Za-z0-9]{0,7})\b/.exec(
          rest,
        );
      if (file?.[0]) {
        raw(file[0]);
        i += file[0].length;
        continue;
      }
    }
    prose += input[i] ?? "";
    i += 1;
  }
  flush();
  return segs;
}

function applyPhrases(text: string): string {
  let s = text.replace(
    /(^|\n)\s*(?:i would like you to|i want you to|i need you to|could you please|would you please|can you please|please could you|could you|would you|can you)\b[,:]?\s*/gi,
    "$1",
  );
  for (const [from, to] of PHRASES) {
    s = s.replace(new RegExp(`\\b${from}\\b`, "gi"), to);
  }
  s = s.replace(/\bthank you\b[!.,]?/gi, "");
  s = s.replace(/\bthanks\b[!.,]?/gi, "");
  s = s.replace(/\bplease\b[,]?/gi, "");
  s = s.replace(/\bkindly\b/gi, "");
  return s;
}

function dropWords(text: string, words: readonly string[]): string {
  return text.replace(new RegExp(`\\b(?:${words.join("|")})\\b`, "gi"), "");
}

function tidy(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

function isCamelOrPascalIdent(word: string): boolean {
  let hasLower = false;
  let hasUpperAfter = false;
  for (let i = 0; i < word.length; i += 1) {
    const c = word[i];
    if (c === undefined) continue;
    if (c >= "a" && c <= "z") hasLower = true;
    if (i > 0 && c >= "A" && c <= "Z") hasUpperAfter = true;
  }
  return hasLower && hasUpperAfter;
}

function applyCase(original: string, short: string): string {
  const first = original[0];
  const shortFirst = short[0];
  if (!first || !shortFirst) return short;
  if (first.toLowerCase() === first) return short;
  if (original.length > 1 && original === original.toUpperCase()) return short.toUpperCase();
  if (shortFirst.toLowerCase() !== shortFirst) return short;
  return shortFirst.toUpperCase() + short.slice(1);
}

function abbreviate(word: string, gloss: Readonly<Record<string, string>>, used: Array<[string, string]>): string {
  if (word.includes("_") || isCamelOrPascalIdent(word)) return word;
  const lower = word.toLowerCase();
  const short = gloss[lower];
  if (!short || short.toLowerCase() === lower) return word;
  used.push([short.toLowerCase(), lower]);
  return applyCase(word, short);
}

function compressProse(text: string, level: number, used: Array<[string, string]>): string {
  let s = applyPhrases(text);
  if (level >= 2) s = dropWords(s, STOP_2);
  if (level >= 3) {
    s = s.replace(/\bdo not\b/gi, "don't");
    s = s.replace(/\bcannot\b/gi, "can't");
    s = s.replace(/\bit is\b/gi, "it's");
    s = s.replace(/\bthere is\b/gi, "there's");
    s = s.replace(/\bis going to\b/gi, "will");
    s = dropWords(s, STOP_3);
  }
  if (level >= 2) {
    const gloss = glossaryForLevel(level);
    s = s.replace(/[A-Za-z][A-Za-z'-]*/g, (word) => abbreviate(word, gloss, used));
  }
  return tidy(s);
}

function looksLikeJson(text: string): boolean {
  const t = text.trim();
  if (!(t.startsWith("{") && t.endsWith("}")) && !(t.startsWith("[") && t.endsWith("]"))) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

function compressInner(input: string, level: number): CompressResult {
  if (level <= 0 || input.length < MIN_CHARS || looksLikeJson(input)) {
    return { text: input, used: [], changed: false };
  }
  const used: Array<[string, string]> = [];
  const joined = segment(input)
    .map((seg) => (seg.kind === "raw" ? seg.text : compressProse(seg.text, level, used)))
    .join("");
  const trimmed = joined.trim();
  if (!trimmed || trimmed.length >= input.trim().length) {
    return { text: input, used: [], changed: false };
  }
  return { text: trimmed, used, changed: true };
}

export function compressDetailed(input: string, level: number): CompressResult {
  const leadWidth = input.length - input.trimStart().length;
  const trimmedStart = input.slice(leadWidth);
  // A previous hop already inserted a stable directive. Keep that paragraph
  // verbatim so the glossary is not abbreviated on a second pass.
  if (trimmedStart.startsWith("[grunt]")) {
    const sep = trimmedStart.indexOf("\n\n");
    if (sep === -1) return { text: input, used: [], changed: false };
    const head = trimmedStart.slice(0, sep + 2);
    const tail = trimmedStart.slice(sep + 2);
    const rest = compressInner(tail, level);
    const text = input.slice(0, leadWidth) + head + rest.text;
    return { text, used: rest.used, changed: text !== input };
  }
  return compressInner(input, level);
}

export function compressText(input: string, level: number): string {
  return compressDetailed(input, level).text;
}
