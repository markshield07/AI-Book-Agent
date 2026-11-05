// The publication model: the approved manuscript plus author-supplied front/back matter, as
// an ordered list of sections made of semantic blocks. Print layout and the ebook are both
// built from this, so they always contain the same words in the same order.
import type { SnapshotChapter } from "../editor/manuscript";
import { toRuns, type Mark } from "../doc/model";
import { PART_RE } from "../doc/import";
import { sectionIncluded, cleanIsbn, type Publishing } from "./settings";

export interface Run {
  text: string;
  italic?: boolean;
  bold?: boolean;
}

export type BlockType =
  | "p" // body paragraph
  | "scene" // scene break (ornament)
  | "subhead"
  | "quote"
  | "display"; // centred display line(s) on title/copyright/dedication pages

export interface Block {
  type: BlockType;
  runs: Run[];
  /** For "p": first paragraph after a heading or scene break (template decides indent). */
  first?: boolean;
  /** For display blocks: relative size and spacing. */
  size?: "title" | "subtitle" | "author" | "small" | "normal" | "heading";
  spaceBefore?: number; // lines
  align?: "center" | "left";
  /** Paragraph id from the approved version, for word-placement checks. */
  pid?: string;
}

export type SectionRole =
  | "half-title"
  | "title"
  | "copyright"
  | "dedication"
  | "epigraph"
  | "toc"
  | "front" // imported front matter (foreword, preface…)
  | "part"
  | "chapter"
  | "back" // imported back matter
  | "also-by"
  | "about-author";

export interface Section {
  id: string;
  role: SectionRole;
  title: string; // shown in TOC / navigation / running heads
  matter: "front" | "body" | "back";
  blocks: Block[];
  inToc: boolean;
  /** Display pages are vertically placed and carry no running head or folio. */
  display: boolean;
  /** Source chapter, for imported sections. */
  chapterId?: string;
}

export interface BookMeta {
  title: string;
  subtitle: string;
  author: string;
  language: string;
  publisher: string;
  isbnPaperback: string;
  isbnEbook: string;
  website: string;
}

export interface Book {
  meta: BookMeta;
  sections: Section[];
  excluded: { chapterId: string; title: string }[];
}

const runsOf = (text: string, marks: Mark[]): Run[] =>
  toRuns(text, marks).map((r) => ({ text: r.text, ...(r.italic ? { italic: true } : {}), ...(r.bold ? { bold: true } : {}) }));

const plain = (text: string): Run[] => [{ text }];

/** Author-typed multi-line text: blank lines separate paragraphs, single newlines are line breaks. */
export function paragraphsOf(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/[ \t]+\n/g, "\n").trim())
    .filter(Boolean);
}

function chapterBlocks(ch: SnapshotChapter): Block[] {
  const blocks: Block[] = [];
  let first = true;
  for (const p of ch.paragraphs) {
    if (p.style === "scene_break") {
      blocks.push({ type: "scene", runs: plain(p.text), pid: p.id });
      first = true;
    } else if (p.style === "heading") {
      blocks.push({ type: "subhead", runs: runsOf(p.text, p.marks), pid: p.id });
      first = true;
    } else if (p.style === "blockquote") {
      blocks.push({ type: "quote", runs: runsOf(p.text, p.marks), pid: p.id });
      first = true;
    } else {
      blocks.push({ type: "p", runs: runsOf(p.text, p.marks), first, pid: p.id });
      first = false;
    }
  }
  return blocks;
}

export function buildBook(
  chapters: SnapshotChapter[],
  project: { id: string; title: string; authorName: string; language: string },
  pub: Publishing
): Book {
  const d = pub.details;
  const L = pub.layout;
  const meta: BookMeta = {
    title: project.title,
    subtitle: d.subtitle.trim(),
    author: project.authorName,
    language: project.language || "en-US",
    publisher: d.publisher.trim(),
    isbnPaperback: cleanIsbn(d.isbnPaperback),
    isbnEbook: cleanIsbn(d.isbnEbook),
    website: d.website.trim(),
  };
  const sections: Section[] = [];
  const excluded: Book["excluded"] = [];
  const add = (s: Omit<Section, "inToc" | "display"> & Partial<Pick<Section, "inToc" | "display">>) =>
    sections.push({ inToc: false, display: false, ...s });

  if (L.halfTitle) add({ id: "half-title", role: "half-title", title: meta.title, matter: "front", display: true, blocks: [{ type: "display", size: "subtitle", runs: plain(meta.title) }] });

  const titleBlocks: Block[] = [{ type: "display", size: "title", runs: plain(meta.title) }];
  if (meta.subtitle) titleBlocks.push({ type: "display", size: "subtitle", runs: plain(meta.subtitle), spaceBefore: 1 });
  titleBlocks.push({ type: "display", size: "author", runs: plain(meta.author), spaceBefore: 4 });
  if (meta.publisher) titleBlocks.push({ type: "display", size: "small", runs: plain(meta.publisher), spaceBefore: 8 });
  add({ id: "title", role: "title", title: meta.title, matter: "front", display: true, blocks: titleBlocks });

  // Copyright page: only from what the author typed. Nothing is generated.
  const copyrightLines: Block[] = [];
  for (const p of paragraphsOf(d.copyright)) copyrightLines.push({ type: "display", size: "small", align: "left", runs: plain(p), spaceBefore: copyrightLines.length ? 0.6 : 0 });
  if (d.edition.trim()) copyrightLines.push({ type: "display", size: "small", align: "left", runs: plain(d.edition.trim()), spaceBefore: 0.6 });
  if (meta.isbnPaperback) copyrightLines.push({ type: "display", size: "small", align: "left", runs: plain(`ISBN ${d.isbnPaperback.trim()} (paperback)`), spaceBefore: 0.6 });
  if (meta.isbnEbook) copyrightLines.push({ type: "display", size: "small", align: "left", runs: plain(`ISBN ${d.isbnEbook.trim()} (ebook)`), spaceBefore: copyrightLines.length && !meta.isbnPaperback ? 0.6 : 0 });
  if (meta.publisher && copyrightLines.length) copyrightLines.push({ type: "display", size: "small", align: "left", runs: plain(`Published by ${meta.publisher}`), spaceBefore: 0.6 });
  if (meta.website && copyrightLines.length) copyrightLines.push({ type: "display", size: "small", align: "left", runs: plain(meta.website), spaceBefore: 0.6 });
  if (copyrightLines.length) add({ id: "copyright", role: "copyright", title: "Copyright", matter: "front", display: true, blocks: copyrightLines });

  if (d.dedication.trim())
    add({ id: "dedication", role: "dedication", title: "Dedication", matter: "front", display: true, blocks: paragraphsOf(d.dedication).map((p, i) => ({ type: "display", size: "normal", runs: [{ text: p, italic: true }], spaceBefore: i ? 0.6 : 0 })) });

  if (d.epigraph.trim()) {
    const b: Block[] = paragraphsOf(d.epigraph).map((p, i) => ({ type: "display", size: "normal", runs: [{ text: p, italic: true }], spaceBefore: i ? 0.6 : 0 }));
    if (d.epigraphSource.trim()) b.push({ type: "display", size: "small", runs: plain(`— ${d.epigraphSource.trim()}`), spaceBefore: 1 });
    add({ id: "epigraph", role: "epigraph", title: "Epigraph", matter: "front", display: true, blocks: b });
  }

  // TOC placeholder; its entries are filled in by each output (page numbers or links).
  if (L.printToc) add({ id: "toc", role: "toc", title: "Contents", matter: "front", blocks: [] });

  let seenBody = false;
  for (const ch of chapters) {
    if (!sectionIncluded(ch, L)) {
      excluded.push({ chapterId: ch.chapterId, title: ch.title });
      continue;
    }
    const isPart = ch.kind === "chapter" && PART_RE.test(ch.title.trim()) && ch.paragraphs.length === 0;
    const role: SectionRole = isPart ? "part" : ch.kind === "front" && !seenBody ? "front" : ch.kind === "back" ? "back" : "chapter";
    if (role === "chapter" || role === "part") seenBody = true;
    add({
      id: `ch-${ch.chapterId}`,
      chapterId: ch.chapterId,
      role,
      title: ch.title,
      matter: role === "front" ? "front" : role === "back" ? "back" : "body",
      inToc: true,
      display: isPart,
      // A part page prints its own title; it has no body text.
      blocks: isPart ? [{ type: "display", size: "heading", runs: plain(ch.title) }] : chapterBlocks(ch),
    });
  }

  if (d.alsoBy.trim()) {
    const lines = d.alsoBy.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
    add({ id: "also-by", role: "also-by", title: `Also by ${meta.author}`, matter: "back", inToc: true, blocks: lines.map((l) => ({ type: "p", first: true, runs: plain(l), align: "center" })) });
  }
  if (d.aboutAuthor.trim() || d.seriesInfo.trim()) {
    const b: Block[] = paragraphsOf(d.aboutAuthor).map((p, i) => ({ type: "p", first: i === 0, runs: plain(p) }));
    for (const p of paragraphsOf(d.seriesInfo)) b.push({ type: "p", first: b.length === 0, runs: plain(p) });
    if (meta.website) b.push({ type: "p", first: true, runs: plain(meta.website), spaceBefore: 1 });
    add({ id: "about-author", role: "about-author", title: "About the Author", matter: "back", inToc: true, blocks: b });
  }
  return { meta, sections, excluded };
}
