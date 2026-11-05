import { db } from "../db";
import { newStorageKey, putFile } from "../storage";
import { assembleManuscript, createVersion, reviewCounts, type SnapshotChapter } from "../editor/manuscript";
import { buildManuscriptDocx, verifyDocx } from "./docx";
import { buildReportDocx } from "./report";
import { getOwnedProject } from "../projects";
import { audit } from "../audit";

export function safeFileStem(title: string): string {
  const stem = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return stem.slice(0, 80) || "Manuscript";
}

export class ApprovalBlocked extends Error {}

/** Freeze an approved text version. Requires every suggestion and note to be resolved. */
export async function approveManuscript(userId: string, projectId: string) {
  const project = await getOwnedProject(projectId, userId);
  const c = await reviewCounts(projectId);
  const running = await db.job.findFirst({ where: { projectId, status: { in: ["QUEUED", "RUNNING"] } } });
  if (running) throw new ApprovalBlocked("The editor is still working on this book.");
  if (c.pendingEdits > 0 || c.pendingNotes > 0)
    throw new ApprovalBlocked(
      `${[
        c.pendingEdits ? `${c.pendingEdits} suggested edit${c.pendingEdits === 1 ? "" : "s"}` : "",
        c.pendingNotes ? `${c.pendingNotes} editorial note${c.pendingNotes === 1 ? "" : "s"}` : "",
      ].filter(Boolean).join(" and ")} still need${c.pendingEdits + c.pendingNotes === 1 ? "s" : ""} a decision. Open Review changes to finish them.`
    );
  const chapters = await db.chapter.count({ where: { projectId, active: true } });
  if (chapters === 0) throw new ApprovalBlocked("There is no manuscript to approve yet.");
  const version = await createVersion(projectId, "approved", `Approved manuscript`);
  await db.project.update({ where: { id: project.id }, data: { status: "APPROVED" } });
  await audit("manuscript.approved", { userId, projectId, details: { versionId: version.id, number: version.number } });
  return version;
}

export async function reopenEditing(userId: string, projectId: string) {
  await getOwnedProject(projectId, userId);
  await db.project.update({ where: { id: projectId }, data: { status: "AWAITING_REVIEW" } });
  await audit("manuscript.reopened", { userId, projectId });
}

/**
 * Export the manuscript as DOCX. Final exports come only from a frozen approved
 * version; otherwise a clearly labelled draft is produced with pending edits NOT applied.
 */
export async function exportDocx(userId: string, projectId: string, kind: "final" | "draft") {
  const project = await getOwnedProject(projectId, userId);
  let chapters: SnapshotChapter[];
  let versionId: string;
  let label: string;
  let draftNote: string | undefined;
  if (kind === "final") {
    const v = await db.manuscriptVersion.findFirst({ where: { projectId, kind: "approved" }, orderBy: { number: "desc" } });
    if (!v || project.status !== "APPROVED") throw new ApprovalBlocked("Approve the manuscript before downloading the final version.");
    chapters = v.snapshot as unknown as SnapshotChapter[];
    versionId = v.id;
    label = `Approved version ${v.number}`;
  } else {
    const c = await reviewCounts(projectId);
    const v = await createVersion(projectId, "checkpoint", "Draft download");
    chapters = v.snapshot as unknown as SnapshotChapter[];
    versionId = v.id;
    label = `Draft (version ${v.number})`;
    draftNote = `Edited draft. ${c.pendingEdits} suggested edit${c.pendingEdits === 1 ? " is" : "s are"} still awaiting review and ${
      c.pendingEdits === 1 ? "is" : "are"
    } not applied. Not a final manuscript.`;
  }
  const buf = await buildManuscriptDocx(chapters, { title: project.title, authorName: project.authorName, draftNote, versionLabel: label });
  const checks = await verifyDocx(buf, chapters);
  const ok = checks.every((c) => c.result !== "failed");
  const stem = safeFileStem(project.title);
  const filename = kind === "final" ? `${stem}_Approved_Manuscript.docx` : `${stem}_Edited_Draft.docx`;
  if (!ok) {
    await audit("export.failed", { userId, projectId, details: { checks: checks as never } });
    throw new Error("The exported file failed verification. Nothing was saved; please try again or contact support.");
  }
  const key = newStorageKey("export");
  await putFile(key, buf);
  const rec = await db.exportRecord.create({
    data: {
      projectId,
      versionId,
      format: kind === "final" ? "docx_approved" : "docx_draft",
      filename,
      storageKey: key,
      sizeBytes: buf.length,
      isFinal: kind === "final",
      config: { template: "standard-manuscript", font: "Times New Roman 12pt", spacing: "double" },
      validation: checks as never,
    },
  });
  await audit("export.created", { userId, projectId, details: { exportId: rec.id, format: rec.format } });
  return rec;
}

export async function exportReport(userId: string, projectId: string) {
  const project = await getOwnedProject(projectId, userId);
  const buf = await buildReportDocx(projectId, project);
  const key = newStorageKey("export");
  await putFile(key, buf);
  const latest = await db.manuscriptVersion.findFirst({ where: { projectId }, orderBy: { number: "desc" } });
  return db.exportRecord.create({
    data: {
      projectId,
      versionId: latest?.id,
      format: "editorial_report",
      filename: `${safeFileStem(project.title)}_Editorial_Report.docx`,
      storageKey: key,
      sizeBytes: buf.length,
      isFinal: false,
      config: {},
      validation: [],
    },
  });
}

export { assembleManuscript };
