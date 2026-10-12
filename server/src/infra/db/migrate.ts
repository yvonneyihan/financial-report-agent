import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigError } from "../../domain/errors.js";
import { withTransaction, type Pool } from "./pool.js";

export const DEFAULT_MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../migrations");

/** Arbitrary constant; serialises concurrent migration runs across processes. */
const MIGRATION_LOCK_ID = 727_274_001;

/** Substitute `${EMBEDDING_DIMENSIONS}` in a migration file. Unknown placeholders are an error. */
export function renderMigration(sql: string, vars: { EMBEDDING_DIMENSIONS: number }): string {
  return sql.replace(/\$\{([A-Z_]+)\}/g, (_m, name: string) => {
    if (name === "EMBEDDING_DIMENSIONS") {
      if (!Number.isInteger(vars.EMBEDDING_DIMENSIONS) || vars.EMBEDDING_DIMENSIONS < 1) {
        throw new ConfigError("EMBEDDING_DIMENSIONS must be a positive integer");
      }
      return String(vars.EMBEDDING_DIMENSIONS);
    }
    throw new ConfigError(`Unknown migration placeholder \${${name}}`);
  });
}

/**
 * Apply pending `*.sql` migrations in filename order. Each runs in its own
 * transaction and is recorded in `schema_migrations`. Returns names applied.
 */
export async function runMigrations(
  pool: Pool,
  opts: { embeddingDimensions: number; dir?: string },
): Promise<string[]> {
  const dir = opts.dir ?? DEFAULT_MIGRATIONS_DIR;
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

  const lock = await pool.connect();
  const applied: string[] = [];
  try {
    await lock.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    await lock.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const done = new Set((await lock.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));

    for (const file of files) {
      if (done.has(file)) continue;
      const sql = renderMigration(await readFile(path.join(dir, file), "utf8"), {
        EMBEDDING_DIMENSIONS: opts.embeddingDimensions,
      });
      await withTransaction(pool, async (client) => {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      });
      applied.push(file);
    }
  } finally {
    await lock.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]).catch(() => undefined);
    lock.release();
  }
  return applied;
}

export interface SchemaInfo {
  /** Dimension the `document_chunks.embedding` column was created with. */
  embeddingDimensions: number;
  /** pgvector extension version, e.g. "0.8.0". */
  pgvectorVersion: string;
  /** HNSW iterative scans (needed for accurate filtered search) exist from pgvector 0.8.0. */
  supportsIterativeScan: boolean;
}

/**
 * Fail fast if the configured embedder cannot write to the existing schema.
 * (pgvector columns have a fixed dimension; changing embedding model requires a re-embed.)
 */
export async function assertEmbeddingSchema(pool: Pool, configuredDimensions: number): Promise<SchemaInfo> {
  const col = await pool.query<{ dims: number | null }>(
    `SELECT a.atttypmod AS dims
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
      WHERE c.relname = 'document_chunks' AND a.attname = 'embedding' AND NOT a.attisdropped`,
  );
  const dims = col.rows[0]?.dims;
  if (dims === undefined || dims === null || dims < 1) {
    throw new ConfigError("document_chunks.embedding not found. Run migrations first (npm run migrate).");
  }
  if (dims !== configuredDimensions) {
    throw new ConfigError(
      `Embedding dimension mismatch: database column is vector(${dims}) but EMBEDDING_DIMENSIONS=${configuredDimensions}. ` +
        "Use a matching model/dimension, or re-create the schema and re-ingest (vector columns have a fixed size).",
    );
  }
  const ext = await pool.query<{ extversion: string }>("SELECT extversion FROM pg_extension WHERE extname = 'vector'");
  const pgvectorVersion = ext.rows[0]?.extversion ?? "0.0.0";
  return { embeddingDimensions: dims, pgvectorVersion, supportsIterativeScan: versionAtLeast(pgvectorVersion, [0, 8, 0]) };
}

export function versionAtLeast(version: string, min: [number, number, number]): boolean {
  const parts = version.split(".").map((p) => Number.parseInt(p, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const v = parts[i] ?? 0;
    if (v !== min[i]) return v > (min[i] as number);
  }
  return true;
}
