// One interface for every model provider. Adapters translate to each vendor's SDK.

export interface ImagePart {
  mediaType: "image/png" | "image/jpeg";
  base64: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  images?: ImagePart[];
}

export type JsonSchema = Record<string, unknown>;

export interface ChatOptions {
  system?: string;
  messages: ChatMessage[];
  maxTokens?: number;
}

export interface JsonOptions extends ChatOptions {
  schema: JsonSchema; // JSON Schema (object). Keep to the portable subset: type/properties/required/items/enum.
  schemaName: string;
}

export interface LLM {
  readonly provider: string;
  readonly model: string;
  readonly supportsVision: boolean;
  chat(opts: ChatOptions): Promise<string>;
  json<T = unknown>(opts: JsonOptions): Promise<T>;
  listModels(): Promise<string[]>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: "auth" | "rate_limit" | "refusal" | "bad_output" | "network" | "other",
  ) {
    super(message);
  }
}

/** Pull the first JSON object/array out of model text (used where a provider lacks strict JSON mode). */
export function parseJsonLoose<T>(text: string): T {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const start = trimmed.search(/[[{]/);
    const end = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as T;
      } catch {
        /* fall through */
      }
    }
    throw new ProviderError("The model did not return valid JSON.", "bad_output");
  }
}

/** Make a schema strict-mode friendly (OpenAI strict requires every property listed and no extras). */
export function strictify(schema: JsonSchema): JsonSchema {
  const s: JsonSchema = { ...schema };
  if (s.type === "object" && s.properties && typeof s.properties === "object") {
    const props: Record<string, JsonSchema> = {};
    for (const [k, v] of Object.entries(s.properties as Record<string, JsonSchema>)) props[k] = strictify(v);
    s.properties = props;
    s.required = Object.keys(props);
    s.additionalProperties = false;
  }
  if (s.type === "array" && s.items) s.items = strictify(s.items as JsonSchema);
  return s;
}

export function classifyHttpError(e: unknown): ProviderError {
  const err = e as { status?: number; message?: string; code?: string };
  const msg = err?.message || String(e);
  if (err?.status === 401 || err?.status === 403) return new ProviderError(`The API key was rejected (${err.status}).`, "auth");
  if (err?.status === 429) return new ProviderError("Rate limited by the provider. Wait a minute and try again.", "rate_limit");
  if (err?.code === "ECONNREFUSED" || /fetch failed|ENOTFOUND|ECONNREFUSED/i.test(msg))
    return new ProviderError(`Could not reach the provider: ${msg}`, "network");
  if (e instanceof ProviderError) return e;
  return new ProviderError(msg, "other");
}
