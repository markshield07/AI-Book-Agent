// Renders a print layout to a KDP interior PDF with pdfkit: single pages at the exact trim
// (plus bleed when chosen), every font embedded as a subset, no crop marks, no outline
// (bookmarks), no annotations or comments, no encryption, and only title/author metadata.
import PDFDocument from "pdfkit";
import { fontBytes, type FontKey } from "./fonts";
import type { Layout } from "./layout";

export async function renderPdf(layout: Layout, meta: { title: string; author: string }): Promise<Buffer> {
  const doc = new PDFDocument({
    autoFirstPage: false,
    size: [layout.width, layout.height],
    margin: 0,
    pdfVersion: "1.4",
    compress: true,
    info: { Title: meta.title, Author: meta.author, Creator: "The Editorial Studio", Producer: "The Editorial Studio" },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const registered = new Set<string>();
  const use = (f: FontKey) => {
    if (!registered.has(f)) {
      doc.registerFont(f, fontBytes(f));
      registered.add(f);
    }
    doc.font(f);
  };

  for (const page of layout.pages) {
    doc.addPage({ size: [layout.width, layout.height], margin: 0 });
    for (const it of page.items) {
      if (it.t === "rule") {
        doc.save().lineWidth(0.5).strokeColor("#000000").moveTo(it.x, it.y).lineTo(it.x + it.w, it.y).stroke().restore();
        continue;
      }
      use(it.f);
      doc.fontSize(it.z).fillColor("#000000");
      doc.text(it.s, it.x, it.y, {
        lineBreak: false,
        baseline: "alphabetic",
        wordSpacing: it.ws ?? 0,
        characterSpacing: it.ls ?? 0,
      });
    }
  }
  doc.end();
  return done;
}
