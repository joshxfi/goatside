import { rmSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { MIGRATIONS, createDb, pendingMigrations } from "@workspace/db"
import { envProblems } from "./env"
import { getDb } from "./services"
import { checkSetup } from "./setup.server"

describe("pendingMigrations", () => {
  it("finds nothing pending once every migration has run", async () => {
    expect(await pendingMigrations(getDb())).toEqual([])
  })

  it("lists shipped migrations newer than the last one applied", async () => {
    const last = MIGRATIONS.at(-1)!
    const next = { tag: "9999_next", when: last.when + 1 }
    expect(await pendingMigrations(getDb(), [...MIGRATIONS, next])).toEqual([
      next,
    ])
  })

  it("lists every migration for a database that was never set up", async () => {
    const file = join(tmpdir(), `goatside-empty-${randomUUID()}.db`)
    try {
      const empty = createDb({ url: `file:${file}` })
      expect(await pendingMigrations(empty)).toEqual(MIGRATIONS)
    } finally {
      rmSync(file, { force: true })
    }
  })
})

describe("envProblems", () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })

  it("is empty when the env is valid", () => {
    expect(envProblems()).toEqual([])
  })

  it("names each missing or invalid variable without its value", () => {
    delete process.env.SESSION_SECRET
    process.env.GOATSIDE_PASSWORD = "hunter2"
    const problems = envProblems()
    expect(problems.map((p) => p.name).toSorted()).toEqual([
      "GOATSIDE_PASSWORD",
      "SESSION_SECRET",
    ])
    expect(problems.find((p) => p.name === "SESSION_SECRET")?.problem).toBe(
      "isn't set"
    )
    expect(JSON.stringify(problems)).not.toContain("hunter2")
  })
})

describe("checkSetup", () => {
  it("passes on a configured, migrated database", async () => {
    expect(await checkSetup()).toBeNull()
  })
})
