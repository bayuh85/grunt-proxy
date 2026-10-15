/**
 * Consistent before/after counter. It is not a model tokenizer.
 * Savings use the delta, so a stable bias matters more than an exact count.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const parts = text.match(/[A-Za-z]+(?:'[A-Za-z]+)?|\d+|[\u00C0-\u024F]+|[^\sA-Za-z0-9\u00C0-\u024F]/g);
  if (!parts) return 0;
  let tokens = 0;
  for (const part of parts) {
    if (/^[A-Za-z]/.test(part) || /^[\u00C0-\u024F]/.test(part)) {
      tokens += Math.max(1, Math.ceil(part.length / 4));
    } else if (/^\d+$/.test(part)) {
      tokens += Math.max(1, Math.ceil(part.length / 3));
    } else {
      tokens += 1;
    }
  }
  return tokens;
}
