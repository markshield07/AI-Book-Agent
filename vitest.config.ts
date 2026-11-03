import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { include: ["tests/unit/**/*.test.ts"],
    globalSetup: ["tests/setup-db.ts"], fileParallelism: false, testTimeout: 60000,
    env: {
      DATABASE_URL: "file:./test.db",
      STORAGE_DIR: "./storage-test",
      AI_PROVIDER: "rules",
    },
  },
});
