import { sql } from "drizzle-orm"
import journal from "../migrations/meta/_journal.json"
import type { Db } from "./index"

export interface ShippedMigration {
  tag: string
  /** What drizzle records as `created_at` once the migration is applied. */
  when: number
}

/** The migrations this build ships with, oldest first. */
export const MIGRATIONS: ShippedMigration[] = journal.entries.map(
  ({ tag, when }) => ({ tag, when })
)

/**
 * Shipped migrations the database hasn't applied. Uses drizzle's own rule:
 * everything newer than the last migration it recorded. A database with no
 * migrations table has applied none. Throws if the database can't be reached.
 */
export async function pendingMigrations(
  db: Db,
  shipped: ShippedMigration[] = MIGRATIONS
): Promise<ShippedMigration[]> {
  let last = 0
  try {
    const [row] = await db.all<{ created_at: number | string }>(
      sql`select created_at from __drizzle_migrations order by created_at desc limit 1`
    )
    last = Number(row?.created_at ?? 0)
  } catch (error) {
    if (!mentions(error, /no such table/i)) throw error
  }
  return shipped.filter((migration) => migration.when > last)
}

/** Whether the error or anything in its `cause` chain matches. Drizzle wraps libSQL's errors. */
function mentions(error: unknown, pattern: RegExp): boolean {
  for (let e = error; e instanceof Error; e = e.cause) {
    if (pattern.test(e.message)) return true
  }
  return false
}
