import Link from "next/link";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const nav = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/projects/new", label: "New project" },
    { href: "/exports", label: "Export history" },
    { href: "/settings", label: "Settings" },
  ];
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-[var(--color-line)] bg-white/60 px-4 py-6 md:flex">
        <Link href="/dashboard" className="mb-8 px-2 font-serif text-xl leading-tight">The Editorial Studio</Link>
        <nav className="flex flex-col gap-1 text-sm">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="rounded-md px-2 py-1.5 hover:bg-stone-100">{n.label}</Link>
          ))}
        </nav>
        <div className="mt-auto px-2 text-sm">
          <p className="truncate font-medium">{user.name}</p>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-[var(--color-line)] px-4 py-3 md:hidden">
          <Link href="/dashboard" className="font-serif">The Editorial Studio</Link>
          <div className="flex gap-3 text-sm">{nav.map((n) => <Link key={n.href} href={n.href}>{n.label}</Link>)}</div>
        </header>
        {children}
      </div>
    </div>
  );
}
