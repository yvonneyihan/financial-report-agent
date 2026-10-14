import { describe, expect, it } from "vitest";
import { findUngroundedNumbers } from "../../../src/qa/groundedNumbers.js";
import type { RetrievedChunk } from "../../../src/domain/schemas.js";

function chunk(content: string): RetrievedChunk {
  return {
    chunkId: "c1",
    documentId: "d1",
    fileName: "acme.pdf",
    companyName: null,
    ticker: null,
    fiscalYear: null,
    reportingPeriod: null,
    documentType: null,
    pageNumber: 1,
    chunkType: "text",
    content,
    metadata: {},
    score: 0.9,
  };
}

describe("findUngroundedNumbers", () => {
  it("finds no ungrounded numbers when every figure appears in context", () => {
    const chunks = [chunk("Revenue was $1,120 million, up from $1,000 million.")];
    const result = findUngroundedNumbers("Revenue grew to $1,120 million from $1,000 million.", chunks);
    expect(result).toEqual([]);
  });

  it("flags a number that appears nowhere in the retrieved context", () => {
    const chunks = [chunk("Revenue was $1,120 million.")];
    const result = findUngroundedNumbers("Revenue was $1,120 million and net income was $999 million.", chunks);
    expect(result).toEqual(["$999"]);
  });

  it("matches numbers across comma/currency-symbol formatting differences", () => {
    const chunks = [chunk("Total assets: 2400 (in millions)")];
    const result = findUngroundedNumbers("Total assets were $2,400 million.", chunks);
    expect(result).toEqual([]);
  });

  it("ignores small bare integers (list numbers, form names) to avoid false positives", () => {
    const chunks = [chunk("Some unrelated context.")];
    const result = findUngroundedNumbers("There were 3 factors driving results, per Form 10-K.", chunks);
    expect(result).toEqual([]);
  });

  it("does not flag a number that is a substring of a different larger number in context", () => {
    const chunks = [chunk("Fiscal year 2024 results were strong.")];
    // "24" should not be considered grounded just because it's a substring of "2024".
    const result = findUngroundedNumbers("The company grew by 24% year over year.", chunks);
    expect(result).toEqual(["24%"]);
  });
});
