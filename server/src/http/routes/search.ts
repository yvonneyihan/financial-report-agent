import type { FastifyInstance } from "fastify";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import { SearchRequestSchema } from "../../domain/schemas.js";
import { vectorSearch } from "../../infra/db/vectorSearch.js";
import type { Pool } from "../../infra/db/pool.js";

export interface SearchRouteDeps {
  pool: Pool;
  embeddings: EmbeddingsInterface;
  defaultTopK: number;
  minRelevance: number | undefined;
  supportsIterativeScan: boolean;
}

export async function registerSearchRoute(app: FastifyInstance, deps: SearchRouteDeps) {
  app.post("/search", async (request) => {
    const body = SearchRequestSchema.parse(request.body);
    const startedAt = Date.now();
    const queryEmbedding = await deps.embeddings.embedQuery(body.query);
    const results = await vectorSearch(deps.pool, {
      ownerId: request.ownerId,
      queryEmbedding,
      topK: body.topK ?? deps.defaultTopK,
      supportsIterativeScan: deps.supportsIterativeScan,
      ...(body.filters ? { filters: body.filters } : {}),
      ...(deps.minRelevance !== undefined ? { minRelevance: deps.minRelevance } : {}),
    });
    return { results, latencyMs: Date.now() - startedAt };
  });
}
