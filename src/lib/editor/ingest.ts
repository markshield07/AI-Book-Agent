// Stage 1 (ingestion): store the original file immutably, parse it, and add chapters.
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { importManuscript, importPlainText, extensionOf } from "../doc/import";
import { chapterWordCount, type DocChapter, type ImportResult } from "../doc/model";
import { newStorageKey, putFile, sha256 } from "../storage";
import { createVersion } from "./manuscript";
import { audit } from "../audit";

export interface PendingReconcile {
  key: string;
  existingChapterId: string;
  existingTitle: string;
  chapter: DocChapter;
}

export interface IngestReport {
  detectedTitle: string | null;
  warnings: ImportResult["warnings"];
  stats: ImportResult["stats"];
  added: { title: string; words: number }[];
  unchanged: string[];
  pending: PendingReconcile[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const chapterText = (c: { paragraphs: { text: string }[] }) => c.paragraphs.map((p) => p.text).join("\n");

async function insertChapter(
  tx: Prisma.TransactionClient,
  projectId: string,
  sourceFileId: string,
  ch: DocChapter,
  position: number
) {
  const created = await tx.chapter.create({
    data: { projectId, sourceFileId, position, title: ch.title.slice(0, 300), kind: ch.kind, wordCount: chapterWordCount(ch) },
  });
  await tx.paragraph.createMany({
    data: ch.paragraphs.map((p, i) => ({
      chapterId: created.id,
      position: i,
      style: p.style,
      text: p.text,
      marks: p.marks as unknown as Prisma.InputJsonValue,
    })),
  });
  return created;
}

export async function ingest(
  userId: string,
  projectId: string,
  file: { name: string; type: string; data: Buffer } | { pastedText: string }
): Promise<{ sourceFileId: string; report: IngestReport }> {
  let result: ImportResult;
  let name: string;
  let mime: string;
  let data: Buffer;
  if ("pastedText" in file) {
    name = "pasted-text.txt";
    mime = "text/plain";
    data = Buffer.from(file.pastedText, "utf8");
    result = importPlainText(file.pastedText);
  } else {
    name = file.name.replace(/[\\/]/g, "_").slice(0, 200);
    mime = file.type || "application/octet-stream";
    data = file.data;
    result = await importManuscript(name, data); // throws ImportError with an author-facing message
  }

  const key = newStorageKey("source");
  await putFile(key, data);

  const existing = await db.chapter.findMany({
    where: { projectId, active: true },
    orderBy: { position: "asc" },
    include: { paragraphs: { orderBy: { position: "asc" }, select: { text: true } } },
  });
  const report: IngestReport = {
    detectedTitle: result.detectedTitle,
    warnings: result.warnings,
    stats: result.stats,
    added: [],
    unchanged: [],
    pending: [],
  };

  const sf = await db.$transaction(async (tx) => {
    const sf = await tx.sourceFile.create({
      data: { projectId, originalName: name, mimeType: mime, sizeBytes: data.length, sha256: sha256(data), storageKey: key, importReport: {} },
    });
    const matchOf = (ch: DocChapter) => existing.find((e) => norm(e.title) === norm(ch.title) && ch.title !== "Chapter 1");
    // New sections go where they sit in the uploaded file: right after the previous section
    // the book already has, or before the first one if they come first. A file with no
    // overlap at all is appended at the end.
    const anyMatch = result.chapters.some((ch) => matchOf(ch));
    let anchor: number | null = null; // position of the last section placed or matched
    for (const ch of result.chapters) {
      const match = matchOf(ch);
      if (match) {
        anchor = (await tx.chapter.findUniqueOrThrow({ where: { id: match.id }, select: { position: true } })).position;
        if (chapterText(match) === chapterText(ch)) {
          report.unchanged.push(ch.title);
          continue;
        }
        // A new version of an existing chapter: ask the author how to reconcile.
        report.pending.push({ key: `${sf.id}:${report.pending.length}`, existingChapterId: match.id, existingTitle: match.title, chapter: ch });
        continue;
      }
      let position: number;
      if (anchor !== null) position = anchor + 1;
      else if (anyMatch) position = existing[0].position;
      else position = ((await tx.chapter.aggregate({ where: { projectId }, _max: { position: true } }))._max.position ?? -1) + 1;
      await tx.chapter.updateMany({ where: { projectId, position: { gte: position } }, data: { position: { increment: 1 } } });
      await insertChapter(tx, projectId, sf.id, ch, position);
      anchor = position;
      report.added.push({ title: ch.title, words: chapterWordCount(ch) });
    }
    await tx.sourceFile.update({ where: { id: sf.id }, data: { importReport: report as unknown as Prisma.InputJsonValue } });
    const project = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
    if (project.status === "DRAFT") await tx.project.update({ where: { id: projectId }, data: { status: "UPLOADED" } });
    else if (project.status === "APPROVED" && report.added.length)
      await tx.project.update({ where: { id: projectId }, data: { status: "AWAITING_REVIEW" } });
    return sf;
  }, { timeout: 120_000 });

  if (report.added.length) await createVersion(projectId, "import", `Imported ${name}`);
  await audit("manuscript.uploaded", { userId, projectId, details: { file: name, ext: extensionOf(name), added: report.added.length, pending: report.pending.length } });
  return { sourceFileId: sf.id, report };
}

/** Resolve a re-uploaded chapter: replace the old one, add it as a new chapter, or keep the old. */
export async function reconcile(userId: string, projectId: string, sourceFileId: string, key: string, choice: "replace" | "add" | "keep") {
  const sf = await db.sourceFile.findFirst({ where: { id: sourceFileId, projectId, project: { userId } } });
  if (!sf) throw new Error("Not found");
  const report = sf.importReport as unknown as IngestReport;
  const item = report.pending.find((p) => p.key === key);
  if (!item) return;
  await db.$transaction(async (tx) => {
    if (choice === "replace") {
      const old = await tx.chapter.findFirstOrThrow({ where: { id: item.existingChapterId, projectId } });
      // Old chapter (and its decisions) is kept for history but leaves the manuscript.
      await tx.chapter.update({ where: { id: old.id }, data: { active: false } });
      await tx.chapter.updateMany({ where: { projectId, position: { gt: old.position } }, data: { position: { increment: 1 } } });
      const created = await insertChapter(tx, projectId, sf.id, item.chapter, old.position + 1);
      await tx.chapter.update({ where: { id: old.id }, data: { supersededById: created.id } });
    } else if (choice === "add") {
      const last = await tx.chapter.findFirst({ where: { projectId }, orderBy: { position: "desc" } });
      await insertChapter(tx, projectId, sf.id, item.chapter, (last?.position ?? -1) + 1);
    }
    report.pending = report.pending.filter((p) => p.key !== key);
    if (choice !== "keep") report.added.push({ title: item.chapter.title, words: chapterWordCount(item.chapter) });
    await tx.sourceFile.update({ where: { id: sf.id }, data: { importReport: report as unknown as Prisma.InputJsonValue } });
  });
  if (choice !== "keep") await createVersion(projectId, "import", `${choice === "replace" ? "Replaced" : "Added"} "${item.chapter.title}"`);
  await audit("chapter.reconciled", { userId, projectId, details: { title: item.chapter.title, choice } });
}
