import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getOwnedProject, NotFoundError } from "@/lib/projects";
import { reviewCounts } from "@/lib/editor/manuscript";
import { readPublishing, sectionIncluded } from "@/lib/publish/settings";
import { templateFor } from "@/lib/publish/templates";
import { KDP_LINKS } from "@/lib/publish/kdp";
import type { ReadinessReport as Report } from "@/lib/publish/checks";
import { ProjectHeader } from "@/components/ProjectHeader";
import { ActionForm } from "@/components/ActionForm";
import { PublishStudio, type PubDetails, type PubLayout } from "@/components/publish/PublishStudio";
import { ReadinessReport } from "@/components/publish/ReadinessReport";
import { publishExportAction } from "../../../actions";

const FORMATS = ["paperback_pdf", "kindle_epub", "kindle_docx"];
const FORMAT_LABEL: Record<string, string> = { paperback_pdf: "Paperback interior PDF", kindle_epub: "Kindle EPUB", kindle_docx: "Kindle DOCX" };

export default async function PublishPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const project = await getOwnedProject(id, user.id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const pub = readPublishing(project.publishing);
  const [chapters, counts, exports, approvedVersion] = await Promise.all([
    db.chapter.findMany({ where: { projectId: id, active: true }, orderBy: { position: "asc" }, select: { id: true, title: true, kind: true, wordCount: true } }),
    reviewCounts(id),
    db.exportRecord.findMany({ where: { projectId: id, format: { in: FORMATS } }, orderBy: { createdAt: "desc" }, take: 12, include: { version: { select: { number: true } } } }),
    db.manuscriptVersion.findFirst({ where: { projectId: id, kind: "approved" }, orderBy: { number: "desc" }, select: { number: true, createdAt: true } }),
  ]);
  const approved = project.status === "APPROVED" && !!approvedVersion;
  const pending = counts.pendingEdits + counts.pendingNotes;
  const sections = chapters.map((c) => ({ id: c.id, title: c.title, kind: c.kind, words: c.wordCount, included: sectionIncluded({ chapterId: c.id, title: c.title, kind: c.kind }, pub.layout) }));
  const latestBy = new Map<string, (typeof exports)[number]>();
  for (const e of exports) if (!latestBy.has(e.format)) latestBy.set(e.format, e);

  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-8">
      <ProjectHeader project={project} tab="publish" />

      {chapters.length === 0 ? (
        <div className="card mt-6 p-6">
          <p>Upload your manuscript first. Once it&apos;s in, you can design the paperback and Kindle editions here.</p>
          <Link href={`/projects/${id}`} className="btn-primary mt-4">Go to the manuscript</Link>
        </div>
      ) : (
        <>
          <div className={`mt-6 rounded-xl border p-4 text-sm ${approved ? "border-emerald-200 bg-emerald-50/60" : "border-amber-200 bg-amber-50/60"}`}>
            {approved ? (
              <p>Previews and downloads use <strong>approved version {approvedVersion!.number}</strong>. Your words are fixed; layout choices only change how they look.</p>
            ) : (
              <p>
                You&apos;re previewing the <strong>current draft</strong> (accepted edits applied{pending ? `; ${pending} item${pending === 1 ? "" : "s"} still need a decision` : ""}). Design the book now; the download buttons unlock once the manuscript is approved on the{" "}
                <Link href={`/projects/${id}`} className="underline">Overview</Link> tab.
              </p>
            )}
          </div>

          <PublishStudio
            projectId={id}
            initialLayout={pub.layout as PubLayout}
            initialDetails={pub.details as PubDetails}
            sections={sections}
            defaultTemplate={templateFor(pub.layout.template, project.isFiction).id}
            authorName={project.authorName}
          />

          <section className="card mt-6 p-5">
            <h2 className="text-lg font-semibold">Create publishing files</h2>
            <p className="mt-1 text-sm muted">Each file is built from the approved manuscript and checked against KDP&apos;s requirements. Save your layout changes first.</p>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              {[
                { kind: "paperback", format: "paperback_pdf", title: "Paperback interior (PDF)", text: "Print-ready interior at your trim size with embedded fonts. Upload it as the manuscript for a KDP paperback. The cover is a separate file." },
                { kind: "epub", format: "kindle_epub", title: "Kindle ebook (EPUB)", text: "Reflowable EPUB with a working table of contents. Upload it as the manuscript for a Kindle eBook." },
                { kind: "kindle_docx", format: "kindle_docx", title: "Kindle ebook (Word)", text: "A clean Word file KDP accepts for Kindle, and the best file to open in Kindle Create if you want to finish there." },
              ].map((f) => {
                const last = latestBy.get(f.format);
                return (
                  <div key={f.kind} className="rounded-lg border border-[var(--color-line)] p-4">
                    <h3 className="font-medium">{f.title}</h3>
                    <p className="mt-1 text-sm muted">{f.text}</p>
                    {approved ? (
                      <ActionForm action={publishExportAction} submit={last ? "Create again" : "Create file"} className="mt-3">
                        <input type="hidden" name="projectId" value={id} />
                        <input type="hidden" name="kind" value={f.kind} />
                      </ActionForm>
                    ) : (
                      <button type="button" className="btn-primary mt-3" disabled title="Approve the manuscript first">Create file</button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {exports.length > 0 && (
            <section className="card mt-6 p-5">
              <h2 className="text-lg font-semibold">Files and readiness reports</h2>
              <ul className="mt-3 divide-y divide-[var(--color-line)]">
                {exports.map((e) => {
                  const report = e.validation as unknown as Report;
                  const latest = latestBy.get(e.format)?.id === e.id;
                  return (
                    <li key={e.id} className="py-4">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <a href={`/api/exports/${e.id}`} className="font-medium hover:underline">{e.filename}</a>
                        <span className="text-xs muted">{FORMAT_LABEL[e.format]} · {e.version ? `approved version ${e.version.number}` : ""} · {(e.sizeBytes / 1024).toFixed(0)} KB · {e.createdAt.toLocaleString()}</span>
                        <span className={`rounded px-2 py-0.5 text-xs ${e.isFinal ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>{e.isFinal ? "Ready for KDP upload" : "Not ready: see report"}</span>
                      </div>
                      {report?.checks && (
                        <details className="mt-2" open={latest && !e.isFinal}>
                          <summary className="cursor-pointer text-sm">KDP readiness report</summary>
                          <div className="mt-2"><ReadinessReport report={report} /></div>
                        </details>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <section className="card mt-6 p-5 text-sm">
            <h2 className="text-lg font-semibold">Using Kindle Create (optional)</h2>
            <p className="mt-1 muted">This app doesn&apos;t make Kindle Create&apos;s KPF files. You don&apos;t need one: KDP accepts the EPUB or Word file directly. If you&apos;d like to fine-tune the ebook in Amazon&apos;s free Kindle Create app:</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>Create the <strong>Kindle ebook (Word)</strong> file above and download it.</li>
              <li>Install <a className="underline" href={KDP_LINKS.kindleCreate} target="_blank" rel="noopener noreferrer">Kindle Create</a>, choose <em>New project from file</em>, and open the downloaded .docx.</li>
              <li>Accept its detected chapters (they come from the Heading 1 chapter titles), adjust the theme if you like, then use <em>Publish</em> to save a .kpf file.</li>
              <li>Upload the .kpf to KDP as your eBook manuscript, and check it in <a className="underline" href={KDP_LINKS.kindlePreviewer} target="_blank" rel="noopener noreferrer">Kindle Previewer</a>.</li>
            </ol>
          </section>
        </>
      )}
    </main>
  );
}
