// Publishing through the service layer against the real (SQLite) database: settings are
// validated and owned, previews work on drafts, final files only come from an approved version.
import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@/lib/db";
import { ingest } from "@/lib/editor/ingest";
import { approveManuscript, ApprovalBlocked } from "@/lib/export/service";
import { NotFoundError } from "@/lib/projects";
import { getFile } from "@/lib/storage";
import { savePublishing, previewLayout, exportPaperback, exportEpub, exportKindleDocx, SettingsError } from "@/lib/publish/service";
import type { ReadinessReport } from "@/lib/publish/checks";

const TEXT = Array.from({ length: 12 }, (_, i) =>
  [`Chapter ${i + 1}`, "", ...Array.from({ length: 40 }, (_, j) => `Paragraph ${j + 1} of chapter ${i + 1}. The tide came in slowly over the flats, the way it always had, and nobody on the quay looked up. “You’re late,” she said, without turning around.`)].join("\n\n")
).join("\n\n");

async function makeUser(tag: string) {
  return db.user.create({ data: { email: `${tag}-${Date.now()}-${Math.random()}@test.local`, name: tag, passwordHash: "x" } });
}

describe("publishing service", () => {
  let userId: string;
  let projectId: string;
  beforeAll(async () => {
    userId = (await makeUser("pub")).id;
    projectId = (await db.project.create({ data: { userId, title: "Tide Clock", authorName: "A. Writer", targetFormats: ["kindle", "paperback"], styleSheet: {} } })).id;
    await ingest(userId, projectId, { name: "tide.txt", type: "text/plain", data: Buffer.from(TEXT) });
  });

  it("validates and stores settings, and only for the owner", async () => {
    await expect(savePublishing(userId, projectId, { layout: { trim: "13x13" } })).rejects.toBeInstanceOf(SettingsError);
    const saved = await savePublishing(userId, projectId, { layout: { trim: "5.5x8.5", template: "modern" }, details: { copyright: "Copyright © 2026 A. Writer" } });
    expect(saved.layout.trim).toBe("5.5x8.5");
    expect(saved.details.copyright).toContain("A. Writer");
    // partial update keeps the rest
    const again = await savePublishing(userId, projectId, { details: { dedication: "For R." } });
    expect(again.layout.template).toBe("modern");
    expect(again.details.copyright).toContain("A. Writer");
    const other = await makeUser("intruder");
    await expect(savePublishing(other.id, projectId, { layout: { trim: "6x9" } })).rejects.toBeInstanceOf(NotFoundError);
    await expect(previewLayout(other.id, projectId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("previews the draft but refuses final files until the manuscript is approved", async () => {
    const p = await previewLayout(userId, projectId);
    expect(p.source.approved).toBe(false);
    expect(p.layout.trim.id).toBe("5.5x8.5");
    await expect(exportPaperback(userId, projectId)).rejects.toBeInstanceOf(ApprovalBlocked);
    await expect(exportEpub(userId, projectId)).rejects.toBeInstanceOf(ApprovalBlocked);
    await expect(exportKindleDocx(userId, projectId)).rejects.toBeInstanceOf(ApprovalBlocked);
  });

  it("creates the paperback PDF, Kindle EPUB and Kindle DOCX from the approved version, with readiness reports", async () => {
    const v = await approveManuscript(userId, projectId);
    const pdf = await exportPaperback(userId, projectId);
    expect(pdf.filename).toBe("Tide_Clock_Paperback_5.5x8.5.pdf");
    expect(pdf.versionId).toBe(v.id);
    const r = pdf.validation as unknown as ReadinessReport;
    expect(r.checks.filter((c) => c.status === "failed").map((c) => c.id)).toEqual([]);
    expect(pdf.isFinal).toBe(true);
    expect((await getFile(pdf.storageKey)).subarray(0, 5).toString()).toBe("%PDF-");

    const epub = await exportEpub(userId, projectId);
    expect(epub.filename).toBe("Tide_Clock_Kindle.epub");
    const er = epub.validation as unknown as ReadinessReport;
    expect(er.checks.filter((c) => c.status === "failed")).toEqual([]);
    const official = er.checks.find((c) => c.id === "epub.epubcheck")!;
    // CI installs EPUBCheck and requires a clean pass; locally it may honestly say "not checked".
    if (process.env.REQUIRE_EPUBCHECK) expect(official, official.detail).toMatchObject({ status: "passed" });
    else expect(["passed", "not_checked"]).toContain(official.status);
    expect(er.officialTools.some((t) => t.url.includes("kdp.amazon.com"))).toBe(true);

    const docx = await exportKindleDocx(userId, projectId);
    expect(docx.filename).toBe("Tide_Clock_Kindle.docx");
    expect((docx.validation as unknown as ReadinessReport).ok).toBe(true);
  });

  it("never changes the author's imported text", async () => {
    const paras = await db.paragraph.findMany({ where: { chapter: { projectId } }, select: { text: true } });
    expect(paras.some((p) => p.text.includes("The tide came in slowly"))).toBe(true);
    const src = await db.sourceFile.findFirst({ where: { projectId } });
    expect((await getFile(src!.storageKey)).toString()).toBe(TEXT);
  });
});
