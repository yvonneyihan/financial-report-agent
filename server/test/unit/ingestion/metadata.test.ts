import { describe, expect, it } from "vitest";
import { deriveDocumentMetadata } from "../../../src/ingestion/metadata.js";
import type { ParsedDocument } from "../../../src/domain/schemas.js";

function doc(pages: string[]): ParsedDocument {
  return {
    page_count: pages.length,
    pages: pages.map((text, i) => ({ page_number: i + 1, text, tables: [] })),
  };
}

describe("deriveDocumentMetadata", () => {
  it("detects a 10-K, fiscal year, reporting period, and company name from the cover page", () => {
    const derived = deriveDocumentMetadata(
      doc([
        [
          "ACME CORPORATION",
          "ANNUAL REPORT ON FORM 10-K",
          "For the fiscal year ended December 31, 2024",
        ].join("\n"),
      ]),
    );

    expect(derived.documentType).toBe("10-K");
    expect(derived.fiscalYear).toBe(2024);
    expect(derived.reportingPeriod).toBe("December 31, 2024");
    expect(derived.companyName).toBe("Acme Corporation");
  });

  it("detects an earnings release", () => {
    const derived = deriveDocumentMetadata(doc(["Q3 2024 Earnings Release\nRevenue grew year over year."]));
    expect(derived.documentType).toBe("earnings-release");
  });

  it("returns an empty object when nothing is recognizable", () => {
    const derived = deriveDocumentMetadata(doc(["Just some unrelated text with no markers."]));
    expect(derived).toEqual({});
  });

  it("only looks at the first two pages", () => {
    const derived = deriveDocumentMetadata(doc(["Cover page, nothing special.", "More filler.", "ANNUAL REPORT ON FORM 10-K, page 3"]));
    expect(derived.documentType).toBeUndefined();
  });
});
