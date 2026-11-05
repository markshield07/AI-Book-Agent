// Manual smoke test of the subscription (Claude Code) editor on one short passage:
//   npx tsx tests/live-claude-code.ts
import { ClaudeCodeEditor } from "../src/lib/ai/claude-code";
import { validateSuggestions } from "../src/lib/editor/validate";

const text = "He saw the the dog , and i ran toward it. Teh sky was gray. “Ain't nobody could of told me,” Dre said.";
(async () => {
  const ed = new ClaudeCodeEditor(process.env.AI_MODEL || "opus", "low");
  const t = Date.now();
  const { result, usage } = await ed.editChunk({
    project: { title: "Test", authorName: "A", genre: "Urban fiction", isFiction: true, language: "en-US", manuscriptState: "complete" },
    mode: "COPYEDIT", intensity: "STANDARD", styleSheet: { preserveDialect: true }, continuity: "", chapterTitle: "One",
    chapterIndex: 0, chunkIndex: 0, chunkCount: 1, rejected: [], paragraphs: [{ ref: "P1", style: "body", text }],
  });
  const v = validateSuggestions(result.suggestions, [{ ref: "P1", paragraphId: "p", text, style: "body", acceptedRanges: [], pendingRanges: [] }], { mode: "COPYEDIT", protectedTerms: [], rejected: [] });
  console.log(JSON.stringify({ seconds: (Date.now() - t) / 1000, usage, valid: v.valid.map((s) => `${s.originalText} → ${s.suggestedText} (${s.category})`), discarded: v.discarded.map((d) => d.reason), notes: result.notes.length }, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
