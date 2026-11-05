"use client";
// Print preview drawn from the real print layout (the same page list the PDF is rendered from),
// as facing-page spreads with optional margin and gutter guides.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type FontKey = string;
interface TextItem { t: "text"; x: number; y: number; w: number; s: string; f: FontKey; z: number; ws?: number; ls?: number; r?: string }
interface RuleItem { t: "rule"; x: number; y: number; w: number }
interface Page { n: number; side: "recto" | "verso"; kind: string; folio: string | null; header: string | null; sectionId: string | null; items: (TextItem | RuleItem)[] }
interface PreviewMeta {
  total: number; width: number; height: number; bleed: boolean;
  trim: { id: string; label: string; width: number; height: number };
  margins: { top: number; bottom: number; inside: number; outside: number };
  requiredInside: number;
  limits: { min: number; max: number } | null;
  sections: { id: string; title: string; role: string; page: number; folio: string | null; inToc: boolean }[];
  stats: { iterations: number; gutterHistory: { pages: number; inside: number }[]; wordsIn: number; wordsOut: number; blankPages: number };
  missingGlyphs: Record<string, string[]>;
  source: { label: string; approved: boolean };
}

const FAMILIES = ["eb-garamond", "crimson-pro", "source-serif-4", "lora", "source-sans-3"];
const STYLES = ["regular", "italic", "bold", "bolditalic"];
export const fontFaceCss = FAMILIES.flatMap((f) => STYLES.map((s) => `@font-face{font-family:"es-${f}-${s}";src:url("/api/fonts/${f}/${s}") format("truetype");font-display:block}`)).join("\n");
const cssFamily = (k: FontKey) => `es-${k.replace("/", "-")}`;
const PT = 72;

function PageSvg({ page, meta, guides, scale }: { page: Page | undefined; meta: PreviewMeta; guides: boolean; scale: number }) {
  const w = meta.width;
  const h = meta.height;
  if (!page) return <div style={{ width: w * scale, height: h * scale }} className="bg-stone-100" />;
  const bleedX = meta.bleed && page.side === "verso" ? 0.125 * PT : 0;
  const bleedY = meta.bleed ? 0.125 * PT : 0;
  const m = meta.margins;
  const left = bleedX + (page.side === "recto" ? m.inside : m.outside) * PT;
  const textW = (meta.trim.width - m.inside - m.outside) * PT;
  const top = bleedY + m.top * PT;
  const textH = (meta.trim.height - m.top - m.bottom) * PT;
  const gutterX = page.side === "recto" ? bleedX : bleedX + meta.trim.width * PT;
  return (
    <svg
      role="img"
      aria-label={`Page ${page.n}${page.folio ? ` (numbered ${page.folio})` : ""}${page.kind === "blank" ? ", blank" : ""}`}
      viewBox={`0 0 ${w} ${h}`}
      width={w * scale}
      height={h * scale}
      className="bg-white shadow-[0_1px_4px_rgba(0,0,0,0.18)]"
    >
      {guides && (
        <g>
          <rect x={left} y={top} width={textW} height={textH} fill="rgba(122,75,42,0.05)" stroke="rgba(122,75,42,0.45)" strokeWidth={0.5} strokeDasharray="3 2" />
          <line x1={gutterX} x2={gutterX} y1={0} y2={h} stroke="rgba(30,90,160,0.6)" strokeWidth={2} />
          {meta.bleed && <rect x={page.side === "verso" ? 0.125 * PT : 0} y={bleedY} width={meta.trim.width * PT} height={meta.trim.height * PT} fill="none" stroke="rgba(200,0,0,0.5)" strokeWidth={0.5} />}
        </g>
      )}
      {page.items.map((it, i) =>
        it.t === "rule" ? (
          <line key={i} x1={it.x} x2={it.x + it.w} y1={it.y} y2={it.y} stroke="#000" strokeWidth={0.5} />
        ) : (
          <text
            key={i}
            x={it.x}
            y={it.y}
            fontFamily={cssFamily(it.f)}
            fontSize={it.z}
            wordSpacing={it.ws}
            letterSpacing={it.ls}
            style={{ whiteSpace: "pre" }}
            fill="#111"
          >
            {it.s}
          </text>
        )
      )}
    </svg>
  );
}

export function PrintPreview({ projectId, version }: { projectId: string; version: number }) {
  const [meta, setMeta] = useState<PreviewMeta | null>(null);
  const [pages, setPages] = useState<Map<number, Page>>(new Map());
  const [spread, setSpread] = useState(0); // 0 = page 1 alone on the right; k = pages 2k, 2k+1
  const [guides, setGuides] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const load = useCallback(
    async (from: number, to: number, reset = false) => {
      setLoading(true);
      try {
        const res = await fetch(`/api/projects/${projectId}/publish/preview?from=${from}&to=${to}`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Preview failed");
        setMeta(data);
        setPages((prev) => {
          const next = reset ? new Map<number, Page>() : new Map(prev);
          for (const p of data.pages as Page[]) next.set(p.n, p);
          return next;
        });
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [projectId]
  );

  // Settings changed: reload around the current spread.
  useEffect(() => {
    const first = Math.max(1, spread * 2 - 4);
    load(first, first + 15, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, load]);

  const total = meta?.total ?? 0;
  const lastSpread = Math.floor(total / 2);
  const left = spread === 0 ? undefined : spread * 2;
  const right = spread * 2 + 1 <= total ? spread * 2 + 1 : undefined;

  useEffect(() => {
    if (!meta) return;
    const need = [left, right].filter((n): n is number => !!n && !pages.has(n));
    if (need.length) load(Math.max(1, Math.min(...need) - 4), Math.max(...need) + 11);
  }, [left, right, meta, pages, load]);

  const goPage = (n: number) => setSpread(Math.max(0, Math.min(lastSpread, Math.floor(n / 2))));
  const scale = useMemo(() => (meta ? Math.min(1.1, (width - 24) / (meta.width * 2)) : 0.5), [meta, width]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea,select")) return;
      if (e.key === "ArrowRight") setSpread((s) => Math.min(lastSpread, s + 1));
      if (e.key === "ArrowLeft") setSpread((s) => Math.max(0, s - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lastSpread]);

  const missing = meta ? Object.values(meta.missingGlyphs).flat() : [];
  const currentSection = meta?.sections.filter((s) => s.page <= (right ?? left ?? 1)).pop();

  return (
    <div>
      <style>{fontFaceCss}</style>
      {meta && (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span><strong>{meta.total}</strong> pages · {meta.trim.label}{meta.bleed ? " with bleed" : ""}</span>
          <span className="muted">
            Inside margin {meta.margins.inside.toFixed(3).replace(/0+$/, "")}" (KDP minimum {meta.requiredInside}" for {meta.total} pages)
          </span>
          {meta.limits && (meta.total < meta.limits.min || meta.total > meta.limits.max) && (
            <span className="text-red-700">KDP allows {meta.limits.min}–{meta.limits.max} pages for this setup.</span>
          )}
          {missing.length > 0 && <span className="text-red-700">Characters missing from this font: {missing.join(" ")}</span>}
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <button type="button" className="btn-ghost" onClick={() => setSpread((s) => Math.max(0, s - 1))} disabled={spread === 0} aria-label="Previous pages">←</button>
        <button type="button" className="btn-ghost" onClick={() => setSpread((s) => Math.min(lastSpread, s + 1))} disabled={spread >= lastSpread} aria-label="Next pages">→</button>
        <label className="inline-flex items-center gap-1">
          Page
          <input
            type="number"
            min={1}
            max={total || 1}
            className="input w-20 py-1"
            value={right ?? left ?? 1}
            onChange={(e) => goPage(Number(e.target.value) || 1)}
            aria-label="Go to page"
          />
          <span className="muted">of {total}</span>
        </label>
        {meta && (
          <select className="input w-auto py-1" value={currentSection?.id ?? ""} onChange={(e) => { const s = meta.sections.find((x) => x.id === e.target.value); if (s) goPage(s.page); }} aria-label="Jump to section">
            {meta.sections.map((s) => <option key={s.id} value={s.id}>{s.title}{s.folio ? ` (p. ${s.folio})` : ""}</option>)}
          </select>
        )}
        <label className="ml-auto inline-flex items-center gap-2"><input type="checkbox" checked={guides} onChange={(e) => setGuides(e.target.checked)} /> Margin guides</label>
        {loading && <span className="muted">Laying out…</span>}
      </div>
      {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
      <div ref={wrap} className="flex justify-center gap-0 overflow-hidden rounded-lg bg-stone-200 p-3">
        {meta ? (
          <>
            {left ? <PageSvg page={pages.get(left)} meta={meta} guides={guides} scale={scale} /> : <div style={{ width: meta.width * scale }} />}
            {right ? <PageSvg page={pages.get(right)} meta={meta} guides={guides} scale={scale} /> : <div style={{ width: meta.width * scale }} />}
          </>
        ) : (
          <p className="p-10 text-sm muted">{error ? "" : "Laying out your book…"}</p>
        )}
      </div>
      {meta && (
        <p className="mt-2 text-xs muted">
          {left ? `Left: page ${left}${pages.get(left)?.folio ? ` (numbered ${pages.get(left)?.folio})` : ""}. ` : ""}
          {right ? `Right: page ${right}${pages.get(right)?.folio ? ` (numbered ${pages.get(right)?.folio})` : ""}. ` : ""}
          {guides ? "Dashed box: text area. Blue line: the spine (gutter) side." : ""} Use ← → keys to turn pages. Preview of: {meta.source.label}.
        </p>
      )}
    </div>
  );
}
