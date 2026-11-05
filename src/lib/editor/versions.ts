// Restore an earlier manuscript state by replaying its recorded decisions. Suggestions
// created after that version return to pending. The restore itself is a new version,
// so nothing is lost and it can be undone like any other decision batch.
import crypto from "node:crypto";
import { db, writeTransaction } from "../db";
import { getOwnedProject } from "../projects";
import { createVersion, type DecisionMap } from "./manuscript";
import { audit } from "../audit";

export async function restoreVersion(userId: string, projectId: string, versionId: string) {
  await getOwnedProject(projectId, userId);
  const v = await db.manuscriptVersion.findFirst({ where: { id: versionId, projectId } });
  if (!v) throw new Error("Version not found");
  const target = v.decisions as unknown as DecisionMap;
  const batchId = crypto.randomUUID();
  await writeTransaction(
    async (tx) => {
      const all = await tx.suggestion.findMany({ where: { projectId } });
      for (const s of all) {
        const t = target[s.id] ?? { status: "PENDING" as const, authorText: null };
        if (t.status === s.status && t.authorText === s.authorText) continue;
        await tx.decision.create({
          data: { suggestionId: s.id, userId, batchId, fromStatus: s.status, toStatus: t.status, fromAuthorText: s.authorText, authorText: t.authorText },
        });
        await tx.suggestion.update({ where: { id: s.id }, data: { status: t.status, authorText: t.authorText } });
      }
      await tx.project.update({ where: { id: projectId }, data: { status: "AWAITING_REVIEW" } });
    },
    { timeout: 120_000 }
  );
  const nv = await createVersion(projectId, "restore", `Restored version ${v.number}`);
  await audit("version.restored", { userId, projectId, details: { from: v.number, to: nv.number } });
  return nv;
}
