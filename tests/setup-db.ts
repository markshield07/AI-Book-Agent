// Builds a fresh throwaway SQLite database (prisma/test.db) for the test run.
import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

export default function setup() {
  for (const f of ["test.db", "test.db-journal", "test.db-wal", "test.db-shm"]) rmSync(path.join("prisma", f), { force: true });
  execSync("npx prisma db push --skip-generate", { stdio: "pipe", env: { ...process.env, DATABASE_URL: "file:./test.db" } });
}
