// Print preview: pages from the real print layout (the same one the PDF is drawn from).
import { requireUser } from "@/lib/auth";
import { json, handleError } from "@/lib/api";
import { previewLayout } from "@/lib/publish/service";
import { minInsideMargin, pageLimits, type Ink, type Paper } from "@/lib/publish/kdp";

const MAX_PAGES = 40;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const url = new URL(req.url);
    const { layout, source, pub } = await previewLayout(user.id, id);
    const total = layout.pages.length;
    const from = Math.max(1, Math.min(total, Number(url.searchParams.get("from")) || 1));
    const to = Math.max(from, Math.min(total, Number(url.searchParams.get("to")) || from + 7, from + MAX_PAGES - 1));
    return json({
      total,
      width: layout.width,
      height: layout.height,
      trim: layout.trim,
      bleed: layout.bleed,
      margins: layout.margins,
      requiredInside: minInsideMargin(total),
      limits: pageLimits(layout.trim, pub.layout.ink as Ink, pub.layout.paper as Paper),
      template: layout.template,
      sections: layout.sections,
      stats: layout.stats,
      missingGlyphs: layout.missingGlyphs,
      source: { label: source.label, approved: source.approved },
      from,
      to,
      pages: layout.pages.slice(from - 1, to),
    });
  } catch (e) {
    return handleError(e);
  }
}
