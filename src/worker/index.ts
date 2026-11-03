// Background worker: claims editing jobs from Postgres and runs them.
// Run alongside the web server (`npm run dev` starts both). Safe to run several copies.
import { claimJob, runJob } from "../lib/editor/pipeline";
import { db } from "../lib/db";

let stopping = false;
const POLL_MS = Number(process.env.WORKER_POLL_MS || 2000);

async function loop() {
  console.log("[worker] started; polling for editing jobs");
  while (!stopping) {
    try {
      const id = await claimJob();
      if (id) {
        console.log(`[worker] running job ${id}`);
        await runJob(id);
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
    // The current job keeps its lock; if we exit mid-step another worker resumes it
    // from the last chapter checkpoint once the lock goes stale.
    stopping = true;
    setTimeout(() => process.exit(0), 5000).unref();
  });
}

loop();
