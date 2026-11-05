// Print layout engine. Turns the publication model into positioned pages for a KDP paperback.
// The same page list drives the PDF renderer, the on-screen print preview and the readiness
// checker, so the preview is the real layout rather than an approximation.
//
// Units: points (1/72 in). Origin: top-left of the PDF page (which includes bleed, if any).
import { hyphenateSync as hyphenateUs } from "hyphen/en-us";
import { hyphenateSync as hyphenateGb } from "hyphen/en-gb";
import { Measurer, fontKey, type FontKey, type FamilyId } from "./fonts";
import { templateFor, splitChapterTitle, type BookTemplate } from "./templates";
import { trimById, minInsideMargin, minOutsideMargin, pageSize, BLEED_WIDTH, BLEED_HEIGHT, DEFAULT_TRIM, type TrimSize } from "./kdp";
import type { Book, Block, Run, Section } from "./book";
import type { LayoutSettings } from "./settings";
import { countWords } from "../doc/model";

export const PT = 72;

export interface TextItem {
  t: "text";
  x: number;
  y: number; // baseline
  w: number; // advance width including word/letter spacing
  s: string;
  f: FontKey;
  z: number; // font size, pt
  ws?: number; // extra space added to each U+0020, pt
  ls?: number; // letter spacing, pt
  r?: "head" | "folio"; // running head / page number (outside the text block, inside safe margins)
}
export interface RuleItem {
  t: "rule";
  x: number;
  y: number;
  w: number;
}
export type Item = TextItem | RuleItem;

export type PageKind = "blank" | "display" | "opener" | "text";

export interface Page {
  n: number; // physical page, 1-based (odd = right-hand/recto)
  side: "recto" | "verso";
  kind: PageKind;
  folio: string | null; // printed page number
  header: string | null;
  sectionId: string | null;
  items: Item[];
}

export interface Margins {
  top: number;
  bottom: number;
  inside: number;
  outside: number; // inches
}

export interface Layout {
  trim: TrimSize;
  bleed: boolean;
  width: number; // page size in pt (incl. bleed)
  height: number;
  margins: Margins;
  template: BookTemplate["id"];
  pages: Page[];
  sections: { id: string; title: string; role: Section["role"]; page: number; folio: string | null; inToc: boolean }[];
  stats: {
    iterations: number;
    gutterHistory: { pages: number; inside: number }[];
    wordsIn: number;
    wordsOut: number;
    hyphenated: number;
    blankPages: number;
    minFontSize: number;
    /** Fewest lines of a split paragraph left at a page bottom or carried to the next top (widow/orphan control). */
    minLinesAtBreak: number | null;
  };
  missingGlyphs: Record<string, string[]>;
}

interface Seg {
  text: string;
  f: FontKey;
  w: number;
}
interface Line {
  segs: Seg[];
  natural: number; // width with natural spaces
  spaces: number;
  justify: boolean;
  indent: number;
  words: number; // whole words completed on this line (for placement checks)
  hyphen: boolean;
}

// ---------------------------------------------------------------- hyphenation
type Hyph = (w: string) => string[];
const hyphCache = new Map<string, Hyph | null>();
function hyphenatorFor(lang: string): Hyph | null {
  const l = lang.toLowerCase();
  const key = l.startsWith("en-gb") ? "en-gb" : l.startsWith("en") ? "en-us" : "";
  if (!key) return null; // no patterns for this language: lines are justified without hyphens
  let h = hyphCache.get(key);
  if (!h) {
    const fn = key === "en-gb" ? hyphenateGb : hyphenateUs;
    const memo = new Map<string, string[]>();
    h = (w) => {
      let parts = memo.get(w);
      if (!parts) {
        parts = fn(w, { hyphenChar: "\u00AD", minWordLength: 6 }).split("\u00AD");
        memo.set(w, parts);
      }
      return parts;
    };
    hyphCache.set(key, h);
  }
  return h;
}

// ---------------------------------------------------------------- line breaking
interface Word {
  segs: { text: string; f: FontKey }[];
  br?: boolean; // forced line break before this word
  orig?: string; // the whole word, when this is the rest of a word split across lines
}

function wordsOf(runs: Run[], fontFor: (r: Run) => FontKey): Word[] {
  const out: Word[] = [];
  let cur: Word | null = null;
  let pendingBreak = false;
  for (const r of runs) {
    const f = fontFor(r);
    // Tabs and odd spacing collapse to single spaces; "\n" is a deliberate line break.
    const parts = r.text.replace(/[\t  - ]/g, (c) => (c === " " ? " " : " ")).split(/(\n| +)/);
    for (const p of parts) {
      if (!p) continue;
      if (p === "\n") {
        cur = null;
        pendingBreak = true;
        continue;
      }
      if (/^ +$/.test(p)) {
        cur = null;
        continue;
      }
      if (!cur) {
        cur = { segs: [], ...(pendingBreak && out.length ? { br: true } : {}) };
        pendingBreak = false;
        out.push(cur);
      }
      const last = cur.segs[cur.segs.length - 1];
      if (last && last.f === f) last.text += p;
      else cur.segs.push({ text: p, f });
    }
  }
  return out;
}

interface BreakOpts {
  width: number;
  size: number;
  firstIndent: number;
  justify: boolean;
  hyphenate: Hyph | null;
  ls?: number;
}

export function breakLines(m: Measurer, words: Word[], o: BreakOpts): Line[] {
  const lines: Line[] = [];
  const sw = (f: FontKey) => m.width(f, " ", o.size);
  const ww = (w: Word) => w.segs.reduce((n, s) => n + m.width(s.f, s.text, o.size) + (o.ls ?? 0) * [...s.text].length, 0);
  let cur: Line = newLine(o.firstIndent);
  let curWidth = 0; // words only
  let hyphenRun = 0;

  function newLine(indent: number): Line {
    return { segs: [], natural: 0, spaces: 0, justify: o.justify, indent, words: 0, hyphen: false };
  }
  const avail = () => o.width - cur.indent;
  const minSpace = (f: FontKey) => sw(f) * (o.justify ? 0.8 : 1);

  function pushWord(w: Word, complete: boolean) {
    if (cur.segs.length) {
      const f = cur.segs[cur.segs.length - 1].f;
      // the space takes the style of the preceding text
      const last = cur.segs[cur.segs.length - 1];
      last.text += " ";
      last.w += sw(f);
      cur.spaces++;
    }
    for (const s of w.segs) {
      const width = m.width(s.f, s.text, o.size) + (o.ls ?? 0) * [...s.text].length;
      const last = cur.segs[cur.segs.length - 1];
      if (last && last.f === s.f) {
        last.text += s.text;
        last.w += width;
      } else cur.segs.push({ text: s.text, f: s.f, w: width });
      curWidth += width;
    }
    // Count a split word once, as the author wrote it, on the line where it ends.
    if (complete) cur.words += countWords(w.orig ?? w.segs.map((x) => x.text).join(""));
  }
  function flush(last: boolean) {
    cur.natural = cur.segs.reduce((n, s) => n + s.w, 0);
    if (last) cur.justify = false;
    if (cur.hyphen) hyphenRun++;
    else hyphenRun = 0;
    lines.push(cur);
    cur = newLine(0);
    curWidth = 0;
  }

  const queue = [...words];
  while (queue.length) {
    const w = queue.shift()!;
    if (w.br && cur.segs.length) flush(true);
    const width = ww(w);
    const spaceNeeded = cur.segs.length ? minSpace(cur.segs[cur.segs.length - 1].f) * (cur.spaces + 1) : 0;
    if (curWidth + spaceNeeded + width <= avail() + 0.01) {
      pushWord(w, true);
      continue;
    }
    // Try to hyphenate a single-style word into the remaining space.
    if (o.hyphenate && cur.segs.length && hyphenRun < 2 && w.segs.length === 1 && !w.br) {
      const s = w.segs[0];
      const core = s.text.match(/^([“"‘'(]*)([\p{Ll}\p{Lu}][\p{Ll}]{5,})([”"’'),.;:!?]*)$/u);
      if (core) {
        const parts = o.hyphenate(core[2]);
        for (let k = parts.length - 1; k >= 1; k--) {
          const head = core[1] + parts.slice(0, k).join("") + "-";
          const hw = m.width(s.f, head, o.size);
          if (curWidth + spaceNeeded + hw <= avail() + 0.01) {
            pushWord({ segs: [{ text: head, f: s.f }] }, false);
            cur.hyphen = true;
            flush(false);
            queue.unshift({ segs: [{ text: parts.slice(k).join("") + core[3], f: s.f }], orig: s.text });
            break;
          }
        }
        if (cur.segs.length === 0) continue; // hyphenated and flushed
      }
    }
    if (cur.segs.length) {
      flush(false);
      queue.unshift(w);
      continue;
    }
    // A single word wider than the line (a long URL): split it so nothing runs into the margin.
    let piece = "";
    const s = w.segs.map((x) => x.text).join("");
    const f = w.segs[0].f;
    for (const ch of s) {
      if (m.width(f, piece + ch, o.size) > avail() && piece) break;
      piece += ch;
    }
    pushWord({ segs: [{ text: piece, f }] }, piece.length === s.length);
    if (piece.length < s.length) {
      flush(false);
      queue.unshift({ segs: [{ text: s.slice(piece.length), f }], orig: w.orig ?? s });
    }
  }
  if (cur.segs.length || lines.length === 0) flush(true);
  return lines;
}

// ---------------------------------------------------------------- page assembly
export interface LayoutInput {
  book: Book;
  settings: LayoutSettings;
  isFiction: boolean;
  /** First gutter to try (inches). Defaults to an estimate from the word count. */
  startGutter?: number;
}

const ROMAN: [number, string][] = [
  [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
];
export function roman(n: number): string {
  let s = "";
  for (const [v, r] of ROMAN) while (n >= v) (s += r), (n -= v);
  return s;
}

/** Default design margins (inches) before the KDP gutter is added. */
export function designMargins(trim: TrimSize): Omit<Margins, "inside"> & { insideExtra: number } {
  const small = trim.width <= 5.25;
  const large = trim.width >= 7;
  return { top: large ? 0.85 : 0.75, bottom: large ? 0.9 : 0.8, outside: small ? 0.5 : large ? 0.75 : 0.625, insideExtra: small ? 0.2 : 0.25 };
}

class Composer {
  pages: Page[] = [];
  page!: Page;
  y = 0; // baseline of the last placed line on the current page (0 = nothing yet)
  bodyPage = 0; // arabic folio counter
  frontPage = 0;
  inBody = false;
  sectionPages: Layout["sections"] = [];
  wordsIn = 0;
  wordsOut = 0;
  hyphenated = 0;
  minFont = 99;
  constructor(
    readonly lineCache: Map<string, Line[]>,
    readonly m: Measurer,
    readonly t: BookTemplate,
    readonly book: Book,
    readonly s: LayoutSettings,
    readonly geo: { width: number; height: number; trimW: number; trimH: number; bleed: boolean; margins: Margins },
    readonly hyph: Hyph | null,
    readonly tocNumbers: Map<string, string>
  ) {}

  // geometry ----------------------------------------------------------
  get mg() {
    return this.geo.margins;
  }
  textLeft(side: Page["side"]) {
    const trimX = this.geo.bleed && side === "verso" ? BLEED_WIDTH * PT : 0;
    return trimX + (side === "recto" ? this.mg.inside : this.mg.outside) * PT;
  }
  get textWidth() {
    return (this.geo.trimW - this.mg.inside - this.mg.outside) * PT;
  }
  get trimTop() {
    return this.geo.bleed ? (BLEED_HEIGHT / 2) * PT : 0;
  }
  get top() {
    return this.trimTop + this.mg.top * PT;
  }
  get bottom() {
    return this.trimTop + (this.geo.trimH - this.mg.bottom) * PT;
  }
  get leading() {
    return this.t.leading;
  }
  get firstBaseline() {
    return this.top + this.t.bodySize * 0.8;
  }
  nextSide(): Page["side"] {
    return (this.pages.length + 1) % 2 === 1 ? "recto" : "verso";
  }

  // pages -------------------------------------------------------------
  newPage(kind: PageKind, sectionId: string | null): Page {
    const n = this.pages.length + 1;
    const side = n % 2 === 1 ? "recto" : "verso";
    let folioNum: number;
    if (this.inBody) folioNum = ++this.bodyPage;
    else folioNum = ++this.frontPage;
    const p: Page = { n, side, kind, folio: null, header: null, sectionId, items: [] };
    (p as Page & { _num: number })._num = folioNum;
    this.pages.push(p);
    this.page = p;
    this.y = 0;
    return p;
  }
  blank() {
    this.newPage("blank", null);
  }
  ensureRecto() {
    if (this.nextSide() === "verso") this.blank();
  }

  // text --------------------------------------------------------------
  lines(key: string, runs: Run[], o: BreakOpts & { family: FamilyId; italic?: boolean; bold?: boolean }): Line[] {
    const k = `${key}|${o.width.toFixed(2)}|${o.size}|${o.firstIndent}`;
    let ls = this.lineCache.get(k);
    if (!ls) {
      const words = wordsOf(runs, (r) => fontKey(o.family, o.italic ? !r.italic : !!r.italic, !!r.bold || !!o.bold));
      ls = breakLines(this.m, words, o);
      this.lineCache.set(k, ls);
    }
    return ls;
  }

  drawLine(line: Line, x: number, y: number, width: number, size: number, align: "justify" | "left" | "center" | "right", ls = 0, role?: TextItem["r"]) {
    this.minFont = Math.min(this.minFont, size);
    let ws = 0;
    let start = x + line.indent;
    const room = width - line.indent;
    // Justified lines stretch or shrink to the measure. Any line set with slightly tightened
    // spaces (allowed when breaking) is also shrunk back to fit, so nothing enters the margin.
    if (line.spaces > 0 && ((align === "justify" && line.justify) || line.natural > room)) ws = (room - line.natural) / line.spaces;
    else if (align === "center") start = x + line.indent + (room - line.natural) / 2;
    else if (align === "right") start = x + width - line.natural;
    let cx = start;
    for (const seg of line.segs) {
      const spaces = (seg.text.match(/ /g) ?? []).length;
      const text = seg.text.replace(/ +$/, (sp) => (seg === line.segs[line.segs.length - 1] ? "" : sp));
      const w = seg.w + ws * spaces;
      if (text) this.page.items.push({ t: "text", x: r2(cx), y: r2(y), w: r2(w), s: text, f: seg.f, z: size, ...(ws && spaces ? { ws: r3(ws) } : {}), ...(ls ? { ls } : {}), ...(role ? { r: role } : {}) });
      cx += w;
    }
  }

  // sections ----------------------------------------------------------
  run(): void {
    const secs = this.book.sections;
    for (let i = 0; i < secs.length; i++) {
      const sec = secs[i];
      const prev = secs[i - 1];
      const startsBody = sec.matter !== "front" && !this.inBody;
      // page placement rules
      if (startsBody) {
        this.ensureRecto();
        this.inBody = true;
      } else if (sec.role === "copyright") {
        if (this.nextSide() === "recto" && this.pages.length) this.blank();
      } else if (["half-title", "title", "dedication", "epigraph", "toc", "front", "part"].includes(sec.role) || prev?.role === "part") {
        this.ensureRecto();
      } else if (this.s.chapterStart === "recto") {
        this.ensureRecto();
      }
      if (sec.display) this.displaySection(sec);
      else this.flowSection(sec);
      if (sec.role === "part") this.blank(); // the back of a part page stays empty
    }
    // KDP prints in pairs; end on a left-hand page.
    if (this.pages.length % 2 === 1) this.blank();
    if (this.pages.length && this.pages[this.pages.length - 1].kind === "blank" && this.pages[this.pages.length - 2]?.kind === "blank") {
      this.pages.splice(-2, 2); // never two trailing blanks
    }
    this.finish();
  }

  recordSection(sec: Section) {
    this.sectionPages.push({ id: sec.id, title: sec.title, role: sec.role, page: this.page.n, folio: null, inToc: sec.inToc });
  }

  displaySection(sec: Section) {
    const p = this.newPage("display", sec.id);
    this.recordSection(sec);
    const t = this.t;
    const width = this.textWidth;
    type Placed = { lines: Line[]; size: number; lead: number; before: number; align: "center" | "left"; ls: number };
    const placed: Placed[] = [];
    for (const [bi, b] of sec.blocks.entries()) {
      const size = this.displaySize(b, sec);
      const family = b.size === "title" || b.size === "subtitle" || b.size === "author" || b.size === "heading" || sec.role === "part" ? t.heading : t.body;
      const upper = sec.role === "part" || (b.size === "title" && t.chapter.uppercase);
      const ls = upper ? Math.round(size * t.chapter.tracking * 100) / 100 : 0;
      const runs = upper ? b.runs.map((r) => ({ ...r, text: r.text.toUpperCase() })) : b.runs;
      const lines = this.lines(`${sec.id}#${bi}`, runs, { width, size, firstIndent: 0, justify: false, hyphenate: null, family, ls });
      this.wordsIn += countRunsWords(b.runs);
      placed.push({ lines, size, lead: size * 1.3, before: (b.spaceBefore ?? 0) * t.leading, align: b.align ?? "center", ls });
    }
    const total = placed.reduce((n, b) => n + b.before + b.lines.length * b.lead, 0);
    const avail = this.bottom - this.top;
    const anchor = sec.role === "copyright" ? "bottom" : sec.role === "title" ? 0.18 : sec.role === "part" ? 0.32 : 0.28;
    let y = anchor === "bottom" ? Math.max(this.top, this.bottom - total) : this.top + Math.max(0, Math.min(avail * anchor, avail - total));
    for (const b of placed) {
      y += b.before;
      for (const line of b.lines) {
        y += b.lead;
        if (y > this.bottom + 1) {
          // Too long for one page (a long copyright notice): continue on the next.
          this.newPage("display", sec.id);
          y = this.top + b.lead;
        }
        this.drawLine(line, this.textLeft(this.page.side), y - b.lead * 0.25, width, b.size, b.align, b.ls);
        this.wordsOut += line.words;
      }
    }
  }

  displaySize(b: Block, sec: Section): number {
    const t = this.t;
    if (sec.role === "part") return t.chapter.titleSize;
    switch (b.size) {
      case "title":
        return Math.round(t.chapter.titleSize * 1.45);
      case "subtitle":
        return Math.round(t.chapter.titleSize * 0.75);
      case "author":
        return Math.round(t.chapter.titleSize * 0.7);
      case "heading":
        return t.chapter.titleSize;
      case "small":
        return Math.max(8, Math.round(t.bodySize * 0.8 * 2) / 2);
      default:
        return t.bodySize;
    }
  }

  flowSection(sec: Section) {
    const t = this.t;
    this.newPage("opener", sec.id);
    this.recordSection(sec);
    // chapter heading, sunk down the page
    const x = () => this.textLeft(this.page.side);
    const width = this.textWidth;
    const { label, name } = splitChapterTitle(sec.title);
    const sink = sec.role === "toc" || sec.role === "also-by" || sec.role === "about-author" ? Math.min(t.chapter.sink, 0.12) : t.chapter.sink;
    let y = this.top + (this.bottom - this.top) * sink;
    const ls = Math.round(t.chapter.titleSize * t.chapter.tracking * 100) / 100;
    const align = t.chapter.align;
    if (label) {
      const size = t.chapter.labelSize;
      const runs = [{ text: label.toUpperCase() }];
      for (const ln of this.lines(`${sec.id}#label`, runs, { width, size, firstIndent: 0, justify: false, hyphenate: null, family: t.heading, ls: size * 0.15 })) {
        y += size * 1.4;
        this.drawLine(ln, x(), y, width, size, align, Math.round(size * 0.15 * 100) / 100);
      }
      y += t.chapter.labelSize * 0.6;
    }
    const titleRuns = [{ text: t.chapter.uppercase ? name.toUpperCase() : name }];
    const tsize = t.chapter.titleSize;
    for (const ln of this.lines(`${sec.id}#title`, titleRuns, { width, size: tsize, firstIndent: 0, justify: false, hyphenate: null, family: t.heading, italic: t.chapter.italic, ls })) {
      y += tsize * 1.25;
      this.drawLine(ln, x(), y, width, tsize, align, ls);
    }
    this.wordsIn += countWords(sec.title);
    this.wordsOut += countWords(sec.title);
    if (t.chapter.rule) {
      y += tsize * 0.6;
      const rw = align === "center" ? width * 0.25 : width * 0.18;
      this.page.items.push({ t: "rule", x: r2(align === "center" ? x() + (width - rw) / 2 : x()), y: r2(y), w: r2(rw) });
    }
    this.y = y + t.chapter.spaceAfter * this.leading - this.leading;

    if (sec.role === "toc") return this.tocEntries();
    sec.blocks.forEach((b, i) => this.flowBlock(sec, b, i, sec.blocks[i + 1]));
  }

  /** Start a new text page for the same section. */
  continuePage(sec: Section) {
    this.newPage("text", sec.id);
  }

  room(): number {
    const base = this.y || this.firstBaseline - this.leading;
    return Math.floor((this.bottom - this.t.bodySize * 0.25 - base) / this.leading + 1e-6);
  }

  flowBlock(sec: Section, b: Block, bi: number, next?: Block) {
    const t = this.t;
    const width = this.textWidth;
    const words = countRunsWords(b.runs);
    this.wordsIn += words;
    if (b.type === "scene") {
      // A scene break needs room for itself and two lines after it, or it moves to the next page.
      // Half a line above and below the ornament: the break takes two lines in all.
      if (this.room() < (this.y ? 2 : 1) + 2) this.continuePage(sec);
      if (this.y) this.y += this.leading * 0.5;
      const ln = this.lines(`scene|${t.sceneBreak}`, [{ text: t.sceneBreak }], { width, size: t.bodySize, firstIndent: 0, justify: false, hyphenate: null, family: t.body })[0];
      this.y = this.y ? this.y + this.leading : this.firstBaseline;
      this.drawLine(ln, this.textLeft(this.page.side), this.y, width, t.bodySize, "center");
      this.y += this.leading * 0.5;
      this.wordsIn -= words; // the author's break marker is replaced by the template ornament
      return;
    }
    if (b.type === "subhead") {
      const sub = t.subheading;
      const fam = sub.family === "heading" ? t.heading : t.body;
      const lines = this.lines(`${sec.id}#${bi}`, b.runs, { width, size: sub.size, firstIndent: 0, justify: false, hyphenate: null, family: fam, italic: sub.italic, bold: sub.bold });
      const before = this.y ? 1 : 0;
      if (this.room() < before + lines.length + 2) this.continuePage(sec);
      if (this.y) this.y += this.leading * 0.6 + this.leading * 0.4;
      for (const ln of lines) {
        this.y = this.y ? this.y + this.leading : this.firstBaseline;
        this.drawLine(ln, this.textLeft(this.page.side), this.y, width, sub.size, "left");
        this.wordsOut += ln.words;
      }
      this.y += this.leading * 0.3;
      return;
    }
    const isQuote = b.type === "quote";
    const size = isQuote ? Math.round(t.bodySize * t.blockquote.scale * 2) / 2 : t.bodySize;
    const inset = isQuote ? t.blockquote.indent * t.bodySize : 0;
    const flush = b.first && t.firstParagraph === "flush";
    const centered = b.align === "center";
    const lines = this.lines(`${sec.id}#${bi}`, b.runs, {
      width: width - inset * 2,
      size,
      firstIndent: isQuote || flush || centered ? 0 : t.indent * t.bodySize,
      justify: t.justify && !centered,
      hyphenate: t.hyphenate && !centered ? this.hyph : null,
      family: t.body,
      italic: isQuote && t.blockquote.italic,
    });
    const spaceBefore = (isQuote ? 0.5 : t.paragraphSpace) + (b.spaceBefore ?? 0);
    const spaceAfter = isQuote && next && next.type !== "quote" ? 0.5 : 0;
    if (this.y && spaceBefore) this.y += spaceBefore * this.leading;
    let i = 0;
    const chunks: number[] = [];
    while (i < lines.length) {
      let r = this.room();
      const remaining = lines.length - i;
      let take = Math.min(r, remaining);
      if (take < remaining) {
        // widow/orphan control: at least two lines on each side of a page turn
        take = Math.min(take, remaining - 2);
        if (i === 0 && take < 2) take = 0;
        if (take < 1 && i > 0) take = 0;
      }
      if (take <= 0) {
        if (!this.y) {
          take = Math.min(remaining, Math.max(1, r)); // nothing else fits anywhere; avoid an infinite loop
        } else {
          this.continuePage(sec);
          r = this.room();
          continue;
        }
      }
      chunks.push(take);
      for (let k = 0; k < take; k++, i++) {
        const ln = lines[i];
        this.y = this.y ? this.y + this.leading : this.firstBaseline;
        if (ln.hyphen) this.hyphenated++;
        this.drawLine(ln, this.textLeft(this.page.side) + inset, this.y, width - inset * 2, size, centered ? "center" : t.justify ? "justify" : "left");
        this.wordsOut += ln.words;
      }
      if (i < lines.length) this.continuePage(sec);
    }
    if (chunks.length > 1) this.minSplit = Math.min(this.minSplit, chunks[0], chunks[chunks.length - 1]);
    if (spaceAfter) this.y += spaceAfter * this.leading;
  }
  minSplit = Infinity;

  tocEntries() {
    const t = this.t;
    const width = this.textWidth;
    const numW = this.m.width(fontKey(t.body, false, false), "0000", t.bodySize);
    const entries = this.book.sections.filter((s) => s.inToc);
    for (const e of entries) {
      const isPart = e.role === "part";
      const runs = [{ text: isPart ? e.title.toUpperCase() : e.title }];
      const lines = this.lines(`toc|${e.id}`, runs, { width: width - numW - (isPart ? 0 : t.bodySize), size: t.bodySize, firstIndent: 0, justify: false, hyphenate: null, family: t.body });
      const gap = isPart ? 0.6 : 0.15;
      if (this.room() < lines.length + 1) this.newPage("text", "toc");
      if (this.y) this.y += gap * this.leading;
      lines.forEach((ln, li) => {
        this.y = this.y ? this.y + this.leading : this.firstBaseline;
        this.drawLine(ln, this.textLeft(this.page.side) + (isPart ? 0 : t.bodySize), this.y, width, t.bodySize, "left", isPart ? 0.6 : 0);
        if (li === lines.length - 1) {
          const num = this.tocNumbers.get(e.id) ?? "";
          if (num) {
            const nl = this.lines(`tocnum|${num}`, [{ text: num }], { width: numW, size: t.bodySize, firstIndent: 0, justify: false, hyphenate: null, family: t.body })[0];
            this.drawLine(nl, this.textLeft(this.page.side), this.y, width, t.bodySize, "right");
          }
        }
      });
    }
  }

  finish() {
    const t = this.t;
    const romanFront = this.s.frontNumbering === "roman";
    const titleOf = new Map(this.book.sections.map((s) => [s.id, s]));
    for (const p of this.pages) {
      const num = (p as Page & { _num?: number })._num ?? 0;
      delete (p as Page & { _num?: number })._num;
      const sec = p.sectionId ? titleOf.get(p.sectionId) : undefined;
      const front = !sec || sec.matter === "front";
      if (p.kind === "blank" || p.kind === "display") continue;
      this.page = p; // drawLine writes to this.page
      const isFrontPage = this.isFrontPage(p);
      p.folio = isFrontPage ? (romanFront ? roman(num) : null) : String(num);
      if (p.kind === "text" && this.s.runningHeaders && !front) {
        const author = this.book.meta.author;
        const title = this.book.meta.title;
        const chap = sec?.title ?? title;
        if (sec?.matter === "back") p.header = p.side === "verso" ? (t.header.verso === "author" ? author : title) : chap;
        else p.header = p.side === "verso" ? (t.header.verso === "author" ? author : title) : t.header.recto === "title" ? title : chap;
      }
      const left = this.textLeft(p.side);
      const width = this.textWidth;
      if (p.header) {
        const hs = t.header.size;
        const text = t.header.uppercase ? p.header.toUpperCase() : p.header;
        const ls = Math.round(hs * t.header.tracking * 100) / 100;
        const ln = this.lines(`head|${text}`, [{ text, italic: t.header.italic }], { width, size: hs, firstIndent: 0, justify: false, hyphenate: null, family: t.body, ls })[0];
        if (ln) this.drawLine(ln, left, this.top - 18, width, hs, "center", ls, "head");
      }
      if (p.folio) {
        const fs = t.folioSize;
        const ln = this.lines(`folio|${p.folio}`, [{ text: p.folio }], { width, size: fs, firstIndent: 0, justify: false, hyphenate: null, family: t.body })[0];
        this.drawLine(ln, left, this.bottom + 26, width, fs, "center", 0, "folio");
      }
    }
    for (const s of this.sectionPages) s.folio = this.pages[s.page - 1].folio;
  }

  isFrontPage(p: Page): boolean {
    const sec = p.sectionId ? this.book.sections.find((s) => s.id === p.sectionId) : undefined;
    return !sec || sec.matter === "front";
  }
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

function countRunsWords(runs: Run[]): number {
  return countWords(runs.map((r) => r.text).join(""));
}

/**
 * Lay out the book, then recalculate the KDP gutter from the page count and reflow until the
 * inside margin satisfies the requirement for the final page count.
 */
export function layoutBook(input: LayoutInput): Layout {
  const s = input.settings;
  const trim = trimById(s.trim) ?? trimById(DEFAULT_TRIM)!;
  const t = templateFor(s.template, input.isFiction);
  const m = new Measurer();
  const hyph = t.hyphenate ? hyphenatorFor(input.book.meta.language) : null;
  const size = pageSize(trim, s.bleed);
  const d = designMargins(trim);
  const minOut = minOutsideMargin(s.bleed);
  const history: Layout["stats"]["gutterHistory"] = [];
  const lineCache = new Map<string, Line[]>();

  const run = (gutter: number, toc: Map<string, string>) => {
    const margins: Margins = { top: Math.max(d.top, minOut), bottom: Math.max(d.bottom, minOut), outside: Math.max(d.outside, minOut), inside: gutter + d.insideExtra };
    const c = new Composer(lineCache, m, t, input.book, s, { width: size.width * PT, height: size.height * PT, trimW: trim.width, trimH: trim.height, bleed: s.bleed, margins }, hyph, toc);
    c.run();
    return { c, margins };
  };

  // Start from an estimate (about 300 words per 6x9 page) to save a pass on long books.
  const words = input.book.sections.reduce((n, sec) => n + sec.blocks.reduce((k, b) => k + countRunsWords(b.runs), 0), 0);
  let gutter = input.startGutter ?? minInsideMargin(Math.max(24, Math.round(words / (300 * ((trim.width * trim.height) / 54)))));
  let res = run(gutter, new Map());
  let iterations = 1;
  for (; iterations < 8; iterations++) {
    const pages = res.c.pages.length;
    history.push({ pages, inside: gutter });
    const need = minInsideMargin(pages);
    if (need <= gutter + 1e-9) {
      // Compliant. If the estimate overshot a bracket, try the smaller gutter once: keep it only if it still complies.
      if (need < gutter - 1e-9) {
        const trial = run(need, new Map());
        if (minInsideMargin(trial.c.pages.length) <= need + 1e-9) {
          gutter = need;
          res = trial;
          history.push({ pages: trial.c.pages.length, inside: need });
        }
      }
      break;
    }
    gutter = need; // gutter only ever grows, so this always terminates
    res = run(gutter, new Map());
  }
  // Final pass with real page numbers in the table of contents (same page count: TOC space is reserved).
  const toc = new Map<string, string>();
  for (const sp of res.c.sectionPages) {
    const p = res.c.pages[sp.page - 1];
    const sec = input.book.sections.find((x) => x.id === sp.id)!;
    if (!sec.inToc) continue;
    toc.set(sp.id, p.folio ?? displayFolio(res.c, p));
  }
  const final = run(gutter, toc);
  const c = final.c;
  const missingGlyphs: Record<string, string[]> = {};
  for (const [k, v] of m.missing) missingGlyphs[k] = [...v];
  return {
    trim,
    bleed: s.bleed,
    width: size.width * PT,
    height: size.height * PT,
    margins: final.margins,
    template: t.id,
    pages: c.pages,
    sections: c.sectionPages.map((sp) => ({ ...sp, folio: toc.get(sp.id) ?? sp.folio })),
    stats: {
      iterations,
      gutterHistory: history,
      wordsIn: c.wordsIn,
      wordsOut: c.wordsOut,
      hyphenated: c.hyphenated,
      blankPages: c.pages.filter((p) => p.kind === "blank").length,
      minFontSize: c.minFont,
      minLinesAtBreak: Number.isFinite(c.minSplit) ? c.minSplit : null,
    },
    missingGlyphs,
  };
}

/** Page number a display page (a part page) would have, for the contents list. */
function displayFolio(c: Composer, p: Page): string {
  if (c.isFrontPage(p)) {
    const idx = p.n;
    return c.s.frontNumbering === "roman" ? roman(idx) : "";
  }
  const first = c.pages.findIndex((x) => !c.isFrontPage(x) && x.sectionId);
  return String(p.n - first);
}
