import { createPool, type Pool } from "../../src/infra/db/pool.js";
import { runMigrations } from "../../src/infra/db/migrate.js";
import { makeTestConfig } from "./testConfig.js";

let sharedPool: Pool | undefined;

/** One pool per test process, migrated once. Reused across integration test files. */
export async function getMigratedTestPool(): Promise<Pool> {
  if (!sharedPool) {
    const config = makeTestConfig();
    sharedPool = createPool(config.databaseUrl);
    await runMigrations(sharedPool, { embeddingDimensions: config.embeddings.dimensions });
  }
  return sharedPool;
}

/** Wipe all rows between tests. Cascades from documents to document_chunks. */
export async function truncateAll(pool: Pool): Promise<void> {
  await pool.query("TRUNCATE TABLE documents RESTART IDENTITY CASCADE");
}
