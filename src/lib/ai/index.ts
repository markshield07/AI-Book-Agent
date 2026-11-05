// Provider registry. AI_PROVIDER = claude-code | anthropic | rules.
// Default: claude-code (your Claude subscription, via the Claude Code CLI) when it is
// installed; otherwise anthropic if an API key is set; otherwise offline rules.
import { AnthropicEditor } from "./anthropic";
import { ClaudeCodeEditor, claudeCliAvailable } from "./claude-code";
import { RulesEditor } from "./rules";
import type { EditorProvider } from "./types";

export type ProviderName = "claude-code" | "anthropic" | "rules";

export function configuredProviderName(): ProviderName {
  const p = (process.env.AI_PROVIDER || "").toLowerCase();
  if (p === "rules" || p === "mock") return "rules";
  if (p === "anthropic") return "anthropic";
  if (p === "claude-code" || p === "subscription") return "claude-code";
  if (claudeCliAvailable()) return "claude-code";
  return process.env.ANTHROPIC_API_KEY ? "anthropic" : "rules";
}

export function getProvider(name: string = configuredProviderName()): EditorProvider {
  if (name === "claude-code") return new ClaudeCodeEditor();
  if (name === "anthropic") return new AnthropicEditor();
  return new RulesEditor();
}

export function providerInfo() {
  const name = configuredProviderName();
  const model =
    name === "claude-code" ? process.env.AI_MODEL || "opus" : name === "anthropic" ? process.env.AI_MODEL || "claude-opus-5-5" : "rules-v1";
  const label =
    name === "claude-code"
      ? "Claude, using your Claude subscription (Claude Code)"
      : name === "anthropic"
      ? "Claude (Anthropic API key)"
      : "Automatic checks only (Claude isn't set up on this computer)";
  return { name, model, external: name !== "rules", label };
}
