import { db } from "../db";
import type { Mark } from "../doc/model";

export interface ReviewSuggestion {
  id: string;
  kind: string;
  paragraphId: string | null;
  start: number;
  end: number;
  originalText: string;
  suggestedText: string;
  authorText: string | null;
  category: string;
  explanation: string;
  severity: string;
  confidence: number;
  status: string;
  origin: string;
  contribution: string;
}

export interface ReviewData {
  project: { id: string; title: string; status: string };
  chapters: { id: string; title: string; kind: string; wordCount: number; pending: number; accepted: number; rejected: number; notes: number }[];
  chapter: {
    id: string;
    title: string;
    paragraphs: { id: string; style: string; text: string; marks: Mark[] }[];
    suggestions: ReviewSuggestion[];
  } | null;
  totals: { pending: number; resolved: number };
}

export async function loadReview(projectId: string, chapterId?: string): Promise<ReviewData> {
  const [project, chapters, grouped] = await Promise.all([
    db.project.findUniqueOrThrow({ where: { id: projectId }, select: { id: true, title: true, status: true } }),
    db.chapter.findMany({ where: { projectId, active: true }, orderBy: { position: "asc" }, select: { id: true, title: true, kind: true, wordCount: true } }),
    db.suggestion.groupBy({ by: ["chapterId", "kind", "status"], where: { projectId, chapter: { active: true } }, _count: true }),
  ]);
  const nav = chapters.map((c) => {
    const rows = grouped.filter((g) => g.chapterId === c.id);
    const sum = (f: (g: (typeof rows)[number]) => boolean) => rows.filter(f).reduce((n, r) => n + r._count, 0);
    return {
      ...c,
      pending: sum((g) => g.status === "PENDING"),
      accepted: sum((g) => g.kind === "edit" && (g.status === "ACCEPTED" || g.status === "MODIFIED")),
      rejected: sum((g) => g.kind === "edit" && g.status === "REJECTED"),
      notes: sum((g) => g.kind === "note"),
    };
  });
  const target = chapterId ? chapters.find((c) => c.id === chapterId) : nav.find((c) => c.pending > 0) ?? chapters[0];
  let chapter: ReviewData["chapter"] = null;
  if (target) {
    const ch = await db.chapter.findUniqueOrThrow({
      where: { id: target.id },
      include: {
        paragraphs: { orderBy: { position: "asc" }, select: { id: true, style: true, text: true, marks: true } },
        suggestions: { orderBy: [{ start: "asc" }, { createdAt: "asc" }] },
      },
    });
    const order = new Map(ch.paragraphs.map((p, i) => [p.id, i]));
    chapter = {
      id: ch.id,
      title: ch.title,
      paragraphs: ch.paragraphs.map((p) => ({ ...p, marks: (p.marks as unknown as Mark[]) ?? [] })),
      suggestions: ch.suggestions
        .map((s) => ({
          id: s.id, kind: s.kind, paragraphId: s.paragraphId, start: s.start, end: s.end, originalText: s.originalText,
          suggestedText: s.suggestedText, authorText: s.authorText, category: s.category, explanation: s.explanation,
          severity: s.severity, confidence: s.confidence, status: s.status, origin: s.origin, contribution: s.contribution,
        }))
        .sort((a, b) => (order.get(a.paragraphId ?? "") ?? -1) - (order.get(b.paragraphId ?? "") ?? -1) || a.start - b.start),
    };
  }
  const pending = nav.reduce((n, c) => n + c.pending, 0);
  const total = grouped.reduce((n, g) => n + g._count, 0);
  return { project, chapters: nav, chapter, totals: { pending, resolved: total - pending } };
}
