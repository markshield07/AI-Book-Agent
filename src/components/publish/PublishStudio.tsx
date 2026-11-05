"use client";
// Publish tab: layout settings and book details on the left, live print/Kindle preview on the right.
import { useState } from "react";
import { TRIM_SIZES, COMMON_TRIMS, paperOptions, type Ink } from "@/lib/publish/kdp";
import { TEMPLATES, TEMPLATE_IDS } from "@/lib/publish/templates";
import { PrintPreview } from "./PrintPreview";
import { KindlePreview } from "./KindlePreview";

export interface PubLayout {
  trim: string; ink: string; paper: string; bleed: boolean; template?: string; chapterStart: string; runningHeaders: boolean;
  frontNumbering: string; printToc: boolean; halfTitle: boolean; excludedSections: string[]; includedSections: string[];
}
export type PubDetails = Record<"subtitle" | "publisher" | "copyright" | "isbnPaperback" | "isbnEbook" | "edition" | "dedication" | "epigraph" | "epigraphSource" | "aboutAuthor" | "alsoBy" | "website" | "seriesInfo", string>;
export interface ImportedSection { id: string; title: string; kind: string; included: boolean; words: number }

const INKS: [Ink, string][] = [["bw", "Black & white"], ["standard_color", "Standard color"], ["premium_color", "Premium color"]];

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs muted">{hint}</span>}
    </label>
  );
}

export function PublishStudio({
  projectId, initialLayout, initialDetails, sections, defaultTemplate, authorName,
}: {
  projectId: string; initialLayout: PubLayout; initialDetails: PubDetails; sections: ImportedSection[]; defaultTemplate: string; authorName: string;
}) {
  const [layout, setLayout] = useState<PubLayout>(initialLayout);
  const [details, setDetails] = useState<PubDetails>(initialDetails);
  const [included, setIncluded] = useState<Record<string, boolean>>(Object.fromEntries(sections.map((s) => [s.id, s.included])));
  const [panel, setPanel] = useState<"layout" | "details">("layout");
  const [view, setView] = useState<"print" | "kindle">("print");
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const L = <K extends keyof PubLayout>(k: K, v: PubLayout[K]) => {
    setLayout((p) => {
      const next = { ...p, [k]: v };
      if (k === "ink" && !paperOptions(v as Ink).includes(next.paper as never)) next.paper = "white";
      return next;
    });
    setDirty(true);
  };
  const D = (k: keyof PubDetails, v: string) => {
    setDetails((p) => ({ ...p, [k]: v }));
    setDirty(true);
  };

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const body = {
        layout: {
          ...layout,
          includedSections: sections.filter((s) => included[s.id]).map((s) => s.id),
          excludedSections: sections.filter((s) => !included[s.id]).map((s) => s.id),
        },
        details,
      };
      const res = await fetch(`/api/projects/${projectId}/publishing`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't save");
      setLayout(data.layout);
      setDetails(data.details);
      setVersion((v) => v + 1);
      setDirty(false);
      setStatus({ kind: "ok", text: "Saved. The preview now shows these settings." });
    } catch (e) {
      setStatus({ kind: "err", text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  const tpl = layout.template ?? defaultTemplate;
  const common = TRIM_SIZES.filter((t) => COMMON_TRIMS.includes(t.id));
  const other = TRIM_SIZES.filter((t) => !COMMON_TRIMS.includes(t.id));

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[22rem_1fr] [&>*]:min-w-0">
      <div className="card p-5">
        <div className="mb-4 flex gap-1 text-sm" role="tablist">
          {(["layout", "details"] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={panel === k} onClick={() => setPanel(k)} className={panel === k ? "btn-primary" : "btn-ghost"}>
              {k === "layout" ? "Layout" : "Book details"}
            </button>
          ))}
        </div>
        {panel === "layout" ? (
          <div className="space-y-4">
            <Field label="Design template">
              <select className="input" value={tpl} onChange={(e) => L("template", e.target.value)}>
                {TEMPLATE_IDS.map((id) => <option key={id} value={id}>{TEMPLATES[id].name}</option>)}
              </select>
              <span className="mt-1 block text-xs muted">{TEMPLATES[tpl as keyof typeof TEMPLATES]?.description} Templates change the look, never your words.</span>
            </Field>
            <Field label="Trim size" hint="6 × 9 in is the usual choice for fiction.">
              <select className="input" value={layout.trim} onChange={(e) => L("trim", e.target.value)}>
                <optgroup label="Most common">{common.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</optgroup>
                <optgroup label="Other KDP sizes">{other.map((t) => <option key={t.id} value={t.id}>{t.label}{t.large ? " (large trim)" : ""}</option>)}</optgroup>
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Interior ink">
                <select className="input" value={layout.ink} onChange={(e) => L("ink", e.target.value)}>
                  {INKS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Field>
              <Field label="Paper">
                <select className="input" value={layout.paper} onChange={(e) => L("paper", e.target.value)}>
                  {paperOptions(layout.ink as Ink).map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
                </select>
              </Field>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={layout.bleed} onChange={(e) => L("bleed", e.target.checked)} />
              <span>Bleed <span className="block text-xs muted">Only needed when something prints to the page edge. Text-only books should leave this off.</span></span>
            </label>
            <Field label="Chapters start on">
              <select className="input" value={layout.chapterStart} onChange={(e) => L("chapterStart", e.target.value)}>
                <option value="any">The next page (fewer blank pages)</option>
                <option value="recto">A right-hand page (traditional)</option>
              </select>
            </Field>
            <Field label="Front matter page numbers">
              <select className="input" value={layout.frontNumbering} onChange={(e) => L("frontNumbering", e.target.value)}>
                <option value="roman">Roman numerals (i, ii, iii)</option>
                <option value="none">None</option>
              </select>
            </Field>
            <div className="space-y-2 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={layout.runningHeaders} onChange={(e) => L("runningHeaders", e.target.checked)} /> Running headers (author and title at the top of pages)</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={layout.printToc} onChange={(e) => L("printToc", e.target.checked)} /> Table of contents</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={layout.halfTitle} onChange={(e) => L("halfTitle", e.target.checked)} /> Half-title page (print only)</label>
            </div>
            <fieldset>
              <legend className="label">Sections from your manuscript</legend>
              <p className="mb-2 text-xs muted">Untick anything that shouldn&apos;t be printed, such as a title page you typed yourself (the app makes one for you).</p>
              <div className="max-h-56 space-y-1 overflow-y-auto rounded border border-[var(--color-line)] p-2 text-sm">
                {sections.map((s) => (
                  <label key={s.id} className="flex items-center gap-2">
                    <input type="checkbox" checked={!!included[s.id]} onChange={(e) => { setIncluded((p) => ({ ...p, [s.id]: e.target.checked })); setDirty(true); }} />
                    <span className="truncate">{s.title}</span>
                    <span className="ml-auto shrink-0 text-xs muted">{s.words.toLocaleString()} words</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm muted">Nothing here is ever made up for you. Leave a field empty and that page is simply left out.</p>
            <Field label="Subtitle"><input className="input" value={details.subtitle} onChange={(e) => D("subtitle", e.target.value)} maxLength={300} /></Field>
            <Field label="Copyright page" hint={`Type it exactly as it should print, e.g. "Copyright © 2026 ${authorName}. All rights reserved."`}>
              <textarea className="input min-h-24" value={details.copyright} onChange={(e) => D("copyright", e.target.value)} maxLength={3000} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Paperback ISBN" hint="Optional. KDP can assign a free one."><input className="input" value={details.isbnPaperback} onChange={(e) => D("isbnPaperback", e.target.value)} maxLength={20} /></Field>
              <Field label="Ebook ISBN" hint="Optional; Kindle books don't need one."><input className="input" value={details.isbnEbook} onChange={(e) => D("isbnEbook", e.target.value)} maxLength={20} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Publisher / imprint"><input className="input" value={details.publisher} onChange={(e) => D("publisher", e.target.value)} maxLength={200} /></Field>
              <Field label="Edition"><input className="input" value={details.edition} onChange={(e) => D("edition", e.target.value)} maxLength={100} placeholder="e.g. First edition" /></Field>
            </div>
            <Field label="Dedication"><textarea className="input min-h-16" value={details.dedication} onChange={(e) => D("dedication", e.target.value)} maxLength={2000} /></Field>
            <Field label="Epigraph"><textarea className="input min-h-16" value={details.epigraph} onChange={(e) => D("epigraph", e.target.value)} maxLength={2000} /></Field>
            <Field label="Epigraph source"><input className="input" value={details.epigraphSource} onChange={(e) => D("epigraphSource", e.target.value)} maxLength={300} /></Field>
            <Field label="About the author"><textarea className="input min-h-24" value={details.aboutAuthor} onChange={(e) => D("aboutAuthor", e.target.value)} maxLength={6000} /></Field>
            <Field label="Also by the author" hint="One title per line."><textarea className="input min-h-16" value={details.alsoBy} onChange={(e) => D("alsoBy", e.target.value)} maxLength={3000} /></Field>
            <Field label="Series information"><textarea className="input min-h-16" value={details.seriesInfo} onChange={(e) => D("seriesInfo", e.target.value)} maxLength={1000} /></Field>
            <Field label="Website or newsletter"><input className="input" value={details.website} onChange={(e) => D("website", e.target.value)} maxLength={300} /></Field>
          </div>
        )}
        <div className="sticky bottom-0 mt-5 border-t border-[var(--color-line)] bg-white pt-4">
          <button type="button" className="btn-primary w-full" onClick={save} disabled={saving}>{saving ? "Saving…" : dirty ? "Save and update preview" : "Save"}</button>
          {status && <p role={status.kind === "err" ? "alert" : "status"} className={`mt-2 text-sm ${status.kind === "err" ? "text-red-700" : "text-emerald-800"}`}>{status.text}</p>}
        </div>
      </div>
      <div className="card p-5">
        <div className="mb-4 flex gap-1 text-sm" role="tablist">
          <button type="button" role="tab" aria-selected={view === "print"} onClick={() => setView("print")} className={view === "print" ? "btn-primary" : "btn-ghost"}>Paperback preview</button>
          <button type="button" role="tab" aria-selected={view === "kindle"} onClick={() => setView("kindle")} className={view === "kindle" ? "btn-primary" : "btn-ghost"}>Kindle preview</button>
        </div>
        {view === "print" ? <PrintPreview projectId={projectId} version={version} /> : <KindlePreview projectId={projectId} version={version} />}
      </div>
    </div>
  );
}
