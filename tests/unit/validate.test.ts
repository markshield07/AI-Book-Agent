import { describe, it, expect } from "vitest";
import { validateSuggestions, minimize, type ParagraphRef } from "@/lib/editor/validate";
import type { RawSuggestion } from "@/lib/ai/types";

const para = (ref: string, text: string, extra: Partial<ParagraphRef> = {}): ParagraphRef => ({
  ref, paragraphId: `id-${ref}`, text, style: "body", acceptedRanges: [], pendingRanges: [], ...extra,
});
const s = (paragraph: string, original: string, replacement: string, extra: Partial<RawSuggestion> = {}): RawSuggestion => ({
  paragraph, original, replacement, category: "grammar", explanation: "x", severity: "minor", confidence: 0.9, adds_new_material: false, ...extra,
});
const opts = { mode: "COPYEDIT" as const, protectedTerms: [] as string[], rejected: [] };

describe("minimize", () => {
  it("narrows to changed words", () => {
    expect(minimize("the cat sat on teh mat", "the cat sat on the mat")).toEqual({ offset: 15, original: "teh", replacement: "the" });
  });
  it("attaches an inserted comma to the preceding word", () => {
    expect(minimize("Hello world", "Hello, world")).toEqual({ offset: 0, original: "Hello", replacement: "Hello," });
  });
});

describe("validateSuggestions", () => {
  const ps = [para("P1", "I could of gone there. I could of stayed."), para("P2", "Marisol walked in.")];
  it("anchors a valid suggestion to exact offsets", () => {
    const { valid } = validateSuggestions([s("P2", "walked in.", "strode in.")], ps, opts);
    expect(valid).toHaveLength(1);
    expect(ps[1].text.slice(valid[0].start, valid[0].end)).toBe(valid[0].originalText);
    expect(valid[0].originalText).toBe("walked");
  });
  it("rejects text that is not in the paragraph, ambiguous anchors, and unknown refs", () => {
    const r = validateSuggestions(
      [s("P2", "ran in.", "x"), s("P1", "could of", "could have"), s("P9", "x", "y")],
      ps,
      opts
    );
    expect(r.valid).toHaveLength(0);
    expect(r.discarded.map((d) => d.reason)).toEqual([
      "original text not found in paragraph",
      "original text is ambiguous within paragraph",
      "unknown paragraph reference",
    ]);
  });
  it("protects terms", () => {
    const r = validateSuggestions([s("P2", "Marisol walked", "Marisa walked")], ps, { ...opts, protectedTerms: ["Marisol"] });
    expect(r.valid).toHaveLength(0);
    expect(r.discarded[0].reason).toMatch(/protected term/);
  });
  it("refuses overlaps with accepted edits and within the batch", () => {
    const p = [para("P1", "One two three four.", { acceptedRanges: [{ start: 4, end: 7 }] })];
    const r = validateSuggestions([s("P1", "two three", "2 3"), s("P1", "three four", "3 4"), s("P1", "three four.", "x four.")], p, opts);
    expect(r.valid).toHaveLength(1);
    expect(r.discarded.map((d) => d.reason)).toEqual(["conflicts with an edit the author already accepted", "overlaps another suggestion in this batch"]);
  });
  it("does not re-propose a rejected change", () => {
    const r = validateSuggestions([s("P2", "walked", "strode")], ps, { ...opts, rejected: [{ paragraphId: "id-P2", original: "walked", replacement: "strode" }] });
    expect(r.valid).toHaveLength(0);
  });
  it("limits proofreading to small changes", () => {
    const long = "word ".repeat(40).trim();
    const r = validateSuggestions([s("P1", long, long.toUpperCase())], [para("P1", long)], { ...opts, mode: "PROOFREAD" });
    expect(r.valid).toHaveLength(0);
  });
  it("refuses to duplicate another paragraph", () => {
    const a = "The storm had passed by the time they reached the harbour, and nobody spoke.";
    const r = validateSuggestions([s("P1", "Short one.", "Short one. " + a)], [para("P1", "Short one."), para("P2", a)], { ...opts, mode: "LINE_EDIT" });
    expect(r.discarded[0].reason).toMatch(/duplicate/);
  });
});
