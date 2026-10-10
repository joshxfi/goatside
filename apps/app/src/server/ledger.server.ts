/**
 * Ledger queries. Server-only: imported by the server functions in
 * ledger.ts, and kept out of client bundles by the .server suffix.
 */
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
import {
  DEFAULT_TIME_ZONE,
  daysInMonth,
  monthRange,
  todayIn,
} from "@workspace/core/dates"
import { preparse } from "@workspace/core/preparse"
import { type Db, schema } from "@workspace/db"
import {
  categorize,
  openQuestions,
  resolveQuestionsFor,
  saveQuestions,
} from "./agent.server"
import { getDb } from "./services"

const { categories, corrections, entries, settings, transactions } = schema

async function today(db: Db) {
  const row = await db.query.settings.findFirst({
    where: eq(settings.id, 1),
    columns: { timeZone: true },
  })
  return todayIn(row?.timeZone ?? DEFAULT_TIME_ZONE)
}

const txnColumns = {
  id: transactions.id,
  kind: transactions.kind,
  amount: transactions.amount,
  localDate: transactions.localDate,
  description: transactions.description,
  split: transactions.split,
  recurring: transactions.recurring,
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
    recurring: row.recurring,
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

/** Totals, daily and category breakdowns, and transactions for one month. */
export async function monthView(requested?: string) {
  const db = getDb()
  const todayDate = await today(db)
  const month = requested ?? todayDate.slice(0, 7)
  const { start, end } = monthRange(month)

  const rows = await fetchTransactions(
    db,
    and(
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
  const isCurrentMonth = month === todayDate.slice(0, 7)
  const dayOfMonth = isCurrentMonth ? Number(todayDate.slice(8, 10)) : days
  const [py = 0, pm = 1] = month.split("-").map(Number)
  const prevMonth =
    pm === 1 ? `${py - 1}-12` : `${py}-${String(pm - 1).padStart(2, "0")}`
  const prevCutoff = Math.min(dayOfMonth, daysInMonth(prevMonth))
  const prevRows = await db
    .select({ amount: transactions.amount, kind: transactions.kind })
    .from(transactions)
    .where(
      and(
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

  const activeCategories = await db
    .select({
      id: categories.id,
      name: categories.name,
      emoji: categories.emoji,
      kind: categories.kind,
    })
    .from(categories)
    .where(eq(categories.archived, false))
    .orderBy(categories.kind, categories.sort)
  const labels = new Map(activeCategories.map((c) => [c.id, c]))

  return {
    month,
    today: todayDate,
    totals: { out: totalOut, in: totalIn, net: totalIn - totalOut },
    previous: {
      month: prevMonth,
      outToDate: prevOut,
      hasData: prevRows.length > 0,
    },
    daily,
    byCategory: [...byCategory.values()].toSorted((a, b) => b.out - a.out),
    transactions: txns,
    categories: activeCategories,
    questions: await openQuestions(db, labels),
  }
}

export type MonthView = Awaited<ReturnType<typeof monthView>>

/** Parses a composer line and saves it (or runs `undo`). */
export async function logText(text: string) {
  const db = getDb()
  const parsed = preparse(text, { today: await today(db) })

  if (parsed.kind === "empty") return { kind: "empty" as const }

  if (parsed.kind === "undo") {
    const undone = await undoLatest(db)
    return { kind: "undo" as const, undone }
  }

  if (parsed.kind === "ask") {
    await db.insert(entries).values({ rawText: text, mode: "ask" })
    return { kind: "ask" as const }
  }

  const [entry] = await db
    .insert(entries)
    .values({ rawText: text, mode: "log" })
    .returning({ id: entries.id })
  if (!entry) throw new Error("Could not save entry")

  const resolved = await categorize(
    db,
    parsed.lines.map((line) => ({
      description: line.description,
      amount: line.share,
      direction: line.signInferred ? null : line.direction,
    }))
  )

  const inserted = await db
    .insert(transactions)
    .values(
      parsed.lines.map((line, i) => {
        const r = resolved[i]
        const direction = r?.direction ?? line.direction
        return {
          entryId: entry.id,
          kind: direction === "in" ? ("income" as const) : ("expense" as const),
          amount: direction === "in" ? line.share : -line.share,
          localDate: line.localDate,
          description: line.description,
          split: line.split,
          categoryId: r?.categoryId ?? null,
          aiConfidence: r?.confidence ?? null,
          recurring: r?.recurring ?? false,
          status: r?.status ?? ("pending" as const),
        }
      })
    )
    .returning({ id: transactions.id })

  await saveQuestions(
    db,
    inserted.flatMap((txn, i) =>
      (resolved[i]?.questions ?? []).map((draft) => ({
        transactionId: txn.id,
        draft,
      }))
    )
  )

  return {
    kind: "log" as const,
    entryId: entry.id,
    transactionIds: inserted.map((t) => t.id),
    saved: parsed.lines.map((line, i) => ({
      amount: resolved[i]?.direction === "in" ? line.share : -line.share,
      description: line.description,
      categoryId: resolved[i]?.categoryId ?? null,
    })),
    asked: resolved.some((r) => r.questions.length > 0),
  }
}

/** Soft-deletes the transactions from the newest entry that still has any. */
async function undoLatest(db: Db) {
  const [latest] = await db
    .select({ entryId: transactions.entryId })
    .from(transactions)
    .where(and(isNull(transactions.deletedAt), isNotNull(transactions.entryId)))
    .orderBy(desc(transactions.createdAt))
    .limit(1)
  if (!latest?.entryId) return 0

  const undone = await db
    .update(transactions)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(transactions.entryId, latest.entryId),
        isNull(transactions.deletedAt)
      )
    )
    .returning({ id: transactions.id })
  return undone.length
}

export async function setDeleted(ids: string[], deleted: boolean) {
  await getDb()
    .update(transactions)
    .set({ deletedAt: deleted ? new Date() : null })
    .where(inArray(transactions.id, ids))
}

/** Applies manual edits and records them as corrections. */
export async function editTransaction(data: {
  id: string
  categoryId?: string | null
  description?: string
  localDate?: string
}) {
  const db = getDb()
  const current = await db.query.transactions.findFirst({
    where: eq(transactions.id, data.id),
  })
  if (!current) throw new Error("Transaction not found")

  if (data.categoryId) {
    const exists = await db.query.categories.findFirst({
      where: eq(categories.id, data.categoryId),
      columns: { id: true },
    })
    if (!exists) throw new Error("Category not found")
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

  await db.update(transactions).set(changes).where(eq(transactions.id, data.id))
  // Picking a category by hand answers any open category question.
  await resolveQuestionsFor(
    db,
    data.id,
    changes.categoryId !== undefined ? ["category"] : []
  )
  // Confirmed rows teach the categorizer; corrections keep the history.
  await db.insert(corrections).values(
    changed.map((c) => ({
      transactionId: data.id,
      field: c.field,
      fromValue: c.from,
      toValue: c.to,
    }))
  )
}
