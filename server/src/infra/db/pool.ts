import pg from "pg";

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;

export function createPool(databaseUrl: string): Pool {
  return new pg.Pool({ connectionString: databaseUrl, max: 10, idleTimeoutMillis: 30_000 });
}

/** Run `fn` inside a transaction; commits on success, rolls back and rethrows on error. */
export async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** pgvector text literal, e.g. `[0.1,0.2]`. Passed as a parameter and cast with `::vector`. */
export function toVectorLiteral(vector: readonly number[]): string {
  for (const n of vector) {
    if (!Number.isFinite(n)) throw new Error("Embedding contains a non-finite value");
  }
  return `[${vector.join(",")}]`;
}
