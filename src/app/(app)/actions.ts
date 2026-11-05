"use server";
// Server actions for the signed-in app. Every action re-checks the session and ownership.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { EditingMode, Intensity, Prisma } from "@prisma/client";
import { db, writeTransaction } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getOwnedProject } from "@/lib/projects";
import { enqueueEditJob, requestCancel, resumeJob } from "@/lib/editor/pipeline";
import { reconcile } from "@/lib/editor/ingest";
import { approveManuscript, exportDocx, exportReport, reopenEditing, ApprovalBlocked } from "@/lib/export/service";
import { exportPaperback, exportEpub, exportKindleDocx } from "@/lib/publish/service";
import { restoreVersion } from "@/lib/editor/versions";
import { audit } from "@/lib/audit";
import { deleteFile } from "@/lib/storage";
import type { StyleSheet } from "@/lib/ai/types";
import { providerInfo } from "@/lib/ai";

export type ActionState = { error?: string; message?: string } | undefined;

const MODES = ["PROOFREAD", "COPYEDIT", "LINE_EDIT", "DEVELOPMENTAL"];
const INTENSITIES = ["LIGHT", "STANDARD", "INTENSIVE"];

function styleSheetFrom(form: FormData, prev: StyleSheet = {}): StyleSheet {
  const s = (k: string) => String(form.get(k) ?? "").trim();
  return {
    ...prev,
    preserveVoice: form.get("preserveVoice") === "on",
    preserveDialect: form.get("preserveDialect") === "on",
    englishVariant: s("englishVariant") === "british" ? "british" : "american",
    serialComma: (["always", "never", "author"].includes(s("serialComma")) ? s("serialComma") : "author") as StyleSheet["serialComma"],
    dialogueStyle: s("dialogueStyle"),
    pov: s("pov"),
    tense: s("tense"),
    flashbackFormatting: s("flashbackFormatting"),
    sceneBreakStyle: s("sceneBreakStyle"),
    chapterHeadingStyle: s("chapterHeadingStyle"),
    emphasisPreference: s("emphasisPreference"),
    protectedTerms: s("protectedTerms").split(/\n|,/).map((t) => t.trim()).filter(Boolean).slice(0, 500),
    notes: s("notes").slice(0, 4000),
  };
}

function projectFields(form: FormData) {
  const formats = form.getAll("targetFormats").map(String).filter((f) => ["kindle", "paperback", "hardcover"].includes(f));
  const mode = String(form.get("editingMode") || "COPYEDIT");
  const intensity = String(form.get("intensity") || "STANDARD");
  return {
    title: String(form.get("title") || "").trim().slice(0, 300),
    authorName: String(form.get("authorName") || "").trim().slice(0, 200),
    genre: String(form.get("genre") || "").trim().slice(0, 100),
    isFiction: form.get("isFiction") !== "nonfiction",
    language: String(form.get("language") || "en-US").slice(0, 20),
    manuscriptState: String(form.get("manuscriptState") || "complete"),
    targetFormats: formats.length ? formats : ["kindle", "paperback"],
    editingMode: (MODES.includes(mode) ? mode : "COPYEDIT") as EditingMode,
    intensity: (INTENSITIES.includes(intensity) ? intensity : "STANDARD") as Intensity,
  };
}

export async function createProjectAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const f = projectFields(form);
  if (!f.title) return { error: "Give your book a title (you can change it later)." };
  if (!f.authorName) return { error: "Enter the author or pen name." };
  const p = await db.project.create({
    data: { ...f, userId: user.id, styleSheet: styleSheetFrom(form) as unknown as Prisma.InputJsonValue },
  });
  await audit("project.created", { userId: user.id, projectId: p.id });
  redirect(`/projects/${p.id}`);
}

export async function updateProjectAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const p = await getOwnedProject(String(form.get("projectId")), user.id);
  const f = projectFields(form);
  if (!f.title || !f.authorName) return { error: "Title and author name are required." };
  await db.project.update({
    where: { id: p.id },
    data: { ...f, styleSheet: styleSheetFrom(form, p.styleSheet as StyleSheet) as unknown as Prisma.InputJsonValue },
  });
  revalidatePath(`/projects/${p.id}`);
  return { message: "Settings saved. They apply to the next editing pass." };
}

export async function archiveProjectAction(form: FormData) {
  const user = await requireUser();
  const p = await getOwnedProject(String(form.get("projectId")), user.id);
  await db.project.update({ where: { id: p.id }, data: { archived: !p.archived } });
  revalidatePath("/dashboard");
}

export async function deleteProjectAction(form: FormData) {
  const user = await requireUser();
  const p = await getOwnedProject(String(form.get("projectId")), user.id);
  if (String(form.get("confirm")) !== p.title) redirect(`/projects/${p.id}/settings?deleteError=1`);
  const [sources, exports] = await Promise.all([
    db.sourceFile.findMany({ where: { projectId: p.id }, select: { storageKey: true } }),
    db.exportRecord.findMany({ where: { projectId: p.id }, select: { storageKey: true } }),
  ]);
  await db.project.delete({ where: { id: p.id } });
  await Promise.all([...sources, ...exports].map((f) => deleteFile(f.storageKey)));
  await audit("project.deleted", { userId: user.id, details: { title: p.title } });
  redirect("/dashboard");
}

export async function duplicateProjectAction(form: FormData) {
  const user = await requireUser();
  const src = await getOwnedProject(String(form.get("projectId")), user.id);
  const chapters = await db.chapter.findMany({
    where: { projectId: src.id, active: true },
    orderBy: { position: "asc" },
    include: { paragraphs: { orderBy: { position: "asc" } }, suggestions: true },
  });
  const copy = await writeTransaction(async (tx) => {
    const p = await tx.project.create({
      data: {
        userId: user.id, title: `${src.title} (copy)`, authorName: src.authorName, genre: src.genre, isFiction: src.isFiction,
        language: src.language, manuscriptState: src.manuscriptState, targetFormats: (src.targetFormats ?? []) as Prisma.InputJsonValue, editingMode: src.editingMode,
        intensity: src.intensity, styleSheet: src.styleSheet as Prisma.InputJsonValue,
        status: chapters.length ? (chapters.some((c) => c.suggestions.length) ? "AWAITING_REVIEW" : "UPLOADED") : "DRAFT",
      },
    });
    for (const ch of chapters) {
      const nc = await tx.chapter.create({ data: { projectId: p.id, position: ch.position, title: ch.title, kind: ch.kind, wordCount: ch.wordCount } });
      const idMap = new Map<string, string>();
      for (const para of ch.paragraphs) {
        const np = await tx.paragraph.create({ data: { chapterId: nc.id, position: para.position, style: para.style, text: para.text, marks: para.marks as Prisma.InputJsonValue } });
        idMap.set(para.id, np.id);
      }
      if (ch.suggestions.length)
        await tx.suggestion.createMany({
          data: ch.suggestions.map(({ id: _id, createdAt: _c, updatedAt: _u, jobId: _j, ...s }) => ({
            ...s, projectId: p.id, chapterId: nc.id, paragraphId: s.paragraphId ? idMap.get(s.paragraphId) ?? null : null,
          })),
        });
    }
    return p;
  }, { timeout: 120_000 });
  await audit("project.duplicated", { userId: user.id, projectId: copy.id, details: { from: src.id } });
  redirect(`/projects/${copy.id}`);
}

export async function startEditingAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const p = await getOwnedProject(String(form.get("projectId")), user.id);
  const mode = String(form.get("editingMode"));
  const intensity = String(form.get("intensity"));
  if (!MODES.includes(mode) || !INTENSITIES.includes(intensity)) return { error: "Choose an editing mode and intensity." };
  if (providerInfo().external && !user.aiConsentAt) {
    if (form.get("consent") !== "on") return { error: "Please confirm you're happy for your manuscript to be sent to the AI provider." };
    await db.user.update({ where: { id: user.id }, data: { aiConsentAt: new Date() } });
  }
  const chapterIds = form.getAll("chapterIds").map(String).filter(Boolean);
  try {
    await enqueueEditJob(user.id, p.id, { mode: mode as EditingMode, intensity: intensity as Intensity, chapterIds: chapterIds.length ? chapterIds : undefined });
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath(`/projects/${p.id}`);
  return { message: "The Master Editor has started. You can leave this page; progress is saved chapter by chapter." };
}

export async function cancelJobAction(form: FormData) {
  const user = await requireUser();
  const p = await getOwnedProject(String(form.get("projectId")), user.id);
  await requestCancel(p.id, String(form.get("jobId")));
  revalidatePath(`/projects/${p.id}`);
}

export async function resumeJobAction(form: FormData) {
  const user = await requireUser();
  const p = await getOwnedProject(String(form.get("projectId")), user.id);
  await resumeJob(p.id, String(form.get("jobId")));
  revalidatePath(`/projects/${p.id}`);
}

export async function reconcileAction(form: FormData) {
  const user = await requireUser();
  const p = await getOwnedProject(String(form.get("projectId")), user.id);
  const choice = String(form.get("choice"));
  if (!["replace", "add", "keep"].includes(choice)) return;
  await reconcile(user.id, p.id, String(form.get("sourceFileId")), String(form.get("key")), choice as "replace" | "add" | "keep");
  revalidatePath(`/projects/${p.id}`);
}

export async function approveAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const projectId = String(form.get("projectId"));
  try {
    await approveManuscript(user.id, projectId);
  } catch (e) {
    if (e instanceof ApprovalBlocked) return { error: e.message };
    throw e;
  }
  revalidatePath(`/projects/${projectId}`);
  return { message: "Your manuscript is approved and frozen. You can download it below." };
}

export async function reopenAction(form: FormData) {
  const user = await requireUser();
  const projectId = String(form.get("projectId"));
  await reopenEditing(user.id, projectId);
  revalidatePath(`/projects/${projectId}`);
}

export async function exportAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const projectId = String(form.get("projectId"));
  const kind = String(form.get("kind"));
  try {
    if (kind === "report") await exportReport(user.id, projectId);
    else await exportDocx(user.id, projectId, kind === "final" ? "final" : "draft");
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath(`/projects/${projectId}`);
  return { message: "Your file is ready. Download it from the list below." };
}

export async function publishExportAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const projectId = String(form.get("projectId"));
  const kind = String(form.get("kind"));
  try {
    const rec =
      kind === "paperback" ? await exportPaperback(user.id, projectId) : kind === "epub" ? await exportEpub(user.id, projectId) : kind === "kindle_docx" ? await exportKindleDocx(user.id, projectId) : null;
    if (!rec) return { error: "Unknown format." };
    revalidatePath(`/projects/${projectId}/publish`);
    return rec.isFinal
      ? { message: `${rec.filename} is ready and passed every KDP readiness check we can run. Download it below.` }
      : { message: `${rec.filename} was created, but some readiness checks failed. See the report below before uploading to KDP.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function restoreVersionAction(form: FormData) {
  const user = await requireUser();
  const projectId = String(form.get("projectId"));
  await restoreVersion(user.id, projectId, String(form.get("versionId")));
  redirect(`/projects/${projectId}/versions?restored=1`);
}

export async function updateAccountAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const name = String(form.get("name") || "").trim();
  if (!name) return { error: "Name can't be empty." };
  const data: Prisma.UserUpdateInput = { name };
  if (form.get("revokeConsent") === "on") data.aiConsentAt = null;
  await db.user.update({ where: { id: user.id }, data });
  revalidatePath("/settings");
  return { message: "Account updated." };
}

