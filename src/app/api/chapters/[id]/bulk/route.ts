import { requireUser } from "@/lib/auth";
import { decideBulk } from "@/lib/editor/decisions";
import { z } from "zod";
import { json, handleError, readJson } from "@/lib/api";

const Body = z.object({
  action: z.enum(["accept", "reject"]),
  category: z.string().max(100).optional(),
  kind: z.enum(["edit", "note"]).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = await readJson(req, Body);
    return json(await decideBulk(user.id, id, body.action, { category: body.category || undefined, kind: body.kind }));
  } catch (e) {
    return handleError(e);
  }
}
