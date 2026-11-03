import { db } from "./db";
import type { Prisma } from "@prisma/client";

export async function audit(
  action: string,
  opts: { userId?: string | null; projectId?: string | null; details?: Prisma.InputJsonValue } = {}
) {
  await db.auditEvent.create({
    data: { action, userId: opts.userId ?? null, projectId: opts.projectId ?? null, details: opts.details ?? {} },
  });
}
