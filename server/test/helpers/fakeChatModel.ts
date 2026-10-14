import { BaseChatModel, type BaseChatModelParams } from "@langchain/core/language_models/chat_models";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import type { ChatResult } from "@langchain/core/outputs";

export type ScriptedResponse = { parsed: Record<string, unknown>; usage?: { inputTokens: number; outputTokens: number } };

export interface FakeStructuredChatModelParams extends BaseChatModelParams {
  /** One entry consumed per `withStructuredOutput(...).invoke(...)` call, in order. */
  responses: ScriptedResponse[];
}

/**
 * A minimal chat model for testing the QA layer without a real LLM. Bypasses
 * LangChain's normal tool-calling machinery for structured output — instead
 * of parsing free text, it hands back pre-scripted responses in order, which
 * lets tests set up specific (including adversarial: fabricated citations,
 * unverifiable quotes, hallucinated numbers) model behaviour deterministically.
 */
export class FakeStructuredChatModel extends BaseChatModel {
  private readonly responses: ScriptedResponse[];
  private cursor = 0;

  constructor(params: FakeStructuredChatModelParams) {
    super(params);
    this.responses = [...params.responses];
  }

  /** Queue another scripted response, consumed after any already queued. */
  pushResponse(response: ScriptedResponse): void {
    this.responses.push(response);
  }

  _llmType(): string {
    return "fake-structured-chat-model";
  }

  async _generate(_messages: BaseMessage[]): Promise<ChatResult> {
    throw new Error("FakeStructuredChatModel does not support _generate directly; use withStructuredOutput.");
  }

  override withStructuredOutput(_schema: unknown, _config?: { includeRaw?: boolean }): ReturnType<BaseChatModel["withStructuredOutput"]> {
    const next = (): ScriptedResponse => {
      if (this.cursor >= this.responses.length) {
        throw new Error(`FakeStructuredChatModel: no scripted response left (call #${this.cursor + 1}).`);
      }
      const response = this.responses[this.cursor] as ScriptedResponse;
      this.cursor++;
      return response;
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return RunnableLambda.from(async (_input: unknown) => {
      const response = next();
      const raw = new AIMessage({
        content: "",
        ...(response.usage
          ? {
              usage_metadata: {
                input_tokens: response.usage.inputTokens,
                output_tokens: response.usage.outputTokens,
                total_tokens: response.usage.inputTokens + response.usage.outputTokens,
              },
            }
          : {}),
      });
      return { raw, parsed: response.parsed };
    }) as unknown as ReturnType<BaseChatModel["withStructuredOutput"]>;
  }
}
