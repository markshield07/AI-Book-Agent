// KDP-compatible Kindle DOCX: the same publication model as the EPUB, as a Word file with real
// styles. No headers, footers or page numbers (Kindle is reflowable), chapters as Heading 1
// starting on a new page so KDP builds the table of contents, italics kept as character
// formatting, scene breaks centred, and no manual spaces or tabs for layout.
import { AlignmentType, Document, HeadingLevel, LineRuleType, Packer, Paragraph, TextRun } from "docx";
import mammoth from "mammoth";
import JSZip from "jszip";
import type { Book, Block, Run } from "./book";
import { EBOOK_SCENE_BREAK } from "./epub";
import type { ReadinessCheck } from "./checks";

const font = "Georgia";

function runs(rs: Run[]): TextRun[] {
  return rs.flatMap((r) => r.text.split("\n").map((t, i) => new TextRun({ text: t, italics: r.italic, bold: r.bold, ...(i > 0 ? { break: 1 } : {}) })));
}

function para(b: Block): Paragraph {
  switch (b.type) {
    case "scene":
      return new Paragraph({ style: "SceneBreak", children: [new TextRun(EBOOK_SCENE_BREAK)] });
    case "subhead":
      return new Paragraph({ heading: HeadingLevel.HEADING_2, children: runs(b.runs) });
    case "quote":
      return new Paragraph({ style: "BlockQuote", children: runs(b.runs) });
    case "display":
      return new Paragraph({ style: b.size === "title" ? "BookTitle" : b.size === "small" ? (b.align === "left" ? "SmallLeft" : "Small") : "Display", children: runs(b.runs) });
    default:
      return new Paragraph({ style: b.align === "center" ? "Display" : b.first ? "FirstParagraph" : "BodyText", children: runs(b.runs) });
  }
}

export async function buildKindleDocx(book: Book): Promise<Buffer> {
  const children: Paragraph[] = [];
  for (const sec of book.sections) {
    if (sec.role === "half-title" || sec.role === "toc") continue; // KDP generates the Kindle TOC from Heading 1
    const first = children.length === 0;
    if (sec.display && sec.role !== "part") {
      sec.blocks.forEach((b, i) => {
        const p = para(b);
        children.push(i === 0 && !first ? new Paragraph({ style: b.size === "title" ? "BookTitle" : "Display", pageBreakBefore: true, children: runs(b.runs) }) : p);
      });
      continue;
    }
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: !first, children: [new TextRun(sec.title)] }));
    if (sec.role !== "part") for (const b of sec.blocks) children.push(para(b));
  }
  const doc = new Document({
    creator: book.meta.author,
    title: book.meta.title,
    styles: {
      default: { document: { run: { font, size: 24 } } },
      paragraphStyles: [
        { id: "BodyText", name: "Body Text", basedOn: "Normal", run: { font, size: 24 }, paragraph: { indent: { firstLine: 360 }, spacing: { line: 276, lineRule: LineRuleType.AUTO, before: 0, after: 0 }, alignment: AlignmentType.JUSTIFIED } },
        { id: "FirstParagraph", name: "First Paragraph", basedOn: "BodyText", next: "BodyText", paragraph: { indent: { firstLine: 0 } } },
        { id: "BlockQuote", name: "Block Quote", basedOn: "Normal", paragraph: { indent: { left: 720, right: 720 }, spacing: { before: 120, after: 120 } } },
        { id: "SceneBreak", name: "Scene Break", basedOn: "Normal", next: "FirstParagraph", paragraph: { alignment: AlignmentType.CENTER, spacing: { before: 240, after: 240 } } },
        { id: "BookTitle", name: "Book Title", basedOn: "Normal", run: { font, size: 44 }, paragraph: { alignment: AlignmentType.CENTER, spacing: { before: 1440, after: 360 } } },
        { id: "Display", name: "Display", basedOn: "Normal", paragraph: { alignment: AlignmentType.CENTER, spacing: { before: 120, after: 120 } } },
        { id: "Small", name: "Small", basedOn: "Normal", run: { size: 18 }, paragraph: { alignment: AlignmentType.CENTER, spacing: { after: 120 } } },
        { id: "SmallLeft", name: "Small Left", basedOn: "Small", paragraph: { alignment: AlignmentType.LEFT } },
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "FirstParagraph", run: { font, size: 36, bold: false, color: "000000" }, paragraph: { alignment: AlignmentType.CENTER, spacing: { before: 720, after: 480 }, keepNext: true } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "FirstParagraph", run: { font, size: 28, bold: true, color: "000000" }, paragraph: { spacing: { before: 360, after: 120 }, keepNext: true } },
      ],
    },
    sections: [{ properties: {}, children }],
  });
  return Packer.toBuffer(doc);
}

/** Re-open the DOCX: every word present, no headers/footers, chapters as Heading 1. */
export async function checkKindleDocx(buf: Buffer, book: Book, expectedWords: number): Promise<ReadinessCheck[]> {
  const out: ReadinessCheck[] = [];
  let html = "";
  try {
    html = (await mammoth.convertToHtml({ buffer: buf })).value;
  } catch (e) {
    return [{ id: "docx.opens", label: "Opens as a Word document", status: "failed", detail: (e as Error).message }];
  }
  out.push({ id: "docx.opens", label: "Opens as a Word document", status: "passed", detail: `${buf.length.toLocaleString()} bytes` });
  const h1 = (html.match(/<h1>/g) ?? []).length;
  const expectedH1 = book.sections.filter((s) => !s.display && s.role !== "half-title" && s.role !== "toc").length + book.sections.filter((s) => s.role === "part").length;
  out.push({ id: "docx.headings", label: "Chapters use Heading 1 (for the Kindle table of contents)", status: h1 === expectedH1 ? "passed" : "failed", detail: `${h1} Heading 1 paragraphs; ${expectedH1} expected.` });
  // Count from the HTML view: raw text glues words either side of a line break together.
  const text = html.replace(/<\/?(?:em|strong|span|a|b|i|u|sup|sub)(?:\s[^>]*)?>/g, "").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ");
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu)?.length ?? 0;
  out.push({ id: "docx.words", label: "Every word of the approved text is present", status: words === expectedWords ? "passed" : "failed", detail: `${words.toLocaleString()} words in the file; ${expectedWords.toLocaleString()} expected.` });
  const zip = await JSZip.loadAsync(buf);
  const hf = Object.keys(zip.files).filter((n) => /^word\/(header|footer)\d*\.xml$/.test(n));
  const docXml = (await zip.file("word/document.xml")?.async("string")) ?? "";
  const pageFields = /PAGE\b|w:fldSimple/.test(docXml);
  out.push({
    id: "docx.reflow",
    label: "No print headers, footers or page numbers",
    status: hf.length || pageFields ? "failed" : "passed",
    detail: hf.length || pageFields ? "The file contains print headers, footers or page-number fields." : "The file has no header, footer or page-number parts.",
  });
  return out;
}
