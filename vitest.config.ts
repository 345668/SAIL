import { defineConfig } from "vitest/config"
import path from "node:path"

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  test: { environment: "node", include: ["lib/**/*.test.ts", "app/**/*.test.ts"], globals: false,
    // Several test files start an in-memory Postgres at once; on a busy machine that exceeds the 10 s default and fails the suite for no real reason.
    hookTimeout: 60_000, testTimeout: 30_000 },
})
