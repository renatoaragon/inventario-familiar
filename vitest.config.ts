import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    // Mirror the "@/*" path alias from tsconfig.json.
    alias: { "@": root },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // The split engine is pure, but importing it pulls the Prisma client
    // module, which expects these to exist.
    env: {
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      AUTH_SECRET: "test-only",
    },
  },
});
