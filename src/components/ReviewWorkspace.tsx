"use client";
// The track-changes review screen: chapter navigator, manuscript with inline changes,
// and the editorial explanation panel. Every action is persisted before the UI updates.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ReviewData, ReviewSuggestion } from "@/lib/editor/review";
import { applyEdits, rangesOverlap } from "@/lib/doc/assemble";
import { toRuns, type Mark } from "@/lib/doc/model";

type View = "original" | "suggested" | "accepted";
const applied = (s: { status: string }) => s.status === "ACCEPTED" || s.status === "MODIFIED";
const CATEGORY_LABEL = (c: string) => c.replace(/_/g, " ").replace(/^\w/, (x) => x.toUpperCase());

function Styled({ text, marks, offset = 0 }: { text: string; marks: Mark[]; offset?: number }) {
  // Render a slice of a paragraph (starting at `offset`) with its italics/bold.
  const local = marks
    .map((m) => ({ ...m, start: m.start - offset, end: m.end - offset }))
    .filter((m) => m.end > 0 && m.start < text.length);
  return (
    <>
      {toRuns(text, local).map((r, i) => {
        let el: React.ReactNode = r.text;
        if (r.italic) el = <em>{el}</em>;
        if (r.bold) el = <strong>{el}</strong>;
        return <span key={i}>{el}</span>;
      })}
    </>
  );
}

export function ReviewWorkspace({ projectId, initial }: { projectId: string; initial: ReviewData }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [view, setView] = useState<View>("suggested");
  const [selected, setSelected] = useState<string | null>(null);
  const [category, setCategory] = useState("");
  const [onlyPending, setOnlyPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [modifying, setModifying] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [bulkAsk, setBulkAsk] = useState<"accept" | "reject" | "notes" | null>(null);
  const [find, setFind] = useState("");
  const centerRef = useRef<HTMLDivElement>(null);
  const locked = data.project.status === "APPROVED";

  const ch = data.chapter;
  const suggestions = useMemo(() => ch?.suggestions ?? [], [ch]);
  const categories = useMemo(() => [...new Set(suggestions.map((s) => s.category))].sort(), [suggestions]);
  const visible = useMemo(
    () => suggestions.filter((s) => (!category || s.category === category) && (!onlyPending || s.status === "PENDING")),
    [suggestions, category, onlyPending]
  );
  const sel = suggestions.find((s) => s.id === selected) ?? null;

  const reload = useCallback(
    async (chapterId?: string) => {
      const res = await fetch(`/api/projects/${projectId}/review${chapterId ? `?chapter=${chapterId}` : ""}`, { cache: "no-store" });
      if (res.ok) setData(await res.json());
    },
    [projectId]
  );

  const openChapter = async (id: string) => {
    setSelected(null);
    setModifying(null);
    await reload(id);
    router.replace(`/projects/${projectId}/review?chapter=${id}`, { scroll: false });
    centerRef.current?.scrollTo({ top: 0 });
  };

  const say = (m: string) => {
    setFlash(m);
    setTimeout(() => setFlash(null), 2500);
  };

  async function post(url: string, body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(out.error ?? "That didn't save. Please try again.");
        return null;
      }
      return out;
    } catch {
      setError("Couldn't reach the server. Your last decision may not have been saved.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  const nextPendingAfter = (id: string | null) => {
    const list = visible.filter((s) => s.status === "PENDING" && s.id !== id);
    if (!list.length) return null;
    const idx = id ? visible.findIndex((s) => s.id === id) : -1;
    return list.find((s) => visible.indexOf(s) > idx) ?? list[0];
  };

  async function decide(s: ReviewSuggestion, action: "accept" | "reject" | "modify" | "reset", authorText?: string) {
    const out = await post(`/api/suggestions/${s.id}`, { action, authorText });
    if (!out) return;
    const nxt = action === "reset" ? s : nextPendingAfter(s.id);
    await reload(ch!.id);
    setModifying(null);
    say(action === "accept" ? "Change approved" : action === "reject" ? "Change rejected" : action === "modify" ? "Your version saved" : "Back to pending");
    if (nxt) select(nxt.id);
  }

  async function bulk(ask: "accept" | "reject" | "notes") {
    setBulkAsk(null);
    const action = ask === "reject" ? "reject" : "accept";
    const out = await post(`/api/chapters/${ch!.id}/bulk`, { action, category: ask === "notes" ? undefined : category || undefined, kind: ask === "accept" ? "edit" : ask === "notes" ? "note" : undefined });
    if (!out) return;
    await reload(ch!.id);
    say(`${out.changed} ${ask === "notes" ? `note${out.changed === 1 ? "" : "s"} marked resolved` : action === "accept" ? "approved" : "rejected"}${out.skipped ? ` · ${out.skipped} skipped because they overlap an approved change` : ""}`);
  }

  async function undo() {
    const out = await post(`/api/projects/${projectId}/undo`, {});
    if (!out) return;
    await reload(ch?.id);
    say(out.undone ? `Undid ${out.undone} decision${out.undone === 1 ? "" : "s"}` : "Nothing to undo");
  }

  function select(id: string) {
    setSelected(id);
    setModifying(null);
    requestAnimationFrame(() => document.getElementById(`s-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  }

  // Keyboard shortcuts: J/K next/previous, A approve, R reject, M modify, U undo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea,select") || e.metaKey || e.ctrlKey || e.altKey || busy) return;
      const idx = sel ? visible.findIndex((s) => s.id === sel.id) : -1;
      if (e.key === "j" && visible.length) select(visible[Math.min(visible.length - 1, idx + 1)].id);
      else if (e.key === "k" && visible.length) select(visible[Math.max(0, idx - 1)].id);
      else if (e.key === "a" && sel && !locked) decide(sel, "accept");
      else if (e.key === "r" && sel && !locked) decide(sel, "reject");
      else if (e.key === "m" && sel && sel.kind === "edit" && !locked) { setModifying(sel.id); setDraft(sel.authorText ?? sel.suggestedText); }
      else if (e.key === "u" && !locked) undo();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const chapterCounts = data.chapters.find((c) => c.id === ch?.id);
  const notesHere = suggestions.filter((s) => s.status === "PENDING" && s.kind === "note").length;
  const pendingHere = suggestions.filter((s) => s.status === "PENDING" && s.kind === "edit" && (!category || s.category === category)).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-line)] bg-white px-4 py-2 text-sm">
        <div className="inline-flex rounded-md border border-[var(--color-line)] p-0.5" role="tablist" aria-label="Manuscript view">
          {(["original", "suggested", "accepted"] as View[]).map((v) => (
            <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={`rounded px-2.5 py-1 ${view === v ? "bg-[var(--color-ink)] text-white" : ""}`}>
              {v === "original" ? "Original" : v === "suggested" ? "Suggested changes" : "Accepted changes"}
            </button>
          ))}
        </div>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="input w-auto py-1" aria-label="Filter by category">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{CATEGORY_LABEL(c)}</option>)}
        </select>
        <label className="flex items-center gap-1"><input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} /> Pending only</label>
        <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find in chapter" className="input w-40 py-1" aria-label="Find in chapter" />
        <div className="ml-auto flex items-center gap-2">
          {!locked && <button className="btn-ghost py-1" onClick={undo} disabled={busy} title="Undo (U)">Undo</button>}
          {!locked && ch && (bulkAsk ? (
            <span className="flex items-center gap-2">
              <span>{bulkAsk === "notes" ? `Mark ${notesHere} editorial note${notesHere === 1 ? "" : "s"} as resolved` : <>{bulkAsk === "accept" ? `Approve ${pendingHere} pending edit${pendingHere === 1 ? "" : "s"}` : "Reject all pending suggestions"}{category ? ` in “${CATEGORY_LABEL(category)}”` : ""}</>} in this chapter?</span>
              <button className="btn-primary py-1" onClick={() => bulk(bulkAsk)} disabled={busy}>Yes</button>
              <button className="btn-ghost py-1" onClick={() => setBulkAsk(null)}>Cancel</button>
            </span>
          ) : (
            <>
              <button className="btn-ghost py-1" onClick={() => setBulkAsk("accept")} disabled={busy || pendingHere === 0}>Approve all in chapter</button>
              <button className="btn-ghost py-1" onClick={() => setBulkAsk("reject")} disabled={busy || !suggestions.some((s) => s.status === "PENDING")}>Reject all in chapter</button>
              {notesHere > 0 && <button className="btn-ghost py-1" onClick={() => setBulkAsk("notes")} disabled={busy}>Resolve all notes</button>}
            </>
          ))}
        </div>
      </div>
      {locked && <div className="bg-emerald-50 px-4 py-2 text-sm text-emerald-900">This manuscript is approved and read-only. Reopen editing from the Overview to change decisions.</div>}
      {error && <div role="alert" className="bg-red-50 px-4 py-2 text-sm text-red-800">{error}</div>}
      {flash && <div role="status" className="fixed bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full bg-[var(--color-ink)] px-4 py-2 text-sm text-white shadow">{flash}</div>}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)_340px]">
        {/* Chapter navigator */}
        <nav className="border-r border-[var(--color-line)] bg-white/50 lg:overflow-y-auto" aria-label="Chapters">
          <p className="px-4 pt-4 text-xs uppercase tracking-wide muted">{data.totals.pending ? `${data.totals.pending} waiting for review` : "All suggestions resolved"}</p>
          <ul className="p-2">
            {data.chapters.map((c) => (
              <li key={c.id}>
                <button onClick={() => openChapter(c.id)} className={`w-full rounded-md px-3 py-2 text-left text-sm ${c.id === ch?.id ? "bg-[var(--color-accent-soft)]" : "hover:bg-stone-100"}`}>
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{c.title}</span>
                    {c.pending === 0 && c.accepted + c.rejected + c.notes > 0 ? <span className="text-xs text-emerald-700" title="Chapter reviewed">✓</span> : null}
                  </span>
                  <span className="mt-0.5 block text-xs muted">
                    {c.wordCount.toLocaleString()} words · {c.pending} pending · {c.accepted} approved · {c.rejected} rejected
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* Manuscript */}
        <div ref={centerRef} className="min-w-0 lg:overflow-y-auto">
          {!ch ? (
            <p className="p-10 muted">Upload a manuscript to start reviewing.</p>
          ) : (
            <article className="manuscript mx-auto max-w-2xl px-6 py-10">
              <h2 className="mb-8 text-center text-2xl">{ch.title}</h2>
              {ch.paragraphs.map((p, i) => {
                const prev = ch.paragraphs[i - 1];
                const first = !prev || prev.style === "scene_break" || prev.style === "heading";
                const cls = p.style === "scene_break" ? "scene" : p.style === "heading" ? "subhead" : p.style === "blockquote" ? "blockquote" : `body${first ? " first" : ""}`;
                const edits = suggestions.filter((s) => s.kind === "edit" && s.paragraphId === p.id);
                const notes = suggestions.filter((s) => s.kind === "note" && s.paragraphId === p.id);
                if (find && !p.text.toLowerCase().includes(find.toLowerCase())) return null;
                return (
                  <div key={p.id} className="relative">
                    {notes.length > 0 && (
                      <button className="absolute -left-6 top-1 text-xs" title={`${notes.length} editorial note${notes.length > 1 ? "s" : ""}`} onClick={() => select(notes[0].id)} aria-label="Show editorial note">💬</button>
                    )}
                    <p className={`${cls} whitespace-pre-line ${notes.some((n) => n.status === "PENDING") ? "note-mark" : ""}`}>
                      <ParagraphView text={p.text} marks={p.marks} edits={edits} view={view} visibleIds={new Set(visible.map((v) => v.id))} selected={selected} onSelect={select} />
                    </p>
                  </div>
                );
              })}
            </article>
          )}
        </div>

        {/* Explanation panel */}
        <aside className="border-l border-[var(--color-line)] bg-white lg:overflow-y-auto" aria-label="Editorial explanation">
          {sel ? (
            <div className="p-5 text-sm">
              <div className="flex items-center justify-between">
                <span className="rounded bg-stone-100 px-2 py-0.5 text-xs">{sel.kind === "note" ? "Editorial note" : CATEGORY_LABEL(sel.category)}</span>
                <span className="text-xs muted">{sel.origin === "rules" ? "Automatic check" : "Master Editor"} · {sel.severity}{sel.confidence < 0.6 ? " · judgment call" : ""}</span>
              </div>
              {sel.kind === "edit" ? (
                <>
                  <h3 className="mt-4 text-xs uppercase tracking-wide muted">Original</h3>
                  <p className="mt-1 rounded bg-[var(--color-del-bg)] p-2 font-serif">{sel.originalText || <em className="muted">(nothing — this is an insertion)</em>}</p>
                  <h3 className="mt-3 text-xs uppercase tracking-wide muted">{sel.status === "MODIFIED" ? "Your version" : "Suggested"}</h3>
                  <p className="mt-1 rounded bg-[var(--color-ins-bg)] p-2 font-serif">{(sel.status === "MODIFIED" ? sel.authorText : sel.suggestedText) || <em className="muted">(delete)</em>}</p>
                  {sel.status === "MODIFIED" && <p className="mt-1 text-xs muted">Editor suggested: “{sel.suggestedText}”</p>}
                </>
              ) : null}
              <h3 className="mt-3 text-xs uppercase tracking-wide muted">Why</h3>
              <p className="mt-1 leading-relaxed">{sel.explanation}</p>
              {sel.contribution === "addition" && <p className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-900">This suggestion adds new material, not just wording. Approving it counts as AI-generated content for KDP disclosure purposes.</p>}

              <p className="mt-4 text-xs muted">Status: <strong>{sel.status === "PENDING" ? "Pending" : sel.status === "ACCEPTED" ? (sel.kind === "note" ? "Resolved" : "Approved") : sel.status === "REJECTED" ? (sel.kind === "note" ? "Dismissed" : "Rejected") : "Approved with your changes"}</strong></p>

              {!locked && (modifying === sel.id ? (
                <div className="mt-3">
                  <label className="label" htmlFor="modify">Your replacement</label>
                  <textarea id="modify" className="input font-serif" rows={3} value={draft} onChange={(e) => setDraft(e.target.value.replace(/\n/g, " "))} autoFocus />
                  <div className="mt-2 flex gap-2">
                    <button className="btn-primary" disabled={busy} onClick={() => decide(sel, "modify", draft)}>Save my version</button>
                    <button className="btn-ghost" onClick={() => setModifying(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button className="btn-primary" disabled={busy || (sel.status === "ACCEPTED")} onClick={() => decide(sel, "accept")} title="A">{sel.kind === "note" ? "Mark resolved" : "Approve"}</button>
                  <button className="btn-ghost" disabled={busy || sel.status === "REJECTED"} onClick={() => decide(sel, "reject")} title="R">{sel.kind === "note" ? "Dismiss" : "Reject"}</button>
                  {sel.kind === "edit" && <button className="btn-ghost" disabled={busy} onClick={() => { setModifying(sel.id); setDraft(sel.authorText ?? sel.suggestedText); }} title="M">Modify</button>}
                  {sel.status !== "PENDING" && <button className="btn-ghost" disabled={busy} onClick={() => decide(sel, "reset")}>Back to pending</button>}
                </div>
              ))}
              <p className="mt-6 text-xs muted">Shortcuts: J/K next/previous · A approve · R reject · M modify · U undo</p>
            </div>
          ) : (
            <div className="p-5 text-sm muted">
              <p>Select a highlighted change to see the editor's explanation.</p>
              {chapterCounts && <p className="mt-3">This chapter: {chapterCounts.pending} pending, {chapterCounts.accepted} approved, {chapterCounts.rejected} rejected.</p>}
              {visible.length > 0 && <button className="btn-primary mt-4" onClick={() => select((visible.find((s) => s.status === "PENDING") ?? visible[0]).id)}>Start with the first change</button>}
            </div>
          )}
          {ch && suggestions.some((s) => s.kind === "note") && (
            <div className="border-t border-[var(--color-line)] p-5 text-sm">
              <h3 className="font-medium">Editorial notes in this chapter</h3>
              <ul className="mt-2 space-y-2">
                {suggestions.filter((s) => s.kind === "note").map((n) => (
                  <li key={n.id}>
                    <button className={`w-full rounded p-2 text-left ${selected === n.id ? "bg-[var(--color-note-bg)]" : "hover:bg-stone-50"}`} onClick={() => select(n.id)}>
                      <span className="text-xs muted">{CATEGORY_LABEL(n.category)} · {n.status === "PENDING" ? "open" : n.status === "ACCEPTED" ? "resolved" : "dismissed"}</span>
                      <span className="mt-0.5 line-clamp-2 block">{n.explanation}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function ParagraphView({
  text, marks, edits, view, visibleIds, selected, onSelect,
}: {
  text: string; marks: Mark[]; edits: ReviewSuggestion[]; view: View; visibleIds: Set<string>; selected: string | null; onSelect: (id: string) => void;
}) {
  if (view === "original" || edits.length === 0) return <Styled text={text} marks={marks} />;
  if (view === "accepted") {
    const out = applyEdits(text, marks, edits.filter(applied).map((s) => ({ id: s.id, start: s.start, end: s.end, replacement: s.status === "MODIFIED" ? s.authorText ?? s.suggestedText : s.suggestedText })));
    return <Styled text={out.text} marks={out.marks} />;
  }
  // Suggested view: walk the paragraph, rendering each change inline. Overlapping
  // suggestions (rare) are shown only in the side panel to keep the text readable.
  const shown: ReviewSuggestion[] = [];
  for (const s of [...edits].sort((a, b) => a.start - b.start || a.end - b.end)) {
    if (s.status === "REJECTED" && selected !== s.id) continue;
    if (shown.some((x) => rangesOverlap(x, s))) continue;
    shown.push(s);
  }
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const s of shown) {
    if (s.start > cursor) parts.push(<Styled key={`t${cursor}`} text={text.slice(cursor, s.start)} marks={marks} offset={cursor} />);
    const replacement = s.status === "MODIFIED" ? s.authorText ?? "" : s.suggestedText;
    const dim = !visibleIds.has(s.id);
    parts.push(
      <span
        key={s.id}
        id={`s-${s.id}`}
        role="button"
        tabIndex={0}
        aria-label={`${s.status === "PENDING" ? "Suggested change" : "Decided change"}: ${s.originalText} to ${replacement}`}
        onClick={() => onSelect(s.id)}
        onKeyDown={(e) => e.key === "Enter" && onSelect(s.id)}
        className={`chg ${applied(s) ? "accepted" : ""} ${selected === s.id ? "selected" : ""} ${dim ? "opacity-40" : ""}`}
      >
        {applied(s) ? (
          <ins>{replacement}</ins>
        ) : s.status === "REJECTED" ? (
          <Styled text={text.slice(s.start, s.end)} marks={marks} offset={s.start} />
        ) : (
          <>
            {s.originalText && <del><Styled text={text.slice(s.start, s.end)} marks={marks} offset={s.start} /></del>}
            {replacement && <ins>{replacement}</ins>}
          </>
        )}
      </span>
    );
    cursor = s.end;
  }
  if (cursor < text.length) parts.push(<Styled key={`t${cursor}`} text={text.slice(cursor)} marks={marks} offset={cursor} />);
  return <>{parts}</>;
}
