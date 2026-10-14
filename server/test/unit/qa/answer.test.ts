import { describe, expect, it } from "vitest";
import { answerQuestion } from "../../../src/qa/answer.js";
import { FakeStructuredChatModel } from "../../helpers/fakeChatModel.js";
import type { RetrievedChunk } from "../../../src/domain/schemas.js";

function chunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    chunkId: "c1",
    documentId: "d1",
    fileName: "acme.pdf",
    companyName: "Acme Corp",
    ticker: "ACME",
    fiscalYear: 2024,
    reportingPeriod: "FY2024",
    documentType: "10-K",
    pageNumber: 3,
    chunkType: "table",
    content: "FY2024 results:\nRevenue | 1,120 | 1,000\nNet income | 168 | 140",
    metadata: {},
    score: 0.87,
    ...overrides,
  };
}

describe("answerQuestion", () => {
  it("short-circuits with an insufficient answer and makes no LLM call when nothing was retrieved", async () => {
    const chatModel = new FakeStructuredChatModel({ responses: [] }); // would throw if invoked
    const result = await answerQuestion({ chatModel, modelName: "claude-opus-4-6" }, "What was revenue?", [], 12);

    expect(result.sufficient).toBe(false);
    expect(result.citations).toEqual([]);
    expect(result.retrieval).toEqual({ chunkCount: 0, topScore: null, latencyMs: 12 });
    expect(result.usage).toBeNull();
  });

  it("returns a grounded answer with verified citations and usage on the happy path", async () => {
    const chatModel = new FakeStructuredChatModel({
      responses: [
        {
          parsed: {
            sufficient: true,
            answer: "Acme's revenue was $1,120 million in FY2024 [S1].",
            citations: [{ label: "S1", quote: "Revenue | 1,120" }],
          },
          usage: { inputTokens: 500, outputTokens: 40 },
        },
      ],
    });

    const result = await answerQuestion({ chatModel, modelName: "claude-opus-4-6" }, "What was Acme's revenue?", [chunk()], 20);

    expect(result.sufficient).toBe(true);
    expect(result.citations).toEqual([
      { label: "S1", chunkId: "c1", documentId: "d1", documentName: "acme.pdf", page: 3, company: "Acme Corp", fiscalYear: 2024, quote: "Revenue | 1,120" },
    ]);
    expect(result.warnings).toEqual([]);
    expect(result.ungroundedNumbers).toEqual([]);
    expect(result.usage).toEqual({ inputTokens: 500, outputTokens: 40 });
    expect(result.model).toBe("claude-opus-4-6");
    expect(result.retrieval).toEqual({ chunkCount: 1, topScore: 0.87, latencyMs: 20 });
  });

  it("strips a fabricated citation and warns, without failing the whole answer", async () => {
    const chatModel = new FakeStructuredChatModel({
      responses: [
        {
          parsed: {
            sufficient: true,
            answer: "Revenue was $1,120 million [S1], and margins improved [S9].",
            citations: [
              { label: "S1", quote: "Revenue | 1,120" },
              { label: "S9", quote: "margins improved significantly" },
            ],
          },
        },
      ],
    });

    const result = await answerQuestion({ chatModel, modelName: "claude-opus-4-6" }, "q", [chunk()], 1);

    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]?.label).toBe("S1");
    expect(result.warnings.map((w) => w.code)).toContain("invalid_citation_removed");
  });

  it("flags ungrounded numbers in a sufficient answer", async () => {
    const chatModel = new FakeStructuredChatModel({
      responses: [
        {
          parsed: {
            sufficient: true,
            answer: "Revenue was $1,120 million [S1] and grew 45% [S1].",
            citations: [{ label: "S1", quote: "Revenue | 1,120" }],
          },
        },
      ],
    });

    const result = await answerQuestion({ chatModel, modelName: "claude-opus-4-6" }, "q", [chunk()], 1);
    expect(result.ungroundedNumbers).toEqual(["45%"]);
    expect(result.warnings.map((w) => w.code)).toContain("ungrounded_numbers");
  });

  it("does not run number-grounding when the model reports insufficient information", async () => {
    const chatModel = new FakeStructuredChatModel({
      responses: [
        {
          parsed: {
            sufficient: false,
            answer: "The documents do not state Q4 guidance.",
            citations: [],
          },
        },
      ],
    });

    const result = await answerQuestion({ chatModel, modelName: "claude-opus-4-6" }, "What is Q4 guidance?", [chunk()], 1);
    expect(result.sufficient).toBe(false);
    expect(result.ungroundedNumbers).toEqual([]);
  });
});
