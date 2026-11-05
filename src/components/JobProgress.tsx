"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { cancelJobAction, resumeJobAction } from "@/app/(app)/actions";

export interface JobView {
  id: string; status: string; stage: string; doneSteps: number; totalSteps: number; error: string | null;
  inputTokens: number; outputTokens: number; mode: string;
  steps: { kind: string; title: string; status: string; error: string | null; created: number }[];
}

export function JobProgress({ projectId, initial }: { projectId: string; initial: JobView }) {
  const router = useRouter();
  const [job, setJob] = useState(initial);
  const active = job.status === "QUEUED" || job.status === "RUNNING";
  useEffect(() => setJob(initial), [initial]);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/projects/${projectId}/job`, { cache: "no-store" });
      if (!res.ok) return;
      const next: JobView = await res.json();
      setJob(next);
      if (next.status !== "QUEUED" && next.status !== "RUNNING") router.refresh();
    }, 2000);
    return () => clearInterval(t);
  }, [active, projectId, router]);

  const pct = job.totalSteps ? Math.round((job.doneSteps / job.totalSteps) * 100) : 0;
  const label =
    job.status === "QUEUED" ? "Waiting to start…" :
    job.status === "RUNNING" ? (job.stage === "analysis" ? "Reading the whole manuscript…" : `Editing chapter ${Math.max(1, job.doneSteps)} of ${job.totalSteps - 1}`) :
    job.status === "SUCCEEDED" ? "Editing pass finished." :
    job.status === "CANCELLED" ? "Editing was stopped. Finished chapters were kept." :
    "Editing stopped because of a problem.";
  const tokens = job.inputTokens + job.outputTokens;
  return (
    <div className="rounded-lg border border-[var(--color-line)] p-4 text-sm" aria-live="polite">
      <div className="flex justify-between gap-3"><span className="font-medium">{label}</span><span className="shrink-0 muted">{job.mode}</span></div>
      <div className="mt-2 h-2 rounded bg-stone-100"><div className={`h-2 rounded ${job.status === "FAILED" ? "bg-red-500" : "bg-[var(--color-accent)]"}`} style={{ width: `${pct}%` }} /></div>
      <p className="mt-1 text-xs muted">{job.doneSteps} of {job.totalSteps} steps complete{tokens ? ` · ${tokens.toLocaleString()} tokens used` : ""}</p>
      {job.error && <p className="mt-2 text-red-700">{job.error}</p>}
      <details className="mt-2">
        <summary className="cursor-pointer text-xs muted">Details</summary>
        <ul className="mt-1 space-y-0.5 text-xs">
          {job.steps.map((s, i) => (
            <li key={i} className="flex justify-between gap-2">
              <span className="truncate">{s.title}</span>
              <span className={s.status === "FAILED" ? "text-red-700" : "muted"}>{s.status === "SUCCEEDED" ? `✓ ${s.kind === "chapter" ? `${s.created} suggestions` : "done"}` : s.status.toLowerCase()}</span>
            </li>
          ))}
        </ul>
      </details>
      <div className="mt-3 flex gap-2">
        {active && <form action={cancelJobAction}><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="jobId" value={job.id} /><button className="btn-ghost text-xs">Stop editing</button></form>}
        {(job.status === "FAILED" || job.status === "CANCELLED") && job.doneSteps < job.totalSteps && (
          <form action={resumeJobAction}><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="jobId" value={job.id} /><button className="btn-primary text-xs">Resume from where it stopped</button></form>
        )}
      </div>
    </div>
  );
}
