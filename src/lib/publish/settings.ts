// Publishing settings (layout choices) and book details (author-supplied front/back matter),
// stored together in Project.publishing. Details are never invented: an empty field means the
// matching page is simply left out.
import { z } from "zod";
import { DEFAULT_TRIM, trimById, paperOptions, type Ink, type Paper } from "./kdp";
import { TEMPLATE_IDS, type TemplateId } from "./templates";
import { isUntitledFront } from "../doc/import";

const text = (max: number) => z.string().max(max).default("");

export const LayoutSchema = z.object({
  trim: z.string().default(DEFAULT_TRIM).refine((v) => !!trimById(v), "Unknown trim size"),
  ink: z.enum(["bw", "standard_color", "premium_color"]).default("bw"),
  paper: z.enum(["white", "cream", "groundwood"]).default("cream"),
  bleed: z.boolean().default(false),
  template: z.enum(TEMPLATE_IDS as [TemplateId, ...TemplateId[]]).optional(),
  chapterStart: z.enum(["recto", "any"]).default("any"),
  runningHeaders: z.boolean().default(true),
  frontNumbering: z.enum(["roman", "none"]).default("roman"),
  printToc: z.boolean().default(true),
  halfTitle: z.boolean().default(true),
  /** Imported sections left out of the published editions (by chapter id). */
  excludedSections: z.array(z.string().max(64)).max(2000).default([]),
  /** Ids the author has explicitly chosen to include (overrides the default exclusions). */
  includedSections: z.array(z.string().max(64)).max(2000).default([]),
});

export const DetailsSchema = z.object({
  subtitle: text(300),
  publisher: text(200),
  copyright: text(3000),
  isbnPaperback: text(20),
  isbnEbook: text(20),
  edition: text(100),
  dedication: text(2000),
  epigraph: text(2000),
  epigraphSource: text(300),
  aboutAuthor: text(6000),
  alsoBy: text(3000),
  website: text(300),
  seriesInfo: text(1000),
});

export const PublishingSchema = z.object({
  layout: LayoutSchema.default(() => LayoutSchema.parse({})),
  details: DetailsSchema.default(() => DetailsSchema.parse({})),
});

export type LayoutSettings = z.infer<typeof LayoutSchema>;
export type BookDetails = z.infer<typeof DetailsSchema>;
export type Publishing = z.infer<typeof PublishingSchema>;

/** Read stored settings, falling back to defaults for anything missing or invalid. */
export function readPublishing(stored: unknown): Publishing {
  const r = PublishingSchema.safeParse(stored ?? {});
  if (r.success) return normalize(r.data);
  const layout = LayoutSchema.safeParse((stored as { layout?: unknown })?.layout ?? {});
  const details = DetailsSchema.safeParse((stored as { details?: unknown })?.details ?? {});
  return normalize({ layout: layout.success ? layout.data : LayoutSchema.parse({}), details: details.success ? details.data : DetailsSchema.parse({}) });
}

function normalize(p: Publishing): Publishing {
  const papers = paperOptions(p.layout.ink as Ink);
  if (!papers.includes(p.layout.paper as Paper)) p.layout.paper = papers[0];
  return p;
}

/** Normalise an ISBN for display/checks: digits and X only. */
export function cleanIsbn(v: string): string {
  return v.replace(/[^0-9Xx]/g, "").toUpperCase();
}

export function isValidIsbn(v: string): boolean {
  const s = cleanIsbn(v);
  if (s.length === 13 && /^\d{13}$/.test(s)) {
    const sum = [...s].reduce((n, d, i) => n + Number(d) * (i % 2 ? 3 : 1), 0);
    return sum % 10 === 0;
  }
  if (s.length === 10 && /^\d{9}[\dX]$/.test(s)) {
    const sum = [...s].reduce((n, d, i) => n + (d === "X" ? 10 : Number(d)) * (10 - i), 0);
    return sum % 11 === 0;
  }
  return false;
}

/**
 * Whether an imported section is printed. The untitled text before the first heading usually
 * holds the author's own title page, which the generated title page replaces, so it is left
 * out unless the author turns it back on.
 */
export function sectionIncluded(ch: { chapterId: string; title: string; kind: string }, layout: LayoutSettings): boolean {
  if (layout.includedSections.includes(ch.chapterId)) return true;
  if (layout.excludedSections.includes(ch.chapterId)) return false;
  return !isUntitledFront(ch);
}
