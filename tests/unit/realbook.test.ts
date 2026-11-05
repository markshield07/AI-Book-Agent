// Real-manuscript cases found in the second audit.
import { describe, it, expect } from "vitest";
import mammoth from "mammoth";
import { importManuscript, importPlainText } from "@/lib/doc/import";
import { buildManuscriptDocx, verifyDocx } from "@/lib/export/docx";
import { messyDocx } from "../samples/messy-docx";

describe("messy Word manuscripts", () => {
  it("finds chapters under part headings, back matter, and unstyled bold chapter lines", async () => {
    const r = await importManuscript("messy.docx", await messyDocx());
    expect(r.chapters.map((c) => `${c.kind}:${c.title}`)).toEqual([
      "front:Opening pages", "chapter:Part One: The Island", "chapter:Chapter 1", "chapter:Chapter 2",
      "chapter:Part Two: The Sea", "chapter:Chapter 1", "chapter:CHAPTER TWO", "chapter:Epilogue", "back:Acknowledgments",
    ]);
    expect(r.chapters[0].paragraphs[0].text).toMatch(/^Copyright/);
  });
  it("keeps footnotes out of the text and warns about notes, tracked changes and comments", async () => {
    const r = await importManuscript("messy.docx", await messyDocx());
    const all = r.chapters.flatMap((c) => c.paragraphs.map((p) => p.text));
    expect(all).toContain("She saw the reef at dawn.");
    expect(all.some((t) => t.includes("A footnote about the reef"))).toBe(false);
    const w = r.warnings.map((x) => x.message).join("\n");
    expect(w).toMatch(/footnote/);
    expect(w).toMatch(/tracked changes/);
    expect(w).toMatch(/Comments/);
  });
  it("keeps line breaks inside a paragraph through to the exported file", async () => {
    const r = await importManuscript("messy.docx", await messyDocx());
    const poem = r.chapters.flatMap((c) => c.paragraphs).find((p) => p.text.startsWith("Roses"))!;
    expect(poem.text).toBe("Roses are red,\nviolets are blue,\nthe sea is cold.");
    const chapters = [{ chapterId: "c", title: "Chapter 1", kind: "chapter", paragraphs: [{ id: "p", style: "body", text: poem.text, marks: [] }] }];
    const buf = await buildManuscriptDocx(chapters, { title: "T", authorName: "A", versionLabel: "v" });
    expect((await mammoth.convertToHtml({ buffer: buf })).value).toContain("Roses are red,<br />violets are blue,<br />the sea is cold.");
    expect((await verifyDocx(buf, chapters)).every((c) => c.result === "passed")).toBe(true);
  });
});

describe("chapter detection from plain lines", () => {
  it("does not start chapters at sentences that begin with Part, Chapter or Copyright", () => {
    const r = importPlainText(
      "Chapter One\n\nPart of me knew it was over.\n\nChapter one of my life ended that day, she said.\n\nCopyright law was the last thing on her mind.\n\nIntroduction to the island was brief.\n\n“Part two,” he said.\n\nChapter Two\n\nThe end."
    );
    expect(r.chapters.map((c) => c.title)).toEqual(["Chapter One", "Chapter Two"]);
    expect(r.chapters[0].paragraphs).toHaveLength(5);
  });
  it("still finds real heading lines", () => {
    const r = importPlainText("PART ONE\n\nCHAPTER I\n\nText.\n\n12.\n\nMore text.\n\nBook Two: The Sea\n\nChapter Twenty-One\n\nLast.\n\nAcknowledgments\n\nThanks.");
    expect(r.chapters.map((c) => c.title)).toEqual(["PART ONE", "CHAPTER I", "12.", "Book Two: The Sea", "Chapter Twenty-One", "Acknowledgments"]);
  });
});
