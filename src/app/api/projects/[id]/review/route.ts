import { requireUser } from "@/lib/auth";
import { getOwnedProject } from "@/lib/projects";
import { loadReview } from "@/lib/editor/review";
import { json, handleError } from "@/lib/api";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    await getOwnedProject(id, user.id);
    const chapterId = new URL(req.url).searchParams.get("chapter") ?? undefined;
    return json(await loadReview(id, chapterId));
  } catch (e) {
    return handleError(e);
  }
}
