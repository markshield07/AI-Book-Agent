import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getFile } from "@/lib/storage";
import { fileResponse, json } from "@/lib/api";
import { CONTENT_TYPES } from "@/lib/publish/service";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const rec = await db.exportRecord.findFirst({ where: { id, project: { userId: user.id } } });
  if (!rec) return json({ error: "Not found" }, 404);
  const ext = rec.filename.split(".").pop()?.toLowerCase() ?? "";
  return fileResponse(await getFile(rec.storageKey), rec.filename, CONTENT_TYPES[ext] ?? "application/octet-stream");
}
