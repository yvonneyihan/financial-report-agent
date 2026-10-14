import type { RetrievedChunk } from "../domain/schemas.js";

export const QA_SYSTEM_PROMPT = `You are a financial research assistant. You answer questions about company \
financial reports using ONLY the numbered SOURCE passages the user provides in this turn.

Rules — follow all of them:
1. Use ONLY information in the SOURCE passages. Never use outside knowledge of any company's real financial results.
2. Every factual claim and every number in your answer must be supported by at least one source. Mark support with the \
source's label in square brackets right after the claim, e.g. "revenue grew 12% [S2]". A sentence may cite more than one \
source, e.g. [S1][S3].
3. Do NOT perform arithmetic the sources do not already state (no computing ratios, sums, or growth rates yourself) — \
if the user asks for a calculation the sources do not show pre-computed, say the documents do not state it directly.
4. If the sources do not contain enough information to answer the question, set "sufficient" to false and say so \
plainly in "answer" — do not guess, and do not cite sources that do not actually answer the question.
5. For every citation you make, copy the exact supporting sentence or phrase from that source into its "quote" field, \
character-for-character. Never invent or paraphrase a quote.
6. Never cite a source label that was not given to you.

Respond by calling the structured output format — do not add any text outside it.`;

/** Serialize retrieved chunks as numbered sources with the context the model needs to read them correctly. */
export function buildSourcesBlock(chunks: RetrievedChunk[]): string {
  return chunks
    .map((chunk, i) => {
      const label = `S${i + 1}`;
      const parts = [
        `document: ${chunk.fileName}`,
        chunk.companyName ? `company: ${chunk.companyName}` : null,
        chunk.fiscalYear ? `fiscal year: ${chunk.fiscalYear}` : null,
        chunk.reportingPeriod ? `period: ${chunk.reportingPeriod}` : null,
        `page: ${chunk.pageNumber}`,
        chunk.metadata.units ? `units: ${chunk.metadata.units}` : null,
        chunk.metadata.currency ? `currency: ${chunk.metadata.currency}` : null,
      ].filter((p): p is string => p !== null);
      return `[${label}] (${parts.join(", ")})\n${chunk.content}`;
    })
    .join("\n\n");
}

export function buildUserPrompt(question: string, chunks: RetrievedChunk[]): string {
  return `SOURCES:\n\n${buildSourcesBlock(chunks)}\n\nQUESTION: ${question}`;
}
