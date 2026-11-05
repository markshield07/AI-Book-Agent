// The Auditor's race-condition tests: double-clicks, two tabs, and a script hammering the API
// must never corrupt the manuscript (two overlapping edits both applied, lost decisions).
import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@/lib/db";
import { ingest } from "@/lib/editor/ingest";
import { decide, decideBulk, undoLast } from "@/lib/editor/decisions";
import { rangesOverlap } from "@/lib/doc/assemble";

let userId: string;
let projectId: string;
let chapterId: string;
let paragraphId: string;

async function overlappingPair(i: number) {
  const base = { projectId, chapterId, paragraphId, category: "style", explanation: "race" };
  const a = await db.suggestion.create({ data: { ...base, start: 0, end: 7, originalText: "Racing ", suggestedText: `R${i} ` } });
  const b = await db.suggestion.create({ data: { ...base, start: 3, end: 10, originalText: "ing the", suggestedText: `X${i}` } });
  return [a, b];
}

async function appliedOverlaps() {
  const applied = await db.suggestion.findMany({ where: { paragraphId, kind: "edit", status: { in: ["ACCEPTED", "MODIFIED"] } } });
  let n = 0;
  for (let i = 0; i < applied.length; i++) for (let j = i + 1; j < applied.length; j++) if (rangesOverlap(applied[i], applied[j])) n++;
  return n;
}

beforeAll(async () => {
  const u = await db.user.create({ data: { email: `race-${Date.now()}@test.local`, name: "race", passwordHash: "x" } });
  userId = u.id;
  const p = await db.project.create({ data: { userId, title: "Race", authorName: "R", targetFormats: ["kindle"], styleSheet: {} } });
  projectId = p.id;
  await ingest(userId, projectId, { name: "r.txt", type: "text/plain", data: Buffer.from("Chapter 1\n\nRacing the clock, she ran.") });
  const para = await db.paragraph.findFirstOrThrow({ where: { chapter: { projectId } } });
  paragraphId = para.id;
  chapterId = para.chapterId;
});

describe("concurrent decisions", () => {
  it("never applies two overlapping edits when both are accepted at the same moment", async () => {
    for (let i = 0; i < 15; i++) {
      const [a, b] = await overlappingPair(i);
      const results = await Promise.allSettled([decide(userId, a.id, "accept"), decide(userId, b.id, "accept")]);
      expect(results.some((r) => r.status === "fulfilled")).toBe(true);
      expect(await appliedOverlaps()).toBe(0);
      await db.suggestion.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { status: "REJECTED" } });
    }
  }, 120_000);

  it("survives a burst of mixed clicks on one suggestion with a consistent history", async () => {
    const [a] = await overlappingPair(99);
    const actions = ["accept", "reject", "accept", "reset", "reject", "accept", "reject", "reset", "accept", "accept"] as const;
    await Promise.allSettled(actions.map((act) => decide(userId, a.id, act)));
    const s = await db.suggestion.findUniqueOrThrow({ where: { id: a.id } });
    const history = await db.decision.findMany({ where: { suggestionId: a.id }, orderBy: { createdAt: "asc" } });
    // The decision log must chain: each step starts where the previous one ended, and ends at the current status.
    for (let i = 1; i < history.length; i++) expect(history[i].fromStatus).toBe(history[i - 1].toStatus);
    if (history.length) expect(history[history.length - 1].toStatus).toBe(s.status);
  }, 60_000);

  it("bulk accept racing a single accept never double-applies", async () => {
    await db.suggestion.updateMany({ where: { projectId }, data: { status: "REJECTED" } });
    const [a, b] = await overlappingPair(7);
    await Promise.allSettled([decideBulk(userId, chapterId, "accept"), decide(userId, b.id, "accept"), undoLast(userId, projectId)]);
    expect(await appliedOverlaps()).toBe(0);
    void a;
  }, 60_000);
});
