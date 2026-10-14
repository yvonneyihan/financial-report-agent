import type { FastifyInstance } from "fastify";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AskRequestSchema } from "../../domain/schemas.js";
import { answerQuestion } from "../../qa/answer.js";
import { vectorSearch } from "../../infra/db/vectorSearch.js";
import type { Pool } from "../../infra/db/pool.js";

export interface AskRouteDeps {
  pool: Pool;
  embeddings: EmbeddingsInterface;
  chatModel: BaseChatModel;
  modelName: string;
  defaultTopK: number;
  minRelevance: number | undefined;
  supportsIterativeScan: boolean;
}

export async function registerAskRoute(app: FastifyInstance, deps: AskRouteDeps) {
  app.post("/ask", async (request) => {
    const body = AskRequestSchema.parse(request.body);
    const retrievalStart = Date.now();
    const queryEmbedding = await deps.embeddings.embedQuery(body.question);
    const chunks = await vectorSearch(deps.pool, {
      ownerId: request.ownerId,
      queryEmbedding,
      topK: body.topK ?? deps.defaultTopK,
      supportsIterativeScan: deps.supportsIterativeScan,
      ...(body.filters ? { filters: body.filters } : {}),
      ...(deps.minRelevance !== undefined ? { minRelevance: deps.minRelevance } : {}),
    });
    const retrievalLatencyMs = Date.now() - retrievalStart;

    return answerQuestion({ chatModel: deps.chatModel, modelName: deps.modelName }, body.question, chunks, retrievalLatencyMs);
  });
}
