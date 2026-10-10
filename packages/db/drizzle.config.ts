import { defineConfig } from "drizzle-kit"

// Local dev: `pnpm --filter @workspace/db dev` serves .data/local.db on :8080.
// Remote: set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.
export default defineConfig({
  dialect: "turso",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL ?? "http://127.0.0.1:8080",
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
})
