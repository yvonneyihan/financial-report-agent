import { OpenAIEmbeddings } from "@langchain/openai";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import type { Config } from "../../config/env.js";
import { ConfigError } from "../../domain/errors.js";

/**
 * Deterministic, dependency-free embedder for tests. NOT for production use —
 * it carries no semantic meaning, only a fixed dimensionality contract.
 */
export class FakeEmbeddings implements EmbeddingsInterface {
  constructor(private readonly dimensions: number) {}

  async embedDocuments(documents: string[]): Promise<number[][]> {
    return documents.map((d) => this.vectorFor(d));
  }

  async embedQuery(document: string): Promise<number[]> {
    return this.vectorFor(document);
  }

  /** Hash-based bag-of-words so lexically similar text yields similar (not identical) vectors. */
  private vectorFor(text: string): number[] {
    const vec = new Array<number>(this.dimensions).fill(0);
    const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    for (const word of words) {
      let hash = 0;
      for (let i = 0; i < word.length; i++) hash = (hash * 31 + word.charCodeAt(i)) >>> 0;
      const index = hash % this.dimensions;
      vec[index] = (vec[index] ?? 0) + 1;
    }
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
    return vec.map((v) => v / norm);
  }
}

/**
 * Anthropic has no embeddings endpoint (see IMPLEMENTATION_PLAN.md §2), so the
 * embedder is a separate, swappable provider from the answer-generation LLM.
 */
export function createEmbeddings(config: Config["embeddings"]): EmbeddingsInterface {
  if (config.provider === "fake") return new FakeEmbeddings(config.dimensions);
  if (config.provider === "openai") {
    if (!config.openaiApiKey) throw new ConfigError("OPENAI_API_KEY is required for EMBEDDING_PROVIDER=openai");
    return new OpenAIEmbeddings({ apiKey: config.openaiApiKey, model: config.model, dimensions: config.dimensions });
  }
  const exhaustiveCheck: never = config.provider;
  throw new ConfigError(`Unknown embedding provider: ${String(exhaustiveCheck)}`);
}
