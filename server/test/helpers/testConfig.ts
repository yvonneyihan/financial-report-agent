import type { Config } from "../../src/config/env.js";

/** A fully-valid config for tests, overridable per test. Never reads process.env. */
export function makeTestConfig(overrides: Partial<Config> = {}): Config {
  return {
    nodeEnv: "test",
    host: "127.0.0.1",
    port: 0,
    logLevel: "silent",
    databaseUrl: process.env["TEST_DATABASE_URL"] ?? "postgres://postgres:postgres@localhost:55432/fra_test",
    autoMigrate: false,
    python: { baseUrl: "http://localhost:8001", token: "test-internal-token", timeoutMs: 5000 },
    uploads: { dir: "./data/test-uploads", maxBytes: 50 * 1024 * 1024, concurrency: 1 },
    apiKeys: [{ key: "test-key", ownerId: "owner-a" }],
    embeddings: { provider: "fake", model: "fake-embeddings", dimensions: 64 },
    llm: { provider: "anthropic", model: "claude-opus-4-6", maxTokens: 1024, apiKey: "test-anthropic-key" },
    retrieval: { topK: 8 },
    ...overrides,
  };
}
