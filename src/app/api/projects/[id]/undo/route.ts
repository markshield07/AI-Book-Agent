import { requireUser } from "@/lib/auth";
import { undoLast } from "@/lib/editor/decisions";
import { json, handleError } from "@/lib/api";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    return json(await undoLast(user.id, id));
  } catch (e) {
    return handleError(e);
  }
}
