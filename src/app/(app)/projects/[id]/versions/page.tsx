import Link from "next/link";
import { notFound } from "next/navigation";
import { diffWords } from "diff";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getOwnedProject, NotFoundError } from "@/lib/projects";
import type { SnapshotChapter } from "@/lib/editor/manuscript";
import { ProjectHeader } from "@/components/ProjectHeader";
import { ConfirmButton } from "@/components/ConfirmButton";
import { restoreVersionAction } from "../../../actions";

const KIND: Record<string, string> = { import: "Upload", approved: "Approved", checkpoint: "Draft download", restore: "Restore" };

export default async function Versions({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ a?: string; b?: string; restored?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  const project = await getOwnedProject(id, user.id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const versions = await db.manuscriptVersion.findMany({
    where: { projectId: id },
    orderBy: { number: "desc" },
    select: { id: true, number: true, kind: true, label: true, wordCount: true, createdAt: true, _count: { select: { exports: true } } },
  });
  const [a, b] = await Promise.all(
    [sp.a, sp.b].map((v) => (v ? db.manuscriptVersion.findFirst({ where: { id: v, projectId: id } }) : null))
  );
  let diff: { title: string; parts: { value: string; added?: boolean; removed?: boolean }[] }[] = [];
  if (a && b) {
    const A = a.snapshot as unknown as SnapshotChapter[];
    const B = b.snapshot as unknown as SnapshotChapter[];
    const ids = [...new Set([...A.map((c) => c.chapterId), ...B.map((c) => c.chapterId)])];
    diff = ids.map((cid) => {
      const ca = A.find((c) => c.chapterId === cid);
      const cb = B.find((c) => c.chapterId === cid);
      const ta = ca?.paragraphs.map((p) => p.text).join("\n\n") ?? "";
      const tb = cb?.paragraphs.map((p) => p.text).join("\n\n") ?? "";
      return { title: (cb ?? ca)!.title, parts: ta === tb ? [] : diffWords(ta, tb) };
    }).filter((d) => d.parts.length);
  }
  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-8">
      <ProjectHeader project={project} tab="versions" />
      {sp.restored && <p className="mt-4 rounded bg-emerald-50 p-3 text-sm text-emerald-900">Version restored. Your previous state was saved as its own version, so you can go back to it.</p>}
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <section className="card p-5">
          <h2 className="text-lg font-semibold">History</h2>
          <form className="mt-2 text-sm">
            <p className="muted">Pick two versions to compare.</p>
            <ul className="mt-3 divide-y divide-[var(--color-line)]">
              {versions.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-3 py-2">
                  <input type="radio" name="a" value={v.id} defaultChecked={sp.a === v.id} aria-label={`Compare from version ${v.number}`} />
                  <input type="radio" name="b" value={v.id} defaultChecked={sp.b === v.id} aria-label={`Compare to version ${v.number}`} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">v{v.number} · {v.label}</p>
                    <p className="text-xs muted">{KIND[v.kind] ?? v.kind} · {v.wordCount.toLocaleString()} words · {v.createdAt.toLocaleString()}{v._count.exports ? ` · ${v._count.exports} export${v._count.exports > 1 ? "s" : ""}` : ""}</p>
                  </div>
                </li>
              ))}
            </ul>
            <button className="btn-ghost mt-3">Compare</button>
          </form>
          <div className="mt-6 space-y-2 border-t border-[var(--color-line)] pt-4 text-sm">
            <h3 className="font-medium">Restore an earlier state</h3>
            <p className="muted">Restoring brings back the approve/reject decisions from that version. The original text is never changed.</p>
            {versions.slice(1).map((v) => (
              <form key={v.id} action={restoreVersionAction} className="flex items-center justify-between gap-2">
                <input type="hidden" name="projectId" value={id} /><input type="hidden" name="versionId" value={v.id} />
                <span>v{v.number} · {v.label}</span>
                <ConfirmButton label="Restore" question={`Restore v${v.number}?`} />
              </form>
            ))}
          </div>
        </section>
        <section className="card p-5">
          <h2 className="text-lg font-semibold">{a && b ? `Changes from v${a.number} to v${b.number}` : "Comparison"}</h2>
          {!(a && b) && <p className="mt-2 text-sm muted">Choose two versions on the left.</p>}
          {a && b && diff.length === 0 && <p className="mt-2 text-sm muted">The text is identical.</p>}
          <div className="manuscript mt-4 space-y-6 text-base">
            {diff.map((d) => (
              <div key={d.title}>
                <h3 className="font-sans text-sm font-semibold">{d.title}</h3>
                <p className="mt-2 whitespace-pre-wrap">
                  {d.parts.map((p, i) => p.added ? <ins key={i} className="bg-[var(--color-ins-bg)] text-[var(--color-ins)] no-underline">{p.value}</ins> : p.removed ? <del key={i} className="bg-[var(--color-del-bg)] text-[var(--color-del)]">{p.value}</del> : <span key={i}>{p.value.length > 400 ? `${p.value.slice(0, 150)} … ${p.value.slice(-150)}` : p.value}</span>)}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm"><Link href={`/projects/${id}`} className="hover:underline">Download the original upload from the Overview</Link></p>
        </section>
      </div>
    </main>
  );
}
