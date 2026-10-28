import OpenAI from "openai";
import { type ChatOptions, type JsonOptions, type LLM, ProviderError, classifyHttpError, parseJsonLoose, strictify } from "./types.js";

/**
 * OpenAI Chat Completions adapter. Also used for xAI (Grok) and any
 * OpenAI-compatible endpoint (OpenRouter, Ollama, LM Studio...) via baseURL.
 */
export class OpenAILLM implements LLM {
  readonly supportsVision: boolean;
  private client: OpenAI;

  constructor(
    readonly provider: string,
    apiKey: string,
    readonly model: string,
    opts: { baseURL?: string; strictJson?: boolean; vision?: boolean; client?: OpenAI } = {},
  ) {
    this.client = opts.client ?? new OpenAI({ apiKey: apiKey || "not-needed", baseURL: opts.baseURL || undefined, maxRetries: 2 });
    this.strictJson = opts.strictJson ?? true;
    this.supportsVision = opts.vision ?? true;
  }
  private strictJson: boolean;

  private toMessages(opts: ChatOptions): OpenAI.Chat.ChatCompletionMessageParam[] {
    const out: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (opts.system) out.push({ role: "system", content: opts.system });
    for (const m of opts.messages) {
      if (m.role === "user" && m.images?.length) {
        out.push({
          role: "user",
          content: [
            ...m.images.map((i) => ({ type: "image_url" as const, image_url: { url: `data:${i.mediaType};base64,${i.base64}` } })),
            { type: "text" as const, text: m.content },
          ],
        });
      } else out.push({ role: m.role, content: m.content });
    }
    return out;
  }

  private async complete(
    opts: ChatOptions,
    response_format?: OpenAI.Chat.ChatCompletionCreateParams["response_format"],
  ): Promise<string> {
    try {
      const res = await this.client.chat.completions.create({
        model: this.model,
        messages: this.toMessages(opts),
        max_completion_tokens: opts.maxTokens ?? 8000,
        ...(response_format ? { response_format } : {}),
      });
      const choice = res.choices[0];
      if (choice?.message?.refusal) throw new ProviderError("The model declined this request.", "refusal");
      return choice?.message?.content ?? "";
    } catch (e) {
      throw classifyHttpError(e);
    }
  }

  chat(opts: ChatOptions): Promise<string> {
    return this.complete(opts);
  }

  async json<T>(opts: JsonOptions): Promise<T> {
    if (this.strictJson) {
      try {
        const text = await this.complete(opts, {
          type: "json_schema",
          json_schema: { name: opts.schemaName, schema: strictify(opts.schema), strict: true },
        });
        return parseJsonLoose<T>(text);
      } catch (e) {
        // Some compatible servers don't support json_schema; fall back to instructions + loose parsing.
        if (!(e instanceof ProviderError) || e.kind !== "other") throw e;
      }
    }
    const withSchema: ChatOptions = {
      ...opts,
      system: `${opts.system ?? ""}\n\nReply with ONLY a JSON value matching this JSON Schema, no prose:\n${JSON.stringify(opts.schema)}`,
    };
    return parseJsonLoose<T>(await this.complete(withSchema, { type: "json_object" }).catch(() => this.complete(withSchema)));
  }

  async listModels(): Promise<string[]> {
    try {
      const out: string[] = [];
      for await (const m of this.client.models.list()) out.push(m.id);
      return out.sort();
    } catch (e) {
      throw classifyHttpError(e);
    }
  }
}
