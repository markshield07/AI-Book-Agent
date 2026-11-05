import { requireUser } from "@/lib/auth";
import { decideBulk } from "@/lib/editor/decisions";
import { json, handleError } from "@/lib/api";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = (await req.json()) as { action: "accept" | "reject"; category?: string; kind?: "edit" | "note" };
    if (!["accept", "reject"].includes(body.action)) return json({ error: "Unknown action" }, 400);
    return json(await decideBulk(user.id, id, body.action, { category: body.category || undefined, kind: body.kind }));
  } catch (e) {
    return handleError(e);
  }
}
