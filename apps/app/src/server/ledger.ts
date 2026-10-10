import { createServerFn } from "@tanstack/react-start"
import {
  type SQL,
  and,
  between,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
} from "drizzle-orm"
import { z } from "zod"
import {
  DEFAULT_TIME_ZONE,
  daysInMonth,
  monthRange,
  todayIn,
} from "@workspace/core/dates"
import { preparse } from "@workspace/core/preparse"
import { type Db, schema } from "@workspace/db"
import { getDb } from "./services"
import { authMiddleware } from "./session"

const { categories, corrections, entries, profiles, transactions } = schema

const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

async function timeZoneOf(db: Db, userId: string) {
  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.userId, userId),
    columns: { timeZone: true },
  })
  return profile?.timeZone ?? DEFAULT_TIME_ZONE
}

const txnColumns = {
  id: transactions.id,
  kind: transactions.kind,
  amount: transactions.amount,
  localDate: transactions.localDate,
  description: transactions.description,
  split: transactions.split,
  status: transactions.status,
  createdAt: transactions.createdAt,
  categoryId: transactions.categoryId,
  categoryName: categories.name,
  categoryEmoji: categories.emoji,
}

function fetchTransactions(db: Db, where: SQL | undefined) {
  return db
    .select(txnColumns)
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(where)
    .orderBy(desc(transactions.localDate), desc(transactions.createdAt))
}

type TxnRow = Awaited<ReturnType<typeof fetchTransactions>>[number]

function toLedgerTxn(row: TxnRow) {
  return {
    id: row.id,
    kind: row.kind,
    amount: row.amount,
    localDate: row.localDate,
    description: row.description,
    split: row.split,
    status: row.status,
    createdAt: row.createdAt.getTime(),
    category:
      row.categoryId && row.categoryName
        ? {
            id: row.categoryId,
            name: row.categoryName,
            emoji: row.categoryEmoji ?? "",
          }
        : null,
  }
}

export type LedgerTxn = ReturnType<typeof toLedgerTxn>

/** Only spending and income count toward totals; IOUs live on the People page. */
const countsTowardTotals = (kind: LedgerTxn["kind"]) =>
  kind === "expense" || kind === "income"

export const getMonth = createServerFn()
  .middleware([authMiddleware])
  .validator(z.object({ month: MONTH.optional() }))
  .handler(async ({ data, context: { userId } }) => {
    const db = getDb()
    const today = todayIn(await timeZoneOf(db, userId))
    const month = data.month ?? today.slice(0, 7)
    const { start, end } = monthRange(month)

    const rows = await fetchTransactions(
      db,
      and(
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
        between(transactions.localDate, start, end)
      )
    )
    const txns = rows.map(toLedgerTxn)

    const days = daysInMonth(month)
    const daily = Array.from({ length: days }, (_, i) => ({
      date: `${month}-${String(i + 1).padStart(2, "0")}`,
      out: 0,
      in: 0,
    }))
    const byCategory = new Map<
      string,
      { id: string | null; name: string; emoji: string; out: number }
    >()
    let totalOut = 0
    let totalIn = 0

    for (const t of txns) {
      if (!countsTowardTotals(t.kind)) continue
      const day = daily[Number(t.localDate.slice(8, 10)) - 1]
      if (t.amount < 0) {
        totalOut += -t.amount
        if (day) day.out += -t.amount
        const key = t.category?.id ?? "none"
        const bucket = byCategory.get(key) ?? {
          id: t.category?.id ?? null,
          name: t.category?.name ?? "Uncategorized",
          emoji: t.category?.emoji ?? "·",
          out: 0,
        }
        bucket.out += -t.amount
        byCategory.set(key, bucket)
      } else {
        totalIn += t.amount
        if (day) day.in += t.amount
      }
    }

    // Pace check: last month's spending up to the same day of the month.
    const isCurrentMonth = month === today.slice(0, 7)
    const dayOfMonth = isCurrentMonth ? Number(today.slice(8, 10)) : days
    const [py = 0, pm = 1] = month.split("-").map(Number)
    const prevMonth =
      pm === 1 ? `${py - 1}-12` : `${py}-${String(pm - 1).padStart(2, "0")}`
    const prevCutoff = Math.min(dayOfMonth, daysInMonth(prevMonth))
    const prevRows = await db
      .select({ amount: transactions.amount, kind: transactions.kind })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          isNull(transactions.deletedAt),
          between(
            transactions.localDate,
            `${prevMonth}-01`,
            `${prevMonth}-${String(prevCutoff).padStart(2, "0")}`
          )
        )
      )
    const prevOut = prevRows
      .filter((r) => countsTowardTotals(r.kind) && r.amount < 0)
      .reduce((sum, r) => sum - r.amount, 0)

    const userCategories = await db
      .select({
        id: categories.id,
        name: categories.name,
        emoji: categories.emoji,
        kind: categories.kind,
      })
      .from(categories)
      .where(and(eq(categories.userId, userId), eq(categories.archived, false)))
      .orderBy(categories.kind, categories.sort)

    return {
      month,
      today,
      totals: { out: totalOut, in: totalIn, net: totalIn - totalOut },
      previous: {
        month: prevMonth,
        outToDate: prevOut,
        hasData: prevRows.length > 0,
      },
      daily,
      byCategory: [...byCategory.values()].toSorted((a, b) => b.out - a.out),
      transactions: txns,
      categories: userCategories,
    }
  })

export type MonthView = Awaited<ReturnType<typeof getMonth>>

export const logEntry = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ text: z.string().max(500) }))
  .handler(async ({ data, context: { userId } }) => {
    const db = getDb()
    const today = todayIn(await timeZoneOf(db, userId))
    const parsed = preparse(data.text, { today })

    if (parsed.kind === "empty") return { kind: "empty" as const }

    if (parsed.kind === "undo") {
      const undone = await undoLatest(db, userId)
      return { kind: "undo" as const, undone }
    }

    if (parsed.kind === "ask") {
      await db
        .insert(entries)
        .values({ userId, rawText: data.text, mode: "ask" })
      return { kind: "ask" as const }
    }

    const [entry] = await db
      .insert(entries)
      .values({ userId, rawText: data.text, mode: "log" })
      .returning({ id: entries.id })
    if (!entry) throw new Error("Could not save entry")

    const inserted = await db
      .insert(transactions)
      .values(
        parsed.lines.map((line) => ({
          userId,
          entryId: entry.id,
          kind:
            line.direction === "in"
              ? ("income" as const)
              : ("expense" as const),
          amount: line.direction === "in" ? line.share : -line.share,
          localDate: line.localDate,
          description: line.description,
          split: line.split,
          // AI categorization (M3) will move these to parsed / needs_review.
          status: "pending" as const,
        }))
      )
      .returning({ id: transactions.id })

    return {
      kind: "log" as const,
      entryId: entry.id,
      transactionIds: inserted.map((t) => t.id),
      signInferred: parsed.lines.some((l) => l.signInferred),
    }
  })

/** Soft-deletes the transactions from the newest entry that still has any. */
async function undoLatest(db: Db, userId: string) {
  const [latest] = await db
    .select({ entryId: transactions.entryId })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
        isNotNull(transactions.entryId)
      )
    )
    .orderBy(desc(transactions.createdAt))
    .limit(1)
  if (!latest?.entryId) return 0

  const undone = await db
    .update(transactions)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.entryId, latest.entryId),
        isNull(transactions.deletedAt)
      )
    )
    .returning({ id: transactions.id })
  return undone.length
}

const IDS = z.object({ ids: z.array(z.uuid()).min(1).max(50) })

export const deleteTransactions = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(IDS)
  .handler(async ({ data, context: { userId } }) => {
    await getDb()
      .update(transactions)
      .set({ deletedAt: new Date() })
      .where(
        and(eq(transactions.userId, userId), inArray(transactions.id, data.ids))
      )
  })

export const restoreTransactions = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(IDS)
  .handler(async ({ data, context: { userId } }) => {
    await getDb()
      .update(transactions)
      .set({ deletedAt: null })
      .where(
        and(eq(transactions.userId, userId), inArray(transactions.id, data.ids))
      )
  })

export const updateTransaction = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      id: z.uuid(),
      categoryId: z.uuid().nullable().optional(),
      description: z.string().max(200).optional(),
      localDate: DATE.optional(),
    })
  )
  .handler(async ({ data, context: { userId } }) => {
    const db = getDb()
    const current = await db.query.transactions.findFirst({
      where: and(eq(transactions.id, data.id), eq(transactions.userId, userId)),
    })
    if (!current) throw new Error("Transaction not found")

    if (data.categoryId) {
      const owned = await db.query.categories.findFirst({
        where: and(
          eq(categories.id, data.categoryId),
          eq(categories.userId, userId)
        ),
        columns: { id: true },
      })
      if (!owned) throw new Error("Category not found")
    }

    const changes: Partial<typeof transactions.$inferInsert> = {}
    const changed: { field: string; from: string | null; to: string | null }[] =
      []
    for (const field of ["categoryId", "description", "localDate"] as const) {
      const next = data[field]
      if (next === undefined || next === current[field]) continue
      changes[field] = next as never
      changed.push({ field, from: current[field], to: next })
    }
    if (!changed.length) return

    await db
      .update(transactions)
      .set({ ...changes, status: "confirmed" })
      .where(eq(transactions.id, data.id))
    // Corrections become retrieval examples for the AI (M3).
    await db.insert(corrections).values(
      changed.map((c) => ({
        transactionId: data.id,
        field: c.field,
        fromValue: c.from,
        toValue: c.to,
      }))
    )
  })
