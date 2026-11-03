import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fileResponse } from "@/lib/api";

// Exportable author data: every project with its manuscript text, suggestions and decisions.
export async function GET() {
  const user = await requireUser();
  const projects = await db.project.findMany({
    where: { userId: user.id },
    include: {
      chapters: { include: { paragraphs: { orderBy: { position: "asc" } } }, orderBy: { position: "asc" } },
      suggestions: { include: { decisions: true } },
      versions: { select: { number: true, kind: true, label: true, createdAt: true, wordCount: true } },
      sourceFiles: { select: { originalName: true, sizeBytes: true, sha256: true, createdAt: true } },
      exports: { select: { filename: true, format: true, createdAt: true, isFinal: true } },
      continuity: true,
    },
  });
  const body = JSON.stringify({ exportedAt: new Date().toISOString(), user: { name: user.name }, projects }, null, 2);
  return fileResponse(Buffer.from(body), "editorial-studio-data.json", "application/json");
}
