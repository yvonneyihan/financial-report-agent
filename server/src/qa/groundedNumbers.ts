import type { RetrievedChunk } from "../domain/schemas.js";

// Numbers worth checking: has a decimal point, a thousands separator, a $ or
// % sign, or is 3+ digits. Bare 1-2 digit integers ("3 factors", "10-K") are
// excluded — too many false positives (list numbers, footnotes, form names)
// for too little signal.
const CANDIDATE_NUMBER = /\$?-?\d[\d,]*(?:\.\d+)?%?/g;

function isWorthChecking(token: string): boolean {
  const digits = token.replace(/\D/g, "");
  return token.includes(".") || token.includes(",") || token.includes("$") || token.includes("%") || digits.length >= 3;
}

function normalize(token: string): string {
  return token.replace(/[$,%]/g, "");
}

/**
 * Best-effort check that numbers asserted in the answer actually appear
 * (after normalizing $ , %) somewhere in the retrieved context. This is a
 * grounding signal for the caller/UI, not a guarantee of correctness — a
 * number can be present in context and still be misapplied by the model.
 */
export function findUngroundedNumbers(answer: string, chunks: RetrievedChunk[]): string[] {
  const context = chunks.map((c) => normalize(c.content)).join("\n");
  const candidates = Array.from(new Set(answer.match(CANDIDATE_NUMBER) ?? [])).filter(isWorthChecking);

  const ungrounded: string[] = [];
  for (const token of candidates) {
    const needle = normalize(token);
    const pattern = new RegExp(`(?<![\\d.])${escapeRegex(needle)}(?![\\d.])`);
    if (!pattern.test(context)) ungrounded.push(token);
  }
  return ungrounded;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
