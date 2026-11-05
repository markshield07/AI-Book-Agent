import { describe, it, expect } from "vitest";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { importManuscript, importPlainText, importMarkdown, ImportError, parseMdInline } from "@/lib/doc/import";

describe("plain text import", () => {
  it("detects chapters, scene breaks and dialogue", () => {
    const r = importPlainText(
      `The Long Night\n\nby A. Writer\n\nChapter One\n\n"Hey," she said. "You good?"\n\nHe wasn't.\n\n* * *\n\nMorning came.\n\nChapter Two\n\nIt rained.`
    );
    expect(r.chapters.map((c) => [c.title, c.kind])).toEqual([
      ["Opening pages", "front"],
      ["Chapter One", "chapter"],
      ["Chapter Two", "chapter"],
    ]);
    expect(r.detectedTitle).toBe("The Long Night");
    expect(r.stats.sceneBreaks).toBe(1);
    expect(r.stats.dialogueParagraphs).toBe(1);
    expect(r.chapters[1].paragraphs[2].style).toBe("scene_break");
  });
  it("imports a single chapter without headings", () => {
    const r = importPlainText("Just one paragraph of text.\nAnd another.");
    expect(r.chapters).toHaveLength(1);
    expect(r.chapters[0].paragraphs).toHaveLength(2);
    expect(r.warnings[0].message).toMatch(/single chapter/);
  });
  it("preserves accented and non-Latin text exactly", () => {
    const t = "Chapter 1\n\nZoë said “¿Qué pasa?” — 東京 was naïve.";
    expect(importPlainText(t).chapters[0].paragraphs[0].text).toBe("Zoë said “¿Qué pasa?” — 東京 was naïve.");
  });
});

describe("markdown import", () => {
  it("keeps italics and bold", () => {
    const r = importMarkdown("# Prologue\n\nShe *really* meant it. **Never** again.");
    const p = r.chapters[0].paragraphs[0];
    expect(p.text).toBe("She really meant it. Never again.");
    expect(p.marks.map((m) => [p.text.slice(m.start, m.end), m.type])).toEqual([["really", "italic"], ["Never", "bold"]]);
  });
  it("does not treat snake_case as italics", () => {
    expect(parseMdInline("call my_var_name now").marks).toHaveLength(0);
  });
});

describe("docx import", () => {
  it("reads headings, italics and scene breaks from a real .docx", async () => {
    const doc = new Document({
      sections: [{
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Chapter 1")] }),
          new Paragraph({ children: [new TextRun("It was "), new TextRun({ text: "cold", italics: true }), new TextRun(".")] }),
          new Paragraph({ children: [new TextRun("#")] }),
          new Paragraph({ children: [new TextRun("Later.")] }),
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Chapter 2")] }),
          new Paragraph({ children: [new TextRun({ text: "Bold", bold: true }), new TextRun(" start.")] }),
        ],
      }],
    });
    const buf = await Packer.toBuffer(doc);
    const r = await importManuscript("book.docx", buf);
    expect(r.chapters.map((c) => c.title)).toEqual(["Chapter 1", "Chapter 2"]);
    const p = r.chapters[0].paragraphs[0];
    expect(p.text).toBe("It was cold.");
    expect(p.marks).toEqual([{ start: 7, end: 11, type: "italic" }]);
    expect(r.chapters[0].paragraphs[1].style).toBe("scene_break");
    expect(r.stats.boldSpans).toBe(1);
  });
  it("rejects corrupt and unsupported files with a clear message", async () => {
    await expect(importManuscript("book.docx", Buffer.from("not a zip"))).rejects.toThrow(ImportError);
    await expect(importManuscript("book.pdf", Buffer.from("%PDF"))).rejects.toThrow(/aren't supported yet/);
    await expect(importManuscript("book.txt", Buffer.from([0, 1, 2]))).rejects.toThrow(/binary/);
    await expect(importManuscript("book.exe", Buffer.from("x"))).rejects.toThrow(/isn't supported/);
  });
});
