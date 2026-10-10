import { drizzle } from "drizzle-orm/libsql"
import { DEFAULT_CATEGORIES } from "@workspace/core/categories"
import * as schema from "./schema"

export interface DbConfig {
  url: string
  authToken?: string
}

/**
 * Creates a Drizzle client for Turso. `url` can be a Turso database
 * (libsql://…), a local `turso dev` server (http://127.0.0.1:8080), or a
 * plain SQLite file (file:local.db).
 */
export function createDb({ url, authToken }: DbConfig) {
  return drizzle({ connection: { url, authToken }, schema })
}

export type Db = ReturnType<typeof createDb>

/** Creates the settings row and starter categories. Safe to run repeatedly. */
export async function seedDefaults(db: Db) {
  await db.insert(schema.settings).values({ id: 1 }).onConflictDoNothing()
  await db
    .insert(schema.categories)
    .values(DEFAULT_CATEGORIES.map((category, sort) => ({ ...category, sort })))
    .onConflictDoNothing()
}

export { schema }
