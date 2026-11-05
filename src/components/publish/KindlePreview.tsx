"use client";
// Reflowable ebook preview in phone, tablet and e-reader frames, rendered with React elements
// from the same publication model as the EPUB. An app preview only: Amazon's Kindle Previewer
// is the reference.
import { useEffect, useState } from "react";

interface Run { text: string; italic?: boolean; bold?: boolean }
interface Block { type: "p" | "scene" | "subhead" | "quote" | "display"; runs: Run[]; first?: boolean; size?: string; align?: string; spaceBefore?: number }
interface Section { id: string; role: string; title: string; inToc: boolean; blocks: Block[] }
interface Ebook {
  meta: { title: string; author: string };
  source: { label: string; approved: boolean };
  template: { indent: number; heading: "serif" | "sans-serif"; align: "center" | "left"; uppercase: boolean; italic: boolean };
  sceneBreak: string;
  sections: Section[];
}

const DEVICES = {
  phone: { label: "Phone", w: 340, h: 640, bg: "#ffffff", fg: "#111", radius: 36, pad: 18, font: "Georgia, 'Times New Roman', serif" },
  tablet: { label: "Tablet", w: 560, h: 740, bg: "#ffffff", fg: "#111", radius: 24, pad: 40, font: "Georgia, 'Times New Roman', serif" },
  ereader: { label: "E-reader", w: 440, h: 600, bg: "#f4f1e8", fg: "#222", radius: 14, pad: 28, font: "'Bookerly', Georgia, serif" },
} as const;
type Device = keyof typeof DEVICES;

function Runs({ runs }: { runs: Run[] }) {
  return (
    <>
      {runs.map((r, i) => {
        const parts = r.text.split("\n");
        let node: React.ReactNode = parts.map((p, j) => (j ? [<br key={`b${j}`} />, p] : p));
        if (r.italic) node = <em>{node}</em>;
        if (r.bold) node = <strong>{node}</strong>;
        return <span key={i}>{node}</span>;
      })}
    </>
  );
}

function splitTitle(title: string): { label: string | null; name: string } {
  const m = title.match(/^((?:chapter|part|book)\s+[\p{L}\p{N}-]+)\s*[:.\-–—]\s*(.+)$/iu);
  return m ? { label: m[1], name: m[2] } : { label: null, name: title };
}

function SectionView({ s, book, onNav }: { s: Section; book: Ebook; onNav: (id: string) => void }) {
  const t = book.template;
  const hStyle: React.CSSProperties = {
    fontFamily: t.heading === "sans-serif" ? "'Helvetica Neue', Arial, sans-serif" : "inherit",
    fontWeight: "normal",
    fontSize: "1.6em",
    textAlign: s.role === "part" ? "center" : t.align,
    margin: s.role === "part" ? "40% 0 0" : "1.5em 0 1.2em",
    textTransform: t.uppercase ? "uppercase" : undefined,
    letterSpacing: t.uppercase ? "0.1em" : undefined,
    fontStyle: t.italic ? "italic" : undefined,
  };
  const { label, name } = splitTitle(s.title);
  const heading = !["title", "copyright", "dedication", "epigraph"].includes(s.role);
  if (s.role === "toc") {
    return (
      <nav aria-label="Contents">
        <h1 style={hStyle}>Contents</h1>
        <ol className="space-y-2" style={{ listStyle: "none", padding: 0 }}>
          {book.sections.filter((x) => x.inToc).map((x) => (
            <li key={x.id} style={{ paddingLeft: x.role === "chapter" && book.sections.some((y) => y.role === "part") ? "1.5em" : 0 }}>
              <button type="button" onClick={() => onNav(x.id)} className="text-left underline decoration-dotted underline-offset-4">{x.title}</button>
            </li>
          ))}
        </ol>
      </nav>
    );
  }
  return (
    <section style={["dedication", "epigraph"].includes(s.role) ? { marginTop: "25%" } : s.role === "title" ? { marginTop: "20%" } : undefined}>
      {heading && (
        <h1 style={hStyle}>
          {label ? <><span style={{ display: "block", fontSize: "0.55em", textTransform: "uppercase", letterSpacing: "0.15em", marginBottom: "0.5em", fontStyle: "normal" }}>{label}</span>{name}</> : s.title}
        </h1>
      )}
      {s.blocks.map((b, i) => {
        if (b.type === "scene") return <p key={i} style={{ textAlign: "center", margin: "1em 0" }} aria-label="Scene break">{book.sceneBreak}</p>;
        if (b.type === "subhead") return <h2 key={i} style={{ fontSize: "1.15em", margin: "1.5em 0 0.5em" }}><Runs runs={b.runs} /></h2>;
        if (b.type === "quote") return <blockquote key={i} style={{ margin: "1em 1.5em" }}><p><Runs runs={b.runs} /></p></blockquote>;
        if (b.type === "display") {
          const size = b.size === "title" ? "2em" : b.size === "subtitle" || b.size === "author" ? "1.2em" : b.size === "small" ? "0.8em" : "1em";
          return <p key={i} style={{ textAlign: b.align === "left" ? "left" : "center", fontSize: size, margin: b.size === "author" ? "2em 0 0" : "0 0 0.6em" }}><Runs runs={b.runs} /></p>;
        }
        return (
          <p key={i} style={{ margin: 0, textIndent: b.first || b.align === "center" ? 0 : `${t.indent}em`, textAlign: b.align === "center" ? "center" : "justify", hyphens: "auto" }}>
            <Runs runs={b.runs} />
          </p>
        );
      })}
    </section>
  );
}

export function KindlePreview({ projectId, version }: { projectId: string; version: number }) {
  const [book, setBook] = useState<Ebook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [device, setDevice] = useState<Device>("phone");
  const [size, setSize] = useState(100);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    let live = true;
    fetch(`/api/projects/${projectId}/publish/ebook`, { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Preview failed");
        if (live) {
          setBook(d);
          setError(null);
        }
      })
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [projectId, version]);

  const d = DEVICES[device];
  const sec = book?.sections[Math.min(idx, (book?.sections.length ?? 1) - 1)];
  const nav = (id: string) => setIdx(Math.max(0, book?.sections.findIndex((s) => s.id === id) ?? 0));

  return (
    <div>
      <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
        This is an app preview of the reflowable Kindle edition. Real Kindle devices and apps choose their own fonts and spacing; check the final file in Amazon&apos;s free Kindle Previewer before publishing.
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        {(Object.keys(DEVICES) as Device[]).map((k) => (
          <button key={k} type="button" onClick={() => setDevice(k)} className={device === k ? "btn-primary" : "btn-ghost"} aria-pressed={device === k}>{DEVICES[k].label}</button>
        ))}
        <label className="ml-2 inline-flex items-center gap-2">
          Text size
          <input type="range" min={70} max={180} step={10} value={size} onChange={(e) => setSize(Number(e.target.value))} aria-label="Text size" />
          <span className="w-10 tabular-nums muted">{size}%</span>
        </label>
        {book && (
          <select className="input w-auto py-1" value={sec?.id} onChange={(e) => nav(e.target.value)} aria-label="Go to section">
            {book.sections.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex justify-center rounded-lg bg-stone-200 p-6">
        <div style={{ width: d.w, height: d.h, borderRadius: d.radius, background: "#1c1c1c", padding: device === "ereader" ? 22 : 12 }} className="shadow-lg">
          <div
            style={{ background: d.bg, color: d.fg, borderRadius: Math.max(4, d.radius - 12), height: "100%", overflowY: "auto", padding: d.pad, fontFamily: d.font, fontSize: `${(16 * size) / 100}px`, lineHeight: 1.45 }}
            lang="en"
            aria-label={`${d.label} preview`}
          >
            {book && sec ? <SectionView s={sec} book={book} onNav={nav} /> : <p className="muted">{error ? "" : "Loading…"}</p>}
          </div>
        </div>
      </div>
      {book && (
        <div className="mt-3 flex items-center justify-center gap-3 text-sm">
          <button type="button" className="btn-ghost" disabled={idx === 0} onClick={() => setIdx((i) => Math.max(0, i - 1))}>← Previous section</button>
          <span className="muted">{idx + 1} of {book.sections.length}</span>
          <button type="button" className="btn-ghost" disabled={idx >= book.sections.length - 1} onClick={() => setIdx((i) => Math.min(book.sections.length - 1, i + 1))}>Next section →</button>
        </div>
      )}
    </div>
  );
}
