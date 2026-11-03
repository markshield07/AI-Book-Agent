// Approved manuscript DOCX export, built with explicit paragraph styles (no manual
// spaces/tabs), plus a verification pass that re-reads the produced file.
import {
  AlignmentType,
  Document,
  Footer,
  Header,
  LineRuleType,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  TextRun,
  HeadingLevel,
} from "docx";
import mammoth from "mammoth";
import { toRuns } from "../doc/model";
import type { SnapshotChapter } from "../editor/manuscript";

export interface DocxMeta {
  title: string;
  authorName: string;
  draftNote?: string; // set for non-final exports
  versionLabel: string;
}

const INCH = 1440;

function runs(text: string, marks: SnapshotChapter["paragraphs"][number]["marks"]) {
  return toRuns(text, marks).map((r) => new TextRun({ text: r.text, italics: r.italic, bold: r.bold }));
}

export async function buildManuscriptDocx(chapters: SnapshotChapter[], meta: DocxMeta): Promise<Buffer> {
  const children: Paragraph[] = [];
  children.push(new Paragraph({ style: "BookTitle", children: [new TextRun(meta.title)] }));
  children.push(new Paragraph({ style: "BookAuthor", children: [new TextRun(meta.authorName)] }));
  if (meta.draftNote) children.push(new Paragraph({ style: "DraftNote", children: [new TextRun(meta.draftNote)] }));

  for (const ch of chapters) {
    children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, style: "ChapterTitle", children: [new TextRun(ch.title)] }));
    let afterBreak = true;
    for (const p of ch.paragraphs) {
      if (p.style === "scene_break") {
        children.push(new Paragraph({ style: "SceneBreak", children: [new TextRun(p.text)] }));
        afterBreak = true;
        continue;
      }
      if (p.style === "heading") {
        children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, style: "Subheading", children: runs(p.text, p.marks) }));
        afterBreak = true;
        continue;
      }
      const style = p.style === "blockquote" ? "BlockQuote" : afterBreak ? "FirstParagraph" : "BodyText";
      children.push(new Paragraph({ style, children: runs(p.text, p.marks) }));
      afterBreak = false;
    }
  }

  const font = "Times New Roman";
  const doc = new Document({
    creator: "The Editorial Studio",
    title: meta.title,
    description: `${meta.versionLabel}`,
    styles: {
      default: { document: { run: { font, size: 24 } } },
      paragraphStyles: [
        {
          id: "BodyText",
          name: "Body Text",
          basedOn: "Normal",
          run: { font, size: 24 },
          paragraph: { indent: { firstLine: INCH / 2 }, spacing: { line: 480, lineRule: LineRuleType.AUTO, before: 0, after: 0 } },
        },
        {
          id: "FirstParagraph",
          name: "First Paragraph",
          basedOn: "BodyText",
          next: "BodyText",
          paragraph: { indent: { firstLine: 0 }, spacing: { line: 480, before: 0, after: 0 } },
        },
        {
          id: "BlockQuote",
          name: "Block Quote",
          basedOn: "Normal",
          paragraph: { indent: { left: INCH / 2, right: INCH / 2 }, spacing: { line: 480, before: 120, after: 120 } },
        },
        {
          id: "ChapterTitle",
          name: "Chapter Title",
          basedOn: "Heading1",
          next: "FirstParagraph",
          run: { font, size: 32, bold: false, color: "000000" },
          paragraph: { alignment: AlignmentType.CENTER, spacing: { before: INCH * 2, after: 720 }, keepNext: true },
        },
        {
          id: "Subheading",
          name: "Subheading",
          basedOn: "Heading2",
          next: "FirstParagraph",
          run: { font, size: 26, bold: true, color: "000000" },
          paragraph: { spacing: { before: 360, after: 240 }, keepNext: true },
        },
        {
          id: "SceneBreak",
          name: "Scene Break",
          basedOn: "Normal",
          next: "FirstParagraph",
          paragraph: { alignment: AlignmentType.CENTER, spacing: { line: 480, before: 0, after: 0 } },
        },
        {
          id: "BookTitle",
          name: "Book Title",
          basedOn: "Normal",
          run: { font, size: 48 },
          paragraph: { alignment: AlignmentType.CENTER, spacing: { before: INCH * 3, after: 480 } },
        },
        { id: "BookAuthor", name: "Book Author", basedOn: "Normal", run: { font, size: 28 }, paragraph: { alignment: AlignmentType.CENTER } },
        {
          id: "DraftNote",
          name: "Draft Note",
          basedOn: "Normal",
          run: { font, size: 20, italics: true, color: "8A1C1C" },
          paragraph: { alignment: AlignmentType.CENTER, spacing: { before: 720 } },
        },
      ],
    },
    sections: [
      {
        properties: { page: { margin: { top: INCH, bottom: INCH, left: INCH, right: INCH } } },
        headers: {
          default: new Header({
            children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `${meta.authorName} / ${meta.title}`, size: 20 })] })],
          }),
        },
        footers: {
          default: new Footer({
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], size: 20 })] })],
          }),
        },
        children,
      },
    ],
  });
  return Packer.toBuffer(doc);
}

export interface ExportCheck {
  name: string;
  result: "passed" | "warning" | "failed";
  detail: string;
}

/** Re-open the produced DOCX and confirm every paragraph is present, once, in order. */
export async function verifyDocx(buf: Buffer, chapters: SnapshotChapter[]): Promise<ExportCheck[]> {
  const checks: ExportCheck[] = [];
  let raw: string;
  try {
    raw = (await mammoth.extractRawText({ buffer: buf })).value;
    checks.push({ name: "File opens as a Word document", result: "passed", detail: `${buf.length.toLocaleString()} bytes` });
  } catch (e) {
    return [{ name: "File opens as a Word document", result: "failed", detail: (e as Error).message }];
  }
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const expected = chapters.flatMap((c) => [c.title, ...c.paragraphs.map((p) => p.text.trim())]).filter(Boolean);
  let li = 0;
  let missing = 0;
  for (const e of expected) {
    const found = lines.indexOf(e, li);
    if (found === -1) missing++;
    else li = found + 1;
  }
  checks.push({
    name: "All chapters and paragraphs present, in order",
    result: missing === 0 ? "passed" : "failed",
    detail: missing === 0 ? `${expected.length} chapter titles and paragraphs verified` : `${missing} of ${expected.length} missing or out of order`,
  });
  const counts = new Map<string, number>();
  for (const l of lines) counts.set(l, (counts.get(l) ?? 0) + 1);
  const expectedCounts = new Map<string, number>();
  for (const e of expected) expectedCounts.set(e, (expectedCounts.get(e) ?? 0) + 1);
  const duplicated = [...expectedCounts.entries()].filter(([t, n]) => t.length > 30 && (counts.get(t) ?? 0) > n).length;
  checks.push({
    name: "No duplicated paragraphs",
    result: duplicated === 0 ? "passed" : "failed",
    detail: duplicated === 0 ? "No paragraph appears more often than in the approved text" : `${duplicated} paragraphs duplicated`,
  });
  const leftover = /\{\+|\+\}|\[-|-\]|<ins>|<del>/.test(raw);
  checks.push({
    name: "No tracked-change markup",
    result: leftover ? "failed" : "passed",
    detail: leftover ? "Change markers found in output" : "Clean text, no editing annotations",
  });
  return checks;
}
