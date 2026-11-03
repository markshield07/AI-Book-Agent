import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getOwnedProject, NotFoundError } from "@/lib/projects";
import type { StyleSheet } from "@/lib/ai/types";
import { ProjectHeader } from "@/components/ProjectHeader";
import { BookFields, EditingFields, StyleFields } from "@/components/ProjectFields";
import { ActionForm } from "@/components/ActionForm";
import { ConfirmButton } from "@/components/ConfirmButton";
import { deleteProjectAction, updateProjectAction } from "../../../actions";

export default async function ProjectSettings({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ deleteError?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  const p = await getOwnedProject(id, user.id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const s = (p.styleSheet ?? {}) as StyleSheet;
  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-8">
      <ProjectHeader project={p} tab="settings" />
      <ActionForm action={updateProjectAction} submit="Save settings" className="mt-6 space-y-8">
        <input type="hidden" name="projectId" value={p.id} />
        <section className="card p-5"><h2 className="mb-4 text-lg font-semibold">Book details</h2><BookFields d={p} /></section>
        <section className="card p-5"><h2 className="mb-4 text-lg font-semibold">Default editing level</h2><EditingFields d={p} /></section>
        <section className="card p-5">
          <h2 className="mb-1 text-lg font-semibold">Style sheet</h2>
          <p className="mb-4 text-sm muted">The editor follows this in every chapter.</p>
          <StyleFields s={s} />
          {s.derived && (s.derived.voice || s.derived.pov || s.derived.conventions?.length) ? (
            <div className="mt-4 rounded bg-stone-50 p-3 text-sm">
              <p className="font-medium">What the editor noticed about your writing</p>
              {s.derived.voice && <p className="mt-1">Voice: {s.derived.voice}</p>}
              {s.derived.pov && <p>Point of view: {s.derived.pov}</p>}
              {s.derived.tense && <p>Tense: {s.derived.tense}</p>}
              {s.derived.conventions?.length ? <ul className="mt-1 list-disc pl-5">{s.derived.conventions.map((c) => <li key={c}>{c}</li>)}</ul> : null}
            </div>
          ) : null}
        </section>
      </ActionForm>
      <section className="card mt-8 border-red-200 p-5">
        <h2 className="text-lg font-semibold text-red-800">Delete this book</h2>
        <p className="mt-1 text-sm muted">Permanently deletes the manuscript, original uploads, all edits and exports. This can't be undone.</p>
        <form action={deleteProjectAction} className="mt-3 flex flex-wrap items-center gap-2">
          <input type="hidden" name="projectId" value={p.id} />
          <input name="confirm" className="input max-w-xs" placeholder={`Type “${p.title}” to confirm`} aria-label="Type the book title to confirm" />
          <ConfirmButton label="Delete book" question="Delete permanently?" className="btn-danger" />
        </form>
        {sp.deleteError && <p className="mt-2 text-sm text-red-700">The title you typed didn't match.</p>}
      </section>
    </main>
  );
}
