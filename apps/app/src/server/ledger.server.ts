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
  gte,
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
import { alias } from "drizzle-orm/sqlite-core"
import { type Db, schema } from "@workspace/db"
import { accountBook, peopleWithBalances, saveLines } from "./agent.server"
import { accountBalances } from "./accounts.server"
import { openQuestions, resolveQuestionsFor } from "./questions.server"
import { getDb } from "./services"

const {
  accounts,
  categories,
  corrections,
  entries,
  people,
  settings,
  transactions,
} = schema

const toAccounts = alias(accounts, "to_accounts")

export async function today(db: Db) {
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
  accountId: transactions.accountId,
  accountName: accounts.name,
  accountColor: accounts.color,
  toAccountId: transactions.toAccountId,
  toAccountName: toAccounts.name,
  toAccountColor: toAccounts.color,
}

function fetchTransactions(db: Db, where: SQL | undefined) {
  return db
    .select(txnColumns)
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(people, eq(people.id, transactions.personId))
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(toAccounts, eq(toAccounts.id, transactions.toAccountId))
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
    account:
      row.accountId && row.accountName
        ? {
            id: row.accountId,
            name: row.accountName,
            color: row.accountColor ?? "slate",
          }
        : null,
    /** Transfers only: where the money went. */
    toAccount:
      row.toAccountId && row.toAccountName
        ? {
            id: row.toAccountId,
            name: row.toAccountName,
            color: row.toAccountColor ?? "slate",
          }
        : null,
  }
}

export type LedgerTxn = ReturnType<typeof toLedgerTxn>

/**
 * Only spending and income count toward totals; IOUs live on the People
 * page, and transfers just move money between the owner's accounts.
 */
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
      categoryId: transactions.categoryId,
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

  // Per category, last month up to the same day, for "biggest changes".
  const prevByCategory = new Map<string, number>()
  for (const r of prevRows) {
    if (!countsTowardTotals(r.kind) || r.amount >= 0) continue
    if (Number(r.localDate.slice(8, 10)) > prevCutoff) continue
    const key = r.categoryId ?? "none"
    prevByCategory.set(key, (prevByCategory.get(key) ?? 0) - r.amount)
  }

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
  // Independent lookups; run them together.
  const [book, balances, wallet] = await Promise.all([
    accountBook(db),
    peopleWithBalances(db),
    accountBalances(db),
  ])
  const accountNames = new Map(book.known.map((a) => [a.id, a.name]))
  const [questions, picks] = await Promise.all([
    openQuestions(db, labels, accountNames),
    quickPicks(db, labels, accountNames),
  ])

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
    changes: categoryChanges(byCategory, prevByCategory, labels),
    transactions: txns,
    categories: activeCategories,
    questions,
    picks,
    people: balances
      .filter((p) => p.owed !== 0)
      .map(({ id, name, owed }) => ({ id, name, owed }))
      .toSorted((a, b) => Math.abs(b.owed) - Math.abs(a.owed)),
    /** Open accounts with balances; the composer also reads names from these. */
    accounts: wallet.filter((a) => !a.archived),
    defaultAccountId: book.defaultAccountId,
  }
}

export type MonthView = Awaited<ReturnType<typeof monthView>>

/** Parses a composer line and saves it (or runs `undo`). */
export async function logText(
  text: string,
  { repeat = false }: { repeat?: boolean } = {}
) {
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
    parsed.lines,
    { checkDuplicates: !repeat }
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
/**
 * Records a repayment between the owner and a person: the whole balance,
 * or `part` centavos of it (capped at the balance).
 */
export async function settleWith(personId: string, part?: number) {
  const db = getDb()
  const { defaultAccountId } = await accountBook(db)
  const person = (await peopleWithBalances(db)).find((p) => p.id === personId)
  if (!person) throw new Error("Person not found")
  if (person.owed === 0) return { amount: 0, id: null }
  // They owe you: money comes in. You owe them: money goes out.
  const size = Math.min(Math.abs(person.owed), part ?? Number.POSITIVE_INFINITY)
  const amount = Math.sign(person.owed) * size
  const [row] = await db
    .insert(transactions)
    .values({
      kind: "settle",
      amount,
      personId,
      accountId: defaultAccountId,
      localDate: await today(db),
      // The row's IOU label already says who paid whom.
      description:
        size === Math.abs(person.owed) ? "Settled up" : "Partly paid back",
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
  accountId?: string | null
  toAccountId?: string | null
}) {
  const db = getDb()
  const current = await db.query.transactions.findFirst({
    where: eq(transactions.id, data.id),
  })
  if (!current) throw new Error("Transaction not found")

  for (const id of [data.accountId, data.toAccountId]) {
    if (!id) continue
    const exists = await db.query.accounts.findFirst({
      where: eq(accounts.id, id),
      columns: { id: true },
    })
    if (!exists) throw new Error("Account not found")
  }
  if (data.toAccountId !== undefined && current.kind !== "transfer") {
    throw new Error("Only a transfer has a second account")
  }
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
  for (const field of [
    "categoryId",
    "description",
    "localDate",
    "accountId",
    "toAccountId",
  ] as const) {
    const next = data[field]
    if (next === undefined || next === current[field]) continue
    changes[field] = next as never
    changed.push({ field, from: current[field], to: next })
  }
  if (!changed.length) return

  await db.update(transactions).set(changes).where(eq(transactions.id, data.id))
  // Picking a category by hand answers any open category question.
  await resolveQuestionsFor(db, data.id, [
    ...(changes.categoryId !== undefined ? (["category"] as const) : []),
    ...(changes.accountId !== undefined ? (["account"] as const) : []),
  ])
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

const TREND_CATEGORIES = 4

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

const PICK_LOOKBACK_DAYS = 60
const PICKS = 4

/**
 * Entries the owner logs again and again (same text, amount and sign),
 * favoring ones usually logged around this hour: morning kape, the ride
 * home. Tapping one re-logs it.
 */
async function quickPicks(
  db: Db,
  labels: Map<string, { name: string; emoji: string }>,
  accountNames: Map<string, string>
) {
  const prefs = await db.query.settings.findFirst({
    columns: { timeZone: true },
  })
  const timeZone = prefs?.timeZone ?? DEFAULT_TIME_ZONE
  const since = new Date(Date.now() - PICK_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
  const rows = await db
    .select({
      description: transactions.description,
      amount: transactions.amount,
      categoryId: transactions.categoryId,
      accountId: transactions.accountId,
      createdAt: transactions.createdAt,
    })
    .from(transactions)
    .where(
      and(
        isNull(transactions.deletedAt),
        isNotNull(transactions.entryId),
        inArray(transactions.kind, ["expense", "income"]),
        gte(transactions.createdAt, since)
      )
    )

  const hourOf = (date: Date) =>
    Number(
      new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        hourCycle: "h23",
        timeZone,
      }).format(date)
    )
  const now = hourOf(new Date())
  const near = (hour: number) =>
    Math.min(Math.abs(hour - now), 24 - Math.abs(hour - now)) <= 2

  const groups = new Map<
    string,
    {
      description: string
      amount: number
      categoryId: string | null
      accountId: string | null
      count: number
      nearNow: number
    }
  >()
  for (const r of rows) {
    const description = r.description.trim().toLowerCase()
    if (!description) continue
    // Same text, amount and account: "kape via gcash" and "kape cash" differ.
    const key = `${description}|${r.amount}|${r.accountId ?? ""}`
    const group = groups.get(key) ?? {
      description,
      amount: r.amount,
      categoryId: r.categoryId,
      accountId: r.accountId,
      count: 0,
      nearNow: 0,
    }
    group.count += 1
    if (near(hourOf(r.createdAt))) group.nearNow += 1
    groups.set(key, group)
  }

  return [...groups.values()]
    .filter((g) => g.count >= 2)
    .toSorted((a, b) => b.count + 2 * b.nearNow - (a.count + 2 * a.nearNow))
    .slice(0, PICKS)
    .map((g) => ({
      text: [
        `${g.amount > 0 ? "+" : "-"}${Math.abs(g.amount) / 100}`,
        g.description,
        g.accountId && accountNames.has(g.accountId)
          ? `using ${accountNames.get(g.accountId)}`
          : null,
      ]
        .filter(Boolean)
        .join(" "),
      description: g.description,
      amount: g.amount,
      emoji: (g.categoryId && labels.get(g.categoryId)?.emoji) || null,
    }))
}

const CHANGES = 4

/**
 * Categories that moved most against last month (up to the same day), so
 * the overview can say "Food is ₱1,200 higher than this point in September".
 */
function categoryChanges(
  now: Map<
    string,
    { id: string | null; name: string; emoji: string; out: number }
  >,
  before: Map<string, number>,
  labels: Map<string, { name: string; emoji: string }>
) {
  const keys = new Set([...now.keys(), ...before.keys()])
  return [...keys]
    .map((key) => {
      const current = now.get(key)
      const label = current ?? labels.get(key)
      return {
        id: key === "none" ? null : key,
        name: label?.name ?? "Uncategorized",
        emoji: label?.emoji ?? "·",
        now: current?.out ?? 0,
        before: before.get(key) ?? 0,
      }
    })
    .map((c) => ({ ...c, delta: c.now - c.before }))
    .filter((c) => c.delta !== 0 && c.before > 0)
    .toSorted((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, CHANGES)
}

export const PERIODS = ["month", "last-3-months", "this-year", "all"] as const
export type Period = (typeof PERIODS)[number]

const MAX_LISTED = 5000

/**
 * Every transaction in a period, for the Transactions page. `month` picks
 * the month for the "month" period (defaults to the current one).
 */
export async function transactionsView(period: Period, month?: string) {
  const db = getDb()
  const todayDate = await today(db)
  const current = todayDate.slice(0, 7)
  const range =
    period === "month"
      ? monthRange(month ?? current)
      : period === "last-3-months"
        ? {
            start: monthRange(addMonths(current, -2)).start,
            end: monthRange(current).end,
          }
        : period === "this-year"
          ? {
              start: `${todayDate.slice(0, 4)}-01-01`,
              end: `${todayDate.slice(0, 4)}-12-31`,
            }
          : { start: "0000-01-01", end: "9999-12-31" }

  const [rows, activeCategories] = await Promise.all([
    fetchTransactions(
      db,
      and(
        isNull(transactions.deletedAt),
        between(transactions.localDate, range.start, range.end)
      )
    ).limit(MAX_LISTED + 1),
    db
      .select({
        id: categories.id,
        name: categories.name,
        emoji: categories.emoji,
        kind: categories.kind,
      })
      .from(categories)
      .where(eq(categories.archived, false))
      .orderBy(categories.kind, categories.sort),
  ])
  return {
    period,
    month: period === "month" ? (month ?? current) : null,
    today: todayDate,
    range,
    transactions: rows.slice(0, MAX_LISTED).map(toLedgerTxn),
    truncated: rows.length > MAX_LISTED,
    categories: activeCategories,
    accounts: (await accountBalances(db)).filter((a) => !a.archived),
  }
}

export type TransactionsView = Awaited<ReturnType<typeof transactionsView>>
