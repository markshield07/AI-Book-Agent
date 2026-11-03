import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { STATUS_LABEL } from "@/lib/projects";
import { archiveProjectAction, duplicateProjectAction } from "../actions";
import { StatusBadge } from "@/components/StatusBadge";

type SP = { q?: string; sort?: string; status?: string; archived?: string };

export default async function Dashboard({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const where: Prisma.ProjectWhereInput = {
    userId: user.id,
    archived: sp.archived === "1",
    ...(sp.q ? { OR: [{ title: { contains: sp.q, mode: "insensitive" } }, { authorName: { contains: sp.q, mode: "insensitive" } }] } : {}),
    ...(sp.status && sp.status in STATUS_LABEL ? { status: sp.status as Prisma.EnumProjectStatusFilter["equals"] } : {}),
  };
  const orderBy: Prisma.ProjectOrderByWithRelationInput =
    sp.sort === "title" ? { title: "asc" } : sp.sort === "created" ? { createdAt: "desc" } : { updatedAt: "desc" };
  const [projects, all] = await Promise.all([
    db.project.findMany({
      where,
      orderBy,
      include: { chapters: { where: { active: true }, select: { wordCount: true } } },
    }),
    db.project.findMany({ where: { userId: user.id, archived: false }, select: { id: true, status: true, updatedAt: true, title: true } }),
  ]);
  const counts = await db.suggestion.groupBy({
    by: ["projectId", "status"],
    where: { project: { userId: user.id }, chapter: { active: true } },
    _count: true,
  });
  const progress = (id: string) => {
    const rows = counts.filter((c) => c.projectId === id);
    const total = rows.reduce((n, r) => n + r._count, 0);
    const pending = rows.filter((r) => r.status === "PENDING").reduce((n, r) => n + r._count, 0);
    return { total, pending, done: total - pending };
  };
  const awaiting = all.filter((p) => progress(p.id).pending > 0).length;
  const completed = all.filter((p) => ["APPROVED", "READY"].includes(p.status)).length;
  const recent = [...all].sort((a, b) => +b.updatedAt - +a.updatedAt).slice(0, 3);
  const first = user.name.split(" ")[0];

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl">Welcome back, {first}.</h1>
          <p className="mt-1 muted">
            {awaiting > 0
              ? `${awaiting} manuscript${awaiting === 1 ? " has" : "s have"} edits waiting for your review.`
              : all.length
              ? "Nothing is waiting on you right now."
              : "Start by creating your first book project."}
          </p>
        </div>
        <Link href="/projects/new" className="btn-accent">+ Create new book</Link>
      </div>

      <section className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Active manuscripts" value={all.length} />
        <Stat label="Awaiting your review" value={awaiting} />
        <Stat label="Completed" value={completed} />
        <div className="card p-4">
          <p className="text-xs uppercase tracking-wide muted">Recently edited</p>
          <ul className="mt-2 space-y-1 text-sm">
            {recent.length ? recent.map((r) => <li key={r.id} className="truncate"><Link href={`/projects/${r.id}`} className="hover:underline">{r.title}</Link></li>) : <li className="muted">None yet</li>}
          </ul>
        </div>
      </section>

      <form className="mt-10 flex flex-wrap items-center gap-2" role="search">
        <input name="q" defaultValue={sp.q} placeholder="Search by title or author" className="input max-w-xs" aria-label="Search projects" />
        <select name="status" defaultValue={sp.status ?? ""} className="input w-auto" aria-label="Filter by status">
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select name="sort" defaultValue={sp.sort ?? "updated"} className="input w-auto" aria-label="Sort">
          <option value="updated">Last modified</option>
          <option value="created">Newest</option>
          <option value="title">Title A–Z</option>
        </select>
        <label className="flex items-center gap-1 text-sm muted"><input type="checkbox" name="archived" value="1" defaultChecked={sp.archived === "1"} /> Archived</label>
        <button className="btn-ghost">Apply</button>
      </form>

      <section className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {projects.length === 0 && (
          <div className="card col-span-full p-10 text-center muted">
            {sp.q || sp.status || sp.archived ? "No projects match these filters." : "No books yet. Create one to upload your manuscript."}
          </div>
        )}
        {projects.map((p) => {
          const words = p.chapters.reduce((n, c) => n + c.wordCount, 0);
          const pr = progress(p.id);
          const pct = pr.total ? Math.round((pr.done / pr.total) * 100) : 0;
          return (
            <article key={p.id} className="card flex flex-col p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate font-serif text-lg"><Link href={`/projects/${p.id}`} className="hover:underline">{p.title}</Link></h2>
                  <p className="truncate text-sm muted">{p.authorName}</p>
                </div>
                <StatusBadge status={p.status} />
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
                <div><dt className="text-xs muted">Words</dt><dd>{words.toLocaleString()}</dd></div>
                <div><dt className="text-xs muted">Chapters</dt><dd>{p.chapters.length}</dd></div>
                <div><dt className="text-xs muted">Modified</dt><dd>{p.updatedAt.toLocaleDateString()}</dd></div>
              </dl>
              {pr.total > 0 && (
                <div className="mt-4">
                  <div className="flex justify-between text-xs muted"><span>Review progress</span><span>{pr.done} of {pr.total}</span></div>
                  <div className="mt-1 h-1.5 rounded bg-stone-100"><div className="h-1.5 rounded bg-[var(--color-accent)]" style={{ width: `${pct}%` }} /></div>
                </div>
              )}
              <div className="mt-5 flex flex-wrap gap-2 text-sm">
                <Link href={`/projects/${p.id}`} className="btn-ghost">Open</Link>
                {pr.pending > 0 && <Link href={`/projects/${p.id}/review`} className="btn-primary">Review {pr.pending}</Link>}
                <form action={duplicateProjectAction}><input type="hidden" name="projectId" value={p.id} /><button className="btn-ghost">Duplicate</button></form>
                <form action={archiveProjectAction}><input type="hidden" name="projectId" value={p.id} /><button className="btn-ghost">{p.archived ? "Unarchive" : "Archive"}</button></form>
                <Link href={`/projects/${p.id}/settings`} className="btn-ghost">Rename</Link>
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wide muted">{label}</p>
      <p className="mt-1 font-serif text-3xl">{value}</p>
    </div>
  );
}
