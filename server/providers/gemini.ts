import { GoogleGenAI } from "@google/genai";
import { type ChatOptions, type JsonOptions, type LLM, ProviderError, classifyHttpError, parseJsonLoose } from "./types.js";

type GenAIModels = Pick<GoogleGenAI["models"], "generateContent" | "list">;

export class GeminiLLM implements LLM {
  readonly provider = "gemini";
  readonly supportsVision = true;
  private models: GenAIModels;

  constructor(
    apiKey: string,
    readonly model: string,
    models?: GenAIModels, // injected in tests
  ) {
    this.models = models ?? new GoogleGenAI({ apiKey }).models;
  }

  private contents(opts: ChatOptions) {
    return opts.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [
        ...(m.images ?? []).map((i) => ({ inlineData: { mimeType: i.mediaType, data: i.base64 } })),
        { text: m.content },
      ],
    }));
  }

  private async generate(opts: ChatOptions, schema?: Record<string, unknown>): Promise<string> {
    try {
      const res = await this.models.generateContent({
        model: this.model,
        contents: this.contents(opts),
        config: {
          systemInstruction: opts.system,
          maxOutputTokens: opts.maxTokens ?? 8000,
          ...(schema ? { responseMimeType: "application/json", responseJsonSchema: schema } : {}),
        },
      });
      const reason = res.candidates?.[0]?.finishReason;
      if (reason === "SAFETY" || reason === "PROHIBITED_CONTENT" || res.promptFeedback?.blockReason)
        throw new ProviderError("The model declined this request.", "refusal");
      return res.text ?? "";
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      throw classifyHttpError(e);
    }
  }

  chat(opts: ChatOptions): Promise<string> {
    return this.generate(opts);
  }

  async json<T>(opts: JsonOptions): Promise<T> {
    return parseJsonLoose<T>(await this.generate(opts, opts.schema));
  }

  async listModels(): Promise<string[]> {
    try {
      const out: string[] = [];
      const pager = await this.models.list();
      for await (const m of pager) if (m.name) out.push(m.name.replace(/^models\//, ""));
      return out;
    } catch (e) {
      throw classifyHttpError(e);
    }
  }
}
