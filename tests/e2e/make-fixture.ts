// Builds a realistic test manuscript (.docx) with dialogue, slang, italics, scene breaks,
// Unicode and deliberate mechanical errors.
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";

export async function fixtureDocx(): Promise<Buffer> {
  const P = (...runs: (string | { t: string; i?: boolean; b?: boolean })[]) =>
    new Paragraph({ children: runs.map((r) => (typeof r === "string" ? new TextRun(r) : new TextRun({ text: r.t, italics: r.i, bold: r.b }))) });
  const H = (t: string) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] });
  return Packer.toBuffer(new Document({ sections: [{ children: [
    new Paragraph({ style: "Title", children: [new TextRun("Southside Summer")] }),
    H("Chapter One"),
    P("“Ain't nobody could of told me that,” Dre said, grinning at Zoë."),
    P("He saw the the dog , and i ran toward it. Teh sky was gray over the ", { t: "Wabash", i: true }, " bridge."),
    P("She looked at him, not knowing what she should say next."),
    P("* * *"),
    P("Morning came alot slower than he wanted. ", { t: "Not today,", i: true }, " he thought."),
    H("Chapter Two"),
    P("It rained. Marisol definately knew why the café on 47th was closed — and she wasn't telling."),
    P("“You good?” “I'm good.” Nobody believed it."),
  ] }] }));
}
