// Approved-manuscript fixtures for publishing tests: the sample novel, and a synthetic long
// book of any length (varied paragraph lengths, dialogue, italics, scene breaks, parts).
import { importManuscript } from "@/lib/doc/import";
import type { SnapshotChapter } from "@/lib/editor/manuscript";
import type { DocChapter } from "@/lib/doc/model";
import { writeSamples } from "./make-samples";
import { readFileSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function toSnapshot(chs: DocChapter[]): SnapshotChapter[] {
  return chs.map((c, i) => ({
    chapterId: `c${i + 1}`,
    title: c.title,
    kind: c.kind,
    paragraphs: c.paragraphs.map((p, j) => ({ id: `c${i + 1}p${j + 1}`, style: p.style, text: p.text, marks: p.marks })),
  }));
}

export async function lighthouseSnapshot(): Promise<SnapshotChapter[]> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lh-"));
  await writeSamples(dir);
  const r = await importManuscript("lighthouse.docx", readFileSync(path.join(dir, "lighthouse.docx")));
  return toSnapshot(r.chapters);
}

const SENTENCES = [
  "The tide came in slowly over the flats, the way it always had, and nobody on the quay looked up.",
  "“You’re late,” she said, without turning around.",
  "He had meant to tell her about the letter, but the moment passed, as moments do, and then it was too late to bring it up without explaining why he hadn’t.",
  "Rain.",
  "Somewhere below, a door banged twice and was still.",
  "It was the kind of extraordinary, unremarkable morning that the island specialised in: grey sky, grey water, gulls arguing over nothing.",
  "She counted the steps under her breath — forty-one, forty-two — and tried not to think about what waited at the top.",
  "“Don’t,” he said. “Just don’t.”",
];

/** A deterministic synthetic novel of roughly `words` words. */
export function longBook(words: number, opts: { parts?: boolean; chapterWords?: number } = {}): SnapshotChapter[] {
  const perChapter = opts.chapterWords ?? 3500;
  const chapters: SnapshotChapter[] = [];
  let n = 0;
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  let ci = 0;
  while (n < words) {
    ci++;
    if (opts.parts && ci % 10 === 1) chapters.push({ chapterId: `part${ci}`, title: `Part ${Math.ceil(ci / 10)}`, kind: "chapter", paragraphs: [] });
    const paras: SnapshotChapter["paragraphs"] = [];
    let cw = 0;
    let pi = 0;
    while (cw < perChapter) {
      pi++;
      if (pi % 23 === 0) {
        paras.push({ id: `c${ci}p${pi}`, style: "scene_break", text: "* * *", marks: [] });
        continue;
      }
      const k = 1 + Math.floor(rnd() * 6);
      const text = Array.from({ length: k }, () => SENTENCES[Math.floor(rnd() * SENTENCES.length)]).join(" ");
      const marks = pi % 9 === 0 ? [{ start: 0, end: Math.min(12, text.length), type: "italic" as const }] : [];
      paras.push({ id: `c${ci}p${pi}`, style: "body", text, marks });
      const w = text.split(/\s+/).length;
      cw += w;
      n += w;
    }
    chapters.push({ chapterId: `c${ci}`, title: `Chapter ${ci}`, kind: "chapter", paragraphs: paras });
  }
  return chapters;
}
