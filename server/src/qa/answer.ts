import { z } from "zod";
import type { BaseMessage } from "@langchain/core/messages";
import type { UsageMetadata } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { AskResponse, RetrievedChunk } from "../domain/schemas.js";
import { UpstreamError } from "../domain/errors.js";
import { buildCitations } from "./citations.js";
import { findUngroundedNumbers } from "./groundedNumbers.js";
import { QA_SYSTEM_PROMPT, buildUserPrompt } from "./prompt.js";

const ModelAnswerSchema = z.object({
  sufficient: z
    .boolean()
    .describe("True if the sources contain enough information to answer the question; false otherwise."),
  answer: z
    .string()
    .describe("The answer, with inline [S1]-style citation labels after every factual claim and number."),
  citations: z
    .array(
      z.object({
        label: z.string().describe('Source label exactly as given, e.g. "S2".'),
        quote: z.string().describe("The exact supporting text copied verbatim from that source."),
      }),
    )
    .describe("One entry per citation used in the answer."),
});

export interface AnswerQuestionDeps {
  chatModel: BaseChatModel;
  modelName: string;
}

const INSUFFICIENT_NO_RESULTS =
  "I couldn't find any documents matching your question. Upload the relevant report, or broaden your search filters, and try again.";

/**
 * Answer a question grounded in `retrievedChunks`. Never calls the LLM when
 * there is nothing to ground an answer in — an empty retrieval short-circuits
 * to an explicit "insufficient" response (see IMPLEMENTATION_PLAN.md §2,
 * "Insufficient info" row).
 */
export async function answerQuestion(
  deps: AnswerQuestionDeps,
  question: string,
  retrievedChunks: RetrievedChunk[],
  retrievalLatencyMs: number,
): Promise<AskResponse> {
  const startedAt = Date.now();

  if (retrievedChunks.length === 0) {
    return {
      answer: INSUFFICIENT_NO_RESULTS,
      sufficient: false,
      citations: [],
      warnings: [],
      ungroundedNumbers: [],
      retrieval: { chunkCount: 0, topScore: null, latencyMs: retrievalLatencyMs },
      usage: null,
      model: null,
      latencyMs: Date.now() - startedAt,
    };
  }

  const structuredModel = deps.chatModel.withStructuredOutput(ModelAnswerSchema, { includeRaw: true });

  let raw: Awaited<ReturnType<typeof structuredModel.invoke>>;
  try {
    raw = await structuredModel.invoke([
      ["system", QA_SYSTEM_PROMPT],
      ["human", buildUserPrompt(question, retrievedChunks)],
    ]);
  } catch (err) {
    throw new UpstreamError("LLM request failed while answering the question.", { cause: err });
  }

  const parsed = raw.parsed;
  const { citations, warnings } = buildCitations(parsed.citations, retrievedChunks);
  const ungroundedNumbers = parsed.sufficient ? findUngroundedNumbers(parsed.answer, retrievedChunks) : [];
  if (ungroundedNumbers.length > 0) {
    warnings.push({
      code: "ungrounded_numbers",
      message: `${ungroundedNumbers.length} number(s) in the answer were not found in the retrieved sources.`,
    });
  }

  const usageMetadata = getUsageMetadata(raw.raw);
  const scores = retrievedChunks.map((c) => c.score);

  return {
    answer: parsed.answer,
    sufficient: parsed.sufficient,
    citations,
    warnings,
    ungroundedNumbers,
    retrieval: { chunkCount: retrievedChunks.length, topScore: Math.max(...scores), latencyMs: retrievalLatencyMs },
    usage: usageMetadata ? { inputTokens: usageMetadata.input_tokens, outputTokens: usageMetadata.output_tokens } : null,
    model: deps.modelName,
    latencyMs: Date.now() - startedAt,
  };
}

/** `withStructuredOutput`'s `raw` is typed as plain BaseMessage, but chat models return an AIMessage at runtime. */
function getUsageMetadata(message: BaseMessage): UsageMetadata | undefined {
  return "usage_metadata" in message ? (message as { usage_metadata?: UsageMetadata }).usage_metadata : undefined;
}
