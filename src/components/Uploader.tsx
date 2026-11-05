"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Report {
  detectedTitle: string | null;
  warnings: { level: string; message: string }[];
  stats: { words: number; paragraphs: number; dialogueParagraphs: number; sceneBreaks: number; italicSpans: number; boldSpans: number };
  added: { title: string; words: number }[];
  unchanged: string[];
  pending: { existingTitle: string }[];
}

export function Uploader({ projectId, hasChapters, disabled }: { projectId: string; hasChapters: boolean; disabled?: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [paste, setPaste] = useState(false);
  const [text, setText] = useState("");
  const [drag, setDrag] = useState(false);

  async function send(body: FormData) {
    setBusy(true); setError(null); setReport(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/upload`, { method: "POST", body });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Upload failed.");
      else { setReport(data.report); setText(""); setPaste(false); router.refresh(); }
    } catch {
      setError("The upload didn't reach the server. Check your connection and try again.");
    } finally { setBusy(false); }
  }
  const sendFile = (f: File) => { const fd = new FormData(); fd.append("file", f); send(fd); };

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f && !disabled) sendFile(f); }}
        className={`rounded-lg border-2 border-dashed p-6 text-center text-sm ${drag ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]" : "border-[var(--color-line)]"}`}
      >
        <p className="font-medium">{hasChapters ? "Add more chapters or a revised version" : "Upload your manuscript"}</p>
        <p className="mt-1 muted">Word (.docx), plain text (.txt) or Markdown (.md), up to 25 MB. A single chapter is fine.</p>
        <div className="mt-3 flex justify-center gap-2">
          <button type="button" className="btn-primary" disabled={busy || disabled} onClick={() => input.current?.click()}>{busy ? "Reading your manuscript…" : "Choose file"}</button>
          <button type="button" className="btn-ghost" disabled={busy || disabled} onClick={() => setPaste(!paste)}>Paste text</button>
        </div>
        <input ref={input} type="file" accept=".docx,.txt,.md,.markdown" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) sendFile(f); e.target.value = ""; }} aria-label="Manuscript file" />
        {disabled && <p className="mt-2 text-xs muted">Uploads are paused while the editor is working.</p>}
      </div>
      {paste && (
        <div className="mt-3">
          <textarea className="input font-serif" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={"Chapter One\n\nPaste your text here. Start each chapter with a heading like “Chapter One”."} aria-label="Pasted manuscript text" />
          <button type="button" className="btn-primary mt-2" disabled={busy || !text.trim()} onClick={() => { const fd = new FormData(); fd.append("pastedText", text); send(fd); }}>Add pasted text</button>
        </div>
      )}
      {error && <p role="alert" className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {report && (
        <div role="status" className="mt-3 rounded-md bg-emerald-50 p-3 text-sm">
          <p className="font-medium text-emerald-900">
            {report.added.length ? `Imported ${report.added.length} section${report.added.length === 1 ? "" : "s"} (${report.added.reduce((n, a) => n + a.words, 0).toLocaleString()} words).` : "No new sections were added."}
          </p>
          <p className="mt-1 muted">
            Found {report.stats.paragraphs.toLocaleString()} paragraphs, {report.stats.dialogueParagraphs.toLocaleString()} with dialogue, {report.stats.sceneBreaks} scene break{report.stats.sceneBreaks === 1 ? "" : "s"}, {report.stats.italicSpans} italic passages.
            {report.detectedTitle ? ` Title found: “${report.detectedTitle}”.` : ""}
          </p>
          {report.unchanged.length > 0 && <p className="mt-1 muted">Already up to date: {report.unchanged.join(", ")}.</p>}
          {report.pending.length > 0 && <p className="mt-1 text-amber-800">{report.pending.length} chapter{report.pending.length === 1 ? "" : "s"} changed since your last upload. Choose how to handle {report.pending.length === 1 ? "it" : "them"} above.</p>}
          {report.warnings.map((w, i) => <p key={i} className={`mt-1 ${w.level === "warning" ? "text-amber-800" : "muted"}`}>{w.message}</p>)}
        </div>
      )}
    </div>
  );
}
