import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getFile } from "@/lib/storage";
import { fileResponse, json } from "@/lib/api";

// Download the untouched original upload.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const sf = await db.sourceFile.findFirst({ where: { id, project: { userId: user.id } } });
  if (!sf) return json({ error: "Not found" }, 404);
  return fileResponse(await getFile(sf.storageKey), sf.originalName, "application/octet-stream");
}
