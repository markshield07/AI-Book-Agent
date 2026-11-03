import { describe, it, expect } from "vitest";
import mammoth from "mammoth";
import { buildManuscriptDocx, verifyDocx } from "@/lib/export/docx";
import type { SnapshotChapter } from "@/lib/editor/manuscript";

describe("DOCX export", () => {
  it("never prints the app's own 'Opening pages' label as a heading", async () => {
    const chapters = [
      { chapterId: "a", title: "Opening pages", kind: "front", paragraphs: [{ id: "p1", style: "body", text: "by M. Shield", marks: [] }] },
      { chapterId: "b", title: "Chapter One", kind: "chapter", paragraphs: [{ id: "p2", style: "body", text: "It began.", marks: [] }] },
    ] as SnapshotChapter[];
    const buf = await buildManuscriptDocx(chapters, { title: "Book", authorName: "M. Shield", versionLabel: "v1" });
    const raw = (await mammoth.extractRawText({ buffer: buf })).value;
    expect(raw).not.toContain("Opening pages");
    expect(raw).toContain("by M. Shield");
    expect(raw).toContain("Chapter One");
    expect((await verifyDocx(buf, chapters)).every((c) => c.result === "passed")).toBe(true);
  });
});
