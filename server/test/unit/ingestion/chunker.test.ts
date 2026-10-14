import { describe, expect, it } from "vitest";
import { chunkPage, detectPageMetadata, extractTableLikeBlocks } from "../../../src/ingestion/chunker.js";
import type { ParsedPage } from "../../../src/domain/schemas.js";

describe("extractTableLikeBlocks", () => {
  it("groups a run of borderless label+numbers lines into one block", () => {
    const text = [
      "Consolidated Balance Sheets",
      "(In millions)",
      "As of December 31, 2024 2023",
      "Cash and cash equivalents 310 270",
      "Total assets 2,400 2,100",
      "Total liabilities 900 850",
      "Total shareholders' equity 1,500 1,250",
    ].join("\n");

    const { tableLikeBlocks, remainingText } = extractTableLikeBlocks(text);

    expect(tableLikeBlocks).toHaveLength(1);
    expect(tableLikeBlocks[0]).toContain("Total assets 2,400 2,100");
    expect(tableLikeBlocks[0]).toContain("As of December 31, 2024 2023");
    expect(remainingText).toContain("Consolidated Balance Sheets");
    expect(remainingText).not.toContain("Total assets");
  });

  it("does not misclassify prose that happens to end with a year", () => {
    const text = [
      "Revenue increased 12% to $1,120 million in fiscal 2024 from $1,000 million in fiscal 2023.",
      "The increase was driven primarily by growth in cloud subscriptions.",
    ].join("\n");

    const { tableLikeBlocks, remainingText } = extractTableLikeBlocks(text);

    expect(tableLikeBlocks).toHaveLength(0);
    expect(remainingText).toBe(text);
  });

  it("requires at least MIN_CONSECUTIVE_LINES before treating lines as a table", () => {
    const text = ["Some heading", "Total assets 2,400 2,100", "Some other prose line here."].join("\n");
    const { tableLikeBlocks } = extractTableLikeBlocks(text);
    expect(tableLikeBlocks).toHaveLength(0);
  });

  it("does not flag a single trailing number as a table line", () => {
    const text = ["We operate in approximately 40 countries.", "We serve millions of customers worldwide today."].join("\n");
    const { tableLikeBlocks } = extractTableLikeBlocks(text);
    expect(tableLikeBlocks).toHaveLength(0);
  });
});

describe("detectPageMetadata", () => {
  it("detects units, currency, and fiscal years mentioned on the page", () => {
    const meta = detectPageMetadata("Consolidated Balance Sheets\n(In millions)\nAs of December 31, 2024 and 2023, in USD.");
    expect(meta.units).toBe("millions");
    expect(meta.currency).toBe("USD");
    expect(meta.periods).toEqual([2024, 2023]);
  });

  it("returns an object with no keys when nothing is detected", () => {
    const meta = detectPageMetadata("Nothing financial here at all.");
    expect(meta).toEqual({});
  });
});

describe("chunkPage", () => {
  it("renders a detected table as one chunk with header and rows pipe-joined", async () => {
    const page: ParsedPage = {
      page_number: 3,
      text: "Consolidated Statements of Income\n(In millions)",
      tables: [{ page_number: 3, rows: [["", "2024", "2023"], ["Revenue", "1,120", "1,000"]] }],
    };

    const chunks = await chunkPage(page);
    const tableChunk = chunks.find((c) => c.chunkType === "table" && c.metadata.tableSource === "detected");
    expect(tableChunk).toBeDefined();
    expect(tableChunk?.content).toBe(" | 2024 | 2023\nRevenue | 1,120 | 1,000");
    expect(tableChunk?.pageNumber).toBe(3);
  });

  it("keeps a borderless table block as its own chunk, separate from prose", async () => {
    const page: ParsedPage = {
      page_number: 4,
      text: [
        "Consolidated Balance Sheets",
        "(In millions)",
        "As of December 31, 2024 2023",
        "Cash and cash equivalents 310 270",
        "Total assets 2,400 2,100",
        "Total liabilities 900 850",
      ].join("\n"),
      tables: [],
    };

    const chunks = await chunkPage(page);
    const tableLike = chunks.filter((c) => c.metadata.tableSource === "text-aligned");
    const prose = chunks.filter((c) => c.chunkType === "text");

    expect(tableLike).toHaveLength(1);
    expect(tableLike[0]?.content).toContain("Total assets 2,400 2,100");
    expect(prose.some((c) => c.content.includes("Consolidated Balance Sheets"))).toBe(true);
    expect(prose.some((c) => c.content.includes("Total assets"))).toBe(false);
  });

  it("splits long prose into multiple overlapping chunks", async () => {
    const paragraph = "This is a sentence about the company's performance. ".repeat(80);
    const page: ParsedPage = { page_number: 2, text: paragraph, tables: [] };

    const chunks = await chunkPage(page);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.content.length).toBeLessThanOrEqual(1300);
  });

  it("returns no chunks for a blank page", async () => {
    const page: ParsedPage = { page_number: 5, text: "   \n  ", tables: [] };
    const chunks = await chunkPage(page);
    expect(chunks).toHaveLength(0);
  });
});
