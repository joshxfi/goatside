import { MIGRATIONS, pendingMigrations } from "@workspace/db"
import { type EnvProblem, envProblems } from "./env"
import { getDb } from "./services"

/** Why this deploy can't run yet. Shown on /setup, without any values. */
export type SetupProblem =
  | { kind: "env"; variables: EnvProblem[] }
  | { kind: "database" }
  | { kind: "migrations"; pending: number; fresh: boolean }

// Once a deploy passes, it stays passed for this server's lifetime. A new
// deploy (with new migrations) starts a new server and checks again.
let ready = false

/** Null when the env is valid and the database is reachable and migrated. */
export async function checkSetup(): Promise<SetupProblem | null> {
  if (ready) return null
  const variables = envProblems()
  if (variables.length > 0) return { kind: "env", variables }

  let pending
  try {
    pending = await pendingMigrations(getDb())
  } catch (error) {
    // The page is public, so the details stay in the function logs.
    console.error("Goatside can't reach its database:", error)
    return { kind: "database" }
  }
  if (pending.length > 0) {
    return {
      kind: "migrations",
      pending: pending.length,
      // None applied: the tables were never set up.
      fresh: pending.length === MIGRATIONS.length,
    }
  }

  ready = true
  return null
}
