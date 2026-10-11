/**
 * Categories and preferences. Server-only.
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { type Db, schema } from "@workspace/db"
import { getDb } from "./services"

const { categories, corrections, merchants, settings, transactions } = schema

export class SettingsError extends Error {}

/** Every category, archived ones too, with how much each has been used. */
export async function categoriesWithStats() {
  const db = getDb()
  const [rows, usage, prefs] = await Promise.all([
    db
      .select()
      .from(categories)
      .orderBy(categories.kind, categories.sort, categories.createdAt),
    db
      .select({
        categoryId: transactions.categoryId,
        count: sql<number>`count(*)`,
        total: sql<number>`sum(abs(${transactions.amount}))`,
        lastUsed: sql<string>`max(${transactions.localDate})`,
      })
      .from(transactions)
      .where(isNull(transactions.deletedAt))
      .groupBy(transactions.categoryId),
    db.query.settings.findFirst({ where: eq(settings.id, 1) }),
  ])
  const byId = new Map(usage.map((u) => [u.categoryId, u]))
  return {
    timeZone: prefs?.timeZone ?? "Asia/Manila",
    categories: rows.map((c) => {
      const u = byId.get(c.id)
      return {
        id: c.id,
        name: c.name,
        emoji: c.emoji,
        kind: c.kind,
        archived: c.archived,
        count: Number(u?.count ?? 0),
        total: Number(u?.total ?? 0),
        lastUsed: u?.lastUsed ?? null,
      }
    }),
  }
}

export type CategoriesView = Awaited<ReturnType<typeof categoriesWithStats>>

const isUniqueViolation = (error: unknown) =>
  String((error as { cause?: unknown })?.cause ?? error).includes("UNIQUE")

async function nameTaken(
  db: Db,
  kind: "expense" | "income",
  name: string,
  except?: string
) {
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        eq(categories.kind, kind),
        sql`lower(${categories.name}) = ${name.toLowerCase()}`
      )
    )
    .limit(1)
  return Boolean(row && row.id !== except)
}

export async function createCategory(input: {
  kind: "expense" | "income"
  name: string
  emoji: string
}) {
  const db = getDb()
  const name = input.name.trim()
  if (await nameTaken(db, input.kind, name)) {
    throw new SettingsError(`You already have a "${name}" category.`)
  }
  const [last] = await db
    .select({ sort: categories.sort })
    .from(categories)
    .where(eq(categories.kind, input.kind))
    .orderBy(desc(categories.sort))
    .limit(1)
  try {
    const [created] = await db
      .insert(categories)
      .values({
        kind: input.kind,
        name,
        emoji: input.emoji,
        sort: (last?.sort ?? 0) + 1,
      })
      .returning({ id: categories.id })
    return created
  } catch (error) {
    if (isUniqueViolation(error))
      throw new SettingsError(`You already have a "${name}" category.`)
    throw error
  }
}

export async function updateCategory(input: {
  id: string
  name?: string
  emoji?: string
  archived?: boolean
}) {
  const db = getDb()
  const current = await db.query.categories.findFirst({
    where: eq(categories.id, input.id),
  })
  if (!current) throw new SettingsError("That category no longer exists.")
  const name = input.name?.trim()
  if (name && (await nameTaken(db, current.kind, name, current.id))) {
    throw new SettingsError(`You already have a "${name}" category.`)
  }
  await db
    .update(categories)
    .set({
      ...(name && { name }),
      ...(input.emoji && { emoji: input.emoji }),
      ...(input.archived !== undefined && { archived: input.archived }),
    })
    .where(eq(categories.id, input.id))
}

/**
 * Moves everything filed under `from` into `into`, then removes `from`.
 * Moved entries are recorded as corrections, so the categorizer learns the
 * new home for them.
 */
export async function mergeCategory(input: { from: string; into: string }) {
  const db = getDb()
  if (input.from === input.into)
    throw new SettingsError("Pick a different category.")
  const [from, into] = await Promise.all([
    db.query.categories.findFirst({ where: eq(categories.id, input.from) }),
    db.query.categories.findFirst({ where: eq(categories.id, input.into) }),
  ])
  if (!from || !into) throw new SettingsError("That category no longer exists.")
  if (from.kind !== into.kind) {
    throw new SettingsError(
      "You can't merge a spending category with an income one."
    )
  }

  const moved = await db
    .update(transactions)
    .set({ categoryId: into.id })
    .where(eq(transactions.categoryId, from.id))
    .returning({ id: transactions.id })
  if (moved.length) {
    await db.insert(corrections).values(
      moved.map((t) => ({
        transactionId: t.id,
        field: "categoryId",
        fromValue: from.id,
        toValue: into.id,
      }))
    )
  }
  await db
    .update(merchants)
    .set({ defaultCategoryId: into.id })
    .where(eq(merchants.defaultCategoryId, from.id))
  await db.delete(categories).where(eq(categories.id, from.id))
  return { moved: moved.length }
}

export async function setTimeZone(timeZone: string) {
  const known =
    timeZone === "UTC" || Intl.supportedValuesOf("timeZone").includes(timeZone)
  if (!known) throw new SettingsError("That isn't a time zone.")
  await getDb()
    .insert(settings)
    .values({ id: 1, timeZone })
    .onConflictDoUpdate({ target: settings.id, set: { timeZone } })
}

/** Re-files the given transactions into a category (used after suggestions). */
export async function refile(ids: string[], categoryId: string) {
  const db = getDb()
  const category = await db.query.categories.findFirst({
    where: eq(categories.id, categoryId),
  })
  if (!category) throw new SettingsError("That category no longer exists.")
  const rows = await db
    .select({
      id: transactions.id,
      categoryId: transactions.categoryId,
      amount: transactions.amount,
    })
    .from(transactions)
    .where(and(inArray(transactions.id, ids), isNull(transactions.deletedAt)))
  const fits = rows.filter(
    (r) => (r.amount > 0 ? "income" : "expense") === category.kind
  )
  if (!fits.length) return { moved: 0 }
  await db
    .update(transactions)
    .set({ categoryId, status: "confirmed" })
    .where(
      inArray(
        transactions.id,
        fits.map((r) => r.id)
      )
    )
  await db.insert(corrections).values(
    fits.map((r) => ({
      transactionId: r.id,
      field: "categoryId",
      fromValue: r.categoryId,
      toValue: categoryId,
    }))
  )
  return { moved: fits.length }
}
