import { z } from "zod";

/** Strings from env; empty string is treated as "unset" so `.env` templates with blanks work. */
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === "" ? undefined : v.trim()));

const optionalNumber = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === "" ? undefined : Number(v)))
  .pipe(z.number().finite().optional());

const bool = z
  .enum(["true", "false", "1", "0"])
  .default("false")
  .transform((v) => v === "true" || v === "1");

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    HOST: z.string().default("0.0.0.0"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    AUTO_MIGRATE: bool,

    PYTHON_SERVICE_URL: z.string().url().default("http://localhost:8001"),
    INTERNAL_API_TOKEN: z.string().min(1, "INTERNAL_API_TOKEN is required"),
    PYTHON_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),

    UPLOAD_DIR: z.string().default("./data/uploads"),
    MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(50 * 1024 * 1024),
    INGEST_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),

    /** "key1:owner-a,key2:owner-b" — each API key maps to a data owner. */
    API_KEYS: z.string().min(1, "API_KEYS is required (format: key:ownerId,key2:ownerId2)"),

    EMBEDDING_PROVIDER: z.enum(["openai", "fake"]).default("openai"),
    EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
    EMBEDDING_DIMENSIONS: z.coerce.number().int().min(2).max(2000).default(1536),
    OPENAI_API_KEY: optionalString,

    LLM_PROVIDER: z.enum(["anthropic", "openai"]).default("anthropic"),
    LLM_MODEL: optionalString,
    LLM_MAX_TOKENS: z.coerce.number().int().positive().default(2048),
    ANTHROPIC_API_KEY: optionalString,

    RETRIEVAL_TOP_K: z.coerce.number().int().min(1).max(50).default(8),
    /** Cosine-similarity floor below which retrieval is treated as "nothing relevant". Unset = disabled. */
    MIN_RELEVANCE: optionalNumber,
  })
  .superRefine((env, ctx) => {
    if (env.EMBEDDING_PROVIDER === "openai" && !env.OPENAI_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["OPENAI_API_KEY"],
        message: "OPENAI_API_KEY is required when EMBEDDING_PROVIDER=openai (Anthropic has no embeddings API)",
      });
    }
    if (env.LLM_PROVIDER === "anthropic" && !env.ANTHROPIC_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["ANTHROPIC_API_KEY"],
        message: "ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic",
      });
    }
    if (env.LLM_PROVIDER === "openai") {
      if (!env.OPENAI_API_KEY) {
        ctx.addIssue({ code: "custom", path: ["OPENAI_API_KEY"], message: "OPENAI_API_KEY is required when LLM_PROVIDER=openai" });
      }
      if (!env.LLM_MODEL) {
        ctx.addIssue({ code: "custom", path: ["LLM_MODEL"], message: "LLM_MODEL is required when LLM_PROVIDER=openai" });
      }
    }
    try {
      parseApiKeys(env.API_KEYS);
    } catch (err) {
      ctx.addIssue({ code: "custom", path: ["API_KEYS"], message: (err as Error).message });
    }
  });

export interface ApiKeyEntry {
  key: string;
  ownerId: string;
}

/** Default matches CLAUDE.md ("claude-opus-4-6 unless a faster model is sufficient"). */
export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-4-6";

export interface Config {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  logLevel: string;
  databaseUrl: string;
  autoMigrate: boolean;
  python: { baseUrl: string; token: string; timeoutMs: number };
  uploads: { dir: string; maxBytes: number; concurrency: number };
  apiKeys: ApiKeyEntry[];
  embeddings: { provider: "openai" | "fake"; model: string; dimensions: number; openaiApiKey?: string };
  llm: { provider: "anthropic" | "openai"; model: string; maxTokens: number; apiKey: string };
  retrieval: { topK: number; minRelevance?: number };
}

export function parseApiKeys(raw: string): ApiKeyEntry[] {
  const entries = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const idx = pair.indexOf(":");
      const key = idx === -1 ? "" : pair.slice(0, idx).trim();
      const ownerId = idx === -1 ? "" : pair.slice(idx + 1).trim();
      if (!key || !ownerId) {
        throw new Error("API_KEYS entries must look like 'key:ownerId'");
      }
      return { key, ownerId };
    });
  if (entries.length === 0) throw new Error("API_KEYS must contain at least one 'key:ownerId' entry");
  return entries;
}

/**
 * Parse and validate configuration. Pure function of its input: no globals, so
 * tests can build any configuration they need.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join("\n")}`);
  }
  const e = parsed.data;
  const llmApiKey = (e.LLM_PROVIDER === "anthropic" ? e.ANTHROPIC_API_KEY : e.OPENAI_API_KEY) as string;
  return {
    nodeEnv: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    autoMigrate: e.AUTO_MIGRATE,
    python: { baseUrl: e.PYTHON_SERVICE_URL.replace(/\/+$/, ""), token: e.INTERNAL_API_TOKEN, timeoutMs: e.PYTHON_REQUEST_TIMEOUT_MS },
    uploads: { dir: e.UPLOAD_DIR, maxBytes: e.MAX_UPLOAD_BYTES, concurrency: e.INGEST_CONCURRENCY },
    apiKeys: parseApiKeys(e.API_KEYS),
    embeddings: {
      provider: e.EMBEDDING_PROVIDER,
      model: e.EMBEDDING_MODEL,
      dimensions: e.EMBEDDING_DIMENSIONS,
      ...(e.OPENAI_API_KEY ? { openaiApiKey: e.OPENAI_API_KEY } : {}),
    },
    llm: {
      provider: e.LLM_PROVIDER,
      model: e.LLM_MODEL ?? DEFAULT_ANTHROPIC_MODEL,
      maxTokens: e.LLM_MAX_TOKENS,
      apiKey: llmApiKey,
    },
    retrieval: { topK: e.RETRIEVAL_TOP_K, ...(e.MIN_RELEVANCE !== undefined ? { minRelevance: e.MIN_RELEVANCE } : {}) },
  };
}
