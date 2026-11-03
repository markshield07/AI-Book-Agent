import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { include: ["tests/unit/**/*.test.ts"], fileParallelism: false, testTimeout: 60000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL || "postgresql://studio:studio@localhost:5432/editorial_studio_test",
      STORAGE_DIR: "./storage-test",
      AI_PROVIDER: "rules",
    },
  },
});
