import { requireUser } from "@/lib/auth";
import { getOwnedProject, MODE_LABEL } from "@/lib/projects";
import { db } from "@/lib/db";
import { json, handleError } from "@/lib/api";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    await getOwnedProject(id, user.id);
    const job = await db.job.findFirst({
      where: { projectId: id },
      orderBy: { createdAt: "desc" },
      include: { steps: { orderBy: { position: "asc" }, include: { chapter: { select: { title: true } } } } },
    });
    if (!job) return json(null);
    return json({
      id: job.id, status: job.status, stage: job.stage, doneSteps: job.doneSteps, totalSteps: job.totalSteps, error: job.error,
      inputTokens: job.inputTokens, outputTokens: job.outputTokens, mode: MODE_LABEL[job.editingMode],
      steps: job.steps.map((s) => ({ kind: s.kind, title: s.chapter?.title ?? "Manuscript analysis", status: s.status, error: s.error, created: s.suggestionsCreated })),
    });
  } catch (e) {
    return handleError(e);
  }
}
