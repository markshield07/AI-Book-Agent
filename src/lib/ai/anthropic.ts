// Claude implementation of the editor provider.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  AnalysisResponseSchema,
  EditChunkResponseSchema,
  ProviderError,
  type AnalysisRequest,
  type EditChunkRequest,
  type EditorProvider,
  type Usage,
} from "./types";
import { ANALYSIS_SYSTEM, analysisUserPrompt, editSystemPrompt, editUserPrompt } from "./prompts";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

// Structured outputs accept a subset of JSON Schema: every object closed, every
// property required, no numeric/length constraints (those are checked by zod afterwards).
const UNSUPPORTED = ["$schema", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "minItems", "maxItems", "pattern", "format"];
function clean(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(clean);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (UNSUPPORTED.includes(k)) continue;
    // keys inside "properties" are field names, not keywords
    out[k] = k === "properties" && v && typeof v === "object"
      ? Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, clean(pv)]))
      : clean(v);
  }
  if (out.type === "object" && out.properties) {
    out.additionalProperties = false;
    out.required = Object.keys(out.properties as object);
  }
  return out;
}
export function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  return clean(z.toJSONSchema(schema, { target: "draft-7" })) as Record<string, unknown>;
}

export class AnthropicEditor implements EditorProvider {
  readonly name = "anthropic";
  readonly external = true;
  private client: Anthropic;
  constructor(
    readonly model: string = process.env.AI_MODEL || "claude-opus-5-5",
    private effort: Effort = (process.env.AI_EFFORT as Effort) || "medium",
    private analysisEffort: Effort = (process.env.AI_ANALYSIS_EFFORT as Effort) || "high"
  ) {
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
      throw new ProviderError("ANTHROPIC_API_KEY is not set. Add it to your environment to use the Claude editor.", false);
    }
    // The SDK retries 408/409/429/5xx itself; the job runner adds chapter-level retries on top.
    this.client = new Anthropic({ maxRetries: 4, timeout: 15 * 60_000 });
  }

  private async call<T>(system: string, user: string, schema: z.ZodType<T>, effort: Effort): Promise<{ result: T; usage: Usage }> {
    let msg;
    try {
      const stream = this.client.beta.messages.stream({
        model: this.model,
        max_tokens: 32000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort, format: { type: "json_schema", schema: jsonSchema(schema) } },
        system,
        messages: [{ role: "user", content: user }],
      } as Anthropic.Beta.Messages.MessageCreateParamsStreaming);
      msg = await stream.finalMessage();
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError)
        throw new ProviderError("The AI provider rejected the API key. Check ANTHROPIC_API_KEY.", false);
      if (err instanceof Anthropic.BadRequestError) throw new ProviderError(`The AI provider rejected the request: ${err.message}`, false);
      if (err instanceof Anthropic.RateLimitError) throw new ProviderError("The AI provider is rate-limiting requests.", true);
      if (err instanceof Anthropic.APIError) throw new ProviderError(`AI provider error: ${err.message}`, true);
      throw new ProviderError(`Could not reach the AI provider: ${(err as Error).message}`, true);
    }
    const usage = { inputTokens: msg.usage.input_tokens ?? 0, outputTokens: msg.usage.output_tokens ?? 0 };
    if (msg.stop_reason === "refusal") throw new ProviderError("The AI declined to edit this section.", false);
    if (msg.stop_reason === "max_tokens") throw new ProviderError("The AI response was cut off before it finished.", true);
    const text = msg.content
      .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ProviderError("The AI returned malformed output.", true);
    }
    const check = schema.safeParse(parsed);
    if (!check.success) throw new ProviderError("The AI output did not match the expected structure.", true);
    return { result: check.data, usage };
  }

  analyze(req: AnalysisRequest) {
    return this.call(ANALYSIS_SYSTEM, analysisUserPrompt(req), AnalysisResponseSchema, this.analysisEffort);
  }

  editChunk(req: EditChunkRequest) {
    return this.call(editSystemPrompt(req.mode, req.intensity), editUserPrompt(req), EditChunkResponseSchema, this.effort);
  }
}
