import OpenAI from "openai";
import type { BackendConfig } from "../config.js";
import { emit, interviewTrace } from "../observability/events.js";
import { z } from "zod";

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmJsonOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  attempts?: number;
}

export class LlmClient {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly temperature: number;

  constructor(
    cfg: Pick<
      BackendConfig,
      | "AI_ROUTER_BASE_URL"
      | "AI_ROUTER_API_KEY"
      | "AI_ROUTER_MODEL"
      | "LLM_TEMPERATURE"
    >,
  ) {
    this.client = new OpenAI({
      baseURL: cfg.AI_ROUTER_BASE_URL,
      apiKey: cfg.AI_ROUTER_API_KEY,
      timeout: 12000,
      maxRetries: 0,
    });
    this.model = cfg.AI_ROUTER_MODEL;
    this.temperature = cfg.LLM_TEMPERATURE;
  }

  async completeJson<T>(
    messages: LlmMessage[],
    options: LlmJsonOptions = {},
  ): Promise<T> {
    const content = await this.complete(messages, options);
    const text = content
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(
        "LLM response was not valid JSON; cannot parse structured output",
      );
    }
  }

  async complete(
    messages: LlmMessage[],
    options: LlmJsonOptions = {},
  ): Promise<string> {
    if (messages.reduce((n, m) => n + m.content.length, 0) > 60000)
      throw new Error("LLM input budget exceeded");
    const startedAt = Date.now();
    const res = await this.client.chat.completions.create(
      {
        model: this.model,
        messages,
        temperature: options.temperature ?? this.temperature,
        max_tokens: Math.min(8192, options.maxTokens ?? 4096),
        stream: false,
      },
      { timeout: options.timeoutMs ?? 12000 },
    );
    const ctx = interviewTrace.getStore();
    if (ctx)
      await emit(ctx.interviewId, `llm.${ctx.step ?? "generation"}`, {
        model: this.model,
        startedAt,
        durationMs: Date.now() - startedAt,
        tokenUsage: res.usage,
      }).catch(() => {});
    return res.choices[0]?.message?.content ?? "";
  }
}

export async function structured<S extends z.ZodTypeAny>(
  llm: LlmClient,
  schema: S,
  messages: LlmMessage[],
  options: LlmJsonOptions = {},
): Promise<z.infer<S>> {
  let error: unknown;
  let feedback: LlmMessage[] = [];
  for (let attempt = 0; attempt < (options.attempts ?? 2); attempt++) {
    let raw: unknown;
    try {
      raw = await llm.completeJson<unknown>([...messages, ...feedback], options);
      return schema.parse(raw);
    } catch (err) {
      error = err;
      if (err instanceof z.ZodError) {
        const shape =
          raw && typeof raw === "object" && !Array.isArray(raw)
            ? Object.keys(raw as Record<string, unknown>).join(",")
            : Array.isArray(raw)
              ? "array"
              : typeof raw;
        console.error(`[llm] structured output keys: ${shape}`);
        const issues = err.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ")
          .slice(0, 2000);
        feedback = [
          {
            role: "user",
            content: `Your previous JSON failed validation: ${issues}. Generate the complete JSON again, correcting these fields and preserving the required schema.`,
          },
        ];
      }
    }
  }
  throw error;
}
