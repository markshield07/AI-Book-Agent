import { requireUser } from "@/lib/auth";
import { z } from "zod";
import { decide } from "@/lib/editor/decisions";
import { json, handleError, readJson } from "@/lib/api";

const Body = z.object({
  action: z.enum(["accept", "reject", "modify", "reset"]),
  authorText: z.string().max(100_000).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = await readJson(req, Body);
    const s = await decide(user.id, id, body.action, body.authorText);
    return json({ id: s.id, status: s.status, authorText: s.authorText });
  } catch (e) {
    return handleError(e);
  }
}
