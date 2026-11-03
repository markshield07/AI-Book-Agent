import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

export default async function ExportHistory() {
  const user = await requireUser();
  const exports = await db.exportRecord.findMany({
    where: { project: { userId: user.id } },
    orderBy: { createdAt: "desc" },
    include: { project: { select: { id: true, title: true } }, version: { select: { number: true } } },
    take: 200,
  });
  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <h1 className="font-serif text-3xl">Export history</h1>
      {exports.length === 0 ? (
        <p className="mt-6 muted">Files you download from a book appear here.</p>
      ) : (
        <table className="card mt-6 w-full overflow-hidden text-sm">
          <thead className="bg-stone-50 text-left text-xs muted"><tr><th className="p-3 font-normal">File</th><th className="font-normal">Book</th><th className="font-normal">Version</th><th className="font-normal">Created</th></tr></thead>
          <tbody>
            {exports.map((e) => (
              <tr key={e.id} className="border-t border-[var(--color-line)]">
                <td className="p-3"><a href={`/api/exports/${e.id}`} className="font-medium hover:underline">{e.filename}</a> <span className="text-xs muted">{e.isFinal ? "final" : e.format === "editorial_report" ? "report" : "draft"}</span></td>
                <td><Link href={`/projects/${e.project.id}`} className="hover:underline">{e.project.title}</Link></td>
                <td>{e.version ? `v${e.version.number}` : "—"}</td>
                <td>{e.createdAt.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
