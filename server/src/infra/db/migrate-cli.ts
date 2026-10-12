import "dotenv/config";
import { loadConfig } from "../../config/env.js";
import { createPool } from "./pool.js";
import { assertEmbeddingSchema, runMigrations } from "./migrate.js";

const config = loadConfig();
const pool = createPool(config.databaseUrl);
try {
  const applied = await runMigrations(pool, { embeddingDimensions: config.embeddings.dimensions });
  console.log(applied.length ? `Applied: ${applied.join(", ")}` : "No pending migrations.");
  const info = await assertEmbeddingSchema(pool, config.embeddings.dimensions);
  console.log(`Schema OK (vector(${info.embeddingDimensions}), pgvector ${info.pgvectorVersion}).`);
} finally {
  await pool.end();
}
