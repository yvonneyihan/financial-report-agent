import type { FastifyInstance } from "fastify";
import type { PythonServiceClient } from "../../infra/python/client.js";
import type { Pool } from "../../infra/db/pool.js";

export async function registerHealthRoute(app: FastifyInstance, deps: { pool: Pool; pythonClient: PythonServiceClient }) {
  app.get("/health", async (_request, reply) => {
    const [dbOk, pythonOk] = await Promise.all([
      deps.pool
        .query("SELECT 1")
        .then(() => true)
        .catch(() => false),
      deps.pythonClient.health(),
    ]);
    const ok = dbOk && pythonOk;
    reply.code(ok ? 200 : 503).send({ status: ok ? "ok" : "degraded", dependencies: { database: dbOk, financeCore: pythonOk } });
  });
}
