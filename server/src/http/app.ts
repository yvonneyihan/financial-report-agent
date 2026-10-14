import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ApiKeyEntry } from "../config/env.js";
import type { Pool } from "../infra/db/pool.js";
import type { DocumentStore } from "../infra/db/documentStore.js";
import type { PythonServiceClient } from "../infra/python/client.js";
import type { DocumentStorage } from "../infra/storage.js";
import type { IngestionDeps } from "../ingestion/pipeline.js";
import { authPlugin } from "./auth.js";
import { errorHandler } from "./errors.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerDocumentRoutes } from "./routes/documents.js";
import { registerSearchRoute } from "./routes/search.js";
import { registerAskRoute } from "./routes/ask.js";

export interface AppDeps {
  pool: Pool;
  documentStore: DocumentStore;
  storage: DocumentStorage;
  pythonClient: PythonServiceClient;
  embeddings: EmbeddingsInterface;
  chatModel: BaseChatModel;
  ingestionDeps: IngestionDeps;
  apiKeys: ApiKeyEntry[];
  llmModelName: string;
  maxUploadBytes: number;
  retrievalTopK: number;
  minRelevance: number | undefined;
  supportsIterativeScan: boolean;
  logLevel?: string;
}

/**
 * Build the Fastify app. This is the ONLY public API in the system (see
 * IMPLEMENTATION_PLAN.md §2) — everything else (Python service, MCP server
 * in Phase 5) is reached through it, never exposed directly to clients.
 */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: deps.logLevel ?? "info" } });
  app.setErrorHandler(errorHandler);

  // /health is intentionally outside the authenticated `/api/v1` scope below,
  // so load balancers and container orchestrators can probe it unauthenticated.
  await registerHealthRoute(app, { pool: deps.pool, pythonClient: deps.pythonClient });

  await app.register(
    async (api) => {
      await api.register(multipart, {
        attachFieldsToBody: true,
        limits: { fileSize: deps.maxUploadBytes },
      });
      await api.register(authPlugin, { apiKeys: deps.apiKeys });

      await registerDocumentRoutes(api, {
        documentStore: deps.documentStore,
        storage: deps.storage,
        ingestionDeps: deps.ingestionDeps,
        maxUploadBytes: deps.maxUploadBytes,
      });
      await registerSearchRoute(api, {
        pool: deps.pool,
        embeddings: deps.embeddings,
        defaultTopK: deps.retrievalTopK,
        minRelevance: deps.minRelevance,
        supportsIterativeScan: deps.supportsIterativeScan,
      });
      await registerAskRoute(api, {
        pool: deps.pool,
        embeddings: deps.embeddings,
        chatModel: deps.chatModel,
        modelName: deps.llmModelName,
        defaultTopK: deps.retrievalTopK,
        minRelevance: deps.minRelevance,
        supportsIterativeScan: deps.supportsIterativeScan,
      });
    },
    { prefix: "/api/v1" },
  );

  return app;
}
