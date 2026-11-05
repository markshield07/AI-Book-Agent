import Link from "next/link";
import { StatusBadge } from "./StatusBadge";

export function ProjectHeader({ project, tab }: { project: { id: string; title: string; authorName: string; status: string }; tab: string }) {
  const tabs = [
    ["overview", "Overview", `/projects/${project.id}`],
    ["review", "Review changes", `/projects/${project.id}/review`],
    ["versions", "Version history", `/projects/${project.id}/versions`],
    ["settings", "Book settings", `/projects/${project.id}/settings`],
  ];
  return (
    <header>
      <Link href="/dashboard" className="text-sm muted hover:underline">← All books</Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="font-serif text-3xl">{project.title}</h1>
        <StatusBadge status={project.status} />
      </div>
      <p className="muted">{project.authorName}</p>
      <nav className="mt-4 flex gap-1 border-b border-[var(--color-line)] text-sm">
        {tabs.map(([k, l, href]) => (
          <Link key={k} href={href} className={`-mb-px border-b-2 px-3 py-2 ${tab === k ? "border-[var(--color-accent)] font-medium" : "border-transparent muted hover:text-[var(--color-ink)]"}`}>{l}</Link>
        ))}
      </nav>
    </header>
  );
}
