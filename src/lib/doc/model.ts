// Structured internal manuscript model shared by import, editing, assembly and export.

export type MarkType = "italic" | "bold";
export interface Mark {
  start: number;
  end: number;
  type: MarkType;
}

export type ParagraphStyle = "body" | "heading" | "scene_break" | "blockquote";

export interface DocParagraph {
  style: ParagraphStyle;
  text: string;
  marks: Mark[];
}

export interface DocChapter {
  title: string;
  kind: "chapter" | "front" | "back";
  paragraphs: DocParagraph[];
}

export interface ImportWarning {
  level: "info" | "warning";
  message: string;
}

export interface ImportResult {
  detectedTitle: string | null;
  chapters: DocChapter[];
  warnings: ImportWarning[];
  stats: {
    words: number;
    paragraphs: number;
    dialogueParagraphs: number;
    sceneBreaks: number;
    italicSpans: number;
    boldSpans: number;
    images: number;
  };
}

export function countWords(text: string): number {
  const m = text.trim().match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu);
  return m ? m.length : 0;
}

export function chapterWordCount(ch: { paragraphs: { style: string; text: string }[] }): number {
  return ch.paragraphs
    .filter((p) => p.style !== "scene_break")
    .reduce((n, p) => n + countWords(p.text), 0);
}

/** Normalise marks: clip to text, drop empties, merge adjacent spans of the same type. */
export function normalizeMarks(marks: Mark[], textLength: number): Mark[] {
  const out: Mark[] = [];
  for (const type of ["italic", "bold"] as MarkType[]) {
    const spans = marks
      .filter((m) => m.type === type)
      .map((m) => ({ start: Math.max(0, m.start), end: Math.min(textLength, m.end), type }))
      .filter((m) => m.end > m.start)
      .sort((a, b) => a.start - b.start);
    for (const s of spans) {
      const last = out.length ? out[out.length - 1] : null;
      if (last && last.type === type && s.start <= last.end) last.end = Math.max(last.end, s.end);
      else out.push({ ...s });
    }
  }
  return out.sort((a, b) => a.start - b.start || a.type.localeCompare(b.type));
}

/** Split text into runs with their active formatting, for rendering/export. */
export function toRuns(text: string, marks: Mark[]): { text: string; italic: boolean; bold: boolean }[] {
  const cuts = new Set<number>([0, text.length]);
  for (const m of marks) {
    cuts.add(Math.max(0, Math.min(text.length, m.start)));
    cuts.add(Math.max(0, Math.min(text.length, m.end)));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const runs: { text: string; italic: boolean; bold: boolean }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (b <= a) continue;
    const italic = marks.some((m) => m.type === "italic" && m.start <= a && m.end >= b);
    const bold = marks.some((m) => m.type === "bold" && m.start <= a && m.end >= b);
    runs.push({ text: text.slice(a, b), italic, bold });
  }
  return runs;
}
