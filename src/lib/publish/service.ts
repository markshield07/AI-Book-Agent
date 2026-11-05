// Publishing service: settings, previews and the three KDP exports (paperback PDF, Kindle
// EPUB, Kindle DOCX). Final files come only from the frozen approved version; previews may use
// the current draft so the author can design while still editing.
import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { getOwnedProject } from "../projects";
import { audit } from "../audit";
import { newStorageKey, putFile } from "../storage";
import { assembleManuscript, type SnapshotChapter } from "../editor/manuscript";
import { ApprovalBlocked, safeFileStem } from "../export/service";
import { countWords } from "../doc/model";
import { buildBook, type Book } from "./book";
import { readPublishing, PublishingSchema, type Publishing } from "./settings";
import { layoutBook, type Layout } from "./layout";
import { renderPdf } from "./pdf";
import { buildEpub, validateEpub } from "./epub";
import { runEpubcheck } from "./epubcheck";
import { buildKindleDocx, checkKindleDocx } from "./kindle-docx";
import { checkPaperback } from "./paperback-check";
import { summarize, type ReadinessReport } from "./checks";
import { KDP_LINKS, type Ink, type Paper } from "./kdp";

export type Source = { chapters: SnapshotChapter[]; versionId: string | null; label: string; approved: boolean; key: string };

type ProjectRow = Awaited<ReturnType<typeof getOwnedProject>>;

/** The approved version when there is one (and the project is approved); otherwise the current draft. */
export async function publishSource(project: ProjectRow, require: "approved" | "any"): Promise<Source> {
  const v = await db.manuscriptVersion.findFirst({ where: { projectId: project.id, kind: "approved" }, orderBy: { number: "desc" } });
  if (v && project.status === "APPROVED") {
    return { chapters: v.snapshot as unknown as SnapshotChapter[], versionId: v.id, label: `Approved version ${v.number}`, approved: true, key: `v:${v.id}` };
  }
  if (require === "approved") throw new ApprovalBlocked("Approve the manuscript before creating publishing files. You can preview the layout now; downloads unlock once every edit is decided and the manuscript is approved.");
  const chapters = await assembleManuscript(project.id, "accepted");
  const hash = crypto.createHash("sha1").update(JSON.stringify(chapters)).digest("hex");
  return { chapters, versionId: null, label: "Current draft (accepted edits applied)", approved: false, key: `d:${hash}` };
}

export async function getPublishing(userId: string, projectId: string): Promise<{ project: ProjectRow; pub: Publishing }> {
  const project = await getOwnedProject(projectId, userId);
  return { project, pub: readPublishing(project.publishing) };
}

export async function savePublishing(userId: string, projectId: string, input: unknown): Promise<Publishing> {
  const project = await getOwnedProject(projectId, userId);
  const current = readPublishing(project.publishing);
  const r = PublishingSchema.safeParse({
    layout: { ...current.layout, ...((input as { layout?: object })?.layout ?? {}) },
    details: { ...current.details, ...((input as { details?: object })?.details ?? {}) },
  });
  if (!r.success) throw new SettingsError(r.error.issues[0]?.message ?? "Invalid settings");
  const pub = readPublishing(r.data);
  await db.project.update({ where: { id: projectId }, data: { publishing: pub as unknown as Prisma.InputJsonValue } });
  await audit("publishing.updated", { userId, projectId });
  return pub;
}

export class SettingsError extends Error {}

function bookFor(project: ProjectRow, src: Source, pub: Publishing): Book {
  return buildBook(src.chapters, project, pub);
}

// Small in-memory cache so paging through the preview doesn't re-run the layout.
const layoutCache = new Map<string, { layout: Layout; book: Book; at: number }>();
const CACHE_MAX = 6;

export async function previewLayout(userId: string, projectId: string): Promise<{ layout: Layout; book: Book; source: Source; pub: Publishing }> {
  const { project, pub } = await getPublishing(userId, projectId);
  const source = await publishSource(project, "any");
  const key = `${projectId}|${source.key}|${project.title}|${project.authorName}|${project.language}|${JSON.stringify(pub)}`;
  const hit = layoutCache.get(key);
  if (hit) {
    hit.at = Date.now();
    return { layout: hit.layout, book: hit.book, source, pub };
  }
  const book = bookFor(project, source, pub);
  const layout = layoutBook({ book, settings: pub.layout, isFiction: project.isFiction });
  layoutCache.set(key, { layout, book, at: Date.now() });
  if (layoutCache.size > CACHE_MAX) {
    const oldest = [...layoutCache.entries()].sort((a, b) => a[1].at - b[1].at)[0][0];
    layoutCache.delete(oldest);
  }
  return { layout, book, source, pub };
}

/** Words the ebook body should contain: every block except the half-title, TOC and part pages (whose title is the heading). */
export function ebookWords(book: Book): number {
  return book.sections
    .filter((s) => s.role !== "half-title" && s.role !== "toc" && s.role !== "part")
    .reduce((n, s) => n + s.blocks.reduce((k, b) => k + (b.type === "scene" ? 0 : countWords(b.runs.map((r) => r.text).join(""))), 0), 0);
}

export function kindleDocxWords(book: Book): number {
  const headings = book.sections.filter((s) => (!s.display || s.role === "part") && s.role !== "half-title" && s.role !== "toc").reduce((n, s) => n + countWords(s.title), 0);
  return ebookWords(book) + headings;
}

const OFFICIAL_PRINT = [
  { label: "KDP paperback formatting guide", url: KDP_LINKS.paperbackFormatting },
  { label: "KDP page count limits", url: KDP_LINKS.pageLimits },
  { label: "Format your paperback (KDP help), then check every page in KDP's print previewer during upload", url: KDP_LINKS.formatPaperback },
];
const OFFICIAL_EBOOK = [
  { label: "Check it in Kindle Previewer (free from Amazon)", url: KDP_LINKS.kindlePreviewer },
  { label: "KDP ebook formatting guide", url: KDP_LINKS.ebookFormatting },
  { label: "Upload and preview book content on KDP", url: KDP_LINKS.uploadPreview },
  { label: "Kindle Create (to make a KPF file, optional)", url: KDP_LINKS.kindleCreate },
];

/** Checks that mean the file itself is broken, not just "not ready for KDP yet". */
const HARD_FAILURES = new Set(["pdf.structure", "pdf.pages", "layout.words", "epub.package", "epub.xml", "epub.words", "docx.opens", "docx.words"]);

async function save(
  userId: string,
  projectId: string,
  src: Source,
  format: "paperback_pdf" | "kindle_epub" | "kindle_docx",
  filename: string,
  buf: Buffer,
  report: ReadinessReport,
  config: Record<string, unknown>
) {
  const hard = report.checks.filter((c) => c.status === "failed" && HARD_FAILURES.has(c.id));
  if (hard.length) {
    await audit("export.failed", { userId, projectId, details: { format, checks: hard as never } });
    throw new Error(`The file failed verification (${hard.map((c) => c.label.toLowerCase()).join("; ")}). Nothing was saved; please try again or tell us what happened.`);
  }
  const key = newStorageKey("export");
  await putFile(key, buf);
  const rec = await db.exportRecord.create({
    data: {
      projectId,
      versionId: src.versionId,
      format,
      filename,
      storageKey: key,
      sizeBytes: buf.length,
      isFinal: report.ok,
      config: config as Prisma.InputJsonValue,
      validation: report as unknown as Prisma.InputJsonValue,
    },
  });
  await audit("export.created", { userId, projectId, details: { exportId: rec.id, format, ok: report.ok } });
  return rec;
}

export async function exportPaperback(userId: string, projectId: string) {
  const { project, pub } = await getPublishing(userId, projectId);
  const src = await publishSource(project, "approved");
  const book = bookFor(project, src, pub);
  const layout = layoutBook({ book, settings: pub.layout, isFiction: project.isFiction });
  const pdf = await renderPdf(layout, { title: project.title, author: project.authorName });
  const checks = await checkPaperback(pdf, layout, { ink: pub.layout.ink as Ink, paper: pub.layout.paper as Paper, title: project.title });
  const report = summarize("paperback", checks, OFFICIAL_PRINT);
  const filename = `${safeFileStem(project.title)}_Paperback_${layout.trim.id}.pdf`;
  return save(userId, projectId, src, "paperback_pdf", filename, pdf, report, {
    trim: layout.trim.id,
    bleed: layout.bleed,
    ink: pub.layout.ink,
    paper: pub.layout.paper,
    template: layout.template,
    pages: layout.pages.length,
    margins: layout.margins,
  });
}

export async function exportEpub(userId: string, projectId: string) {
  const { project, pub } = await getPublishing(userId, projectId);
  const src = await publishSource(project, "approved");
  const book = bookFor(project, src, pub);
  const { buf } = await buildEpub(book, { projectId, template: pub.layout.template, isFiction: project.isFiction });
  const checks = [...(await validateEpub(buf, ebookWords(book))), await runEpubcheck(buf)];
  const report = summarize("ebook", checks, OFFICIAL_EBOOK);
  return save(userId, projectId, src, "kindle_epub", `${safeFileStem(project.title)}_Kindle.epub`, buf, report, { template: pub.layout.template ?? null });
}

export async function exportKindleDocx(userId: string, projectId: string) {
  const { project, pub } = await getPublishing(userId, projectId);
  const src = await publishSource(project, "approved");
  const book = bookFor(project, src, pub);
  const buf = await buildKindleDocx(book);
  const checks = await checkKindleDocx(buf, book, kindleDocxWords(book));
  const report = summarize("kindle_docx", checks, OFFICIAL_EBOOK);
  return save(userId, projectId, src, "kindle_docx", `${safeFileStem(project.title)}_Kindle.docx`, buf, report, {});
}

export const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  epub: "application/epub+zip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
