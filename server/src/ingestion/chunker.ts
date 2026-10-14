import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import type { ChunkMetadata, ChunkType, ParsedPage, Units } from "../domain/schemas.js";

export interface Chunk {
  pageNumber: number;
  chunkType: ChunkType;
  content: string;
  metadata: ChunkMetadata;
}

const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 150;

/**
 * Table-aware chunker (see IMPLEMENTATION_PLAN.md §6/§9-R1).
 *
 * 1. Detected tables (from pdfplumber, ruled tables) become one chunk each,
 *    rendered as `Header | Header` rows so a metric name always stays next to
 *    its value and fiscal year — never split mid-table.
 * 2. Prose is scanned for "borderless" table-like blocks (a run of lines that
 *    each pair a label with trailing numbers, e.g. SEC-style balance sheets
 *    pdfplumber's ruling-line detector misses) and those are kept as their
 *    own chunk too.
 * 3. Everything else is prose, split with RecursiveCharacterTextSplitter.
 *
 * Every chunk is tagged with `units`/`currency`/`periods` heuristically
 * derived from its own page, so a value is never separated from the context
 * needed to interpret it.
 */
export async function chunkPage(page: ParsedPage): Promise<Chunk[]> {
  const pageMetadata = detectPageMetadata(page.text);
  const chunks: Chunk[] = [];

  for (const table of page.tables) {
    chunks.push({
      pageNumber: page.page_number,
      chunkType: "table",
      content: renderTable(table.rows),
      metadata: { ...pageMetadata, tableSource: "detected" },
    });
  }

  const { tableLikeBlocks, remainingText } = extractTableLikeBlocks(page.text);
  for (const block of tableLikeBlocks) {
    chunks.push({
      pageNumber: page.page_number,
      chunkType: "table",
      content: block,
      metadata: { ...pageMetadata, tableSource: "text-aligned" },
    });
  }

  if (remainingText.trim().length > 0) {
    const splitter = new RecursiveCharacterTextSplitter({ chunkSize: CHUNK_SIZE, chunkOverlap: CHUNK_OVERLAP });
    const pieces = await splitter.splitText(remainingText.trim());
    for (const piece of pieces) {
      if (piece.trim().length === 0) continue;
      chunks.push({ pageNumber: page.page_number, chunkType: "text", content: piece, metadata: { ...pageMetadata } });
    }
  }

  return chunks;
}

function renderTable(rows: string[][]): string {
  return rows.map((row) => row.join(" | ")).join("\n");
}

// A line that reads like "Total assets 2,400 2,100" — a label followed by two
// or more numeric-looking trailing tokens (thousands separators, decimals,
// parens for negatives, leading $ all tolerated). Token-based (not a single
// whitespace-run regex) because pdfplumber's extract_text() collapses
// visually-separated columns to single spaces — there is no run of spaces to
// key off. A trailing "." (end of sentence, e.g. "...fiscal 2023.") is
// deliberately NOT part of the pattern, so prose ending in a year is not
// mistaken for a table row.
const NUMERIC_TOKEN = /^-?\$?\(?\d[\d,]*(?:\.\d+)?\)?%?$/;
const MIN_TRAILING_NUMERIC_TOKENS = 2;
const MIN_CONSECUTIVE_LINES = 3;

function isTableLikeLine(line: string): boolean {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.length <= MIN_TRAILING_NUMERIC_TOKENS) return false;
  let trailingNumeric = 0;
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (!NUMERIC_TOKEN.test(tokens[i] as string)) break;
    trailingNumeric++;
  }
  return trailingNumeric >= MIN_TRAILING_NUMERIC_TOKENS && trailingNumeric < tokens.length;
}

/** Splits page text into (borderless table-like blocks, everything else), preserving order in `remainingText`. */
export function extractTableLikeBlocks(text: string): { tableLikeBlocks: string[]; remainingText: string } {
  const lines = text.split("\n");
  const isTableLine = lines.map((l) => isTableLikeLine(l));

  const tableLikeBlocks: string[] = [];
  const keep: boolean[] = new Array(lines.length).fill(true);

  let i = 0;
  while (i < lines.length) {
    if (!isTableLine[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < lines.length && isTableLine[j]) j++;
    const runLength = j - i;
    if (runLength >= MIN_CONSECUTIVE_LINES) {
      tableLikeBlocks.push(lines.slice(i, j).join("\n"));
      for (let k = i; k < j; k++) keep[k] = false;
    }
    i = j;
  }

  const remainingText = lines.filter((_, idx) => keep[idx]).join("\n");
  return { tableLikeBlocks, remainingText };
}

const UNITS_RE = /\bin\s+(thousands|millions|billions)\b/i;
const CURRENCY_RE = /\b(USD|US\$|EUR|GBP|JPY)\b|\$/;
const YEAR_RE = /\b(19|20)\d{2}\b/g;

/** Best-effort per-page context: units/currency/periods. Not authoritative — used to enrich chunks, not to compute anything. */
export function detectPageMetadata(pageText: string): Pick<ChunkMetadata, "units" | "currency" | "periods"> {
  const unitsMatch = UNITS_RE.exec(pageText);
  const units = unitsMatch ? (unitsMatch[1]?.toLowerCase() as Units) : undefined;
  const currencyMatch = CURRENCY_RE.exec(pageText);
  const currency = currencyMatch ? (currencyMatch[1] ?? "USD") : undefined;
  const periods = Array.from(new Set((pageText.match(YEAR_RE) ?? []).map(Number))).sort((a, b) => b - a);

  return {
    ...(units ? { units } : {}),
    ...(currency ? { currency } : {}),
    ...(periods.length > 0 ? { periods } : {}),
  };
}
