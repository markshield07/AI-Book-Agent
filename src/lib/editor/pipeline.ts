// Stages 2-4: manuscript analysis and chapter-by-chapter editing, run as a durable job.
// Each chapter is a checkpoint (JobStep); a failed or interrupted job resumes from the
// first unfinished chapter. Progress shown to authors is the real step count.
import type { EditingMode, Intensity, Job, Prisma } from "@prisma/client";
import { db } from "../db";
import { getProvider, providerInfo } from "../ai";
import { ProviderError, type ProjectContext, type StyleSheet, type ChunkParagraph } from "../ai/types";
import { countWords } from "../doc/model";
import { validateSuggestions, type ParagraphRef } from "./validate";
import { audit } from "../audit";

const CHUNK_WORDS = Number(process.env.EDIT_CHUNK_WORDS || 2500);
const ANALYSIS_WORD_BUDGET = Number(process.env.ANALYSIS_WORD_BUDGET || 150_000);
const MAX_ATTEMPTS = 3;

export async function enqueueEditJob(
  userId: string,
  projectId: string,
  opts: { mode: EditingMode; intensity: Intensity; chapterIds?: string[] }
): Promise<Job> {
  const running = await db.job.findFirst({ where: { projectId, status: { in: ["QUEUED", "RUNNING"] } } });
  if (running) throw new Error("An editing job is already running for this book.");
  const chapters = await db.chapter.findMany({
    where: { projectId, active: true, ...(opts.chapterIds ? { id: { in: opts.chapterIds } } : {}) },
    orderBy: { position: "asc" },
    select: { id: true },
  });
  if (chapters.length === 0) throw new Error("Upload a manuscript before starting the editor.");
  const info = providerInfo();
  const job = await db.job.create({
    data: {
      projectId,
      editingMode: opts.mode,
      intensity: opts.intensity,
      provider: info.name,
      model: info.model,
      totalSteps: chapters.length + 1,
      steps: {
        create: [
          { kind: "analysis", position: 0 },
          ...chapters.map((c, i) => ({ kind: "chapter", chapterId: c.id, position: i + 1 })),
        ],
      },
    },
  });
  await db.project.update({ where: { id: projectId }, data: { status: "ANALYZING", editingMode: opts.mode, intensity: opts.intensity } });
  await audit("job.queued", { userId, projectId, details: { jobId: job.id, mode: opts.mode, provider: info.name, model: info.model } });
  return job;
}

export async function requestCancel(projectId: string, jobId: string) {
  await db.job.updateMany({ where: { id: jobId, projectId, status: { in: ["QUEUED", "RUNNING"] } }, data: { cancelRequested: true } });
  // A queued job that no worker has picked up can be cancelled immediately.
  await db.job.updateMany({ where: { id: jobId, projectId, status: "QUEUED" }, data: { status: "CANCELLED", finishedAt: new Date() } });
  await settleProjectStatus(projectId);
}

export async function resumeJob(projectId: string, jobId: string) {
  const job = await db.job.findFirst({ where: { id: jobId, projectId, status: { in: ["FAILED", "CANCELLED"] } } });
  if (!job) throw new Error("Only failed or cancelled jobs can be resumed.");
  await db.jobStep.updateMany({ where: { jobId, status: { not: "SUCCEEDED" } }, data: { status: "QUEUED", attempts: 0, error: null } });
  await db.job.update({ where: { id: jobId }, data: { status: "QUEUED", cancelRequested: false, error: null, finishedAt: null, lockedAt: null } });
  await db.project.update({ where: { id: projectId }, data: { status: "EDITING" } });
}

/** Atomically claim the next queued job (or one whose worker died). */
export async function claimJob(): Promise<string | null> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    UPDATE "Job" SET status = 'RUNNING', "lockedAt" = now(), "startedAt" = COALESCE("startedAt", now())
    WHERE id = (
      SELECT id FROM "Job"
      WHERE status = 'QUEUED' OR (status = 'RUNNING' AND "lockedAt" < now() - interval '10 minutes')
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id`;
  return rows[0]?.id ?? null;
}

class Cancelled extends Error {}

export async function runJob(jobId: string): Promise<void> {
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId }, include: { project: true } });
  const provider = getProvider(job.provider);
  const heartbeat = setInterval(() => {
    db.job.update({ where: { id: jobId }, data: { lockedAt: new Date() } }).catch(() => {});
  }, 30_000);
  try {
    const steps = await db.jobStep.findMany({ where: { jobId }, orderBy: { position: "asc" } });
    for (const step of steps) {
      if (step.status === "SUCCEEDED") continue;
      await checkCancel(jobId);
      await db.job.update({ where: { id: jobId }, data: { stage: step.kind === "analysis" ? "analysis" : "editing" } });
      await db.project.update({ where: { id: job.projectId }, data: { status: step.kind === "analysis" ? "ANALYZING" : "EDITING" } });
      let lastError: unknown = null;
      for (let attempt = step.attempts; attempt < MAX_ATTEMPTS; attempt++) {
        await db.jobStep.update({ where: { id: step.id }, data: { status: "RUNNING", attempts: attempt + 1 } });
        try {
          const usage =
            step.kind === "analysis"
              ? await runAnalysis(job, provider)
              : await runChapter(job, provider, step.id, step.chapterId!);
          await db.jobStep.update({
            where: { id: step.id },
            data: { status: "SUCCEEDED", error: null, finishedAt: new Date(), inputTokens: { increment: usage.inputTokens }, outputTokens: { increment: usage.outputTokens } },
          });
          await db.job.update({
            where: { id: jobId },
            data: { doneSteps: { increment: 1 }, inputTokens: { increment: usage.inputTokens }, outputTokens: { increment: usage.outputTokens } },
          });
          lastError = null;
          break;
        } catch (err) {
          if (err instanceof Cancelled) throw err;
          lastError = err;
          const retryable = !(err instanceof ProviderError) || err.retryable;
          await db.jobStep.update({ where: { id: step.id }, data: { error: (err as Error).message.slice(0, 1000) } });
          if (!retryable) break;
          if (attempt + 1 < MAX_ATTEMPTS) await sleep(2000 * 2 ** attempt);
        }
      }
      if (lastError) {
        await db.jobStep.update({ where: { id: step.id }, data: { status: "FAILED" } });
        throw lastError;
      }
    }
    await db.job.update({ where: { id: jobId }, data: { status: "SUCCEEDED", stage: "done", finishedAt: new Date() } });
    await audit("job.succeeded", { projectId: job.projectId, details: { jobId } });
  } catch (err) {
    if (err instanceof Cancelled) {
      await db.job.update({ where: { id: jobId }, data: { status: "CANCELLED", finishedAt: new Date() } });
      await db.jobStep.updateMany({ where: { jobId, status: "RUNNING" }, data: { status: "QUEUED" } });
    } else {
      const msg = (err as Error).message || "Unknown error";
      await db.job.update({ where: { id: jobId }, data: { status: "FAILED", error: msg.slice(0, 1000), finishedAt: new Date() } });
      await audit("job.failed", { projectId: job.projectId, details: { jobId, error: msg.slice(0, 500) } });
    }
  } finally {
    clearInterval(heartbeat);
    await settleProjectStatus(job.projectId);
  }
}

async function checkCancel(jobId: string) {
  const j = await db.job.findUniqueOrThrow({ where: { id: jobId }, select: { cancelRequested: true } });
  if (j.cancelRequested) throw new Cancelled();
}

/** Set the project's status from its real state after a job ends. */
export async function settleProjectStatus(projectId: string) {
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  const active = await db.job.findFirst({ where: { projectId, status: { in: ["QUEUED", "RUNNING"] } } });
  if (active) return;
  if (["APPROVED", "FORMATTING", "READY"].includes(p.status)) return;
  const suggestions = await db.suggestion.count({ where: { projectId } });
  const chapters = await db.chapter.count({ where: { projectId, active: true } });
  const status = suggestions > 0 ? "AWAITING_REVIEW" : chapters > 0 ? "UPLOADED" : "DRAFT";
  await db.project.update({ where: { id: projectId }, data: { status } });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function projectContext(p: { title: string; authorName: string; genre: string; isFiction: boolean; language: string; manuscriptState: string }): ProjectContext {
  return { title: p.title, authorName: p.authorName, genre: p.genre, isFiction: p.isFiction, language: p.language, manuscriptState: p.manuscriptState };
}

type JobWithProject = Job & { project: { id: string; title: string; authorName: string; genre: string; isFiction: boolean; language: string; manuscriptState: string; styleSheet: Prisma.JsonValue } };

async function runAnalysis(job: JobWithProject, provider: ReturnType<typeof getProvider>) {
  const chapters = await db.chapter.findMany({
    where: { projectId: job.projectId, active: true },
    orderBy: { position: "asc" },
    include: { paragraphs: { orderBy: { position: "asc" }, select: { text: true, style: true } } },
  });
  const total = chapters.reduce((n, c) => n + c.wordCount, 0);
  const ratio = total > ANALYSIS_WORD_BUDGET ? ANALYSIS_WORD_BUDGET / total : 1;
  const input = chapters.map((c) => {
    const paras = c.paragraphs.filter((p) => p.style !== "scene_break").map((p) => p.text);
    if (ratio >= 1) return { title: c.title, text: paras.join("\n") };
    // Excerpt long books evenly: keep the opening and closing of each chapter.
    const keep = Math.max(200, Math.floor(c.wordCount * ratio));
    const out: string[] = [];
    let words = 0;
    for (const p of paras) {
      if (words > keep / 2) break;
      out.push(p);
      words += countWords(p);
    }
    const tail: string[] = [];
    words = 0;
    for (const p of [...paras].reverse()) {
      if (words > keep / 2 || out.includes(p)) break;
      tail.unshift(p);
      words += countWords(p);
    }
    return { title: c.title, text: [...out, "[…]", ...tail].join("\n") };
  });
  const styleSheet = (job.project.styleSheet ?? {}) as StyleSheet;
  const { result, usage } = await provider.analyze({ project: projectContext(job.project), styleSheet, chapters: input, truncated: ratio < 1 });

  const records: Prisma.ContinuityRecordCreateManyInput[] = [
    ...result.characters.map((c) => ({
      projectId: job.projectId,
      kind: "character",
      name: c.name,
      details: c.description + (c.spellings_seen.length > 1 ? ` (spellings seen: ${c.spellings_seen.join(", ")})` : ""),
      chapters: c.chapters,
    })),
    ...result.locations.map((l) => ({ projectId: job.projectId, kind: "location", name: l.name, details: l.description, chapters: l.chapters })),
    ...result.terms.map((t) => ({ projectId: job.projectId, kind: "term", name: t.name, details: t.description })),
    ...result.events.map((e) => ({ projectId: job.projectId, kind: "event", name: e.name, details: e.description, chapters: e.chapters })),
  ];
  await db.$transaction(async (tx) => {
    await tx.continuityRecord.deleteMany({ where: { projectId: job.projectId } });
    if (records.length) await tx.continuityRecord.createMany({ data: records });
    const derived = { voice: result.voice, pov: result.pov, tense: result.tense, conventions: result.conventions };
    await tx.project.update({
      where: { id: job.projectId },
      data: { styleSheet: { ...styleSheet, derived } as unknown as Prisma.InputJsonValue },
    });
    // Continuity concerns become reviewable notes, never automatic edits.
    await tx.suggestion.deleteMany({ where: { jobId: job.id, kind: "note", category: "continuity", status: "PENDING", decisions: { none: {} } } });
    const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    for (const c of result.continuity_concerns) {
      const ch = chapters.find((x) => norm(x.title) === norm(c.chapter)) ?? chapters.find((x) => norm(c.chapter).includes(norm(x.title))) ?? chapters[0];
      await tx.suggestion.create({
        data: {
          projectId: job.projectId,
          chapterId: ch.id,
          jobId: job.id,
          kind: "note",
          category: "continuity",
          explanation: `${c.certainty === "confirmed" ? "Inconsistency" : c.certainty === "likely" ? "Likely inconsistency" : "Possible inconsistency"}: ${c.description}`,
          severity: c.certainty === "confirmed" ? "major" : "moderate",
          confidence: c.certainty === "confirmed" ? 0.9 : c.certainty === "likely" ? 0.7 : 0.5,
          origin: job.provider === "anthropic" ? "ai" : "rules",
        },
      });
    }
  });
  return usage;
}

function continuitySummary(records: { kind: string; name: string; details: string }[], styleSheet: StyleSheet): string {
  const by = (k: string) => records.filter((r) => r.kind === k).slice(0, 40).map((r) => `- ${r.name}: ${r.details}`).join("\n");
  const parts = [];
  if (styleSheet.derived?.voice) parts.push(`Voice: ${styleSheet.derived.voice}`);
  for (const [k, label] of [["character", "Characters"], ["location", "Locations"], ["term", "Terminology"], ["event", "Key events so far"]]) {
    const s = by(k);
    if (s) parts.push(`${label}:\n${s}`);
  }
  return parts.join("\n\n");
}

async function runChapter(job: JobWithProject, provider: ReturnType<typeof getProvider>, stepId: string, chapterId: string) {
  const chapter = await db.chapter.findUniqueOrThrow({
    where: { id: chapterId },
    include: {
      paragraphs: { orderBy: { position: "asc" } },
      suggestions: { where: { kind: "edit" }, select: { paragraphId: true, start: true, end: true, status: true, originalText: true, suggestedText: true } },
    },
  });
  // Idempotent retry: drop undecided output from an earlier attempt of this same step.
  await db.suggestion.deleteMany({ where: { jobId: job.id, chapterId, status: "PENDING", decisions: { none: {} } } });
  const fresh = await db.suggestion.findMany({ where: { chapterId, kind: "edit" }, select: { paragraphId: true, start: true, end: true, status: true, originalText: true, suggestedText: true } });
  chapter.suggestions = fresh;

  const project = await db.project.findUniqueOrThrow({ where: { id: job.projectId } });
  const styleSheet = (project.styleSheet ?? {}) as StyleSheet;
  const records = await db.continuityRecord.findMany({ where: { projectId: job.projectId } });
  const continuity = continuitySummary(records, styleSheet);
  const position = await db.chapter.count({ where: { projectId: job.projectId, active: true, position: { lt: chapter.position } } });

  const refs: ParagraphRef[] = chapter.paragraphs.map((p, i) => ({
    ref: `P${i + 1}`,
    paragraphId: p.id,
    text: p.text,
    style: p.style,
    acceptedRanges: chapter.suggestions.filter((s) => s.paragraphId === p.id && (s.status === "ACCEPTED" || s.status === "MODIFIED")),
    pendingRanges: chapter.suggestions.filter((s) => s.paragraphId === p.id && s.status === "PENDING"),
  }));
  const rejected = chapter.suggestions
    .filter((s) => s.status === "REJECTED" && s.paragraphId)
    .map((s) => ({ paragraphId: s.paragraphId!, original: s.originalText, replacement: s.suggestedText }));

  // Split into chunks at paragraph boundaries.
  const chunks: ParagraphRef[][] = [];
  let cur: ParagraphRef[] = [];
  let words = 0;
  for (const r of refs) {
    const w = countWords(r.text);
    if (cur.length && words + w > CHUNK_WORDS) {
      chunks.push(cur);
      cur = [];
      words = 0;
    }
    cur.push(r);
    words += w;
  }
  if (cur.length) chunks.push(cur);

  const usage = { inputTokens: 0, outputTokens: 0 };
  let created = 0;
  let discarded = 0;
  const origin = job.provider === "anthropic" ? "ai" : "rules";
  for (let ci = 0; ci < chunks.length; ci++) {
    await checkCancel(job.id);
    const chunk = chunks[ci];
    const paragraphs: ChunkParagraph[] = chunk.map((r) => ({ ref: r.ref, style: r.style, text: r.text }));
    const { result, usage: u } = await provider.editChunk({
      project: projectContext(project),
      mode: job.editingMode,
      intensity: job.intensity,
      styleSheet,
      continuity,
      chapterTitle: chapter.title,
      chapterIndex: position,
      chunkIndex: ci,
      chunkCount: chunks.length,
      paragraphs,
      rejected: rejected.map((r) => ({ original: r.original, replacement: r.replacement })),
    });
    usage.inputTokens += u.inputTokens;
    usage.outputTokens += u.outputTokens;
    const { valid, discarded: dropped } = validateSuggestions(result.suggestions, chunk, {
      mode: job.editingMode,
      protectedTerms: styleSheet.protectedTerms ?? [],
      rejected,
    });
    discarded += dropped.length;
    if (dropped.length) console.log(`[job ${job.id}] ${chapter.title} chunk ${ci + 1}: discarded ${dropped.length}: ${[...new Set(dropped.map((d) => d.reason))].join("; ")}`);
    const byRef = new Map(chunk.map((r) => [r.ref.toUpperCase(), r]));
    await db.$transaction([
      db.suggestion.createMany({
        data: valid.map((v) => ({
          projectId: job.projectId,
          chapterId,
          jobId: job.id,
          kind: "edit",
          origin,
          ...v,
        })),
      }),
      db.suggestion.createMany({
        data: result.notes.map((n) => ({
          projectId: job.projectId,
          chapterId,
          jobId: job.id,
          kind: "note",
          origin,
          paragraphId: byRef.get(n.paragraph.trim().replace(/^\[|\]$/g, "").toUpperCase())?.paragraphId ?? null,
          category: n.category.toLowerCase().replace(/\s+/g, "_").slice(0, 40),
          explanation: n.explanation.slice(0, 4000),
          severity: n.severity,
          confidence: n.confidence,
        })),
      }),
    ]);
    created += valid.length + result.notes.length;
    for (const v of valid) {
      const r = refs.find((x) => x.paragraphId === v.paragraphId)!;
      r.pendingRanges.push({ start: v.start, end: v.end });
    }
  }
  await db.jobStep.update({ where: { id: stepId }, data: { suggestionsCreated: created, suggestionsDiscarded: discarded } });
  return usage;
}
