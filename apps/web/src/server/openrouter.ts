import { env } from "@/server/env";

const BASE_URL = "https://openrouter.ai/api/v1";
const CATALOG_TTL_MS = 60 * 60_000;

export type CatalogModel = {
  id: string;
  name: string;
  contextLength: number;
  /** USD per million tokens. */
  promptPrice: number;
  completionPrice: number;
  free: boolean;
  tools: boolean;
  vision: boolean;
};

type RawModel = {
  id: string;
  name: string;
  context_length: number;
  pricing: { prompt: string; completion: string };
  supported_parameters?: string[];
  architecture?: { input_modalities?: string[] };
};

let catalog: { models: CatalogModel[]; fetchedAt: number } | null = null;

export async function getModelCatalog(): Promise<CatalogModel[]> {
  if (catalog && Date.now() - catalog.fetchedAt < CATALOG_TTL_MS) return catalog.models;
  try {
    const res = await fetch(`${BASE_URL}/models`, { cache: "no-store" });
    if (!res.ok) throw new Error(`OpenRouter models: ${res.status}`);
    const { data } = (await res.json()) as { data: RawModel[] };
    const models = data
      .map((m) => {
        const promptPrice = Number(m.pricing.prompt) * 1e6;
        const completionPrice = Number(m.pricing.completion) * 1e6;
        return {
          id: m.id,
          name: m.name,
          contextLength: m.context_length,
          promptPrice,
          completionPrice,
          free: promptPrice === 0 && completionPrice === 0,
          tools: m.supported_parameters?.includes("tools") ?? false,
          vision: m.architecture?.input_modalities?.includes("image") ?? false,
        };
      })
      // Negative prices mark router/variable-priced entries; keep only chat-capable priced models.
      .filter((m) => m.promptPrice >= 0 && m.completionPrice >= 0);
    catalog = { models, fetchedAt: Date.now() };
    return models;
  } catch (error) {
    if (catalog) return catalog.models;
    throw error;
  }
}

export async function findModel(id: string) {
  return (await getModelCatalog()).find((m) => m.id === id);
}

// ---------- Chat completions (streaming) ----------

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export type ToolDefinition = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type Usage = { prompt_tokens: number; completion_tokens: number; cost?: number };

export class OpenRouterError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** Prefer the upstream provider's explanation (e.g. rate limits) over OpenRouter's generic message. */
function errorMessage(error?: { message?: string; metadata?: { raw?: unknown } }) {
  const raw = error?.metadata?.raw;
  if (typeof raw === "string" && raw.trim()) return raw.trim().slice(0, 500);
  return error?.message;
}

export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "tool_calls"; calls: ToolCall[] }
  | { type: "usage"; usage: Usage };

/** Streams a chat completion, yielding text deltas, assembled tool calls and final usage. */
export async function* streamChat(options: {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  signal?: AbortSignal;
}): AsyncGenerator<StreamEvent> {
  if (!env.OPENROUTER_API_KEY) throw new OpenRouterError("OPENROUTER_API_KEY is not set", 401);

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    signal: options.signal,
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://botlings.app",
      "X-OpenRouter-Title": "Botlings",
    },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      stream: true,
      ...(options.tools?.length ? { tools: options.tools } : {}),
    }),
  });

  if (!res.ok || !res.body) {
    let message = `OpenRouter error ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { message?: string; metadata?: { raw?: unknown } } };
      message = errorMessage(body.error) ?? message;
    } catch {}
    throw new OpenRouterError(message, res.status);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  const toolCalls = new Map<number, ToolCall>();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;

    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      // Blank lines separate events; ":" lines are keep-alive comments.
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;

      let chunk: {
        error?: { message?: string; code?: number; metadata?: { raw?: unknown } };
        usage?: Usage;
        choices?: {
          delta?: {
            content?: string | null;
            tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
          };
          error?: { message?: string; code?: number; metadata?: { raw?: unknown } };
        }[];
      };
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }

      const streamError = chunk.error ?? chunk.choices?.[0]?.error;
      if (streamError) throw new OpenRouterError(errorMessage(streamError) ?? "Stream error", streamError.code ?? 500);

      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content) yield { type: "delta", text: delta.content };
      for (const part of delta?.tool_calls ?? []) {
        const existing = toolCalls.get(part.index) ?? {
          id: part.id ?? `call_${part.index}`,
          type: "function" as const,
          function: { name: "", arguments: "" },
        };
        if (part.id) existing.id = part.id;
        if (part.function?.name) existing.function.name += part.function.name;
        if (part.function?.arguments) existing.function.arguments += part.function.arguments;
        toolCalls.set(part.index, existing);
      }
      if (chunk.usage) yield { type: "usage", usage: chunk.usage };
    }
  }

  if (toolCalls.size) yield { type: "tool_calls", calls: [...toolCalls.values()] };
}
