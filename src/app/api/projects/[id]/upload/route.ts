import { requireUser } from "@/lib/auth";
import { getOwnedProject } from "@/lib/projects";
import { ingest } from "@/lib/editor/ingest";
import { MAX_UPLOAD_BYTES, ImportError } from "@/lib/doc/import";
import { db } from "@/lib/db";
import { json, handleError } from "@/lib/api";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const project = await getOwnedProject(id, user.id);
    if (await db.job.findFirst({ where: { projectId: id, status: { in: ["QUEUED", "RUNNING"] } } }))
      return json({ error: "Please wait for the current editing pass to finish before uploading." }, 409);
    if (project.status === "APPROVED") return json({ error: "This manuscript is approved. Reopen editing before adding chapters." }, 409);
    const form = await req.formData();
    const pasted = form.get("pastedText");
    const file = form.get("file");
    let result;
    if (typeof pasted === "string") {
      if (!pasted.trim()) throw new ImportError("There's no text to add.");
      if (pasted.length > MAX_UPLOAD_BYTES) throw new ImportError("That's too much text to paste at once. Upload a file instead.");
      result = await ingest(user.id, id, { pastedText: pasted });
    } else if (file instanceof File) {
      if (file.size > MAX_UPLOAD_BYTES) throw new ImportError("The file is larger than the 25 MB limit.");
      result = await ingest(user.id, id, { name: file.name, type: file.type, data: Buffer.from(await file.arrayBuffer()) });
    } else {
      throw new ImportError("Choose a file to upload.");
    }
    return json({ report: result.report });
  } catch (e) {
    return handleError(e);
  }
}
