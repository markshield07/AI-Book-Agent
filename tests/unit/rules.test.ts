import { describe, it, expect } from "vitest";
import { ruleSuggestions } from "@/lib/ai/rules";
import { validateSuggestions } from "@/lib/editor/validate";

const req = (text: string, preserveDialect = true) => ({
  project: { title: "t", authorName: "a", genre: "", isFiction: true, language: "en", manuscriptState: "complete" },
  mode: "PROOFREAD" as const, intensity: "STANDARD" as const, styleSheet: { preserveDialect }, continuity: "",
  chapterTitle: "c", chapterIndex: 0, chunkIndex: 0, chunkCount: 1, rejected: [],
  paragraphs: [{ ref: "P1", style: "body", text }],
});

describe("rules editor", () => {
  it("finds mechanical errors that survive validation", () => {
    const text = "He saw the the dog , and i ran.";
    const raw = ruleSuggestions(req(text));
    const { valid } = validateSuggestions(raw, [{ ref: "P1", paragraphId: "p", text, style: "body", acceptedRanges: [], pendingRanges: [] }], { mode: "PROOFREAD", protectedTerms: [], rejected: [] });
    expect(valid.map((v) => [v.originalText, v.suggestedText])).toEqual([["the ", ""], ["dog ,", "dog,"], ["i", "I"]]);
  });
  it("leaves dialect in dialogue alone when asked to preserve it", () => {
    expect(ruleSuggestions(req("“I could of told you,” he said."))).toHaveLength(0);
    expect(ruleSuggestions(req("“I could of told you,” he said.", false))).toHaveLength(1);
  });
});
