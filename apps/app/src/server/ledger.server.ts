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
  addMonths,
  daysInMonth,
  monthRange,
  todayIn,
} from "@workspace/core/dates"
import { preparse } from "@workspace/core/preparse"
import { type Db, schema } from "@workspace/db"
import { peopleWithBalances, saveLines } from "./agent.server"
import { openQuestions, resolveQuestionsFor } from "./questions.server"
import { getDb } from "./services"

const { categories, corrections, entries, people, settings, transactions } =
  schema

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
  personId: transactions.personId,
  personName: people.name,
}

function fetchTransactions(db: Db, where: SQL | undefined) {
  return db
    .select(txnColumns)
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(people, eq(people.id, transactions.personId))
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
    person:
      row.personId && row.personName
        ? { id: row.personId, name: row.personName }
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

  // Pace check: last month's spending, by day and up to the same day.
  const isCurrentMonth = month === todayDate.slice(0, 7)
  const dayOfMonth = isCurrentMonth ? Number(todayDate.slice(8, 10)) : days
  const prevMonth = addMonths(month, -1)
  const prevCutoff = Math.min(dayOfMonth, daysInMonth(prevMonth))
  const prevRange = monthRange(prevMonth)
  const prevRows = await db
    .select({
      amount: transactions.amount,
      kind: transactions.kind,
      localDate: transactions.localDate,
    })
    .from(transactions)
    .where(
      and(
        isNull(transactions.deletedAt),
        between(transactions.localDate, prevRange.start, prevRange.end)
      )
    )
  const prevDaily = Array.from({ length: daysInMonth(prevMonth) }, () => 0)
  for (const r of prevRows) {
    if (!countsTowardTotals(r.kind) || r.amount >= 0) continue
    const i = Number(r.localDate.slice(8, 10)) - 1
    prevDaily[i] = (prevDaily[i] ?? 0) - r.amount
  }
  const prevOut = prevDaily
    .slice(0, prevCutoff)
    .reduce((sum, out) => sum + out, 0)

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
      /** Spending per day of last month, for the pace chart. */
      daily: prevDaily,
    },
    daily,
    byCategory: [...byCategory.values()].toSorted((a, b) => b.out - a.out),
    transactions: txns,
    categories: activeCategories,
    questions: await openQuestions(db, labels),
    people: (await peopleWithBalances(db))
      .filter((p) => p.owed !== 0)
      .map(({ id, name, owed }) => ({ id, name, owed }))
      .toSorted((a, b) => Math.abs(b.owed) - Math.abs(a.owed)),
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

  const { saved, transactionIds, asked } = await saveLines(
    db,
    entry.id,
    parsed.lines
  )
  return {
    kind: "log" as const,
    entryId: entry.id,
    transactionIds,
    saved,
    asked,
  }
}

/** Records that a person and the owner are square. */
export async function settleWith(personId: string) {
  const db = getDb()
  const person = (await peopleWithBalances(db)).find((p) => p.id === personId)
  if (!person) throw new Error("Person not found")
  if (person.owed === 0) return { amount: 0, id: null }
  // They owe you: money comes in. You owe them: money goes out.
  const amount = person.owed
  const [row] = await db
    .insert(transactions)
    .values({
      kind: "settle",
      amount,
      personId,
      localDate: await today(db),
      // The row's IOU label already says who paid whom.
      description: "Settled up",
      status: "confirmed",
    })
    .returning({ id: transactions.id })
  return { amount, id: row?.id ?? null }
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

const TREND_CATEGORIES = 5

/**
 * Spending and income for the `months` months ending at `month`, with
 * spending split into the top categories (the rest grouped as "Other").
 */
export async function trendView(month: string, months: number) {
  const db = getDb()
  const list = Array.from({ length: months }, (_, i) =>
    addMonths(month, i - months + 1)
  )
  const rows = await db
    .select({
      amount: transactions.amount,
      kind: transactions.kind,
      localDate: transactions.localDate,
      category: categories.name,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        isNull(transactions.deletedAt),
        inArray(transactions.kind, ["expense", "income"]),
        between(
          transactions.localDate,
          monthRange(list[0] ?? month).start,
          monthRange(month).end
        )
      )
    )

  const totals = new Map(list.map((m) => [m, { out: 0, in: 0 }]))
  const byCategory = new Map<string, number>()
  for (const r of rows) {
    const total = totals.get(r.localDate.slice(0, 7))
    if (!total) continue
    if (r.amount > 0) {
      total.in += r.amount
      continue
    }
    total.out -= r.amount
    const name = r.category ?? "Uncategorized"
    byCategory.set(name, (byCategory.get(name) ?? 0) - r.amount)
  }
  const top = [...byCategory]
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, TREND_CATEGORIES)
    .map(([name]) => name)
  const keyOf = (name: string) => (top.includes(name) ? name : "Other")

  const stacks = new Map<string, number>()
  for (const r of rows) {
    if (r.amount >= 0) continue
    const key = `${r.localDate.slice(0, 7)}|${keyOf(r.category ?? "Uncategorized")}`
    stacks.set(key, (stacks.get(key) ?? 0) - r.amount)
  }
  const series = top.length < byCategory.size ? [...top, "Other"] : top

  return {
    months: list.map((m) => ({ month: m, ...totals.get(m)! })),
    series,
    stacks: list.flatMap((m) =>
      series.map((category) => ({
        month: m,
        category,
        out: stacks.get(`${m}|${category}`) ?? 0,
      }))
    ),
  }
}

export type TrendView = Awaited<ReturnType<typeof trendView>>
