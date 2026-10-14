import type { AnswerWarning, Citation, RetrievedChunk } from "../domain/schemas.js";

export interface ModelCitation {
  label: string;
  quote: string;
}

/** Collapse whitespace/case for tolerant (but still exact-substring) quote verification. */
function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Turn the model's self-reported citations into server-verified `Citation`s.
 * A citation is dropped (with a warning) if its label was not actually given
 * to the model; a quote that cannot be found verbatim in its source is kept
 * (the citation still points at a real, retrieved passage) but its `quote`
 * is nulled out and a warning is recorded — this function never trusts the
 * model's claim about what a source says without checking.
 */
export function buildCitations(
  modelCitations: ModelCitation[],
  retrievedChunks: RetrievedChunk[],
): { citations: Citation[]; warnings: AnswerWarning[] } {
  const byLabel = new Map(retrievedChunks.map((chunk, i) => [`S${i + 1}`, chunk]));
  const citations: Citation[] = [];
  const warnings: AnswerWarning[] = [];

  for (const mc of modelCitations) {
    const chunk = byLabel.get(mc.label);
    if (!chunk) {
      warnings.push({
        code: "invalid_citation_removed",
        message: `Model cited "${mc.label}", which was not among the retrieved sources. Removed.`,
      });
      continue;
    }

    const quoteVerified = normalize(chunk.content).includes(normalize(mc.quote));
    if (!quoteVerified) {
      warnings.push({
        code: "unverified_quote",
        message: `Quote attributed to ${mc.label} could not be verified against the source text.`,
      });
    }

    citations.push({
      label: mc.label,
      chunkId: chunk.chunkId,
      documentId: chunk.documentId,
      documentName: chunk.fileName,
      page: chunk.pageNumber,
      company: chunk.companyName,
      fiscalYear: chunk.fiscalYear,
      quote: quoteVerified ? mc.quote : null,
    });
  }

  if (modelCitations.length > 0 && citations.length === 0) {
    warnings.push({ code: "no_valid_citations", message: "None of the model's citations referenced a retrieved source." });
  }

  return { citations, warnings };
}
