// Approve / reject / modify / undo. All decisions are persisted and auditable, and a
// decision that would make two applied edits overlap is refused, so the assembled
// manuscript can never be corrupted by approval actions.
import crypto from "node:crypto";
import type { Prisma, Suggestion, SuggestionStatus } from "@prisma/client";
import { db, writeTransaction } from "../db";
import { rangesOverlap } from "../doc/assemble";
import { getOwnedSuggestion, getOwnedChapter, getOwnedProject } from "../projects";
import { isApplied } from "./manuscript";

export type Action = "accept" | "reject" | "modify" | "reset";

export class DecisionError extends Error {
  constructor(message: string, public code: "conflict" | "invalid" | "locked") {
    super(message);
  }
}

type Tx = Prisma.TransactionClient;

async function conflictingApplied(tx: Tx, s: Pick<Suggestion, "id" | "paragraphId" | "start" | "end">) {
  if (!s.paragraphId) return null;
  const others = await tx.suggestion.findMany({
    where: { paragraphId: s.paragraphId, kind: "edit", status: { in: ["ACCEPTED", "MODIFIED"] }, id: { not: s.id } },
    select: { id: true, start: true, end: true, originalText: true },
  });
  return others.find((o) => rangesOverlap(o, s)) ?? null;
}

async function assertEditable(tx: Tx, projectId: string) {
  const p = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { status: true } });
  if (p.status === "APPROVED") {
    throw new DecisionError("This manuscript is approved. Reopen editing to change decisions.", "locked");
  }
}

function target(action: Action): SuggestionStatus {
  return action === "accept" ? "ACCEPTED" : action === "reject" ? "REJECTED" : action === "modify" ? "MODIFIED" : "PENDING";
}

export async function decide(userId: string, suggestionId: string, action: Action, authorText?: string) {
  const owned = await getOwnedSuggestion(suggestionId, userId);
  if (action === "modify") {
    if (owned.kind !== "edit") throw new DecisionError("Notes can't be modified.", "invalid");
    if (authorText === undefined) throw new DecisionError("Enter your replacement text.", "invalid");
    if (authorText.includes("\n")) throw new DecisionError("Replacement text can't contain line breaks.", "invalid");
  }
  const batchId = crypto.randomUUID();
  return writeTransaction(
    async (tx) => {
      await assertEditable(tx, owned.projectId);
      const s = await tx.suggestion.findUniqueOrThrow({ where: { id: suggestionId } });
      const to = target(action);
      if (s.kind === "edit" && isApplied(to)) {
        const c = await conflictingApplied(tx, s);
        if (c)
          throw new DecisionError(
            `This change overlaps another change you already accepted ("${c.originalText.slice(0, 60)}"). Undo that one first, or modify this one.`,
            "conflict"
          );
      }
      const newAuthorText = action === "modify" ? authorText! : action === "reset" ? null : s.authorText;
      if (s.status === to && newAuthorText === s.authorText) return s;
      await tx.decision.create({
        data: { suggestionId: s.id, userId, batchId, fromStatus: s.status, toStatus: to, fromAuthorText: s.authorText, authorText: newAuthorText },
      });
      return tx.suggestion.update({ where: { id: s.id }, data: { status: to, authorText: newAuthorText } });
    },
    { timeout: 30_000 }
  );
}

/** Accept or reject every pending suggestion in a chapter (optionally one category). */
export async function decideBulk(
  userId: string,
  chapterId: string,
  action: "accept" | "reject",
  opts: { category?: string; kind?: "edit" | "note" } = {}
) {
  const ch = await getOwnedChapter(chapterId, userId);
  const batchId = crypto.randomUUID();
  return writeTransaction(
    async (tx) => {
      await assertEditable(tx, ch.projectId);
      const pending = await tx.suggestion.findMany({
        where: {
          chapterId,
          status: "PENDING",
          ...(opts.category ? { category: opts.category } : {}),
          ...(opts.kind ? { kind: opts.kind } : {}),
        },
        orderBy: [{ paragraphId: "asc" }, { start: "asc" }],
      });
      const to = target(action);
      let changed = 0;
      const skipped: string[] = [];
      // Applied ranges accumulate as we go so two pending suggestions that overlap
      // each other are never both accepted.
      const applied = new Map<string, { start: number; end: number }[]>();
      if (action === "accept") {
        const existing = await tx.suggestion.findMany({
          where: { chapterId, kind: "edit", status: { in: ["ACCEPTED", "MODIFIED"] } },
          select: { paragraphId: true, start: true, end: true },
        });
        for (const e of existing) if (e.paragraphId) applied.set(e.paragraphId, [...(applied.get(e.paragraphId) ?? []), e]);
      }
      for (const s of pending) {
        if (action === "accept" && s.kind === "edit" && s.paragraphId) {
          const list = applied.get(s.paragraphId) ?? [];
          if (list.some((r) => rangesOverlap(r, s))) {
            skipped.push(s.id);
            continue;
          }
          list.push(s);
          applied.set(s.paragraphId, list);
        }
        await tx.decision.create({
          data: { suggestionId: s.id, userId, batchId, fromStatus: s.status, toStatus: to, fromAuthorText: s.authorText, authorText: s.authorText },
        });
        await tx.suggestion.update({ where: { id: s.id }, data: { status: to } });
        changed++;
      }
      return { changed, skipped: skipped.length, batchId };
    },
    { timeout: 60_000 }
  );
}

/** Undo the author's most recent decision (or bulk batch) in this project. */
export async function undoLast(userId: string, projectId: string) {
  await getOwnedProject(projectId, userId);
  return writeTransaction(
    async (tx) => {
      await assertEditable(tx, projectId);
      const last = await tx.decision.findFirst({
        where: { userId, undone: false, suggestion: { projectId } },
        orderBy: { createdAt: "desc" },
      });
      if (!last) return { undone: 0 };
      const batch = await tx.decision.findMany({
        where: { batchId: last.batchId, undone: false },
        include: { suggestion: true },
      });
      for (const d of batch) {
        if (isApplied(d.fromStatus) && d.suggestion.kind === "edit") {
          const c = await conflictingApplied(tx, d.suggestion);
          if (c) throw new DecisionError("Undo would create overlapping accepted changes. Resolve the overlap first.", "conflict");
        }
        await tx.suggestion.update({ where: { id: d.suggestionId }, data: { status: d.fromStatus, authorText: d.fromAuthorText } });
        await tx.decision.update({ where: { id: d.id }, data: { undone: true } });
      }
      return { undone: batch.length };
    },
    { timeout: 60_000 }
  );
}
