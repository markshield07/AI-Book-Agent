import { PrismaClient } from "@prisma/client";

// SQLite database in prisma/studio.db by default: nothing to install or run.
// socket_timeout makes concurrent writers (web app + worker) wait instead of failing.
const url = process.env.DATABASE_URL || "file:./studio.db";
const g = globalThis as unknown as { prisma?: PrismaClient };
export const db =
  g.prisma ?? new PrismaClient({ datasourceUrl: url.startsWith("file:") && !url.includes("socket_timeout") ? `${url}${url.includes("?") ? "&" : "?"}socket_timeout=30` : url });
if (process.env.NODE_ENV !== "production") g.prisma = db;

/** Write-ahead logging lets the web app read while the worker writes. Persists in the file. */
export async function enableWal() {
  if (!url.startsWith("file:")) return;
  await db.$queryRawUnsafe("PRAGMA journal_mode=WAL;");
}
