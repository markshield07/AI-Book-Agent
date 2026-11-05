// Offline rule-based proofreader. Used when no AI key is configured and in automated tests.
// It is a real (if limited) mechanical checker, and the UI labels its suggestions as
// "Automatic checks", never as AI editing.
import type {
  AnalysisRequest,
  AnalysisResponse,
  EditChunkRequest,
  EditChunkResponse,
  EditorProvider,
  RawSuggestion,
} from "./types";

interface Rule {
  re: RegExp;
  replace: (m: RegExpExecArray) => string | null;
  category: string;
  explanation: string;
  skipInDialogueWhenPreservingDialect?: boolean;
}

const RULES: Rule[] = [
  {
    re: /\b([A-Za-z]+) \1\b/g,
    replace: (m) => (["had", "that", "very", "no", "bye", "ha", "so"].includes(m[1].toLowerCase()) ? null : m[1]),
    category: "typo",
    explanation: "This word is repeated by mistake.",
  },
  { re: /(\S)  +(?=\S)/g, replace: (m) => `${m[1]} `, category: "formatting", explanation: "Extra space between words." },
  { re: /(\w) +([,.;:!?])(?!\.)/g, replace: (m) => `${m[1]}${m[2]}`, category: "punctuation", explanation: "There shouldn't be a space before this punctuation mark." },
  { re: /\balot\b/g, replace: () => "a lot", category: "spelling", explanation: "“A lot” is two words." },
  {
    re: /\b(could|should|would) of\b/gi,
    replace: (m) => `${m[1]} have`,
    category: "grammar",
    explanation: "“Of” here should be “have”.",
    skipInDialogueWhenPreservingDialect: true,
  },
  { re: /(^|[.!?]\s+|\s)i(?=\s|'|’)/g, replace: (m) => `${m[1]}I`, category: "spelling", explanation: "The pronoun “I” is always capitalised." },
  { re: /\b([Tt])eh\b/g, replace: (m) => `${m[1]}he`, category: "typo", explanation: "Typo for “the”." },
  { re: /\brecieve/g, replace: () => "receive", category: "spelling", explanation: "Spelling: “i before e except after c”." },
  { re: /\bseperate/g, replace: () => "separate", category: "spelling", explanation: "Common misspelling of “separate”." },
  { re: /\bdefinately\b/g, replace: () => "definitely", category: "spelling", explanation: "Common misspelling of “definitely”." },
  { re: /\boccured\b/g, replace: () => "occurred", category: "spelling", explanation: "“Occurred” has a double r." },
];

function inDialogue(text: string, index: number): boolean {
  const before = text.slice(0, index);
  const opens = (before.match(/[“]/g) || []).length;
  const closes = (before.match(/[”]/g) || []).length;
  const straight = (before.match(/"/g) || []).length;
  return opens > closes || straight % 2 === 1;
}

export function ruleSuggestions(req: EditChunkRequest): RawSuggestion[] {
  const out: RawSuggestion[] = [];
  const protectedTerms = (req.styleSheet.protectedTerms ?? []).filter(Boolean);
  for (const p of req.paragraphs) {
    if (p.style === "scene_break") continue;
    const used: [number, number][] = [];
    for (const rule of RULES) {
      rule.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = rule.re.exec(p.text))) {
        const original = m[0];
        const replacement = rule.replace(m);
        if (replacement === null || replacement === original) continue;
        if (rule.skipInDialogueWhenPreservingDialect && req.styleSheet.preserveDialect !== false && inDialogue(p.text, m.index)) continue;
        if (protectedTerms.some((t) => original.includes(t))) continue;
        const start = m.index;
        const end = start + original.length;
        if (used.some(([a, b]) => start < b && a < end)) continue;
        used.push([start, end]);
        // widen to make the anchor unique in the paragraph
        let s = start;
        let e = end;
        while (p.text.indexOf(p.text.slice(s, e)) !== s || p.text.indexOf(p.text.slice(s, e), s + 1) !== -1) {
          if (s === 0 && e === p.text.length) break;
          s = Math.max(0, s - 6);
          e = Math.min(p.text.length, e + 6);
        }
        out.push({
          paragraph: p.ref,
          original: p.text.slice(s, e),
          replacement: p.text.slice(s, start) + replacement + p.text.slice(end, e),
          category: rule.category,
          explanation: rule.explanation,
          severity: "minor",
          confidence: 0.9,
          adds_new_material: false,
        });
      }
    }
  }
  return out;
}

export class RulesEditor implements EditorProvider {
  readonly name = "rules";
  readonly model = "rules-v1";
  readonly external = false;

  async analyze(req: AnalysisRequest): Promise<{ result: AnalysisResponse; usage: { inputTokens: number; outputTokens: number } }> {
    // Minimal deterministic analysis: capitalised names that recur across chapters.
    const counts = new Map<string, Set<string>>();
    for (const ch of req.chapters) {
      for (const m of ch.text.matchAll(/(?<=[a-z,;]\s)([A-Z][a-z]{2,})\b/g)) {
        if (!counts.has(m[1])) counts.set(m[1], new Set());
        counts.get(m[1])!.add(ch.title);
      }
    }
    const characters = [...counts.entries()]
      .filter(([, chs]) => chs.size >= 2)
      .slice(0, 20)
      .map(([name, chs]) => ({ name, description: "Recurring proper noun", spellings_seen: [name], chapters: [...chs] }));
    return {
      result: {
        summary: "Automatic checks only (no AI provider configured).",
        voice: "",
        pov: "",
        tense: "",
        conventions: [],
        characters,
        locations: [],
        terms: [],
        events: [],
        continuity_concerns: [],
      },
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  async editChunk(req: EditChunkRequest): Promise<{ result: EditChunkResponse; usage: { inputTokens: number; outputTokens: number } }> {
    if (process.env.RULES_EDITOR_FAIL_ONCE && !(globalThis as { __failed?: boolean }).__failed) {
      // Test hook used to exercise retry/resume paths.
      (globalThis as { __failed?: boolean }).__failed = true;
      throw new Error("Simulated provider failure");
    }
    return { result: { suggestions: ruleSuggestions(req), notes: [] }, usage: { inputTokens: 0, outputTokens: 0 } };
  }
}
