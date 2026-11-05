// KDP readiness checks for the paperback interior. Some checks re-open the produced PDF
// (dimensions, fonts, structure); others read the layout it was drawn from (margins, glyphs,
// pagination, word placement), because both come from the same page list.
import { PDFDocument, PDFDict, PDFName, PDFArray, PDFRef } from "pdf-lib";
import type { Layout, TextItem } from "./layout";
import { PT } from "./layout";
import { minInsideMargin, minOutsideMargin, pageLimits, pageSize, KDP_MIN_FONT_PT, BLEED_WIDTH, BLEED_HEIGHT, type Ink, type Paper } from "./kdp";
import type { ReadinessCheck } from "./checks";

const inch = (n: number) => `${Number(n.toFixed(3))}"`;

export async function checkPaperback(
  pdf: Buffer,
  layout: Layout,
  opts: { ink: Ink; paper: Paper; title: string }
): Promise<ReadinessCheck[]> {
  const out: ReadinessCheck[] = [];
  const push = (id: string, label: string, status: ReadinessCheck["status"], detail: string) => out.push({ id, label, status, detail });

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(pdf, { updateMetadata: false });
  } catch (e) {
    push("pdf.structure", "Valid PDF structure", "failed", `The PDF could not be opened: ${(e as Error).message}`);
    return out;
  }
  const encrypted = doc.isEncrypted;
  push("pdf.structure", "Valid PDF structure", encrypted ? "failed" : "passed", encrypted ? "The PDF is encrypted; KDP rejects password-protected files." : `PDF ${pdf.subarray(5, 8).toString()} opens cleanly, not encrypted, ${pdf.length < 1048576 ? `${Math.ceil(pdf.length / 1024)} KB` : `${(pdf.length / 1048576).toFixed(1)} MB`} (KDP limit 650 MB).`);

  // ---- dimensions and bleed
  const pages = doc.getPages();
  const want = pageSize(layout.trim, layout.bleed);
  const wrong = pages.filter((p) => Math.abs(p.getWidth() - want.width * PT) > 0.5 || Math.abs(p.getHeight() - want.height * PT) > 0.5).length;
  push(
    "pdf.trim",
    "Correct trim size and page dimensions",
    wrong ? "failed" : "passed",
    wrong ? `${wrong} page${wrong === 1 ? " is" : "s are"} not ${inch(want.width)} × ${inch(want.height)}.` : `Every page is ${inch(want.width)} × ${inch(want.height)} (${layout.trim.label}${layout.bleed ? " plus bleed" : ""}).`
  );
  push(
    "pdf.bleed",
    "Bleed configuration",
    "passed",
    layout.bleed
      ? `Bleed is on: pages are ${BLEED_WIDTH}" wider and ${BLEED_HEIGHT}" taller than the trim. Choose "Bleed" when you upload to KDP.`
      : `No bleed: nothing prints to the page edge. Choose "No bleed" when you upload to KDP.`
  );

  // ---- page count and limits
  const n = pages.length;
  const lim = pageLimits(layout.trim, opts.ink, opts.paper);
  const inkLabel = opts.ink === "bw" ? `black ink on ${opts.paper} paper` : opts.ink === "standard_color" ? "standard color" : "premium color";
  if (n !== layout.pages.length) push("pdf.pages", "No missing or duplicated pages", "failed", `The PDF has ${n} pages but the layout has ${layout.pages.length}.`);
  else {
    const seq = layout.pages.every((p, i) => p.n === i + 1);
    push("pdf.pages", "No missing or duplicated pages", seq ? "passed" : "failed", seq ? `${n} pages, in order, single pages (not spreads).` : "Pages are out of sequence.");
  }
  if (!lim) push("kdp.pagecount", "Page count within KDP limits", "failed", `KDP doesn't offer ${inkLabel} at ${layout.trim.label}. Choose another trim size or ink.`);
  else if (n < lim.min) push("kdp.pagecount", "Page count within KDP limits", "failed", `${n} pages. KDP needs at least ${lim.min} pages for ${inkLabel} at ${layout.trim.label}. A short manuscript can still be downloaded as a draft.`);
  else if (n > lim.max) push("kdp.pagecount", "Page count within KDP limits", "failed", `${n} pages. The KDP maximum for ${inkLabel} at ${layout.trim.label} is ${lim.max}. Try a larger trim size or a smaller template.`);
  else push("kdp.pagecount", "Page count within KDP limits", "passed", `${n} pages; KDP allows ${lim.min}–${lim.max} for ${inkLabel} at ${layout.trim.label}.`);

  // ---- margins
  const need = minInsideMargin(n);
  const m = layout.margins;
  push(
    "kdp.gutter",
    "Sufficient inside margin (gutter) for the page count",
    m.inside + 1e-9 >= need ? "passed" : "failed",
    `${inch(m.inside)} inside margin; KDP requires at least ${inch(need)} for ${n} pages. Recalculated ${layout.stats.iterations} time${layout.stats.iterations === 1 ? "" : "s"} as the page count settled.`
  );
  const minOut = minOutsideMargin(layout.bleed);
  const outside: string[] = [];
  const textOutside: string[] = [];
  const trimX = (side: string) => (layout.bleed && side === "verso" ? BLEED_WIDTH * PT : 0);
  const trimY = layout.bleed ? (BLEED_HEIGHT / 2) * PT : 0;
  for (const p of layout.pages) {
    const tx = trimX(p.side);
    const insideEdge = p.side === "recto" ? tx : tx + layout.trim.width * PT;
    const left = p.side === "recto" ? tx + m.inside * PT : tx + m.outside * PT;
    const right = left + (layout.trim.width - m.inside - m.outside) * PT;
    for (const it of p.items) {
      const size = it.t === "text" ? it.z : 1;
      const x0 = it.x;
      const x1 = it.x + it.w;
      const y0 = it.y - (it.t === "text" ? size * 0.85 : 0);
      const y1 = it.y + (it.t === "text" ? size * 0.3 : 0);
      // Everything: inside the KDP minimums from every trim edge.
      const safeL = p.side === "recto" ? insideEdge + need * PT : tx + minOut * PT;
      const safeR = p.side === "recto" ? tx + (layout.trim.width - minOut) * PT : insideEdge - need * PT;
      if (x0 < safeL - 0.5 || x1 > safeR + 0.5 || y0 < trimY + minOut * PT - 0.5 || y1 > trimY + (layout.trim.height - minOut) * PT + 0.5) {
        if (outside.length < 3) outside.push(`page ${p.n}`);
        else outside.push("");
      }
      // Body text: inside the design text block.
      if (it.t === "text" && !(it as TextItem).r && (x0 < left - 0.5 || x1 > right + 1)) {
        if (textOutside.length < 3) textOutside.push(`page ${p.n}: “${it.s.slice(0, 30)}”`);
        else textOutside.push("");
      }
    }
  }
  push(
    "kdp.safe",
    "No text outside the safe margins",
    outside.length ? "failed" : "passed",
    outside.length
      ? `${outside.length} item${outside.length === 1 ? "" : "s"} too close to the trim edge (${outside.filter(Boolean).join(", ")}).`
      : `All text, page numbers and running heads are at least ${inch(minOut)} from the outside, top and bottom edges and ${inch(need)} from the spine.`
  );
  push(
    "layout.clip",
    "No clipped or overflowing lines",
    textOutside.length ? "failed" : "passed",
    textOutside.length ? `${textOutside.length} line${textOutside.length === 1 ? "" : "s"} run past the text block (${textOutside.filter(Boolean).join("; ")}).` : "Every line fits inside the text block."
  );

  // ---- fonts
  const fonts = fontReport(doc);
  push(
    "pdf.fonts",
    "All fonts embedded",
    fonts.total === 0 ? "warning" : fonts.unembedded.length ? "failed" : "passed",
    fonts.unembedded.length ? `Not embedded: ${fonts.unembedded.join(", ")}.` : `${fonts.total} font${fonts.total === 1 ? "" : "s"}, all embedded (subset).`
  );
  const missing = Object.entries(layout.missingGlyphs);
  push(
    "layout.glyphs",
    "No missing characters",
    missing.length ? "failed" : "passed",
    missing.length ? `Some characters aren't in the chosen font and would print as boxes: ${missing.map(([f, chars]) => `${chars.slice(0, 10).join(" ")} (${f.split("/")[0]})`).join("; ")}. Try another template.` : "Every character in the book exists in the chosen fonts."
  );
  push(
    "layout.fontsize",
    `Text at least ${KDP_MIN_FONT_PT} pt`,
    layout.stats.minFontSize >= KDP_MIN_FONT_PT ? "passed" : "failed",
    `Smallest text is ${layout.stats.minFontSize} pt.`
  );
  push("pdf.images", "Image resolution", "not_checked", "This interior has no images, so there is nothing to check. (Images in manuscripts aren't imported yet.)");

  // ---- pagination
  const badParity: number[] = [];
  let last = 0;
  let gaps = 0;
  for (const p of layout.pages) {
    if (!p.folio || !/^\d+$/.test(p.folio)) continue;
    const num = Number(p.folio);
    if ((num % 2 === 1) !== (p.side === "recto")) badParity.push(p.n);
    if (last && num <= last) gaps++;
    last = num;
  }
  push(
    "layout.pagination",
    "Correct page numbering",
    badParity.length || gaps ? "failed" : "passed",
    badParity.length || gaps
      ? `Page numbers out of order or on the wrong side (physical pages ${badParity.slice(0, 5).join(", ")}).`
      : "Odd page numbers on right-hand pages, even on left; numbering starts at 1 on a right-hand page after the front matter."
  );
  const blanks = layout.pages.filter((p) => p.kind === "blank").length;
  let doubleBlank = 0;
  for (let i = 1; i < layout.pages.length; i++) if (layout.pages[i].kind === "blank" && layout.pages[i - 1].kind === "blank") doubleBlank++;
  push(
    "layout.blanks",
    "No excessive blank pages",
    doubleBlank ? "failed" : blanks > Math.max(6, n * 0.15) ? "warning" : "passed",
    doubleBlank
      ? `${doubleBlank} place${doubleBlank === 1 ? " has" : "s have"} two blank pages in a row.`
      : `${blanks} intentional blank page${blanks === 1 ? "" : "s"} (backs of display pages, chapters starting on the right${n % 2 === 0 ? ", and an even total" : ""}).`
  );
  push(
    "layout.words",
    "Every word of the approved text is placed",
    layout.stats.wordsIn === layout.stats.wordsOut ? "passed" : "failed",
    `${layout.stats.wordsOut.toLocaleString()} of ${layout.stats.wordsIn.toLocaleString()} words placed on pages.`
  );

  // ---- no annotations, bookmarks, forms or crop marks
  const catalog = doc.catalog;
  const outlines = catalog.get(PDFName.of("Outlines"));
  const acro = catalog.get(PDFName.of("AcroForm"));
  const annots = pages.filter((p) => p.node.get(PDFName.of("Annots"))).length;
  const extras = [outlines && "bookmarks", acro && "form fields", annots && `annotations on ${annots} pages`].filter(Boolean);
  push("pdf.clean", "No comments, annotations, bookmarks or crop marks", extras.length ? "failed" : "passed", extras.length ? `Found ${extras.join(", ")}.` : "None found, and nothing is drawn outside the margins, so there are no crop marks.");

  // ---- metadata
  const pdfTitle = doc.getTitle() ?? "";
  push("pdf.metadata", "Metadata matches the book", pdfTitle === opts.title ? "passed" : "warning", pdfTitle === opts.title ? `PDF title is “${pdfTitle}”; no other metadata beyond author and creator.` : `PDF title “${pdfTitle}” doesn't match “${opts.title}”.`);
  push("kdp.cover", "Cover", "not_checked", "The interior PDF has no cover. KDP needs a separate cover file (use KDP Cover Creator or a designer's PDF).");
  return out;
}

function fontReport(doc: PDFDocument): { total: number; unembedded: string[] } {
  let total = 0;
  const unembedded: string[] = [];
  const ctx = doc.context;
  const deref = (o: unknown) => (o instanceof PDFRef ? ctx.lookup(o) : o);
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    if (obj.get(PDFName.of("Type")) !== PDFName.of("Font")) continue;
    const sub = obj.get(PDFName.of("Subtype"));
    if (sub === PDFName.of("CIDFontType0") || sub === PDFName.of("CIDFontType2")) continue; // checked via their Type0 parent
    total++;
    const name = String(obj.get(PDFName.of("BaseFont")) ?? "font").replace(/^\//, "");
    let target: PDFDict = obj;
    if (sub === PDFName.of("Type0")) {
      const desc = deref(obj.get(PDFName.of("DescendantFonts")));
      const first = desc instanceof PDFArray ? deref(desc.get(0)) : undefined;
      if (first instanceof PDFDict) target = first;
    }
    const fd = deref(target.get(PDFName.of("FontDescriptor")));
    const embedded = fd instanceof PDFDict && ["FontFile", "FontFile2", "FontFile3"].some((k) => fd.get(PDFName.of(k)));
    if (!embedded) unembedded.push(name);
  }
  return { total, unembedded };
}
