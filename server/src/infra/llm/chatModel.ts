import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { Config } from "../../config/env.js";
import { ConfigError } from "../../domain/errors.js";

/**
 * Build the answer-generation chat model per CLAUDE.md conventions: API key
 * from the environment, `claude-opus-4-6` by default. No sampling params are
 * set so behaviour follows the model's own defaults across versions.
 */
export function createChatModel(config: Config["llm"]): BaseChatModel {
  if (config.provider === "anthropic") {
    return new ChatAnthropic({ apiKey: config.apiKey, model: config.model, maxTokens: config.maxTokens });
  }
  if (config.provider === "openai") {
    return new ChatOpenAI({ apiKey: config.apiKey, model: config.model, maxTokens: config.maxTokens });
  }
  const exhaustiveCheck: never = config.provider;
  throw new ConfigError(`Unknown LLM provider: ${String(exhaustiveCheck)}`);
}
