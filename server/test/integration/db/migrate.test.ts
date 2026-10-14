import { describe, expect, it } from "vitest";
import { assertEmbeddingSchema, runMigrations } from "../../../src/infra/db/migrate.js";
import { ConfigError } from "../../../src/domain/errors.js";
import { getMigratedTestPool } from "../../helpers/db.js";
import { makeTestConfig } from "../../helpers/testConfig.js";

describe.skipIf(!process.env["RUN_INTEGRATION_TESTS"])("migrations against a real Postgres + pgvector", () => {
  it("applies migrations idempotently (second run applies nothing)", async () => {
    const pool = await getMigratedTestPool();
    const second = await runMigrations(pool, { embeddingDimensions: makeTestConfig().embeddings.dimensions });
    expect(second).toEqual([]);
  });

  it("reports the configured embedding dimension and pgvector version", async () => {
    const pool = await getMigratedTestPool();
    const info = await assertEmbeddingSchema(pool, makeTestConfig().embeddings.dimensions);
    expect(info.embeddingDimensions).toBe(64);
    expect(info.pgvectorVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("throws ConfigError when the configured dimension does not match the schema", async () => {
    const pool = await getMigratedTestPool();
    await expect(assertEmbeddingSchema(pool, 9999)).rejects.toThrow(ConfigError);
  });
});
