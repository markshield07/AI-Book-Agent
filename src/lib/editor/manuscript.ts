// Manuscript views and versions. Every view is computed from the immutable imported
// paragraphs plus suggestion decisions; nothing here writes paragraph text.
import type { Prisma, SuggestionStatus } from "@prisma/client";
import { db } from "../db";
import { applyEdits, type TextEdit } from "../doc/assemble";
import { countWords, type Mark } from "../doc/model";

export type View = "original" | "accepted";

export interface SnapshotParagraph {
  id: string;
  style: string;
  text: string;
  marks: Mark[];
}
export interface SnapshotChapter {
  chapterId: string;
  title: string;
  kind: string;
  paragraphs: SnapshotParagraph[];
}

export type DecisionMap = Record<string, { status: SuggestionStatus; authorText: string | null }>;

export const isApplied = (s: SuggestionStatus) => s === "ACCEPTED" || s === "MODIFIED";

export async function assembleManuscript(projectId: string, view: View, decisions?: DecisionMap): Promise<SnapshotChapter[]> {
  const chapters = await db.chapter.findMany({
    where: { projectId, active: true },
    orderBy: { position: "asc" },
    include: {
      paragraphs: { orderBy: { position: "asc" } },
      suggestions: { where: { kind: "edit" }, select: { id: true, paragraphId: true, start: true, end: true, suggestedText: true, authorText: true, status: true } },
    },
  });
  return chapters.map((ch) => {
    const edits = new Map<string, TextEdit[]>();
    if (view === "accepted") {
      for (const s of ch.suggestions) {
        const d = decisions ? decisions[s.id] : { status: s.status, authorText: s.authorText };
        if (!d || !isApplied(d.status) || !s.paragraphId) continue;
        const replacement = d.status === "MODIFIED" ? d.authorText ?? s.suggestedText : s.suggestedText;
        const list = edits.get(s.paragraphId) ?? [];
        list.push({ id: s.id, start: s.start, end: s.end, replacement });
        edits.set(s.paragraphId, list);
      }
    }
    return {
      chapterId: ch.id,
      title: ch.title,
      kind: ch.kind,
      paragraphs: ch.paragraphs.map((p) => {
        const marks = (p.marks as unknown as Mark[]) ?? [];
        const applied = applyEdits(p.text, marks, edits.get(p.id) ?? []);
        return { id: p.id, style: p.style, text: applied.text, marks: applied.marks };
      }),
    };
  });
}

export function snapshotWordCount(chs: SnapshotChapter[]): number {
  return chs.reduce(
    (n, c) => n + c.paragraphs.filter((p) => p.style !== "scene_break").reduce((m, p) => m + countWords(p.text), 0),
    0
  );
}

export async function currentDecisionMap(projectId: string): Promise<DecisionMap> {
  const rows = await db.suggestion.findMany({ where: { projectId }, select: { id: true, status: true, authorText: true } });
  return Object.fromEntries(rows.map((r) => [r.id, { status: r.status, authorText: r.authorText }]));
}

export async function createVersion(projectId: string, kind: string, label: string) {
  const [snapshot, decisions] = await Promise.all([assembleManuscript(projectId, "accepted"), currentDecisionMap(projectId)]);
  for (let attempt = 0; attempt < 3; attempt++) {
    const last = await db.manuscriptVersion.findFirst({ where: { projectId }, orderBy: { number: "desc" }, select: { number: true } });
    try {
      return await db.manuscriptVersion.create({
        data: {
          projectId,
          number: (last?.number ?? 0) + 1,
          kind,
          label,
          decisions: decisions as unknown as Prisma.InputJsonValue,
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          wordCount: snapshotWordCount(snapshot),
        },
      });
    } catch (e) {
      if (attempt === 2) throw e; // unique(number) race; retry with the next number
    }
  }
  throw new Error("unreachable");
}

export async function reviewCounts(projectId: string, chapterId?: string) {
  const rows = await db.suggestion.groupBy({
    by: ["kind", "status"],
    where: { projectId, ...(chapterId ? { chapterId } : {}), chapter: { active: true } },
    _count: true,
  });
  const c = { pendingEdits: 0, acceptedEdits: 0, rejectedEdits: 0, modifiedEdits: 0, pendingNotes: 0, resolvedNotes: 0 };
  for (const r of rows) {
    if (r.kind === "note") {
      if (r.status === "PENDING") c.pendingNotes += r._count;
      else c.resolvedNotes += r._count;
    } else if (r.status === "PENDING") c.pendingEdits += r._count;
    else if (r.status === "ACCEPTED") c.acceptedEdits += r._count;
    else if (r.status === "REJECTED") c.rejectedEdits += r._count;
    else c.modifiedEdits += r._count;
  }
  return c;
}
