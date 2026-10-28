import Anthropic from "@anthropic-ai/sdk";
import { type ChatOptions, type JsonOptions, type LLM, ProviderError, classifyHttpError, parseJsonLoose } from "./types.js";

// Models that support server-side refusal fallbacks ("fallbacks": "default").
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5", "claude-opus-5", "claude-fable-5-1"]);

type BetaCreate = Anthropic["beta"]["messages"]["create"];

export class AnthropicLLM implements LLM {
  readonly provider = "anthropic";
  readonly supportsVision = true;
  private client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
    client?: Anthropic, // injected in tests
  ) {
    this.client = client ?? new Anthropic({ apiKey, maxRetries: 2 });
  }

  private toMessages(opts: ChatOptions): Anthropic.Beta.BetaMessageParam[] {
    return opts.messages.map((m) => ({
      role: m.role,
      content: [
        ...(m.images ?? []).map((img) => ({
          type: "image" as const,
          source: { type: "base64" as const, media_type: img.mediaType, data: img.base64 },
        })),
        { type: "text" as const, text: m.content },
      ],
    }));
  }

  private async create(opts: ChatOptions, format?: Record<string, unknown>): Promise<string> {
    const useFallback = FALLBACK_MODELS.has(this.model);
    const params: Parameters<BetaCreate>[0] = {
      model: this.model,
      max_tokens: opts.maxTokens ?? 8000,
      system: opts.system,
      messages: this.toMessages(opts),
      ...(format ? { output_config: { format: { type: "json_schema", schema: format } } } : {}),
      ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
    } as Parameters<BetaCreate>[0];
    let res: Anthropic.Beta.BetaMessage;
    try {
      res = (await this.client.beta.messages.create({ ...params, stream: false })) as Anthropic.Beta.BetaMessage;
    } catch (e) {
      throw classifyHttpError(e);
    }
    if (res.stop_reason === "refusal") throw new ProviderError("The model declined this request.", "refusal");
    const text = res.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (res.stop_reason === "max_tokens" && format) throw new ProviderError("The answer was cut off (max tokens).", "bad_output");
    return text;
  }

  chat(opts: ChatOptions): Promise<string> {
    return this.create(opts);
  }

  async json<T>(opts: JsonOptions): Promise<T> {
    const text = await this.create(opts, opts.schema);
    return parseJsonLoose<T>(text);
  }

  async listModels(): Promise<string[]> {
    try {
      const out: string[] = [];
      for await (const m of this.client.models.list()) out.push(m.id);
      return out;
    } catch (e) {
      throw classifyHttpError(e);
    }
  }
}
