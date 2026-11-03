// Integration test of the full Phase 1 path against a real (SQLite) database:
// upload -> edit job -> approve/reject/modify/undo -> approve manuscript -> DOCX export,
// checking the exported file itself.
import { describe, it, expect, beforeAll } from "vitest";
import mammoth from "mammoth";
import { db } from "@/lib/db";
import { ingest, reconcile } from "@/lib/editor/ingest";
import { enqueueEditJob, claimJob, runJob, resumeJob } from "@/lib/editor/pipeline";
import { decide, decideBulk, undoLast, DecisionError } from "@/lib/editor/decisions";
import { assembleManuscript, reviewCounts } from "@/lib/editor/manuscript";
import { approveManuscript, exportDocx, ApprovalBlocked, exportReport } from "@/lib/export/service";
import { restoreVersion } from "@/lib/editor/versions";
import { getOwnedProject, NotFoundError } from "@/lib/projects";
import { getFile } from "@/lib/storage";

const MANUSCRIPT = `Chapter One

“Ain't nobody could of told me that,” Dre said, grinning.

He saw the the dog , and i ran toward it. Teh sky was gray.

* * *

Morning came alot slower than he wanted.

Chapter Two

It rained. Marisol definately knew why.`;

async function makeUser(tag: string) {
  return db.user.create({ data: { email: `${tag}-${Date.now()}-${Math.random()}@test.local`, name: tag, passwordHash: "x" } });
}

async function drainJobs() {
  let id: string | null;
  while ((id = await claimJob())) await runJob(id);
}

describe("end-to-end editing workflow", () => {
  let userId: string;
  let projectId: string;

  beforeAll(async () => {
    await db.job.updateMany({ where: { status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "CANCELLED" } });
    const u = await makeUser("author");
    userId = u.id;
    const p = await db.project.create({ data: { userId, title: "The Long Night", authorName: "A. Writer", targetFormats: ["kindle"], styleSheet: {} } });
    projectId = p.id;
  });

  it("imports the manuscript and keeps the original", async () => {
    const { report, sourceFileId } = await ingest(userId, projectId, { name: "night.txt", type: "text/plain", data: Buffer.from(MANUSCRIPT) });
    expect(report.added.map((a) => a.title)).toEqual(["Chapter One", "Chapter Two"]);
    const sf = await db.sourceFile.findUniqueOrThrow({ where: { id: sourceFileId } });
    expect((await getFile(sf.storageKey)).toString()).toBe(MANUSCRIPT);
  });

  it("runs the editing job with real progress and validated suggestions", async () => {
    await enqueueEditJob(userId, projectId, { mode: "PROOFREAD", intensity: "STANDARD" });
    await drainJobs();
    const job = await db.job.findFirstOrThrow({ where: { projectId } });
    expect(job.status).toBe("SUCCEEDED");
    expect(job.doneSteps).toBe(job.totalSteps);
    const sugg = await db.suggestion.findMany({ where: { projectId, kind: "edit" }, include: { paragraph: true } });
    // every suggestion's anchor matches the source text exactly
    for (const s of sugg) expect(s.paragraph!.text.slice(s.start, s.end)).toBe(s.originalText);
    const pairs = sugg.map((s) => `${s.originalText}→${s.suggestedText}`);
    expect(pairs).toEqual(expect.arrayContaining(["Teh→The", "alot→a lot", "definately→definitely", "i→I"]));
    // dialect in dialogue is preserved by default
    expect(pairs.some((p) => p.includes("could of"))).toBe(false);
    expect((await db.project.findUniqueOrThrow({ where: { id: projectId } })).status).toBe("AWAITING_REVIEW");
  });

  it("approves, rejects, modifies and undoes, and the accepted view follows", async () => {
    const find = (o: string) => db.suggestion.findFirstOrThrow({ where: { projectId, originalText: o } });
    const teh = await find("Teh");
    const alot = await find("alot");
    const def = await find("definately");
    await decide(userId, teh.id, "accept");
    await decide(userId, alot.id, "reject");
    await decide(userId, def.id, "modify", "certainly");
    let text = (await assembleManuscript(projectId, "accepted")).flatMap((c) => c.paragraphs.map((p) => p.text)).join("\n");
    expect(text).toContain("The sky was gray.");
    expect(text).toContain("came alot slower");
    expect(text).toContain("Marisol certainly knew");
    await undoLast(userId, projectId); // undo the modify
    text = (await assembleManuscript(projectId, "accepted")).flatMap((c) => c.paragraphs.map((p) => p.text)).join("\n");
    expect(text).toContain("Marisol definately knew");
    expect((await db.suggestion.findUniqueOrThrow({ where: { id: def.id } })).status).toBe("PENDING");
  });

  it("refuses a conflicting accept", async () => {
    const teh = await db.suggestion.findFirstOrThrow({ where: { projectId, originalText: "Teh" } });
    const clash = await db.suggestion.create({
      data: { projectId, chapterId: teh.chapterId, paragraphId: teh.paragraphId, start: teh.start, end: teh.end + 4, originalText: "Teh sky", suggestedText: "The heavens", category: "style", explanation: "x" },
    });
    await expect(decide(userId, clash.id, "accept")).rejects.toThrow(DecisionError);
    await decide(userId, clash.id, "reject");
  });

  it("blocks approval until everything is resolved, then bulk-approves", async () => {
    await expect(approveManuscript(userId, projectId)).rejects.toThrow(ApprovalBlocked);
    const chapters = await db.chapter.findMany({ where: { projectId, active: true } });
    for (const c of chapters) await decideBulk(userId, c.id, "accept");
    const counts = await reviewCounts(projectId);
    expect(counts.pendingEdits).toBe(0);
    const v = await approveManuscript(userId, projectId);
    expect(v.kind).toBe("approved");
  });

  it("exports an approved DOCX that contains exactly the approved text", async () => {
    const rec = await exportDocx(userId, projectId, "final");
    expect(rec.filename).toBe("The_Long_Night_Approved_Manuscript.docx");
    const buf = await getFile(rec.storageKey);
    const raw = (await mammoth.extractRawText({ buffer: buf })).value;
    expect(raw).toContain("The sky was gray.");
    expect(raw).toContain("came alot slower"); // rejected edit not applied
    expect(raw).toContain("Marisol definitely knew");
    expect(raw).toContain("could of told me"); // author's dialect untouched
    expect(raw).not.toContain("Teh sky");
    expect((rec.validation as { result: string }[]).every((c) => c.result === "passed")).toBe(true);
    // every paragraph appears exactly once
    const approved = await assembleManuscript(projectId, "accepted");
    for (const p of approved.flatMap((c) => c.paragraphs)) {
      expect(raw.split(p.text).length - 1).toBe(1);
    }
    const report = await exportReport(userId, projectId);
    expect(report.sizeBytes).toBeGreaterThan(1000);
  });

  it("never changes the imported paragraph text", async () => {
    const paras = await db.paragraph.findMany({ where: { chapter: { projectId } }, orderBy: [{ chapter: { position: "asc" } }, { position: "asc" }] });
    expect(paras.map((p) => p.text).join("\n")).toContain("He saw the the dog , and i ran toward it. Teh sky was gray.");
  });

  it("locks decisions after approval and restores earlier versions", async () => {
    const any = await db.suggestion.findFirstOrThrow({ where: { projectId, kind: "edit" } });
    await expect(decide(userId, any.id, "reject")).rejects.toThrow(/approved/);
    const first = await db.manuscriptVersion.findFirstOrThrow({ where: { projectId, kind: "import" } });
    await restoreVersion(userId, projectId, first.id);
    const counts = await reviewCounts(projectId);
    expect(counts.acceptedEdits + counts.modifiedEdits).toBe(0);
    const text = (await assembleManuscript(projectId, "accepted")).flatMap((c) => c.paragraphs.map((p) => p.text)).join("\n");
    expect(text).toContain("Teh sky");
  });

  it("adds chapters later and asks how to reconcile a changed chapter", async () => {
    const before = await db.suggestion.count({ where: { projectId } });
    const { report, sourceFileId } = await ingest(userId, projectId, {
      pastedText: "Chapter Two\n\nIt rained hard. Marisol knew why.\n\nChapter Three\n\nNew pages.",
    });
    expect(report.added.map((a) => a.title)).toEqual(["Chapter Three"]);
    expect(report.pending.map((p) => p.existingTitle)).toEqual(["Chapter Two"]);
    await reconcile(userId, projectId, sourceFileId, report.pending[0].key, "replace");
    const chapters = await db.chapter.findMany({ where: { projectId, active: true }, orderBy: { position: "asc" } });
    expect(chapters.map((c) => c.title)).toEqual(["Chapter One", "Chapter Two", "Chapter Three"]);
    expect(await db.suggestion.count({ where: { projectId } })).toBe(before); // earlier decisions retained
  });

  it("puts newly uploaded sections where they sit in the file, not at the end", async () => {
    await ingest(userId, projectId, {
      pastedText: "Prologue\n\nBefore it all.\n\nChapter One\n\n“Ain't nobody could of told me that,” Dre said, grinning.\n\nInterlude\n\nA pause.\n\nChapter Two\n\nIt rained hard. Marisol knew why.",
    });
    const chapters = await db.chapter.findMany({ where: { projectId, active: true }, orderBy: { position: "asc" } });
    expect(chapters.map((c) => c.title)).toEqual(["Prologue", "Chapter One", "Interlude", "Chapter Two", "Chapter Three"]);
  });

  it("resumes a failed job from its last checkpoint", async () => {
    process.env.RULES_EDITOR_FAIL_ONCE = "1";
    (globalThis as { __failed?: boolean }).__failed = false;
    const job = await enqueueEditJob(userId, projectId, { mode: "PROOFREAD", intensity: "LIGHT" });
    await drainJobs(); // first chapter attempt fails once, then retry succeeds
    delete process.env.RULES_EDITOR_FAIL_ONCE;
    const done = await db.job.findUniqueOrThrow({ where: { id: job.id }, include: { steps: true } });
    expect(done.status).toBe("SUCCEEDED");
    expect(done.steps.some((s) => s.attempts > 1)).toBe(true);
    // a cancelled job can be resumed and finishes
    const j2 = await enqueueEditJob(userId, projectId, { mode: "PROOFREAD", intensity: "LIGHT" });
    await db.job.update({ where: { id: j2.id }, data: { status: "CANCELLED" } });
    await resumeJob(projectId, j2.id);
    await drainJobs();
    expect((await db.job.findUniqueOrThrow({ where: { id: j2.id } })).status).toBe("SUCCEEDED");
  });

  it("keeps each author's projects private", async () => {
    const other = await makeUser("other");
    await expect(getOwnedProject(projectId, other.id)).rejects.toThrow(NotFoundError);
    const s = await db.suggestion.findFirstOrThrow({ where: { projectId } });
    await expect(decide(other.id, s.id, "accept")).rejects.toThrow(NotFoundError);
    await expect(exportDocx(other.id, projectId, "draft")).rejects.toThrow(NotFoundError);
  });
});
