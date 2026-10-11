import { and, eq, isNull } from "drizzle-orm"
import { schema, seedDefaults } from "@workspace/db"
import { logText } from "../src/server/ledger.server"
import { getDb } from "../src/server/services"

const t = schema.transactions

/** Empties every table (children first) and re-seeds the defaults. */
export async function resetDb() {
  const db = getDb()
  await db.delete(schema.questions)
  await db.delete(schema.corrections)
  await db.delete(schema.transactions)
  await db.delete(schema.entries)
  await db.delete(schema.merchants)
  await db.delete(schema.people)
  await db.delete(schema.loginAttempts)
  await db.delete(schema.settings)
  await db.delete(schema.accounts)
  await db.delete(schema.categories)
  await seedDefaults(db)
}

/** Logs a composer line and returns the result, failing if it wasn't a log. */
export async function log(text: string, options?: { id?: string }) {
  const result = await logText(text, options)
  if (result.kind !== "log") throw new Error(`"${text}" wasn't logged`)
  return result
}

/** Adds a person directly and returns their id. */
export async function addPersonRow(name: string) {
  const [row] = await getDb()
    .insert(schema.people)
    .values({ name })
    .returning({ id: schema.people.id })
  if (!row) throw new Error("person not created")
  return row.id
}

/** An entry's rows that aren't soft-deleted. */
export function liveRows(entryId: string) {
  return getDb()
    .select()
    .from(t)
    .where(and(eq(t.entryId, entryId), isNull(t.deletedAt)))
}

/** One transaction row by id (deleted or not). */
export async function row(id: string) {
  const found = await getDb().query.transactions.findFirst({
    where: eq(t.id, id),
  })
  if (!found) throw new Error(`no transaction ${id}`)
  return found
}
