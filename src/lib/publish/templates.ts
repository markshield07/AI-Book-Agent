// Interior design templates. A template only changes presentation (fonts, sizes, spacing,
// headings); it never changes the approved text. Sizes are in points, indents in ems.
import type { FamilyId } from "./fonts";

export type TemplateId = "classic" | "modern" | "literary" | "nonfiction" | "memoir";

export interface BookTemplate {
  id: TemplateId;
  name: string;
  description: string;
  body: FamilyId;
  heading: FamilyId;
  bodySize: number;
  leading: number; // baseline-to-baseline, pt
  indent: number; // first-line indent, em
  justify: boolean;
  hyphenate: boolean;
  /** Paragraph after a chapter heading, subheading or scene break. */
  firstParagraph: "flush" | "indent";
  /** Extra space between paragraphs, in lines (0 for traditional fiction). */
  paragraphSpace: number;
  chapter: {
    sink: number; // fraction of the text block left empty above the chapter title
    labelSize: number; // "Chapter One" line, when the title has a label and a name
    titleSize: number;
    align: "center" | "left";
    uppercase: boolean;
    italic: boolean;
    tracking: number; // letter spacing, em
    rule: boolean; // thin rule under the heading
    spaceAfter: number; // lines between heading and first paragraph
  };
  sceneBreak: string;
  header: { size: number; uppercase: boolean; italic: boolean; tracking: number; verso: "author" | "title"; recto: "title" | "chapter" };
  folioSize: number;
  subheading: { size: number; bold: boolean; italic: boolean; family: "body" | "heading" };
  blockquote: { indent: number; scale: number; italic: boolean };
  /** Ebook CSS knobs (reflowable, em-based). */
  ebook: { indent: number; headingFamily: "serif" | "sans-serif" };
}

export const TEMPLATES: Record<TemplateId, BookTemplate> = {
  classic: {
    id: "classic",
    name: "Classic Novel",
    description: "Traditional Garamond typography, indented paragraphs and quiet chapter openings.",
    body: "eb-garamond",
    heading: "eb-garamond",
    bodySize: 11.5,
    leading: 15,
    indent: 1.5,
    justify: true,
    hyphenate: true,
    firstParagraph: "flush",
    paragraphSpace: 0,
    chapter: { sink: 0.28, labelSize: 11, titleSize: 20, align: "center", uppercase: false, italic: false, tracking: 0.02, rule: false, spaceAfter: 2 },
    sceneBreak: "*   *   *",
    header: { size: 9, uppercase: true, italic: false, tracking: 0.12, verso: "author", recto: "title" },
    folioSize: 10,
    subheading: { size: 12, bold: false, italic: true, family: "body" },
    blockquote: { indent: 1.5, scale: 0.95, italic: false },
    ebook: { indent: 1.5, headingFamily: "serif" },
  },
  modern: {
    id: "modern",
    name: "Modern Fiction",
    description: "Contemporary Source Serif text with clean sans-serif chapter headings and generous space.",
    body: "source-serif-4",
    heading: "source-sans-3",
    bodySize: 10.5,
    leading: 15,
    indent: 1.2,
    justify: true,
    hyphenate: true,
    firstParagraph: "flush",
    paragraphSpace: 0,
    chapter: { sink: 0.22, labelSize: 10, titleSize: 22, align: "left", uppercase: false, italic: false, tracking: 0, rule: true, spaceAfter: 2.5 },
    sceneBreak: "•",
    header: { size: 8.5, uppercase: true, italic: false, tracking: 0.15, verso: "author", recto: "title" },
    folioSize: 9,
    subheading: { size: 11.5, bold: true, italic: false, family: "heading" },
    blockquote: { indent: 1.5, scale: 0.95, italic: false },
    ebook: { indent: 1.2, headingFamily: "sans-serif" },
  },
  literary: {
    id: "literary",
    name: "Literary Fiction",
    description: "Elegant Crimson Pro, traditional proportions and subtle small-caps headings.",
    body: "crimson-pro",
    heading: "crimson-pro",
    bodySize: 12,
    leading: 15.5,
    indent: 1.4,
    justify: true,
    hyphenate: true,
    firstParagraph: "flush",
    paragraphSpace: 0,
    chapter: { sink: 0.33, labelSize: 10.5, titleSize: 17, align: "center", uppercase: true, italic: false, tracking: 0.18, rule: false, spaceAfter: 2.5 },
    sceneBreak: "❧",
    header: { size: 9.5, uppercase: false, italic: true, tracking: 0.02, verso: "author", recto: "title" },
    folioSize: 10,
    subheading: { size: 12, bold: false, italic: true, family: "body" },
    blockquote: { indent: 1.5, scale: 1, italic: true },
    ebook: { indent: 1.4, headingFamily: "serif" },
  },
  nonfiction: {
    id: "nonfiction",
    name: "Nonfiction",
    description: "Readable Source Serif text with sans-serif section headings, block quotations and chapter-title headers.",
    body: "source-serif-4",
    heading: "source-sans-3",
    bodySize: 10.5,
    leading: 14.5,
    indent: 1.2,
    justify: true,
    hyphenate: true,
    firstParagraph: "flush",
    paragraphSpace: 0.25,
    chapter: { sink: 0.18, labelSize: 10, titleSize: 20, align: "left", uppercase: false, italic: false, tracking: 0, rule: true, spaceAfter: 2 },
    sceneBreak: "•   •   •",
    header: { size: 8.5, uppercase: true, italic: false, tracking: 0.12, verso: "title", recto: "chapter" },
    folioSize: 9,
    subheading: { size: 12.5, bold: true, italic: false, family: "heading" },
    blockquote: { indent: 2, scale: 0.92, italic: false },
    ebook: { indent: 1.2, headingFamily: "sans-serif" },
  },
  memoir: {
    id: "memoir",
    name: "Memoir",
    description: "Warm Lora text in a traditional narrative layout with flexible, italic chapter headings.",
    body: "lora",
    heading: "lora",
    bodySize: 10.5,
    leading: 15,
    indent: 1.4,
    justify: true,
    hyphenate: true,
    firstParagraph: "flush",
    paragraphSpace: 0,
    chapter: { sink: 0.25, labelSize: 10, titleSize: 19, align: "center", uppercase: false, italic: true, tracking: 0, rule: false, spaceAfter: 2 },
    sceneBreak: "*  *  *",
    header: { size: 8.5, uppercase: false, italic: true, tracking: 0.02, verso: "author", recto: "title" },
    folioSize: 9.5,
    subheading: { size: 11.5, bold: false, italic: true, family: "body" },
    blockquote: { indent: 1.5, scale: 0.95, italic: true },
    ebook: { indent: 1.4, headingFamily: "serif" },
  },
};

export const TEMPLATE_IDS = Object.keys(TEMPLATES) as TemplateId[];

export function templateFor(id: string | undefined, isFiction = true): BookTemplate {
  if (id && Object.hasOwn(TEMPLATES, id)) return TEMPLATES[id as TemplateId];
  return TEMPLATES[isFiction ? "classic" : "nonfiction"];
}

/**
 * "Chapter Three: The Keeper" -> label "Chapter Three", name "The Keeper". A bare "Chapter 3"
 * stays as a single title. Purely presentational: the text printed is the author's own.
 */
export function splitChapterTitle(title: string): { label: string | null; name: string } {
  const m = title.match(/^((?:chapter|part|book)\s+[\p{L}\p{N}-]+)\s*[:.\-–—]\s*(.+)$/iu);
  if (m) return { label: m[1], name: m[2] };
  return { label: null, name: title };
}
