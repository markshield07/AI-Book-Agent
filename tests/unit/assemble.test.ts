import { describe, it, expect } from "vitest";
import { applyEdits, EditConflictError } from "@/lib/doc/assemble";

describe("applyEdits", () => {
  it("applies non-overlapping edits in any order and leaves the input untouched", () => {
    const text = "She looked at him, not knowing what she should say next.";
    const a = text.indexOf("not knowing");
    const b = text.indexOf("what she");
    const out = applyEdits(text, [], [
      { id: "b", start: b, end: text.length, replacement: "what to say." },
      { id: "a", start: a, end: a + "not knowing".length, replacement: "unsure" },
    ]);
    expect(out.text).toBe("She looked at him, unsure what to say.");
    expect(text).toBe("She looked at him, not knowing what she should say next.");
  });

  it("refuses overlapping edits", () => {
    expect(() =>
      applyEdits("abcdef", [], [
        { id: "1", start: 0, end: 3, replacement: "x" },
        { id: "2", start: 2, end: 4, replacement: "y" },
      ])
    ).toThrow(EditConflictError);
  });

  it("keeps italics on replaced words and shifts later marks", () => {
    const text = "He read Teh Hobbit twice. Then slept.";
    const marks = [
      { start: 8, end: 18, type: "italic" as const },
      { start: 31, end: 36, type: "bold" as const },
    ];
    const out = applyEdits(text, marks, [{ id: "1", start: 8, end: 11, replacement: "The" }]);
    expect(out.text).toBe("He read The Hobbit twice. Then slept.");
    expect(out.text.slice(out.marks[0].start, out.marks[0].end)).toBe("The Hobbit");
    const bold = out.marks.find((m) => m.type === "bold")!;
    expect(out.text.slice(bold.start, bold.end)).toBe("slept");
  });

  it("handles Unicode and insertions", () => {
    const out = applyEdits("Café—naïve “quote”", [], [{ id: "1", start: 4, end: 4, replacement: "," }]);
    expect(out.text).toBe("Café,—naïve “quote”");
  });
});
