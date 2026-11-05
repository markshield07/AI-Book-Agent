// Background worker: claims editing jobs from the database and runs them.
// Run alongside the web server (`npm run dev` starts both). Safe to run several copies.
import { claimJob, runJob } from "../lib/editor/pipeline";
import { db, enableWal } from "../lib/db";

let stopping = false;
let current: string | null = null;
const POLL_MS = Number(process.env.WORKER_POLL_MS || 2000);

async function loop() {
  await enableWal().catch((e) => console.error("[worker] could not enable WAL", e));
  console.log("[worker] started; polling for editing jobs");
  while (!stopping) {
    try {
      const id = await claimJob();
      if (id) {
        console.log(`[worker] running job ${id}`);
        current = id;
        await runJob(id);
        current = null;
        console.log(`[worker] finished job ${id}`);
        continue;
      }
    } catch (err) {
      console.error("[worker] error", err);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  await db.$disconnect();
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    // Release the current job's lock so the next start resumes it straight away from the
    // last finished chapter, instead of waiting for the lock to go stale.
    stopping = true;
    setTimeout(() => process.exit(0), 5000).unref();
    const id = current;
    if (id)
      db.job
        .updateMany({ where: { id, status: "RUNNING" }, data: { lockedAt: new Date(0) } })
        .catch(() => {})
        .finally(() => process.exit(0));
  });
}

loop();
