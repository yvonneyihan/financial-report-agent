import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import type { ApiKeyEntry } from "../config/env.js";
import { UnauthorizedError } from "../domain/errors.js";

declare module "fastify" {
  interface FastifyRequest {
    ownerId: string;
  }
}

export interface AuthPluginOptions {
  apiKeys: ApiKeyEntry[];
}

/**
 * Minimal API-key -> ownerId auth (see IMPLEMENTATION_PLAN.md §2). Register
 * this only inside the encapsulated sub-app that needs it (see http/app.ts,
 * which mounts it under the `/api/v1` prefix and keeps `/health` outside it)
 * — every request handled in that scope requires `Authorization: Bearer <key>`
 * or `X-API-Key: <key>`, and all data access downstream is scoped to
 * `request.ownerId`. A placeholder for real OIDC/JWT auth, not a claim that
 * this is production-grade.
 */
export const authPlugin = fp(
  async function authPlugin(app: FastifyInstance, opts: AuthPluginOptions) {
    const keyToOwner = new Map(opts.apiKeys.map((e) => [e.key, e.ownerId]));

    app.decorateRequest("ownerId", "");

    app.addHook("preHandler", async (request) => {
      const header = request.headers.authorization;
      const bearer = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
      const apiKeyHeader = request.headers["x-api-key"];
      const key = bearer ?? (typeof apiKeyHeader === "string" ? apiKeyHeader : undefined);

      if (!key) throw new UnauthorizedError("Missing API key. Send 'Authorization: Bearer <key>' or 'X-API-Key: <key>'.");
      const ownerId = keyToOwner.get(key);
      if (!ownerId) throw new UnauthorizedError("Invalid API key.");
      request.ownerId = ownerId;
    });
  },
  { name: "auth-plugin" },
);
