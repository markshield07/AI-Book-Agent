// Manuscript intake: DOCX / TXT / Markdown / pasted text -> structured chapters.
// Unsupported formats are refused with an explanation rather than half-imported.

import mammoth from "mammoth";
import { parse, HTMLElement, Node, NodeType } from "node-html-parser";
import {
  DocChapter,
  DocParagraph,
  ImportResult,
  ImportWarning,
  Mark,
  countWords,
  normalizeMarks,
} from "./model";

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export const SUPPORTED_EXTENSIONS = [".docx", ".txt", ".md", ".markdown"];
export const PLANNED_EXTENSIONS = [".rtf", ".pdf", ".epub", ".doc", ".odt", ".pages"];
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

interface RawBlock {
  kind: "heading" | "body" | "blockquote" | "title";
  level?: number;
  text: string;
  marks: Mark[];
}

export function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

export async function importManuscript(fileName: string, data: Buffer): Promise<ImportResult> {
  const ext = extensionOf(fileName);
  if (data.length === 0) throw new ImportError("The file is empty.");
  if (data.length > MAX_UPLOAD_BYTES) throw new ImportError("The file is larger than the 25 MB limit.");
  if (PLANNED_EXTENSIONS.includes(ext)) {
    throw new ImportError(
      `${ext.toUpperCase().slice(1)} files aren't supported yet. Please save your manuscript as a Word document (.docx) or plain text (.txt) and upload that instead.`
    );
  }
  if (ext === ".docx") return importDocx(data);
  if (ext === ".txt" || ext === ".md" || ext === ".markdown") {
    const text = decodeText(data);
    return ext === ".txt" ? importPlainText(text) : importMarkdown(text);
  }
  throw new ImportError("This file type isn't supported. Upload a .docx, .txt or .md file.");
}

function decodeText(data: Buffer): string {
  if (data.includes(0)) throw new ImportError("This file looks like binary data, not text.");
  let text = data.toString("utf8");
  if (text.includes("�")) {
    // Not valid UTF-8; fall back to Windows-1252 which most legacy .txt files use.
    text = new TextDecoder("windows-1252").decode(data);
  }
  return text.replace(/^﻿/, "");
}

// ---------- DOCX ----------

export async function importDocx(data: Buffer): Promise<ImportResult> {
  // DOCX is a zip: check magic bytes before handing to the parser.
  if (data.length < 4 || data[0] !== 0x50 || data[1] !== 0x4b) {
    throw new ImportError("This file isn't a valid Word document. It may be corrupt or an older .doc file.");
  }
  let html: string;
  const messages: string[] = [];
  let images = 0;
  try {
    const result = await mammoth.convertToHtml(
      { buffer: data },
      {
        styleMap: [
          "p[style-name='Title'] => h1.doc-title:fresh",
          "p[style-name='Subtitle'] => p.doc-subtitle:fresh",
          "p[style-name='Quote'] => blockquote > p:fresh",
          "p[style-name='Intense Quote'] => blockquote > p:fresh",
        ],
        convertImage: mammoth.images.imgElement(async () => {
          images++;
          return { src: "" };
        }),
      }
    );
    html = result.value;
    for (const m of result.messages) if (m.type === "warning") messages.push(m.message);
  } catch {
    throw new ImportError("We couldn't read this Word document. It may be corrupt or password-protected.");
  }
  const root = parse(html);
  const blocks: RawBlock[] = [];
  const walk = (el: HTMLElement, inQuote: boolean) => {
    for (const child of el.childNodes) {
      if (child.nodeType !== NodeType.ELEMENT_NODE) continue;
      const c = child as HTMLElement;
      const tag = c.tagName?.toLowerCase();
      if (tag === "blockquote") walk(c, true);
      else if (tag === "ul" || tag === "ol" || tag === "table" || tag === "tbody" || tag === "tr" || tag === "td") walk(c, inQuote);
      else if (/^h[1-6]$/.test(tag)) {
        const { text, marks } = inlineText(c);
        if (text.trim())
          blocks.push({ kind: c.classList.contains("doc-title") ? "title" : "heading", level: Number(tag[1]), text, marks });
      } else if (tag === "p" || tag === "li") {
        const { text, marks } = inlineText(c);
        blocks.push({ kind: inQuote ? "blockquote" : "body", text, marks });
      }
    }
  };
  walk(root, false);
  const warnings: ImportWarning[] = [];
  if (images > 0)
    warnings.push({
      level: "warning",
      message: `Your document contains ${images} image${images > 1 ? "s" : ""}. Images aren't carried into the edited manuscript yet; the text around them was imported.`,
    });
  const unknownStyles = messages.filter((m) => m.includes("Unrecognised paragraph style")).length;
  if (unknownStyles > 0)
    warnings.push({ level: "info", message: "Some custom Word styles were treated as normal paragraphs." });
  return buildResult(blocks, warnings, images);
}

function inlineText(el: HTMLElement): { text: string; marks: Mark[] } {
  let text = "";
  const marks: Mark[] = [];
  const visit = (node: Node, italic: boolean, bold: boolean) => {
    if (node.nodeType === NodeType.TEXT_NODE) {
      const t = decodeEntities(node.rawText);
      if (!t) return;
      const start = text.length;
      text += t;
      if (italic) marks.push({ start, end: text.length, type: "italic" });
      if (bold) marks.push({ start, end: text.length, type: "bold" });
      return;
    }
    if (node.nodeType !== NodeType.ELEMENT_NODE) return;
    const e = node as HTMLElement;
    const tag = e.tagName?.toLowerCase();
    if (tag === "br") {
      text += " ";
      return;
    }
    const it = italic || tag === "em" || tag === "i";
    const bd = bold || tag === "strong" || tag === "b";
    for (const c of e.childNodes) visit(c, it, bd);
  };
  for (const c of el.childNodes) visit(c, false, false);
  // Trim while keeping mark offsets correct.
  const lead = text.length - text.trimStart().length;
  const trimmed = text.trim();
  return {
    text: trimmed,
    marks: normalizeMarks(
      marks.map((m) => ({ ...m, start: m.start - lead, end: m.end - lead })),
      trimmed.length
    ),
  };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

// ---------- Plain text / Markdown ----------

function splitParagraphs(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const nonEmpty = lines.filter((l) => l.trim()).length;
  const blankSeparated = /\n[ \t]*\n/.test(normalized);
  // If blank lines separate paragraphs, a single newline is a soft wrap. Otherwise one line = one paragraph.
  const parts =
    blankSeparated && nonEmpty > 0 && normalized.split(/\n[ \t]*\n/).length > nonEmpty / 4
      ? normalized.split(/\n[ \t]*\n+/).map((p) => p.split("\n").map((l) => l.trim()).join(" "))
      : lines;
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

export function importPlainText(text: string): ImportResult {
  if (!text.trim()) throw new ImportError("The file doesn't contain any text.");
  const blocks: RawBlock[] = splitParagraphs(text).map((t) => ({ kind: "body", text: t, marks: [] }));
  return buildResult(blocks, [], 0);
}

export function importMarkdown(text: string): ImportResult {
  if (!text.trim()) throw new ImportError("The file doesn't contain any text.");
  const blocks: RawBlock[] = [];
  for (const raw of splitParagraphs(text)) {
    const h = raw.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const { text: t, marks } = parseMdInline(h[2]);
      blocks.push({ kind: "heading", level: h[1].length, text: t, marks });
    } else if (raw.startsWith(">")) {
      const { text: t, marks } = parseMdInline(raw.replace(/^>\s?/gm, ""));
      blocks.push({ kind: "blockquote", text: t, marks });
    } else {
      const { text: t, marks } = parseMdInline(raw);
      blocks.push({ kind: "body", text: t, marks });
    }
  }
  return buildResult(blocks, [], 0);
}

/** Minimal inline Markdown: **bold**, __bold__, *italic*, _italic_. */
export function parseMdInline(src: string): { text: string; marks: Mark[] } {
  let text = "";
  const marks: Mark[] = [];
  const re = /(\*\*|__)(.+?)\1|(?<![\p{L}\p{N}])([*_])(?!\s)(.+?)(?<!\s)\3(?![\p{L}\p{N}])/gu;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    text += src.slice(last, m.index);
    const inner = m[2] ?? m[4];
    const start = text.length;
    text += inner;
    marks.push({ start, end: text.length, type: m[1] ? "bold" : "italic" });
    last = m.index + m[0].length;
  }
  text += src.slice(last);
  return { text, marks: normalizeMarks(marks, text.length) };
}

// ---------- Structure detection ----------

/** Name the app gives to text before the first heading (title page etc.). It is a label for
 * the author's dashboard only and is never printed as a heading in exported books. */
export const UNTITLED_FRONT = "Opening pages";
export const isUntitledFront = (c: { title: string; kind: string }) => c.kind === "front" && c.title === UNTITLED_FRONT;

const NUMBER_WORDS =
  "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty";
const CHAPTER_RE = new RegExp(
  `^(chapter|ch\\.)\\s+([0-9]+|[ivxlcdm]+|(?:${NUMBER_WORDS})(?:[- ](?:${NUMBER_WORDS}))?)\\b.{0,80}$`,
  "i"
);
const SPECIAL_RE = /^(prologue|epilogue|interlude|part\s+([0-9]+|[ivxlcdm]+|[a-z]+))\b.{0,60}$/i;
const FRONT_RE = /^(foreword|preface|introduction|dedication|epigraph|copyright|author'?s note|note to the reader)\b.{0,40}$/i;
const BACK_RE = /^(acknowledg(e)?ments|about the author|afterword|also by|other books by|glossary|appendix)\b.{0,40}$/i;
const SCENE_BREAK_RE = /^\s*(?:[*#~•·◆◇❖§+=_\-]\s*){1,7}$/;

export function isSceneBreak(text: string): boolean {
  return SCENE_BREAK_RE.test(text) && text.trim().length > 0;
}

function headingKind(text: string): "chapter" | "front" | "back" | null {
  const t = text.trim();
  if (t.length > 90) return null;
  if (CHAPTER_RE.test(t) || SPECIAL_RE.test(t)) return "chapter";
  if (/^\d{1,3}\.?$/.test(t)) return "chapter";
  if (FRONT_RE.test(t)) return "front";
  if (BACK_RE.test(t)) return "back";
  return null;
}

function buildResult(blocks: RawBlock[], warnings: ImportWarning[], images: number): ImportResult {
  let detectedTitle: string | null = null;
  const titleBlock = blocks.find((b) => b.kind === "title");
  const headings = blocks.filter((b) => b.kind === "heading");
  const h1s = headings.filter((b) => b.level === 1);
  let chapterLevel = headings.length ? Math.min(...headings.map((h) => h.level ?? 1)) : 1;
  if (titleBlock) detectedTitle = titleBlock.text;
  else if (h1s.length === 1 && headings.some((h) => (h.level ?? 1) > 1) && blocks[0] === h1s[0]) {
    // A lone top-level heading at the start is the book title; chapters use the next level.
    detectedTitle = h1s[0].text;
    h1s[0].kind = "title";
    chapterLevel = Math.min(...headings.filter((h) => h !== h1s[0]).map((h) => h.level ?? 2));
  }

  const chapters: DocChapter[] = [];
  let current: DocChapter | null = null;
  let seenChapter = false;
  let promoted = 0;
  const startChapter = (title: string, kind: DocChapter["kind"]) => {
    current = { title, kind, paragraphs: [] };
    chapters.push(current);
  };

  for (const b of blocks) {
    if (b.kind === "title") continue;
    const text = b.text.replace(/\s+$/u, "");
    if (!text.trim()) continue;
    const isStructuralHeading = b.kind === "heading" && (b.level ?? 1) <= chapterLevel;
    const detected = b.kind !== "blockquote" ? headingKind(text) : null;
    if (isStructuralHeading || (b.kind === "body" && detected)) {
      if (b.kind === "body") promoted++;
      let kind: DocChapter["kind"] = detected === "front" || detected === "back" ? detected : "chapter";
      if (kind === "front" && seenChapter) kind = "chapter"; // e.g. an "Introduction" chapter mid-book
      if (kind === "back" && !seenChapter) kind = "front";
      if (kind === "chapter") seenChapter = true;
      startChapter(text.trim(), kind);
      continue;
    }
    if (!current) {
      // Text before any heading.
      startChapter(UNTITLED_FRONT, "front");
    }
    const ch = current as unknown as DocChapter;
    if (isSceneBreak(text)) {
      ch.paragraphs.push({ style: "scene_break", text: text.trim(), marks: [] });
    } else {
      ch.paragraphs.push({
        style: b.kind === "heading" ? "heading" : b.kind === "blockquote" ? "blockquote" : "body",
        text,
        marks: b.marks,
      } as DocParagraph);
    }
  }

  // Short text before the first chapter that has no heading is likely a title page.
  if (chapters.length > 1 && chapters[0].title === UNTITLED_FRONT) {
    const words = chapters[0].paragraphs.reduce((n, p) => n + countWords(p.text), 0);
    if (!detectedTitle && words <= 20 && chapters[0].paragraphs.length > 0)
      detectedTitle = chapters[0].paragraphs[0].text;
  }
  // No headings at all: one section.
  if (chapters.length === 1 && chapters[0].title === UNTITLED_FRONT) {
    chapters[0].title = "Chapter 1";
    chapters[0].kind = "chapter";
    warnings.push({
      level: "info",
      message: "No chapter headings were found, so the text was imported as a single chapter. You can upload more chapters later.",
    });
  }
  // Drop empty chapters created by consecutive headings? Keep them but warn.
  const empty = chapters.filter((c) => c.paragraphs.length === 0);
  if (empty.length)
    warnings.push({
      level: "warning",
      message: `${empty.length} heading${empty.length > 1 ? "s have" : " has"} no text under ${empty.length > 1 ? "them" : "it"}: ${empty
        .slice(0, 3)
        .map((c) => `"${c.title}"`)
        .join(", ")}${empty.length > 3 ? "…" : ""}.`,
    });
  if (promoted > 0 && headings.length === 0)
    warnings.push({ level: "info", message: `Chapter breaks were detected from lines such as "${chapters.find((c) => c.kind === "chapter")?.title ?? ""}".` });

  const all = chapters.flatMap((c) => c.paragraphs);
  if (all.length === 0) throw new ImportError("We couldn't find any readable text in this file.");
  const stats = {
    words: all.filter((p) => p.style !== "scene_break").reduce((n, p) => n + countWords(p.text), 0),
    paragraphs: all.length,
    dialogueParagraphs: all.filter((p) => /["“”]/.test(p.text)).length,
    sceneBreaks: all.filter((p) => p.style === "scene_break").length,
    italicSpans: all.reduce((n, p) => n + p.marks.filter((m) => m.type === "italic").length, 0),
    boldSpans: all.reduce((n, p) => n + p.marks.filter((m) => m.type === "bold").length, 0),
    images,
  };
  return { detectedTitle, chapters, warnings, stats };
}
