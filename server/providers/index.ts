import type { ProviderId, Settings } from "../types.js";
import { AnthropicLLM } from "./anthropic.js";
import { GeminiLLM } from "./gemini.js";
import { OpenAILLM } from "./openai.js";
import { type LLM, ProviderError } from "./types.js";

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  models: { id: string; note: string }[];
  keyUrl: string;
  baseUrl?: string;
}

// Current model IDs, checked against each provider's docs on 2026-10-28.
// "Load models" in Settings fetches the live list from your account.
export const PROVIDERS: ProviderInfo[] = [
  {
    id: "anthropic",
    label: "Anthropic Claude",
    keyUrl: "https://console.anthropic.com/settings/keys",
    models: [
      { id: "claude-opus-5-5", note: "Most capable, best for writing answers" },
      { id: "claude-sonnet-5-5", note: "Fast and capable, cheaper" },
      { id: "claude-haiku-5-5", note: "Cheapest, fine for scoring lots of jobs" },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    keyUrl: "https://platform.openai.com/api-keys",
    models: [
      { id: "gpt-6-astra", note: "Flagship" },
      { id: "gpt-6.1-sol", note: "Near-flagship, lower cost" },
      { id: "gpt-6.1-terra", note: "Balanced" },
      { id: "gpt-6-luna", note: "Cheapest" },
    ],
  },
  {
    id: "gemini",
    label: "Google Gemini",
    keyUrl: "https://aistudio.google.com/apikey",
    models: [
      { id: "gemini-4-argon", note: "Flagship" },
      { id: "gemini-3.8-flash", note: "Fast" },
      { id: "gemini-3.5-flash-lite", note: "Cheapest" },
    ],
  },
  {
    id: "xai",
    label: "xAI Grok",
    keyUrl: "https://console.x.ai",
    baseUrl: "https://api.x.ai/v1",
    models: [
      { id: "grok-4.7", note: "Most capable" },
      { id: "grok-4.6", note: "Previous" },
    ],
  },
  {
    id: "compatible",
    label: "Other (OpenAI-compatible)",
    keyUrl: "https://openrouter.ai/keys",
    baseUrl: "https://openrouter.ai/api/v1",
    models: [{ id: "", note: "Type the model name, e.g. anthropic/claude-sonnet-5-5 on OpenRouter or llama3.3 on Ollama (http://localhost:11434/v1)" }],
  },
];

/** Models occasionally return malformed JSON or hit a passing error. Retry those a couple of times. */
export function withRetries(llm: LLM, attempts = 3): LLM {
  const retry = async <T>(fn: () => Promise<T>): Promise<T> => {
    let last: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (e) {
        last = e;
        const kind = (e as ProviderError).kind;
        if (kind === "auth" || kind === "refusal") throw e;
        await new Promise((r) => setTimeout(r, kind === "rate_limit" ? 8000 * (i + 1) : 800 * (i + 1)));
      }
    }
    throw last;
  };
  return {
    provider: llm.provider,
    model: llm.model,
    supportsVision: llm.supportsVision,
    chat: (o) => retry(() => llm.chat(o)),
    json: <T>(o: Parameters<LLM["json"]>[0]) => retry(() => llm.json<T>(o)),
    listModels: () => llm.listModels(),
  };
}

export function makeLLM(s: Pick<Settings, "provider" | "model" | "apiKey" | "baseUrl">): LLM {
  return withRetries(makeRawLLM(s));
}

function makeRawLLM(s: Pick<Settings, "provider" | "model" | "apiKey" | "baseUrl">): LLM {
  if (!s.model) throw new ProviderError("Pick a model in Settings first.", "other");
  const needsKey = s.provider !== "compatible";
  if (needsKey && !s.apiKey) throw new ProviderError("Add your API key in Settings first.", "auth");
  switch (s.provider) {
    case "anthropic":
      return new AnthropicLLM(s.apiKey, s.model);
    case "gemini":
      return new GeminiLLM(s.apiKey, s.model);
    case "openai":
      return new OpenAILLM("openai", s.apiKey, s.model);
    case "xai":
      return new OpenAILLM("xai", s.apiKey, s.model, { baseURL: "https://api.x.ai/v1" });
    case "compatible":
      if (!s.baseUrl) throw new ProviderError("Add the base URL of your OpenAI-compatible endpoint.", "other");
      return new OpenAILLM("compatible", s.apiKey, s.model, { baseURL: s.baseUrl });
  }
}

/** Small round-trip that proves the key, model and JSON mode all work. */
export async function testConnection(llm: LLM): Promise<{ ok: true; reply: string }> {
  const out = await llm.json<{ ok: boolean; word: string }>({
    schemaName: "ping",
    schema: { type: "object", properties: { ok: { type: "boolean" }, word: { type: "string" } }, required: ["ok", "word"] },
    messages: [{ role: "user", content: 'Reply with {"ok": true, "word": "ready"}.' }],
    maxTokens: 2000,
  });
  return { ok: true, reply: `${out.ok ? "OK" : "?"} ${out.word ?? ""}`.trim() };
}

export { ProviderError };
export type { LLM };
