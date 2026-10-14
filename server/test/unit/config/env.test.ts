import { describe, expect, it } from "vitest";
import { loadConfig, parseApiKeys } from "../../../src/config/env.js";

const BASE_ENV = {
  DATABASE_URL: "postgres://localhost/db",
  API_KEYS: "abc123:owner-a",
  OPENAI_API_KEY: "sk-test",
  ANTHROPIC_API_KEY: "sk-ant-test",
  INTERNAL_API_TOKEN: "internal-token",
};

describe("loadConfig", () => {
  it("parses a minimal valid environment with defaults", () => {
    const config = loadConfig(BASE_ENV);
    expect(config.databaseUrl).toBe("postgres://localhost/db");
    expect(config.apiKeys).toEqual([{ key: "abc123", ownerId: "owner-a" }]);
    expect(config.llm.model).toBe("claude-opus-4-6"); // CLAUDE.md default
    expect(config.embeddings.dimensions).toBe(1536);
    expect(config.retrieval.topK).toBe(8);
    expect(config.retrieval.minRelevance).toBeUndefined();
  });

  it("throws with a readable message when DATABASE_URL is missing", () => {
    const { DATABASE_URL: _drop, ...rest } = BASE_ENV;
    expect(() => loadConfig(rest)).toThrow(/DATABASE_URL/);
  });

  it("requires OPENAI_API_KEY when EMBEDDING_PROVIDER=openai (Anthropic has no embeddings API)", () => {
    const { OPENAI_API_KEY: _drop, ...rest } = BASE_ENV;
    expect(() => loadConfig({ ...rest, EMBEDDING_PROVIDER: "openai" })).toThrow(/OPENAI_API_KEY/);
  });

  it("allows omitting OPENAI_API_KEY when EMBEDDING_PROVIDER=fake", () => {
    const { OPENAI_API_KEY: _drop, ...rest } = BASE_ENV;
    expect(() => loadConfig({ ...rest, EMBEDDING_PROVIDER: "fake" })).not.toThrow();
  });

  it("requires ANTHROPIC_API_KEY when LLM_PROVIDER=anthropic", () => {
    const { ANTHROPIC_API_KEY: _drop, ...rest } = BASE_ENV;
    expect(() => loadConfig(rest)).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("requires LLM_MODEL and OPENAI_API_KEY when LLM_PROVIDER=openai", () => {
    expect(() => loadConfig({ ...BASE_ENV, LLM_PROVIDER: "openai" })).toThrow(/LLM_MODEL/);
  });

  it("respects an explicit MIN_RELEVANCE", () => {
    const config = loadConfig({ ...BASE_ENV, MIN_RELEVANCE: "0.35" });
    expect(config.retrieval.minRelevance).toBe(0.35);
  });

  it("rejects a malformed API_KEYS entry", () => {
    expect(() => loadConfig({ ...BASE_ENV, API_KEYS: "not-a-valid-entry" })).toThrow(/API_KEYS/);
  });
});

describe("parseApiKeys", () => {
  it("parses multiple entries", () => {
    expect(parseApiKeys("k1:owner-a, k2:owner-b")).toEqual([
      { key: "k1", ownerId: "owner-a" },
      { key: "k2", ownerId: "owner-b" },
    ]);
  });

  it("throws on an empty string", () => {
    expect(() => parseApiKeys("")).toThrow();
  });

  it("throws when a key or ownerId is empty", () => {
    expect(() => parseApiKeys("key1:")).toThrow();
    expect(() => parseApiKeys(":owner")).toThrow();
  });
});
