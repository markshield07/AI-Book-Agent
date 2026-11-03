// Deterministic manuscript assembly: original paragraphs + accepted edits -> edited text.
// The original paragraph text is never mutated; this is a pure function.

import { Mark, normalizeMarks } from "./model";

export interface TextEdit {
  id: string;
  start: number;
  end: number;
  replacement: string;
}

export class EditConflictError extends Error {
  constructor(public a: string, public b: string) {
    super(`Edits ${a} and ${b} overlap`);
  }
}

export function rangesOverlap(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  // Two zero-width insertions at the same point also conflict (ordering would be ambiguous).
  if (a.start === a.end && b.start === b.end) return a.start === b.start;
  if (a.start === a.end) return a.start > b.start && a.start < b.end;
  if (b.start === b.end) return b.start > a.start && b.start < a.end;
  return a.start < b.end && b.start < a.end;
}

export function sortAndCheck(edits: TextEdit[]): TextEdit[] {
  const sorted = [...edits].sort((x, y) => x.start - y.start || x.end - y.end || x.id.localeCompare(y.id));
  for (let i = 1; i < sorted.length; i++) {
    if (rangesOverlap(sorted[i - 1], sorted[i])) throw new EditConflictError(sorted[i - 1].id, sorted[i].id);
  }
  return sorted;
}

export function applyEdits(text: string, marks: Mark[], edits: TextEdit[]): { text: string; marks: Mark[] } {
  if (edits.length === 0) return { text, marks };
  const sorted = sortAndCheck(edits);
  for (const e of sorted) {
    if (e.start < 0 || e.end > text.length || e.start > e.end) {
      throw new Error(`Edit ${e.id} is outside the paragraph`);
    }
  }
  let out = "";
  let cursor = 0;
  const placed: { oldStart: number; oldEnd: number; newStart: number; newEnd: number }[] = [];
  for (const e of sorted) {
    out += text.slice(cursor, e.start);
    const newStart = out.length;
    out += e.replacement;
    placed.push({ oldStart: e.start, oldEnd: e.end, newStart, newEnd: out.length });
    cursor = e.end;
  }
  out += text.slice(cursor);

  const map = (p: number, side: "start" | "end"): number => {
    let delta = 0;
    for (const e of placed) {
      if (side === "start" ? p <= e.oldStart : p <= e.oldStart) {
        return p + delta;
      }
      if (p >= e.oldEnd) {
        delta = e.newEnd - e.oldEnd;
        continue;
      }
      // p is strictly inside a replaced range
      return side === "start" ? e.newStart : e.newEnd;
    }
    return p + delta;
  };

  const newMarks = marks.map((m) => ({ ...m, start: map(m.start, "start"), end: map(m.end, "end") }));
  return { text: out, marks: normalizeMarks(newMarks, out.length) };
}
