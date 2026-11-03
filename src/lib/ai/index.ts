// Provider registry. Choose with AI_PROVIDER=anthropic|rules (default: anthropic when a key is set).
import { AnthropicEditor } from "./anthropic";
import { RulesEditor } from "./rules";
import type { EditorProvider } from "./types";

export function configuredProviderName(): "anthropic" | "rules" {
  const p = (process.env.AI_PROVIDER || "").toLowerCase();
  if (p === "rules" || p === "mock") return "rules";
  if (p === "anthropic") return "anthropic";
  return process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? "anthropic" : "rules";
}

export function getProvider(name: string = configuredProviderName()): EditorProvider {
  if (name === "anthropic") return new AnthropicEditor();
  return new RulesEditor();
}

export function providerInfo() {
  const name = configuredProviderName();
  return {
    name,
    model: name === "anthropic" ? process.env.AI_MODEL || "claude-opus-5-5" : "rules-v1",
    external: name === "anthropic",
    label: name === "anthropic" ? "Claude (Anthropic)" : "Automatic checks only (no AI key configured)",
  };
}
