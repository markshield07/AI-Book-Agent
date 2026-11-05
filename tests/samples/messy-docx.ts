// A Word file with the things real manuscripts contain: parts, repeated chapter names, footnotes,
// tracked changes, comments, a poem with line breaks, lists, a table, an image, a hyperlink,
// a bold "CHAPTER TWO" with no heading style, and back matter.
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, FootnoteReferenceRun, InsertedTextRun, DeletedTextRun, Table, TableRow, TableCell, ExternalHyperlink, ImageRun, PageBreak, Header, Footer, CommentRangeStart, CommentRangeEnd, CommentReference } from "docx";


const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const P = (t: string, o: Record<string, unknown> = {}) => new Paragraph({ children: [new TextRun(t)], ...o });
const H = (t: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]) => new Paragraph({ heading: level, children: [new TextRun(t)] });
export const messyDocx = () => Packer.toBuffer(new Document({
  comments: { children: [{ id: 0, author: "Editor", date: new Date(), children: [new Paragraph("Check this")] }] },
  footnotes: { 1: { children: [new Paragraph("A footnote about the reef.")] } },
  sections: [{
    headers: { default: new Header({ children: [P("RUNNING HEADER TEXT")] }) },
    footers: { default: new Footer({ children: [P("Page footer")] }) },
    children: [
      new Paragraph({ style: "Title", children: [new TextRun("Messy Book")] }),
      P("Copyright © 2026 M. Shield. All rights reserved."),
      H("Part One: The Island", HeadingLevel.HEADING_1),
      H("Chapter 1", HeadingLevel.HEADING_2),
      new Paragraph({ children: [new TextRun("She saw the reef"), new FootnoteReferenceRun(1), new TextRun(" at dawn.")] }),
      new Paragraph({ children: [new TextRun("Roses are red,"), new TextRun({ text: "violets are blue,", break: 1 }), new TextRun({ text: "the sea is cold.", break: 1 })] }),
      new Paragraph({ children: [new TextRun("He "), new DeletedTextRun({ text: "walked ", id: 1, author: "A", date: "2026-01-01T00:00:00Z" }), new InsertedTextRun({ text: "ran ", id: 2, author: "A", date: "2026-01-01T00:00:00Z" }), new TextRun("home.")] }),
      new Paragraph({ children: [new CommentRangeStart(0), new TextRun("A commented sentence."), new CommentRangeEnd(0), new TextRun({ children: [new CommentReference(0)] })] }),
      new Paragraph({ text: "First item", numbering: undefined, bullet: { level: 0 } }),
      new Paragraph({ text: "Second item", bullet: { level: 0 } }),
      new Table({ rows: [new TableRow({ children: [new TableCell({ children: [P("Cell A")] }), new TableCell({ children: [P("Cell B")] })] })] }),
      new Paragraph({ children: [new ImageRun({ type: "png", data: png, transformation: { width: 10, height: 10 } })] }),
      new Paragraph({ children: [new TextRun("Visit "), new ExternalHyperlink({ link: "https://example.com", children: [new TextRun({ text: "my site", style: "Hyperlink" })] }), new TextRun(".")] }),
      new Paragraph({ children: [new TextRun("Wait — what…\tTabbed. Emoji 🌊 and “quotes”.")] }),
      new Paragraph({ children: [new PageBreak()] }),
      H("Chapter 2", HeadingLevel.HEADING_2),
      P("Second chapter text."),
      H("Part Two: The Sea", HeadingLevel.HEADING_1),
      H("Chapter 1", HeadingLevel.HEADING_2),
      P("Part two restarts numbering."),
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "CHAPTER TWO", bold: true })] }),
      P("Bold centered heading without a style."),
      H("Epilogue", HeadingLevel.HEADING_2),
      P("The end."),
      H("Acknowledgments", HeadingLevel.HEADING_2),
      P("Thanks to all."),
    ],
  }],
}));
