// Editorial change report: every suggestion with its decision, plus the AI contribution summary
// authors need for KDP's AI-content questions.
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } from "docx";
import { db } from "../db";
import { MODE_LABEL } from "../projects";

const STATUS: Record<string, string> = { PENDING: "Pending", ACCEPTED: "Accepted", REJECTED: "Rejected", MODIFIED: "Accepted with author changes" };

export async function buildReportDocx(projectId: string, project: { title: string; authorName: string; editingMode: string }) {
  const [chapters, jobs] = await Promise.all([
    db.chapter.findMany({
      where: { projectId, active: true },
      orderBy: { position: "asc" },
      include: { suggestions: { orderBy: [{ paragraphId: "asc" }, { start: "asc" }] } },
    }),
    db.job.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } }),
  ]);
  const all = chapters.flatMap((c) => c.suggestions);
  const edits = all.filter((s) => s.kind === "edit");
  const applied = edits.filter((s) => s.status === "ACCEPTED" || s.status === "MODIFIED");
  const additions = applied.filter((s) => s.contribution === "addition");
  const cell = (t: string, bold = false) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: t, bold, size: 18 })] })] });

  const children: (Paragraph | Table)[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(`Editorial Report: ${project.title}`)] }),
    new Paragraph({ children: [new TextRun(`Author: ${project.authorName}`)] }),
    new Paragraph({ children: [new TextRun(`Generated ${new Date().toISOString().slice(0, 10)} by The Editorial Studio`)] }),
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Summary")] }),
    new Paragraph(`Suggested edits: ${edits.length}. Accepted: ${edits.filter((s) => s.status === "ACCEPTED").length}. Accepted with author changes: ${edits.filter((s) => s.status === "MODIFIED").length}. Rejected: ${edits.filter((s) => s.status === "REJECTED").length}. Pending: ${edits.filter((s) => s.status === "PENDING").length}.`),
    new Paragraph(`Editorial notes: ${all.filter((s) => s.kind === "note").length}.`),
    new Paragraph(`Editing passes: ${jobs.map((j) => `${MODE_LABEL[j.editingMode]} (${j.provider === "anthropic" ? `AI: ${j.model}` : "automatic checks"}, ${j.status.toLowerCase()})`).join("; ") || "none"}.`),
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("AI contribution")] }),
    new Paragraph(
      `${applied.length} accepted change${applied.length === 1 ? "" : "s"} edited the author's existing text. ${additions.length} accepted change${
        additions.length === 1 ? "" : "s"
      } added new material suggested by the AI.`
    ),
    new Paragraph({
      children: [
        new TextRun({
          italics: true,
          text: "Amazon KDP asks publishers to disclose AI-generated content (text, images or translations created by AI) and treats AI-assisted editing of your own work differently. This report is information to help you answer; it is not a declaration made on your behalf. Check KDP's current content guidelines before publishing.",
        }),
      ],
    }),
  ];
  for (const ch of chapters) {
    if (!ch.suggestions.length) continue;
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(ch.title)] }));
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({ children: [cell("Original", true), cell("Suggestion", true), cell("Why", true), cell("Decision", true)] }),
          ...ch.suggestions.map(
            (s) =>
              new TableRow({
                children: [
                  cell(s.kind === "note" ? "(note)" : s.originalText || "(insertion)"),
                  cell(s.kind === "note" ? "" : s.status === "MODIFIED" ? `${s.authorText ?? ""} (author's version)` : s.suggestedText || "(delete)"),
                  cell(`${s.category}: ${s.explanation}`),
                  cell(s.kind === "note" ? (s.status === "PENDING" ? "Open" : "Resolved") : STATUS[s.status]),
                ],
              })
          ),
        ],
      })
    );
  }
  return Packer.toBuffer(new Document({ creator: "The Editorial Studio", title: `${project.title} editorial report`, sections: [{ children }] }));
}
