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

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/**
 * Interactive transaction for anything that writes. Use this instead of db.$transaction(async ...).
 *
 * Found by the auditor (2026-11-04): with SQLite, a few interactive transactions started at
 * the same moment (a double-click, two tabs, bulk accept + undo) deadlock inside the database
 * engine. Every one of them hangs for the full 30 seconds and then fails. So write
 * transactions in this process run one at a time (each takes a few milliseconds), and each
 * takes the write lock as its first step so it never has to upgrade a read lock while another
 * process (the worker) is writing.
 */
let queue: Promise<unknown> = Promise.resolve();

export function writeTransaction<T>(fn: (tx: Tx) => Promise<T>, opts: { timeout?: number } = {}): Promise<T> {
  const run = () =>
    db.$transaction(
      async (tx) => {
        if (url.startsWith("file:")) await tx.$executeRawUnsafe(`UPDATE "User" SET "id" = "id" WHERE 0`);
        return fn(tx);
      },
      { maxWait: 30_000, timeout: opts.timeout ?? 30_000 }
    );
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}
