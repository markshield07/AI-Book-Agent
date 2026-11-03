// Runs The Master Editor through the Claude Code CLI on this computer, so editing uses
// the author's own Claude subscription (Pro/Max) instead of a paid API key.
// Requires `claude` to be installed and signed in once with `claude` -> /login.
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { z } from "zod";
import { jsonSchema } from "./anthropic";
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

export const claudeBin = () => process.env.CLAUDE_CLI || "claude";

/**
 * Work out how to launch Claude Code without a shell (so long prompts and JSON never pass
 * through shell quoting). On Windows, npm installs `claude.cmd`, which Node can't spawn
 * directly, so we follow the shim to the real .js or .exe it points at.
 */
export function resolveClaude(): { cmd: string; prefix: string[] } {
  const bin = claudeBin();
  const viaNode = (js: string) => ({ cmd: process.execPath, prefix: [js] });
  if (bin.toLowerCase().endsWith(".js")) return viaNode(bin);
  if (process.platform !== "win32") return { cmd: bin, prefix: [] };
  let candidates: string[] = [bin];
  if (!/[\\/]/.test(bin)) {
    try {
      candidates = execFileSync("where", [bin], { encoding: "utf8", timeout: 10_000 }).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    } catch {
      candidates = [];
    }
  }
  const exe = candidates.find((c) => c.toLowerCase().endsWith(".exe"));
  if (exe) return { cmd: exe, prefix: [] };
  const shim = candidates.find((c) => c.toLowerCase().endsWith(".cmd"));
  if (shim) {
    const target = readFileSync(shim, "utf8").match(/%dp0%\\([^"%\r\n]+\.(?:js|exe))/i)?.[1];
    if (target) {
      const full = path.join(path.dirname(shim), target);
      return full.toLowerCase().endsWith(".js") ? viaNode(full) : { cmd: full, prefix: [] };
    }
  }
  return { cmd: bin, prefix: [] };
}

let available: boolean | null = null;
export function claudeCliAvailable(): boolean {
  if (available === null) {
    try {
      const { cmd, prefix } = resolveClaude();
      execFileSync(cmd, [...prefix, "--version"], { stdio: "ignore", timeout: 15_000 });
      available = true;
    } catch {
      available = false;
    }
  }
  return available;
}

interface CliResult {
  type: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
}

// An empty working directory so no project CLAUDE.md, settings or tools are picked up.
let sandboxDir: string | null = null;
const sandbox = () => (sandboxDir ??= mkdtempSync(path.join(os.tmpdir(), "editorial-studio-")));

export function runClaude(args: string[], input: string, timeoutMs: number): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    // Remove API credentials from the child's environment so the CLI uses the
    // subscription login, never pay-as-you-go API billing.
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    const { cmd, prefix } = resolveClaude();
    const child = spawn(cmd, [...prefix, ...args], { cwd: sandbox(), env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
    child.stdin.end(input);
  });
}

export class ClaudeCodeEditor implements EditorProvider {
  readonly name = "claude-code";
  readonly external = true;
  constructor(
    readonly model: string = process.env.AI_MODEL || "opus",
    private effort: string = process.env.AI_EFFORT || "medium",
    private analysisEffort: string = process.env.AI_ANALYSIS_EFFORT || "high"
  ) {}

  private async call<T>(system: string, user: string, schema: z.ZodType<T>, effort: string): Promise<{ result: T; usage: Usage }> {
    const args = [
      "-p",
      "--output-format", "json",
      "--json-schema", JSON.stringify(jsonSchema(schema)),
      "--system-prompt", system,
      "--model", this.model,
      "--effort", effort,
      "--tools", "",
      "--strict-mcp-config",
      "--setting-sources", "",
      "--no-session-persistence",
    ];
    let out;
    try {
      out = await runClaude(args, user, 20 * 60_000);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT")
        throw new ProviderError("Claude Code isn't installed on this computer. Install it, run `claude` once to sign in, then resume.", false);
      throw new ProviderError(`Couldn't start Claude Code: ${err.message}`, true);
    }
    let parsed: CliResult | null = null;
    try {
      parsed = JSON.parse(out.stdout.trim().split("\n").filter(Boolean).pop() ?? "");
    } catch {
      parsed = null;
    }
    const text = `${parsed?.result ?? ""} ${out.stderr}`.toLowerCase();
    if (!parsed || parsed.is_error || out.code !== 0) {
      if (/usage limit|limit reached|rate.?limit|429|overloaded/.test(text))
        throw new ProviderError("Your Claude subscription's usage limit was reached. The finished chapters are saved; resume once your limit resets.", true);
      if (/login|log in|not authenticated|unauthorized|401|credit balance/.test(text))
        throw new ProviderError("Claude Code isn't signed in. Run `claude` in a terminal, type /login and sign in with your Claude account, then resume.", false);
      throw new ProviderError(`Claude Code returned an error: ${(parsed?.result || out.stderr || "no output").slice(0, 300)}`, true);
    }
    const u = parsed.usage ?? {};
    const usage = {
      inputTokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
      outputTokens: u.output_tokens ?? 0,
    };
    let data = parsed.structured_output;
    if (data === undefined && parsed.result) {
      try {
        data = JSON.parse(parsed.result);
      } catch {
        throw new ProviderError("Claude returned malformed output.", true);
      }
    }
    const check = schema.safeParse(data);
    if (!check.success) throw new ProviderError("Claude's output did not match the expected structure.", true);
    return { result: check.data, usage };
  }

  analyze(req: AnalysisRequest) {
    return this.call(ANALYSIS_SYSTEM, analysisUserPrompt(req), AnalysisResponseSchema, this.analysisEffort);
  }

  editChunk(req: EditChunkRequest) {
    return this.call(editSystemPrompt(req.mode, req.intensity), editUserPrompt(req), EditChunkResponseSchema, this.effort);
  }
}
