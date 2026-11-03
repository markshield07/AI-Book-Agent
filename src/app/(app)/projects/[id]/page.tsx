import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getOwnedProject, NotFoundError, MODE_LABEL, INTENSITY_LABEL } from "@/lib/projects";
import { reviewCounts } from "@/lib/editor/manuscript";
import { providerInfo } from "@/lib/ai";
import type { IngestReport } from "@/lib/editor/ingest";
import { ProjectHeader } from "@/components/ProjectHeader";
import { Uploader } from "@/components/Uploader";
import { JobProgress } from "@/components/JobProgress";
import { ActionForm } from "@/components/ActionForm";
import { EditingFields } from "@/components/ProjectFields";
import { approveAction, exportAction, reconcileAction, reopenAction, startEditingAction } from "../../actions";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const project = await getOwnedProject(id, user.id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const [chapters, counts, job, sources, exports, continuity, perChapter] = await Promise.all([
    db.chapter.findMany({ where: { projectId: id, active: true }, orderBy: { position: "asc" } }),
    reviewCounts(id),
    db.job.findFirst({ where: { projectId: id }, orderBy: { createdAt: "desc" }, include: { steps: { orderBy: { position: "asc" }, include: { chapter: { select: { title: true } } } } } }),
    db.sourceFile.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" } }),
    db.exportRecord.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" }, include: { version: { select: { number: true } } } }),
    db.continuityRecord.findMany({ where: { projectId: id }, orderBy: [{ kind: "asc" }, { name: "asc" }] }),
    db.suggestion.groupBy({ by: ["chapterId", "status"], where: { projectId: id }, _count: true }),
  ]);
  const info = providerInfo();
  const words = chapters.reduce((n, c) => n + c.wordCount, 0);
  const pendingReconcile = sources.flatMap((s) => ((s.importReport as unknown as IngestReport).pending ?? []).map((p) => ({ ...p, sourceFileId: s.id })));
  const active = job && (job.status === "QUEUED" || job.status === "RUNNING");
  const approved = project.status === "APPROVED";
  const totalSuggestions = counts.pendingEdits + counts.acceptedEdits + counts.rejectedEdits + counts.modifiedEdits + counts.pendingNotes + counts.resolvedNotes;
  const chCount = (cid: string, st?: string) => perChapter.filter((r) => r.chapterId === cid && (!st || r.status === st)).reduce((n, r) => n + r._count, 0);

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-8">
      <ProjectHeader project={project} tab="overview" />

      {totalSuggestions > 0 && !active && (
        <div className="mt-6 card flex flex-wrap items-center justify-between gap-4 border-violet-200 bg-violet-50/50 p-5">
          <div>
            <p className="font-medium">
              {counts.pendingEdits + counts.pendingNotes > 0
                ? `${counts.pendingEdits} suggested edit${counts.pendingEdits === 1 ? " is" : "s are"} waiting for your approval${counts.pendingNotes ? `, plus ${counts.pendingNotes} editorial note${counts.pendingNotes === 1 ? "" : "s"}` : ""}.`
                : "All editorial suggestions have been resolved."}
            </p>
            <p className="text-sm muted">{counts.acceptedEdits + counts.modifiedEdits} accepted · {counts.rejectedEdits} rejected</p>
          </div>
          <Link href={`/projects/${id}/review`} className="btn-primary">{counts.pendingEdits + counts.pendingNotes > 0 ? "Review changes" : "Open manuscript"}</Link>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section className="card p-5 lg:col-span-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">Manuscript</h2>
            <p className="text-sm muted">{chapters.length} section{chapters.length === 1 ? "" : "s"} · {words.toLocaleString()} words</p>
          </div>
          {chapters.length > 0 && (
            <table className="mt-4 w-full text-sm">
              <thead className="text-left text-xs muted"><tr><th className="py-1 font-normal">Section</th><th className="font-normal">Words</th><th className="font-normal">Pending</th><th className="font-normal">Accepted</th><th className="font-normal">Rejected</th></tr></thead>
              <tbody>
                {chapters.map((c) => (
                  <tr key={c.id} className="border-t border-[var(--color-line)]">
                    <td className="py-2"><Link href={`/projects/${id}/review?chapter=${c.id}`} className="hover:underline">{c.title}</Link>{c.kind !== "chapter" && <span className="ml-2 text-xs muted">({c.kind === "front" ? "front matter" : "back matter"})</span>}</td>
                    <td>{c.wordCount.toLocaleString()}</td>
                    <td>{chCount(c.id, "PENDING")}</td>
                    <td>{chCount(c.id, "ACCEPTED") + chCount(c.id, "MODIFIED")}</td>
                    <td>{chCount(c.id, "REJECTED")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {pendingReconcile.map((p) => (
            <div key={p.key} className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
              <p className="font-medium">You uploaded a new version of “{p.existingTitle}”.</p>
              <p className="mt-1 muted">How should it be combined with the chapter you already have? Earlier decisions are always kept in the history.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {[["replace", "Replace the old chapter"], ["add", "Add as a separate chapter"], ["keep", "Keep the old one, ignore this"]].map(([c, l]) => (
                  <form key={c} action={reconcileAction}>
                    <input type="hidden" name="projectId" value={id} /><input type="hidden" name="sourceFileId" value={p.sourceFileId} />
                    <input type="hidden" name="key" value={p.key} /><input type="hidden" name="choice" value={c} />
                    <button className="btn-ghost">{l}</button>
                  </form>
                ))}
              </div>
            </div>
          ))}
          <div className="mt-6">
            <Uploader projectId={id} hasChapters={chapters.length > 0} disabled={!!active} />
          </div>
          {sources.length > 0 && (
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer muted">Original uploads ({sources.length})</summary>
              <ul className="mt-2 space-y-1">
                {sources.map((s) => (
                  <li key={s.id}><a className="hover:underline" href={`/api/source-files/${s.id}`}>{s.originalName}</a> <span className="muted">· {(s.sizeBytes / 1024).toFixed(0)} KB · {s.createdAt.toLocaleString()}</span></li>
                ))}
              </ul>
            </details>
          )}
        </section>

        <section className="card p-5">
          <h2 className="text-lg font-semibold">The Master Editor</h2>
          <p className="mt-1 text-sm muted">
            {info.external ? <>Edits are produced by {info.label} using <code>{info.model}</code>.</> : <>{info.label}. Only mechanical checks will run until an AI key is set up.</>}
          </p>
          {job && <div className="mt-4"><JobProgress projectId={id} initial={{ id: job.id, status: job.status, stage: job.stage, doneSteps: job.doneSteps, totalSteps: job.totalSteps, error: job.error, inputTokens: job.inputTokens, outputTokens: job.outputTokens, mode: MODE_LABEL[job.editingMode], steps: job.steps.map((s) => ({ kind: s.kind, title: s.chapter?.title ?? "Manuscript analysis", status: s.status, error: s.error, created: s.suggestionsCreated })) }} /></div>}
          {!active && !approved && chapters.length > 0 && (
            <ActionForm action={startEditingAction} className="mt-5 space-y-4" submit={job ? "Run another editing pass" : "Start editing"} submitClass="btn-accent w-full">
              <input type="hidden" name="projectId" value={id} />
              <EditingFields d={{ editingMode: project.editingMode, intensity: project.intensity }} />
              {info.external && !user.aiConsentAt && (
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="consent" className="mt-1" />
                  <span>I understand the chapters being edited will be sent to Anthropic for processing by Claude. Whether they may be used to improve models follows my Claude account's privacy settings. I keep all rights to my work.</span>
                </label>
              )}
              {job && <p className="text-xs muted">Another pass keeps every decision you've made. Changes you rejected won't be suggested again.</p>}
            </ActionForm>
          )}
          {chapters.length === 0 && <p className="mt-4 text-sm muted">Upload your manuscript to begin.</p>}
          <p className="mt-4 text-xs muted">Current settings: {MODE_LABEL[project.editingMode]}, {INTENSITY_LABEL[project.intensity]}.</p>
        </section>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section className="card p-5 lg:col-span-2">
          <h2 className="text-lg font-semibold">Finalize and download</h2>
          {approved ? (
            <div className="mt-3 text-sm">
              <p>Your manuscript is approved. The approved text is frozen; reopen editing if you want to change any decision.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <ActionForm action={exportAction} submit="Generate approved manuscript (.docx)" submitClass="btn-accent"><input type="hidden" name="projectId" value={id} /><input type="hidden" name="kind" value="final" /></ActionForm>
                <form action={reopenAction}><input type="hidden" name="projectId" value={id} /><button className="btn-ghost">Reopen editing</button></form>
              </div>
            </div>
          ) : (
            <div className="mt-3 text-sm">
              <p className="muted">When every suggestion and note has been resolved, approve the manuscript to freeze the final text. You can download an edited draft at any time; pending suggestions are not applied to drafts.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <ActionForm action={approveAction} submit="Approve manuscript" submitClass="btn-primary" confirm="Approve and freeze the manuscript? You can reopen editing later.">
                  <input type="hidden" name="projectId" value={id} />
                </ActionForm>
                {chapters.length > 0 && <ActionForm action={exportAction} submit="Download edited draft (.docx)" submitClass="btn-ghost"><input type="hidden" name="projectId" value={id} /><input type="hidden" name="kind" value="draft" /></ActionForm>}
              </div>
            </div>
          )}
          {totalSuggestions > 0 && (
            <div className="mt-3"><ActionForm action={exportAction} submit="Generate editorial change report" submitClass="btn-ghost text-sm"><input type="hidden" name="projectId" value={id} /><input type="hidden" name="kind" value="report" /></ActionForm></div>
          )}
          <p className="mt-4 text-xs muted">Kindle EPUB and print-ready paperback PDF exports are the next phase of the Publishing Studio and are not available yet.</p>
          {exports.length > 0 && (
            <ul className="mt-5 divide-y divide-[var(--color-line)] text-sm">
              {exports.map((e) => (
                <li key={e.id} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <a href={`/api/exports/${e.id}`} className="font-medium hover:underline">{e.filename}</a>
                      <span className="ml-2 text-xs muted">{e.isFinal ? "Final" : e.format === "editorial_report" ? "Report" : "Draft"} · {e.version ? `version ${e.version.number}` : ""} · {e.createdAt.toLocaleString()}</span>
                    </div>
                    <a href={`/api/exports/${e.id}`} className="btn-ghost text-xs">Download</a>
                  </div>
                  {Array.isArray(e.validation) && e.validation.length > 0 && (
                    <ul className="mt-2 grid gap-1 text-xs">
                      {(e.validation as { name: string; result: string; detail: string }[]).map((c) => (
                        <li key={c.name}><span className={c.result === "passed" ? "text-emerald-700" : c.result === "warning" ? "text-amber-700" : "text-red-700"}>{c.result === "passed" ? "✓ Passed" : c.result === "warning" ? "! Warning" : "✕ Failed"}</span> {c.name} <span className="muted">({c.detail})</span></li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-5">
          <h2 className="text-lg font-semibold">Continuity reference</h2>
          {continuity.length === 0 ? (
            <p className="mt-2 text-sm muted">Built automatically when the editor analyzes your manuscript.</p>
          ) : (
            <div className="mt-2 max-h-96 space-y-3 overflow-auto text-sm">
              {["character", "location", "term", "event"].map((k) => {
                const rows = continuity.filter((r) => r.kind === k);
                if (!rows.length) return null;
                return (
                  <div key={k}>
                    <h3 className="text-xs uppercase tracking-wide muted">{k === "character" ? "Characters" : k === "location" ? "Locations" : k === "term" ? "Terminology" : "Key events"}</h3>
                    <ul className="mt-1 space-y-1">{rows.map((r) => <li key={r.id}><span className="font-medium">{r.name}</span> <span className="muted">{r.details}</span></li>)}</ul>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
