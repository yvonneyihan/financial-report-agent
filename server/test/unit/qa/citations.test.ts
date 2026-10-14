import { describe, expect, it } from "vitest";
import { buildCitations } from "../../../src/qa/citations.js";
import type { RetrievedChunk } from "../../../src/domain/schemas.js";

function chunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    chunkId: "chunk-1",
    documentId: "doc-1",
    fileName: "acme.pdf",
    companyName: "Acme Corp",
    ticker: "ACME",
    fiscalYear: 2024,
    reportingPeriod: "FY2024",
    documentType: "10-K",
    pageNumber: 3,
    chunkType: "table",
    content: "Revenue | 1,120 | 1,000",
    metadata: {},
    score: 0.9,
    ...overrides,
  };
}

describe("buildCitations", () => {
  it("builds a verified citation when the quote is a real substring of the source", () => {
    const { citations, warnings } = buildCitations([{ label: "S1", quote: "Revenue | 1,120" }], [chunk()]);
    expect(citations).toHaveLength(1);
    expect(citations[0]).toMatchObject({ label: "S1", chunkId: "chunk-1", page: 3, quote: "Revenue | 1,120" });
    expect(warnings).toHaveLength(0);
  });

  it("verifies quotes tolerantly (whitespace/case) but still requires the text to exist", () => {
    const { citations, warnings } = buildCitations([{ label: "S1", quote: "revenue   |    1,120" }], [chunk()]);
    expect(citations[0]?.quote).toBe("revenue   |    1,120");
    expect(warnings).toHaveLength(0);
  });

  it("drops a citation to a label that was never retrieved and warns, keeping other valid citations", () => {
    const { citations, warnings } = buildCitations(
      [
        { label: "S1", quote: "Revenue | 1,120" },
        { label: "S7", quote: "anything" },
      ],
      [chunk()],
    );
    expect(citations).toHaveLength(1);
    expect(citations[0]?.label).toBe("S1");
    expect(warnings).toEqual([{ code: "invalid_citation_removed", message: expect.stringContaining("S7") }]);
  });

  it("keeps the citation but nulls the quote and warns when the quote cannot be verified", () => {
    const { citations, warnings } = buildCitations([{ label: "S1", quote: "revenue grew due to strong holiday demand" }], [chunk()]);
    expect(citations).toHaveLength(1);
    expect(citations[0]?.quote).toBeNull();
    expect(warnings).toEqual([{ code: "unverified_quote", message: expect.stringContaining("S1") }]);
  });

  it("emits no_valid_citations when every citation given was invalid", () => {
    const { citations, warnings } = buildCitations([{ label: "S9", quote: "x" }], [chunk()]);
    expect(citations).toHaveLength(0);
    expect(warnings.map((w) => w.code)).toContain("no_valid_citations");
  });

  it("returns nothing when the model cited nothing", () => {
    const { citations, warnings } = buildCitations([], [chunk()]);
    expect(citations).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it("maps multiple distinct labels to their respective chunks", () => {
    const chunks = [chunk({ chunkId: "c1" }), chunk({ chunkId: "c2", content: "Net income | 168 | 140" })];
    const { citations } = buildCitations(
      [
        { label: "S1", quote: "Revenue | 1,120" },
        { label: "S2", quote: "Net income | 168" },
      ],
      chunks,
    );
    expect(citations.map((c) => c.chunkId)).toEqual(["c1", "c2"]);
  });
});
