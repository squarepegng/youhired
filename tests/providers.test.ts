import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";
import { AnthropicLLM } from "../server/providers/anthropic.js";
import { GeminiLLM } from "../server/providers/gemini.js";
import { OpenAILLM } from "../server/providers/openai.js";
import { makeLLM, testConnection } from "../server/providers/index.js";
import { ProviderError, parseJsonLoose, strictify } from "../server/providers/types.js";

const schema = { type: "object", properties: { ok: { type: "boolean" }, items: { type: "array", items: { type: "object", properties: { a: { type: "string" } } } } }, required: ["ok"] };

describe("Anthropic adapter", () => {
  const fake = (msg: Partial<Anthropic.Beta.BetaMessage>) => {
    const create = vi.fn().mockResolvedValue({ stop_reason: "end_turn", content: [], ...msg });
    return { create, client: { beta: { messages: { create } }, models: { list: async function* () { yield { id: "claude-opus-5-5" }; } } } as unknown as Anthropic };
  };

  it("sends system, images and a JSON schema; parses JSON", async () => {
    const { create, client } = fake({ content: [{ type: "text", text: '{"ok":true}' } as Anthropic.Beta.BetaTextBlock] });
    const llm = new AnthropicLLM("k", "claude-opus-5-5", client);
    const out = await llm.json<{ ok: boolean }>({ schemaName: "x", schema, system: "sys", messages: [{ role: "user", content: "hi", images: [{ mediaType: "image/png", base64: "AAA" }] }] });
    expect(out.ok).toBe(true);
    const p = create.mock.calls[0][0];
    expect(p.model).toBe("claude-opus-5-5");
    expect(p.system).toBe("sys");
    expect(p.output_config.format).toEqual({ type: "json_schema", schema });
    expect(p.messages[0].content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: "AAA" } });
    expect(p.messages[0].content[1]).toEqual({ type: "text", text: "hi" });
    // Current Opus/Sonnet get server-side refusal fallbacks
    expect(p.fallbacks).toBe("default");
    expect(p.betas).toContain("server-side-fallback-2026-07-01");
  });

  it("does not send fallbacks for Haiku", async () => {
    const { create, client } = fake({ content: [{ type: "text", text: "hello" } as Anthropic.Beta.BetaTextBlock] });
    await new AnthropicLLM("k", "claude-haiku-5-5", client).chat({ messages: [{ role: "user", content: "hi" }] });
    expect(create.mock.calls[0][0].fallbacks).toBeUndefined();
  });

  it("turns a refusal into a ProviderError", async () => {
    const { client } = fake({ stop_reason: "refusal", content: [] });
    await expect(new AnthropicLLM("k", "claude-opus-5-5", client).chat({ messages: [{ role: "user", content: "x" }] })).rejects.toMatchObject({ kind: "refusal" });
  });

  it("maps 401 to an auth error without leaking the key", async () => {
    const client = { beta: { messages: { create: vi.fn().mockRejectedValue(Object.assign(new Error("invalid x-api-key sk-ant-secret"), { status: 401 })) } } } as unknown as Anthropic;
    const err = await new AnthropicLLM("sk-ant-secret", "claude-opus-5-5", client).chat({ messages: [{ role: "user", content: "x" }] }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.kind).toBe("auth");
    expect(err.message).not.toContain("sk-ant-secret");
  });

  it("lists models", async () => {
    const { client } = fake({});
    expect(await new AnthropicLLM("k", "m", client).listModels()).toEqual(["claude-opus-5-5"]);
  });
});

describe("OpenAI-compatible adapter (OpenAI, xAI, OpenRouter, Ollama)", () => {
  const fake = (content: string | null, extra: Record<string, unknown> = {}) => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content, ...extra } }] });
    return { create, client: { chat: { completions: { create } }, models: { list: async function* () { yield { id: "b" }; yield { id: "a" }; } } } as unknown as OpenAI };
  };

  it("uses strict json_schema with every property required", async () => {
    const { create, client } = fake('{"ok":true}');
    const out = await new OpenAILLM("openai", "k", "gpt-6-astra", { client }).json<{ ok: boolean }>({ schemaName: "x", schema, system: "s", messages: [{ role: "user", content: "hi" }] });
    expect(out.ok).toBe(true);
    const p = create.mock.calls[0][0];
    expect(p.messages[0]).toEqual({ role: "system", content: "s" });
    expect(p.response_format.type).toBe("json_schema");
    expect(p.response_format.json_schema.strict).toBe(true);
    expect(p.response_format.json_schema.schema.required).toEqual(["ok", "items"]);
    expect(p.response_format.json_schema.schema.additionalProperties).toBe(false);
    expect(p.response_format.json_schema.schema.properties.items.items.required).toEqual(["a"]);
  });

  it("sends images as data URLs", async () => {
    const { create, client } = fake("ok");
    await new OpenAILLM("openai", "k", "gpt-6-astra", { client }).chat({ messages: [{ role: "user", content: "look", images: [{ mediaType: "image/jpeg", base64: "Zm9v" }] }] });
    const content = create.mock.calls[0][0].messages[0].content;
    expect(content[0]).toEqual({ type: "image_url", image_url: { url: "data:image/jpeg;base64,Zm9v" } });
  });

  it("falls back to plain JSON instructions when a server rejects json_schema", async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("response_format json_schema not supported"), { status: 400 }))
      .mockResolvedValueOnce({ choices: [{ message: { content: 'Sure: {"ok": true}' } }] });
    const client = { chat: { completions: { create } } } as unknown as OpenAI;
    const out = await new OpenAILLM("compatible", "", "llama3.3", { client }).json<{ ok: boolean }>({ schemaName: "x", schema, messages: [{ role: "user", content: "hi" }] });
    expect(out.ok).toBe(true);
    expect(create.mock.calls[1][0].messages[0].content).toContain("JSON Schema");
  });

  it("surfaces refusals", async () => {
    const { client } = fake(null, { refusal: "no" });
    await expect(new OpenAILLM("openai", "k", "m", { client }).chat({ messages: [{ role: "user", content: "x" }] })).rejects.toMatchObject({ kind: "refusal" });
  });

  it("lists models sorted", async () => {
    const { client } = fake("");
    expect(await new OpenAILLM("xai", "k", "m", { client }).listModels()).toEqual(["a", "b"]);
  });
});

describe("Gemini adapter", () => {
  it("sends systemInstruction, inline images and responseJsonSchema", async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: '{"ok":true}', candidates: [{ finishReason: "STOP" }] });
    const models = { generateContent, list: vi.fn() } as unknown as ConstructorParameters<typeof GeminiLLM>[2];
    const out = await new GeminiLLM("k", "gemini-3.8-flash", models).json<{ ok: boolean }>({ schemaName: "x", schema, system: "sys", messages: [{ role: "user", content: "hi", images: [{ mediaType: "image/png", base64: "AAA" }] }, { role: "assistant", content: "prev" }] });
    expect(out.ok).toBe(true);
    const p = generateContent.mock.calls[0][0];
    expect(p.config.systemInstruction).toBe("sys");
    expect(p.config.responseMimeType).toBe("application/json");
    expect(p.config.responseJsonSchema).toEqual(schema);
    expect(p.contents[0].parts[0]).toEqual({ inlineData: { mimeType: "image/png", data: "AAA" } });
    expect(p.contents[1].role).toBe("model");
  });

  it("treats a safety block as a refusal", async () => {
    const models = { generateContent: vi.fn().mockResolvedValue({ text: "", candidates: [{ finishReason: "SAFETY" }] }), list: vi.fn() } as unknown as ConstructorParameters<typeof GeminiLLM>[2];
    await expect(new GeminiLLM("k", "m", models).chat({ messages: [{ role: "user", content: "x" }] })).rejects.toMatchObject({ kind: "refusal" });
  });
});

describe("factory and helpers", () => {
  it("builds the right adapter per provider", () => {
    expect(makeLLM({ provider: "anthropic", model: "claude-opus-5-5", apiKey: "k" }).provider).toBe("anthropic");
    expect(makeLLM({ provider: "gemini", model: "gemini-4-argon", apiKey: "k" }).provider).toBe("gemini");
    expect(makeLLM({ provider: "openai", model: "gpt-6-astra", apiKey: "k" }).provider).toBe("openai");
    expect(makeLLM({ provider: "xai", model: "grok-4.7", apiKey: "k" }).provider).toBe("xai");
    expect(makeLLM({ provider: "compatible", model: "llama3.3", apiKey: "", baseUrl: "http://localhost:11434/v1" }).provider).toBe("compatible");
  });
  it("refuses to build without a key or base URL", () => {
    expect(() => makeLLM({ provider: "anthropic", model: "m", apiKey: "" })).toThrow(/API key/);
    expect(() => makeLLM({ provider: "compatible", model: "m", apiKey: "", baseUrl: "" })).toThrow(/base URL/);
  });
  it("testConnection round-trips JSON", async () => {
    const llm = { json: vi.fn().mockResolvedValue({ ok: true, word: "ready" }) } as unknown as Parameters<typeof testConnection>[0];
    expect((await testConnection(llm)).reply).toBe("OK ready");
  });
  it("parses JSON wrapped in prose or code fences", () => {
    expect(parseJsonLoose<{ a: number }>('```json\n{"a":1}\n```').a).toBe(1);
    expect(parseJsonLoose<{ a: number }>('Here you go: {"a":2} hope it helps').a).toBe(2);
    expect(() => parseJsonLoose("nope")).toThrow(ProviderError);
  });
  it("strictify leaves the original schema untouched", () => {
    const copy = JSON.parse(JSON.stringify(schema));
    strictify(schema);
    expect(schema).toEqual(copy);
  });
});
