/**
 * Runs before each test file: a fresh SQLite file with every migration and
 * the default categories, and env that points the server code at it. No AI
 * Gateway credentials, so the logging pipeline never calls a model.
 */
import { rmSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll } from "vitest"
import { migrate } from "drizzle-orm/libsql/migrator"
import { createDb, seedDefaults } from "@workspace/db"

const file = join(tmpdir(), `goatside-test-${randomUUID()}.db`)

process.env.TURSO_DATABASE_URL = `file:${file}`
// Test-only values; serverEnv() requires them to be present and long enough.
process.env.GOATSIDE_USERNAME = "owner"
process.env.GOATSIDE_PASSWORD = "test-password-123"
process.env.SESSION_SECRET = "s".repeat(32)
delete process.env.TURSO_AUTH_TOKEN
delete process.env.AI_GATEWAY_API_KEY
delete process.env.VERCEL

const db = createDb({ url: process.env.TURSO_DATABASE_URL })
await migrate(db, {
  migrationsFolder: fileURLToPath(
    new URL("../../../packages/db/migrations", import.meta.url)
  ),
})
await seedDefaults(db)

afterAll(() => {
  for (const suffix of ["", "-journal", "-wal", "-shm"])
    rmSync(`${file}${suffix}`, { force: true })
})
