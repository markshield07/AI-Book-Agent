// Project-level authorisation. Every project lookup goes through these helpers, which
// always filter by owner, so one author can never load another author's project.
import { db } from "./db";

export class NotFoundError extends Error {
  constructor() {
    super("Not found");
  }
}

export async function getOwnedProject(projectId: string, userId: string) {
  const p = await db.project.findFirst({ where: { id: projectId, userId } });
  if (!p) throw new NotFoundError();
  return p;
}

export async function getOwnedChapter(chapterId: string, userId: string) {
  const c = await db.chapter.findFirst({ where: { id: chapterId, project: { userId } } });
  if (!c) throw new NotFoundError();
  return c;
}

export async function getOwnedSuggestion(suggestionId: string, userId: string) {
  const s = await db.suggestion.findFirst({ where: { id: suggestionId, project: { userId } } });
  if (!s) throw new NotFoundError();
  return s;
}

export const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  UPLOADED: "Uploaded",
  ANALYZING: "Analyzing",
  EDITING: "Editing in progress",
  AWAITING_REVIEW: "Awaiting your review",
  REVISIONS_REQUESTED: "Revisions requested",
  APPROVED: "Approved",
  FORMATTING: "Formatting",
  READY: "Ready for download",
  EXPORT_FAILED: "Export failed",
};

export const MODE_LABEL: Record<string, string> = {
  PROOFREAD: "Proofreading",
  COPYEDIT: "Copyediting",
  LINE_EDIT: "Line editing",
  DEVELOPMENTAL: "Developmental review",
};

export const INTENSITY_LABEL: Record<string, string> = { LIGHT: "Light", STANDARD: "Standard", INTENSIVE: "Intensive" };
