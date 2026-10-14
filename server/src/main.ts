import "dotenv/config";
import { loadConfig } from "./config/env.js";
import { createPool } from "./infra/db/pool.js";
import { assertEmbeddingSchema, runMigrations } from "./infra/db/migrate.js";
import { DocumentStore } from "./infra/db/documentStore.js";
import { LocalDocumentStorage } from "./infra/storage.js";
import { PythonServiceClient } from "./infra/python/client.js";
import { createEmbeddings } from "./infra/llm/embeddings.js";
import { createChatModel } from "./infra/llm/chatModel.js";
import { buildApp } from "./http/app.js";
import type { IngestionDeps } from "./ingestion/pipeline.js";

const config = loadConfig();
const pool = createPool(config.databaseUrl);

if (config.autoMigrate) {
  const applied = await runMigrations(pool, { embeddingDimensions: config.embeddings.dimensions });
  if (applied.length > 0) console.log(`Applied migrations: ${applied.join(", ")}`);
}
const schemaInfo = await assertEmbeddingSchema(pool, config.embeddings.dimensions);

const documentStore = new DocumentStore(pool);
const storage = new LocalDocumentStorage(config.uploads.dir);
const pythonClient = new PythonServiceClient({
  baseUrl: config.python.baseUrl,
  token: config.python.token,
  timeoutMs: config.python.timeoutMs,
});
const embeddings = createEmbeddings(config.embeddings);
const chatModel = createChatModel(config.llm);

const ingestionDeps: IngestionDeps = {
  pool,
  documentStore,
  storage,
  pythonClient,
  embeddings,
  embeddingModel: config.embeddings.model,
};

const app = await buildApp({
  pool,
  documentStore,
  storage,
  pythonClient,
  embeddings,
  chatModel,
  ingestionDeps,
  apiKeys: config.apiKeys,
  llmModelName: config.llm.model,
  maxUploadBytes: config.uploads.maxBytes,
  retrievalTopK: config.retrieval.topK,
  minRelevance: config.retrieval.minRelevance,
  supportsIterativeScan: schemaInfo.supportsIterativeScan,
  logLevel: config.logLevel,
});

async function shutdown(signal: string) {
  app.log.info(`Received ${signal}, shutting down.`);
  await app.close();
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ host: config.host, port: config.port });
