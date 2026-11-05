import { requireUser } from "@/lib/auth";
import { decide, type Action } from "@/lib/editor/decisions";
import { json, handleError } from "@/lib/api";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = (await req.json()) as { action: Action; authorText?: string };
    if (!["accept", "reject", "modify", "reset"].includes(body.action)) return json({ error: "Unknown action" }, 400);
    const s = await decide(user.id, id, body.action, body.authorText);
    return json({ id: s.id, status: s.status, authorText: s.authorText });
  } catch (e) {
    return handleError(e);
  }
}
