import type { DocumentType, ParsedDocument } from "../domain/schemas.js";

export interface DerivedMetadata {
  companyName?: string;
  fiscalYear?: number;
  reportingPeriod?: string;
  documentType?: DocumentType;
}

const DOC_TYPE_PATTERNS: Array<[RegExp, DocumentType]> = [
  [/\bform\s+10-k\b/i, "10-K"],
  [/\bform\s+10-q\b/i, "10-Q"],
  [/\bannual\s+report\b/i, "annual-report"],
  [/\bearnings\s+release\b/i, "earnings-release"],
];

// `.{0,40}?` (not `[^,]*?`) because the date itself usually contains a comma
// ("...ended December 31, 2024") — excluding commas made this never match.
const FISCAL_YEAR_RE = /fiscal\s+year\s+end(?:ed|ing)\s+.{0,40}?(\d{4})/i;
const PERIOD_RE = /(?:for\s+the\s+)?(fiscal\s+year|quarter)\s+end(?:ed|ing)\s+([A-Za-z]+\s+\d{1,2},\s*\d{4})/i;

/**
 * Best-effort metadata extraction from the first couple of pages of a parsed
 * document, used only to pre-fill fields the user did not supply on upload
 * (see documentStore.applyDerivedMetadata — user-provided values always win,
 * and every derived field is tagged `metadataSources[field] = "heuristic"`).
 * This is intentionally simple pattern matching, not an LLM call — it must
 * stay fast and run on every ingest.
 */
export function deriveDocumentMetadata(doc: ParsedDocument): DerivedMetadata {
  const coverPages = doc.pages.slice(0, 2);
  const coverText = coverPages.map((p) => p.text).join("\n");

  const result: DerivedMetadata = {};

  for (const [pattern, type] of DOC_TYPE_PATTERNS) {
    if (pattern.test(coverText)) {
      result.documentType = type;
      break;
    }
  }

  const fyMatch = FISCAL_YEAR_RE.exec(coverText);
  if (fyMatch?.[1]) result.fiscalYear = Number(fyMatch[1]);

  const periodMatch = PERIOD_RE.exec(coverText);
  if (periodMatch?.[2]) result.reportingPeriod = periodMatch[2];

  const companyName = guessCompanyName(coverPages[0]?.text ?? "");
  if (companyName) result.companyName = companyName;

  return result;
}

/**
 * Heuristic: the first substantial ALL-CAPS line on the cover page is usually
 * the registrant name on a 10-K / annual report cover. Low confidence by
 * design — this is why it is stored as "heuristic", not treated as ground
 * truth, and is always overridden by user-supplied `companyName`.
 */
function guessCompanyName(firstPageText: string): string | undefined {
  const lines = firstPageText.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 5)) {
    const letters = line.replace(/[^A-Za-z]/g, "");
    if (letters.length >= 3 && letters === letters.toUpperCase() && !/\d{4}/.test(line)) {
      return toTitleCase(line);
    }
  }
  return undefined;
}

function toTitleCase(s: string): string {
  return s
    .toLowerCase()
    .split(" ")
    .map((w) => (w.length > 0 ? w[0]?.toUpperCase() + w.slice(1) : w))
    .join(" ");
}
