// Phase 2: KDP rules, print layout, PDF, EPUB, Kindle DOCX and the readiness checker.
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { PDFDocument, PDFName } from "pdf-lib";
import { minInsideMargin, pageLimits, trimById, pageSize, TRIM_SIZES, paperOptions } from "@/lib/publish/kdp";
import { buildBook } from "@/lib/publish/book";
import { readPublishing, isValidIsbn, sectionIncluded } from "@/lib/publish/settings";
import { layoutBook, designMargins, roman, type Layout } from "@/lib/publish/layout";
import { renderPdf } from "@/lib/publish/pdf";
import { checkPaperback } from "@/lib/publish/paperback-check";
import { buildEpub, validateEpub } from "@/lib/publish/epub";
import { buildKindleDocx, checkKindleDocx } from "@/lib/publish/kindle-docx";
import { ebookWords, kindleDocxWords } from "@/lib/publish/service";
import { TEMPLATE_IDS } from "@/lib/publish/templates";
import { UNTITLED_FRONT } from "@/lib/doc/import";
import { longBook, lighthouseSnapshot } from "../samples/book-fixture";

const PROJECT = { id: "proj-1", title: "The Lighthouse at Gull's End", authorName: "M. Shield", language: "en-US" };
const DETAILS = { copyright: "Copyright © 2026 M. Shield\nAll rights reserved.", dedication: "For everyone who waited.", aboutAuthor: "M. Shield lives by the sea." };

function lay(chapters: ReturnType<typeof longBook>, layout: Record<string, unknown> = {}, details: Record<string, unknown> = DETAILS): { layout: Layout; book: ReturnType<typeof buildBook> } {
  const pub = readPublishing({ layout, details });
  const book = buildBook(chapters, PROJECT, pub);
  return { book, layout: layoutBook({ book, settings: pub.layout, isFiction: true }) };
}

describe("KDP rules registry", () => {
  it("uses Amazon's gutter table by page count", () => {
    expect([24, 150, 151, 300, 301, 500, 501, 700, 701, 828].map(minInsideMargin)).toEqual([0.375, 0.375, 0.5, 0.5, 0.625, 0.625, 0.75, 0.75, 0.875, 0.875]);
  });
  it("knows page limits per trim, ink and paper", () => {
    const six = trimById("6x9")!;
    expect(pageLimits(six, "bw", "white")).toEqual({ min: 24, max: 828 });
    expect(pageLimits(six, "bw", "cream")).toEqual({ min: 24, max: 776 });
    expect(pageLimits(six, "standard_color", "white")).toEqual({ min: 72, max: 600 });
    expect(pageLimits(trimById("8.5x11")!, "bw", "white")).toEqual({ min: 24, max: 590 });
    expect(pageLimits(trimById("8.27x11.69")!, "standard_color", "white")).toBeNull();
    expect(paperOptions("premium_color")).toEqual(["white"]);
  });
  it("adds bleed of 0.125in to the width and 0.25in to the height, and flags large trims", () => {
    expect(pageSize(trimById("6x9")!, true)).toEqual({ width: 6.125, height: 9.25 });
    expect(trimById("6x9")!.large).toBe(false);
    expect(trimById("7x10")!.large).toBe(true);
    expect(TRIM_SIZES.map((t) => t.id)).toEqual(expect.arrayContaining(["5x8", "5.5x8.5", "6x9"]));
  });
});

describe("publication model", () => {
  it("never invents front or back matter: empty details mean no copyright, dedication or bio pages", async () => {
    const book = buildBook(await lighthouseSnapshot(), PROJECT, readPublishing({}));
    const roles = book.sections.map((s) => s.role);
    expect(roles).not.toContain("copyright");
    expect(roles).not.toContain("dedication");
    expect(roles).not.toContain("about-author");
    expect(JSON.stringify(book)).not.toMatch(/All rights reserved|ISBN/);
  });
  it("leaves the untitled opening text out by default, and puts it back when the author asks", async () => {
    const chs = await lighthouseSnapshot();
    expect(chs[0].title).toBe(UNTITLED_FRONT);
    const def = readPublishing({});
    expect(sectionIncluded(chs[0], def.layout)).toBe(false);
    const withIt = readPublishing({ layout: { includedSections: [chs[0].chapterId] } });
    expect(buildBook(chs, PROJECT, withIt).sections.some((s) => s.chapterId === chs[0].chapterId)).toBe(true);
  });
  it("falls back to defaults for bad stored settings and checks ISBNs", () => {
    expect(readPublishing({ layout: { trim: "99x99", ink: "neon" } }).layout.trim).toBe("6x9");
    expect(readPublishing({ layout: { ink: "premium_color", paper: "cream" } }).layout.paper).toBe("white");
    expect(isValidIsbn("978-0-306-40615-7")).toBe(true);
    expect(isValidIsbn("978-0-306-40615-8")).toBe(false);
    expect(isValidIsbn("0-306-40615-2")).toBe(true);
  });
});

describe("print layout", () => {
  it("lays out a 120,000-word novel: every word placed, KDP gutter for the final page count, correct pagination", () => {
    const { layout } = lay(longBook(120_000, { parts: true }));
    const n = layout.pages.length;
    expect(n).toBeGreaterThan(300);
    expect(n % 2).toBe(0);
    expect(layout.stats.wordsOut).toBe(layout.stats.wordsIn);
    expect(layout.margins.inside).toBeGreaterThanOrEqual(minInsideMargin(n));
    // odd numbers on the right, body starts at 1 on a right-hand page
    const numbered = layout.pages.filter((p) => p.folio && /^\d+$/.test(p.folio));
    expect(numbered.every((p) => (Number(p.folio) % 2 === 1) === (p.side === "recto"))).toBe(true);
    const firstBody = layout.pages.find((p) => p.sectionId?.startsWith("ch-"))!;
    expect(firstBody.side).toBe("recto");
    // front matter is roman
    expect(layout.pages.find((p) => p.sectionId === "toc")?.folio).toMatch(/^[ivxlc]+$/);
    // no running head on chapter openers or blank pages
    expect(layout.pages.filter((p) => p.kind === "opener" || p.kind === "blank").every((p) => !p.header)).toBe(true);
    expect(layout.pages.filter((p) => p.kind === "text" && p.sectionId?.startsWith("ch-")).every((p) => !!p.header)).toBe(true);
    // never two blank pages in a row
    expect(layout.pages.some((p, i) => i > 0 && p.kind === "blank" && layout.pages[i - 1].kind === "blank")).toBe(false);
  });

  it("recalculates the inside margin as the page count crosses a KDP bracket", () => {
    const chs = longBook(60_000); // about 170 pages at 6x9: needs the 151–300 page gutter
    const pub = readPublishing({ details: DETAILS });
    const book = buildBook(chs, PROJECT, pub);
    // Start from the smallest gutter, as if the book were short: the engine must reflow upwards.
    const up = layoutBook({ book, settings: pub.layout, isFiction: true, startGutter: 0.375 });
    const n = up.pages.length;
    expect(n).toBeGreaterThan(150);
    expect(up.stats.gutterHistory[0]).toMatchObject({ inside: 0.375 });
    expect(up.stats.iterations).toBeGreaterThan(1);
    expect(up.margins.inside - designMargins(up.trim).insideExtra).toBeCloseTo(minInsideMargin(n));
    // Start too high: it settles back to the smallest gutter that still complies.
    const down = layoutBook({ book, settings: pub.layout, isFiction: true, startGutter: 0.75 });
    expect(down.margins.inside).toBeCloseTo(up.margins.inside);
    expect(down.pages.length).toBe(n);
  });

  it("keeps at least two lines of a paragraph on each side of a page turn", () => {
    const { layout } = lay(longBook(30_000));
    expect(layout.stats.minLinesAtBreak).not.toBeNull(); // paragraphs do cross pages in this book
    expect(layout.stats.minLinesAtBreak).toBeGreaterThanOrEqual(2);
    expect(layout.stats.wordsOut).toBe(layout.stats.wordsIn);
  });

  it("produces a PDF that passes the paperback readiness checks (dimensions, fonts, margins, structure)", async () => {
    const { layout } = lay(longBook(60_000));
    const pdf = await renderPdf(layout, { title: PROJECT.title, author: PROJECT.authorName });
    const checks = await checkPaperback(pdf, layout, { ink: "bw", paper: "cream", title: PROJECT.title });
    const failed = checks.filter((c) => c.status === "failed");
    expect(failed).toEqual([]);
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(layout.pages.length);
    expect(doc.getPage(0).getSize()).toEqual({ width: 432, height: 648 });
    expect(doc.catalog.get(PDFName.of("Outlines"))).toBeUndefined();
    expect(checks.find((c) => c.id === "pdf.fonts")?.status).toBe("passed");
  });

  it("supports bleed, every template and the common trims without text leaving the safe area", async () => {
    const chs = longBook(8_000);
    for (const template of TEMPLATE_IDS) {
      for (const trim of ["5x8", "5.5x8.5", "6x9"]) {
        const { layout } = lay(chs, { template, trim, bleed: trim === "5x8" });
        const pdf = await renderPdf(layout, { title: "T", author: "A" });
        const checks = await checkPaperback(pdf, layout, { ink: "bw", paper: "white", title: "T" });
        const bad = checks.filter((c) => c.status === "failed" && c.id !== "kdp.pagecount");
        expect(bad, `${template} ${trim}`).toEqual([]);
        if (trim === "5x8") expect(layout.width).toBeCloseTo(5.125 * 72);
      }
    }
  });

  it("flags a book too short for KDP and characters the font can't print", async () => {
    const chs = [{ chapterId: "c1", title: "Chapter 1", kind: "chapter", paragraphs: [{ id: "p1", style: "body", text: "A snowman ☃ waved.", marks: [] }] }];
    const { layout } = lay(chs);
    const pdf = await renderPdf(layout, { title: "T", author: "A" });
    const checks = await checkPaperback(pdf, layout, { ink: "bw", paper: "white", title: "T" });
    expect(checks.find((c) => c.id === "kdp.pagecount")?.status).toBe("failed");
    expect(checks.find((c) => c.id === "layout.glyphs")?.status).toBe("failed");
    expect(checks.find((c) => c.id === "layout.glyphs")?.detail).toContain("☃");
  });

  it("draws running heads and page numbers on their own page, and prints part titles (regressions)", () => {
    const { layout } = lay(longBook(40_000, { parts: true }));
    for (const p of layout.pages) {
      const heads = p.items.filter((it) => it.t === "text" && it.r === "head");
      const folios = p.items.filter((it) => it.t === "text" && it.r === "folio");
      expect(heads.length > 0, `page ${p.n} head`).toBe(!!p.header);
      expect(folios.length > 0, `page ${p.n} folio`).toBe(!!p.folio);
    }
    const part = layout.pages.find((p) => p.sectionId?.startsWith("ch-part"))!;
    expect(part.items.some((it) => it.t === "text" && /PART 1/.test(it.s))).toBe(true);
  });

  it("splits an over-long word (a URL) to fit and still counts every word once (regression)", () => {
    const url = "https://example.com/" + "very-long-path-segment-".repeat(12);
    const chs = [{ chapterId: "c1", title: "Chapter 1", kind: "chapter", paragraphs: [{ id: "p1", style: "body", text: `See ${url} for more, and the extraordinarily unremarkable lighthouse.`, marks: [] }] }];
    const { layout } = lay(chs);
    expect(layout.stats.wordsOut).toBe(layout.stats.wordsIn);
    const m = layout.margins;
    for (const p of layout.pages) for (const it of p.items) if (it.t === "text" && !it.r) {
      const left = p.side === "recto" ? m.inside * 72 : m.outside * 72;
      expect(it.x + it.w).toBeLessThanOrEqual(left + (layout.trim.width - m.inside - m.outside) * 72 + 1);
    }
  });

  it("numbers front matter in roman numerals", () => {
    expect([1, 4, 9, 14, 40].map(roman)).toEqual(["i", "iv", "ix", "xiv", "xl"]);
  });
});

describe("Kindle EPUB", () => {
  it("builds a valid reflowable EPUB with every word, italics, navigation and no page numbers", async () => {
    const chs = await lighthouseSnapshot();
    const book = buildBook(chs, PROJECT, readPublishing({ details: DETAILS }));
    const { buf } = await buildEpub(book, { projectId: PROJECT.id, isFiction: true });
    const checks = await validateEpub(buf, ebookWords(book));
    expect(checks.filter((c) => c.status === "failed" || c.status === "warning")).toEqual([]);
    const zip = await JSZip.loadAsync(buf);
    expect(Object.keys(zip.files)[0]).toBe("mimetype");
    const all = (await Promise.all(Object.keys(zip.files).filter((n) => n.endsWith(".xhtml")).map((n) => zip.file(n)!.async("string")))).join("\n");
    expect(all).toContain("<em>Forty-one to the gate. Sixty to the tower door.</em>");
    expect(all).toContain('epub:type="toc"');
    expect(all).not.toMatch(/page \d+|pagebreak/i);
    const css = await zip.file("OEBPS/styles/book.css")!.async("string");
    expect(css).not.toMatch(/\d+(px|pt)/);
  });

  it("counts a word with italics in the middle as one word (regression)", async () => {
    const chs = [{ chapterId: "c1", title: "Chapter 1", kind: "chapter", paragraphs: [{ id: "p1", style: "body", text: "She was un-believably calm, absolutely calm.", marks: [{ start: 8, end: 11, type: "italic" as const }, { start: 27, end: 33, type: "italic" as const }] }] }];
    const book = buildBook(chs, PROJECT, readPublishing({}));
    const { buf } = await buildEpub(book, { projectId: PROJECT.id, isFiction: true });
    expect((await validateEpub(buf, ebookWords(book))).find((c) => c.id === "epub.words")?.status).toBe("passed");
    const docx = await buildKindleDocx(book);
    expect((await checkKindleDocx(docx, book, kindleDocxWords(book))).find((c) => c.id === "docx.words")?.status).toBe("passed");
  });

  it("validator catches a broken chapter link and a missing title", async () => {
    const book = buildBook(longBook(3000), PROJECT, readPublishing({}));
    const { buf } = await buildEpub(book, { projectId: PROJECT.id, isFiction: true });
    const zip = await JSZip.loadAsync(buf);
    const nav = await zip.file("OEBPS/nav.xhtml")!.async("string");
    zip.file("OEBPS/nav.xhtml", nav.replace("text/s002.xhtml", "text/missing.xhtml"));
    const opf = await zip.file("OEBPS/content.opf")!.async("string");
    zip.file("OEBPS/content.opf", opf.replace(/<dc:title>[^<]*<\/dc:title>/, ""));
    const bad = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const checks = await validateEpub(bad);
    expect(checks.find((c) => c.id === "epub.links")?.status).toBe("failed");
    expect(checks.find((c) => c.id === "epub.metadata")?.status).toBe("failed");
    expect(checks.find((c) => c.id === "epub.package")?.status).toBe("failed"); // mimetype compressed
  });

  it("uses a stable identifier per book, or the ebook ISBN when one is given", async () => {
    const book = buildBook(longBook(2000), PROJECT, readPublishing({}));
    const a = await JSZip.loadAsync((await buildEpub(book, { projectId: "x", isFiction: true })).buf);
    const b = await JSZip.loadAsync((await buildEpub(book, { projectId: "x", isFiction: true })).buf);
    const id = (s: string) => s.match(/<dc:identifier[^>]*>([^<]+)</)![1];
    expect(id(await a.file("OEBPS/content.opf")!.async("string"))).toBe(id(await b.file("OEBPS/content.opf")!.async("string")));
    const withIsbn = buildBook(longBook(2000), PROJECT, readPublishing({ details: { isbnEbook: "978-0-306-40615-7" } }));
    const c = await JSZip.loadAsync((await buildEpub(withIsbn, { projectId: "x", isFiction: true })).buf);
    expect(await c.file("OEBPS/content.opf")!.async("string")).toContain("urn:isbn:9780306406157");
  });
});

describe("Kindle DOCX", () => {
  it("has chapters as Heading 1, every word, and no headers, footers or page numbers", async () => {
    const book = buildBook(await lighthouseSnapshot(), PROJECT, readPublishing({ details: DETAILS }));
    const buf = await buildKindleDocx(book);
    const checks = await checkKindleDocx(buf, book, kindleDocxWords(book));
    expect(checks.filter((c) => c.status !== "passed")).toEqual([]);
  });
});
