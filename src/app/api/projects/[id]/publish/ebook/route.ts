// Kindle preview data: the publication model the EPUB is built from (text only; the client
// renders it with React elements, never as raw HTML).
import { requireUser } from "@/lib/auth";
import { json, handleError } from "@/lib/api";
import { previewLayout } from "@/lib/publish/service";
import { templateFor } from "@/lib/publish/templates";
import { EBOOK_SCENE_BREAK } from "@/lib/publish/epub";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const { book, source, pub } = await previewLayout(user.id, id);
    const t = templateFor(pub.layout.template);
    return json({
      meta: book.meta,
      source: { label: source.label, approved: source.approved },
      template: { id: t.id, indent: t.ebook.indent, heading: t.ebook.headingFamily, align: t.chapter.align, uppercase: t.chapter.uppercase, italic: t.chapter.italic },
      sceneBreak: EBOOK_SCENE_BREAK,
      sections: book.sections.filter((s) => s.role !== "half-title").map((s) => ({ id: s.id, role: s.role, title: s.title, inToc: s.inToc, blocks: s.role === "part" ? [] : s.blocks })),
    });
  } catch (e) {
    return handleError(e);
  }
}
