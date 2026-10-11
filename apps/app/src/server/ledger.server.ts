/**
 * Ledger queries. Server-only: imported by the server functions in
 * ledger.ts, and kept out of client bundles by the .server suffix.
 */
import {
  type SQL,
  and,
  asc,
  between,
  desc,
  eq,
  inArray,
  gte,
  isNotNull,
  isNull,
  ne,
  sql,
} from "drizzle-orm"
import {
  DEFAULT_TIME_ZONE,
  addMonths,
  daysInMonth,
  monthRange,
  todayIn,
} from "@workspace/core/dates"
import { preparse } from "@workspace/core/preparse"
import { shares } from "@workspace/ai/people"
import { alias } from "drizzle-orm/sqlite-core"
import { type Db, schema } from "@workspace/db"
import { accountBook, peopleWithBalances, saveLines } from "./agent.server"
import { accountBalances } from "./accounts.server"
import {
  openQuestions,
  rescaleQuestions,
  resolveQuestionsFor,
} from "./questions.server"
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

async function timeZoneOf(db: Db) {
  const row = await db.query.settings.findFirst({
    where: eq(settings.id, 1),
    columns: { timeZone: true },
  })
  return row?.timeZone ?? DEFAULT_TIME_ZONE
}

/** The owner's date now, or at `at` (epoch ms) for an entry typed earlier. */
export async function today(db: Db, at?: number) {
  // A phone's clock can run ahead; never date an entry in the future.
  const when = new Date(Math.min(at ?? Date.now(), Date.now()))
  return todayIn(await timeZoneOf(db), when)
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
    /** For dating entries still on the phone, as the server would. */
    timeZone: await timeZoneOf(db),
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
  {
    repeat = false,
    id,
    at,
  }: {
    repeat?: boolean
    /** Chosen by the phone, so a resent entry is saved once. */
    id?: string
    /** When it was typed (epoch ms); "yesterday" counts from then. */
    at?: number
  } = {}
) {
  const db = getDb()
  const parsed = preparse(text, { today: await today(db, at) })

  if (parsed.kind === "empty") return { kind: "empty" as const }

  if (parsed.kind === "undo") {
    const undone = await undoLatest(db)
    return { kind: "undo" as const, undone }
  }

  if (parsed.kind === "ask") {
    await db.insert(entries).values({ rawText: text, mode: "ask" })
    return { kind: "ask" as const }
  }

  // Sent before: report what it saved. An earlier attempt that stopped
  // before saving any lines carries on below with the same entry.
  const earlier = id
    ? await db.query.entries.findFirst({
        where: eq(entries.id, id),
        columns: { id: true },
      })
    : undefined
  if (earlier) {
    const rows = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.entryId, earlier.id))
    if (rows.length) {
      return {
        kind: "log" as const,
        entryId: earlier.id,
        transactionIds: rows.map((r) => r.id),
        saved: [],
        asked: false,
      }
    }
  }
  const [entry] = earlier
    ? [earlier]
    : await db
        .insert(entries)
        .values({ id, rawText: text, mode: "log" })
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

/** A manual edit that doesn't fit the entry; the message says why. */
export class EditError extends Error {}

type Row = typeof transactions.$inferSelect
type NewRow = typeof transactions.$inferInsert

/**
 * An entry's type as the owner sees it. "lent" and "borrowed" are IOU rows
 * (`lend`) by sign: you paid for or lent them, or they did for you.
 */
export const ENTRY_TYPES = [
  "expense",
  "income",
  "transfer",
  "lent",
  "borrowed",
] as const
export type EntryType = (typeof ENTRY_TYPES)[number] | "settle"

const typeOf = (row: Pick<Row, "kind" | "amount">): EntryType =>
  row.kind === "lend" ? (row.amount < 0 ? "lent" : "borrowed") : row.kind

/** Money out of your pocket (or owed out), as the row's sign. */
const signOf = (type: EntryType, was: number) =>
  type === "income" || type === "borrowed"
    ? 1
    : type === "settle"
      ? Math.sign(was) || 1
      : -1

const MAX_WAYS = 30

/**
 * The others' IOU rows of a split bill whose share `row` is: same entry,
 * same line (description and date), in the order they were planned.
 */
async function splitRows(db: Db, row: Row) {
  if (row.kind !== "expense" || !row.split || row.split < 2 || !row.entryId)
    return []
  return db
    .select()
    .from(transactions)
    .where(
      and(
        isNull(transactions.deletedAt),
        eq(transactions.entryId, row.entryId),
        eq(transactions.kind, "lend"),
        isNotNull(transactions.personId),
        eq(transactions.description, row.description),
        eq(transactions.localDate, row.localDate)
      )
    )
    .orderBy(asc(transactions.createdAt), asc(transactions.id))
}

/** For someone's share of a split: the owner's share it belongs to. */
async function splitOwner(db: Db, row: Row) {
  if (row.kind !== "lend" || !row.entryId) return null
  const owner = await db.query.transactions.findFirst({
    where: and(
      isNull(transactions.deletedAt),
      eq(transactions.entryId, row.entryId),
      eq(transactions.kind, "expense"),
      gte(transactions.split, 2),
      eq(transactions.description, row.description),
      eq(transactions.localDate, row.localDate)
    ),
  })
  return owner ?? null
}

/** The whole bill: your share, the others' IOUs, and any unnamed shares. */
function billOf(row: Row, others: Row[]) {
  const ways = row.split ?? 1
  const share = Math.abs(row.amount)
  return (
    share +
    others.reduce((sum, o) => sum + Math.abs(o.amount), 0) +
    Math.max(0, ways - 1 - others.length) * share
  )
}

/**
 * A split bill as the edit drawer shows it, from either side: the total,
 * who pays what, and the rows that go with it. Null when it isn't split.
 */
export async function splitOf(id: string) {
  const db = getDb()
  const row = await db.query.transactions.findFirst({
    where: and(eq(transactions.id, id), isNull(transactions.deletedAt)),
  })
  if (!row) return null
  const owner = row.kind === "lend" ? await splitOwner(db, row) : row
  if (!owner?.split || owner.split < 2) return null
  const others = await splitRows(db, owner)
  const names = others.length
    ? await db
        .select({ id: people.id, name: people.name })
        .from(people)
        .where(
          inArray(
            people.id,
            others.flatMap((o) => o.personId ?? [])
          )
        )
    : []
  const nameOf = new Map(names.map((p) => [p.id, p.name]))
  return {
    /** "own" when `id` is your share; "share" when it's someone else's. */
    role: owner.id === row.id ? ("own" as const) : ("share" as const),
    ownerId: owner.id,
    bill: billOf(owner, others),
    ways: owner.split,
    ids: others.map((o) => o.id),
    people: others.map((o) => ({
      id: o.personId ?? "",
      name: nameOf.get(o.personId ?? "") ?? "Someone",
      amount: Math.abs(o.amount),
    })),
  }
}

export type SplitView = NonNullable<Awaited<ReturnType<typeof splitOf>>>

/** What `personId` would owe with `row` at `amount` instead. */
async function owedWith(db: Db, personId: string, row: Row, amount: number) {
  const [sum] = await db
    .select({ total: sql<number>`coalesce(sum(${transactions.amount}), 0)` })
    .from(transactions)
    .where(
      and(
        isNull(transactions.deletedAt),
        eq(transactions.personId, personId),
        inArray(transactions.kind, ["lend", "settle"]),
        ne(transactions.id, row.id)
      )
    )
  return -(Number(sum?.total ?? 0) + amount)
}

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i])

/**
 * Applies the owner's own edits and records them as corrections. Nothing
 * here goes through a model: the owner's word is final, within what keeps
 * the books whole.
 *
 * An entry is a line: your row, plus the others' IOU rows when it's a
 * split bill. Its type, people and ways decide those rows, the way
 * `planRows` does for a typed line: a split is your share and theirs,
 * "lent" is all theirs, "just me" is all yours. Changing any of them
 * re-plans the line; your row keeps its id, questions and history.
 */
export async function editTransaction(data: {
  id: string
  categoryId?: string | null
  description?: string
  localDate?: string
  accountId?: string | null
  toAccountId?: string | null
  /** Centavos, unsigned; the type sets the direction. A split's whole bill. */
  amount?: number
  type?: (typeof ENTRY_TYPES)[number]
  /** Who shares a bill (spending), or who an IOU is with (lent, borrowed). */
  people?: string[]
  /** How many ways a bill splits, you included; 1 is just you. */
  ways?: number
  recurring?: boolean
  /** Who a repayment, or one person's share of a split, is with. */
  personId?: string
}) {
  const db = getDb()
  const current = await db.query.transactions.findFirst({
    where: and(eq(transactions.id, data.id), isNull(transactions.deletedAt)),
  })
  if (!current) throw new EditError("That entry was deleted.")

  for (const id of [data.accountId, data.toAccountId]) {
    if (!id) continue
    const exists = await db.query.accounts.findFirst({
      where: eq(accounts.id, id),
      columns: { id: true },
    })
    if (!exists) throw new EditError("That account is gone.")
  }

  // Where the entry stands now.
  const was = typeOf(current)
  const others = await splitRows(db, current)
  const share = Boolean(await splitOwner(db, current))
  const wasPeople =
    current.kind === "lend" && current.personId
      ? [current.personId]
      : others.flatMap((o) => o.personId ?? [])
  const wasWays = current.split && current.split > 1 ? current.split : 1
  const wasWhole =
    wasWays > 1 ? billOf(current, others) : Math.abs(current.amount)

  // Where the owner wants it.
  const type: EntryType = data.type ?? was
  const regroup =
    data.type !== undefined ||
    data.people !== undefined ||
    data.ways !== undefined
  if (regroup && (was === "settle" || share)) {
    throw new EditError(
      was === "settle"
        ? "A repayment stays a repayment."
        : "This is someone's share of a split bill. Open your share to change the split."
    )
  }
  let who =
    data.people ??
    (data.personId && (type === "lent" || type === "borrowed")
      ? [data.personId]
      : type === was
        ? wasPeople
        : type === "lent" || type === "borrowed"
          ? wasPeople.slice(0, 1)
          : [])
  who = [...new Set(who)]
  if (type === "income" || type === "transfer") who = []
  const ways =
    type === "expense"
      ? (data.ways ?? (type === was ? wasWays : who.length + 1))
      : 1
  if (type === "expense" && ways < who.length + 1)
    throw new EditError(
      `Split ${ways} ways, there's room for ${ways - 1} others.`
    )
  if (ways > MAX_WAYS) throw new EditError(`Split at most ${MAX_WAYS} ways.`)
  if ((type === "lent" || type === "borrowed") && who.length !== 1)
    throw new EditError(
      type === "lent" ? "Pick who you lent it to." : "Pick who lent it."
    )
  if (who.length) {
    const found = await db
      .select({ id: people.id })
      .from(people)
      .where(inArray(people.id, who))
    if (found.length !== who.length) throw new EditError("That person is gone.")
  }
  const reshaped = type !== was || ways !== wasWays || !sameList(who, wasPeople)

  const whole = data.amount ?? wasWhole
  if (ways > 1 && whole < ways)
    throw new EditError(`Too small to split ${ways} ways.`)
  const sign = signOf(type, current.amount)
  // Re-divide only when something about the split changed, so shares the
  // owner set one by one stay as they are.
  const parts =
    reshaped || whole !== wasWhole
      ? ways > 1
        ? shares(whole, ways)
        : [whole]
      : null
  const size = parts ? (parts[0] ?? whole) : Math.abs(current.amount)
  const amount = sign * size

  const changes: Partial<NewRow> = {}
  if (amount !== current.amount) changes.amount = amount
  if (type !== was)
    changes.kind = type === "lent" || type === "borrowed" ? "lend" : type
  const split = ways > 1 ? ways : null
  if (split !== current.split && (type === "expense" || current.split !== null))
    changes.split = split

  // Accounts. Turning a transfer into money in files it where it arrived.
  const transfer = type === "transfer"
  const accountId =
    data.accountId !== undefined
      ? data.accountId
      : was === "transfer" && type === "income"
        ? current.toAccountId
        : current.accountId
  const toAccountId = transfer
    ? data.toAccountId !== undefined
      ? data.toAccountId
      : current.toAccountId
    : null
  if (transfer && (!accountId || !toAccountId))
    throw new EditError("A transfer needs both accounts.")
  if (transfer && accountId === toAccountId)
    throw new EditError("Pick two different accounts.")
  if (data.toAccountId !== undefined && !transfer)
    throw new EditError("Only a transfer has a second account.")
  if (accountId !== current.accountId) changes.accountId = accountId
  if (toAccountId !== current.toAccountId) changes.toAccountId = toAccountId

  // Category: only spending and income have one, and it fits the direction.
  const categorized = type === "expense" || type === "income"
  let categoryId = categorized
    ? data.categoryId !== undefined
      ? data.categoryId
      : type === was
        ? current.categoryId
        : null
    : null
  if (categoryId) {
    const category = await db.query.categories.findFirst({
      where: eq(categories.id, categoryId),
      columns: { kind: true },
    })
    if (!category) throw new EditError("That category is gone.")
    if (category.kind !== type)
      throw new EditError("That category doesn't fit this entry.")
  }
  if (categoryId !== current.categoryId) changes.categoryId = categoryId

  if (data.recurring !== undefined && !categorized)
    throw new EditError("Only spending and income repeat.")
  const recurring = categorized ? (data.recurring ?? current.recurring) : false
  if (recurring !== current.recurring) changes.recurring = recurring

  // Who the row itself is with: the IOU's person, or nobody.
  const personId =
    type === "lent" || type === "borrowed"
      ? (who[0] ?? null)
      : type === "settle" || share
        ? (data.personId ?? current.personId)
        : null
  if (data.personId && !personId)
    throw new EditError("Only an IOU is with someone.")
  if (data.personId && personId === data.personId) {
    const exists = await db.query.people.findFirst({
      where: eq(people.id, data.personId),
      columns: { id: true },
    })
    if (!exists) throw new EditError("That person is gone.")
  }
  if (personId !== current.personId) changes.personId = personId

  // A repayment can't pay back more than was owed.
  if (
    type === "settle" &&
    personId &&
    (changes.amount !== undefined || changes.personId !== undefined)
  ) {
    const owed = await owedWith(db, personId, current, amount)
    const person = await db.query.people.findFirst({
      where: eq(people.id, personId),
      columns: { name: true },
    })
    const name = person?.name ?? "them"
    if (amount > 0 && owed < 0)
      throw new EditError(`That's more than ${name} owed you.`)
    if (amount < 0 && owed > 0)
      throw new EditError(`That's more than you owed ${name}.`)
  }

  for (const field of ["description", "localDate"] as const) {
    const next = data[field]
    if (next !== undefined && next !== current[field]) changes[field] = next
  }

  // The others' rows: one IOU per person sharing the bill.
  const theirs =
    type === "expense" && ways > 1
      ? who.map((id, i) => ({
          personId: id,
          amount: parts ? -(parts[i + 1] ?? 0) : null,
        }))
      : []
  const plannedOthers = reshaped || parts !== null
  if (!Object.keys(changes).length && !plannedOthers) return

  // New rows of a line need an entry to belong to.
  let entryId = current.entryId
  if (theirs.length > others.length && !entryId) {
    const [entry] = await db
      .insert(entries)
      .values({
        rawText: changes.description ?? current.description,
        mode: "log",
      })
      .returning({ id: entries.id })
    entryId = changes.entryId = entry?.id ?? null
  }

  await db.update(transactions).set(changes).where(eq(transactions.id, data.id))

  // Keep the others' rows in step: same wording, date and account as yours.
  const line = {
    description: changes.description ?? current.description,
    localDate: changes.localDate ?? current.localDate,
    accountId: accountId ?? null,
  }
  for (const [i, other] of others.entries()) {
    const next = theirs[i]
    if (!next) {
      await db
        .update(transactions)
        .set({ deletedAt: new Date() })
        .where(eq(transactions.id, other.id))
      continue
    }
    const follow: Partial<NewRow> = {}
    if (next.personId !== other.personId) follow.personId = next.personId
    if (next.amount !== null && next.amount !== other.amount)
      follow.amount = next.amount
    for (const key of ["description", "localDate", "accountId"] as const)
      if (line[key] !== other[key]) follow[key] = line[key] as never
    if (Object.keys(follow).length)
      await db
        .update(transactions)
        .set(follow)
        .where(eq(transactions.id, other.id))
  }
  const added = theirs.slice(others.length)
  if (added.length) {
    await db.insert(transactions).values(
      added.map((t) => ({
        entryId,
        kind: "lend" as const,
        amount: t.amount ?? 0,
        personId: t.personId,
        ...line,
        status: "confirmed" as const,
        // Not newer than your row, so "undo" in the composer doesn't take
        // the whole bill back for an edit.
        createdAt: current.createdAt,
      }))
    )
  }

  // Open questions still read the old line; give them the new one.
  if (changes.amount !== undefined)
    await rescaleQuestions(db, data.id, { amount: whole, share: size })
  // Answered by hand: the owner picked these, so stop asking.
  await resolveQuestionsFor(db, data.id, [
    ...(changes.categoryId !== undefined || type !== was
      ? (["category"] as const)
      : []),
    ...(changes.accountId !== undefined ? (["account"] as const) : []),
    ...(reshaped ? (["direction", "transfer", "relation"] as const) : []),
  ])
  // Confirmed rows teach the categorizer; corrections keep the history.
  const changed = (Object.keys(changes) as (keyof NewRow)[]).filter(
    (field) => field !== "entryId"
  )
  const history: (typeof corrections.$inferInsert)[] = changed.map((field) => ({
    transactionId: data.id,
    field,
    fromValue: stringOf(current[field as keyof Row]),
    toValue: stringOf(changes[field]),
  }))
  if (!sameList(who, wasPeople) && type === "expense")
    history.push({
      transactionId: data.id,
      field: "people",
      fromValue: wasPeople.join(","),
      toValue: who.join(","),
    })
  if (history.length) await db.insert(corrections).values(history)
}

const stringOf = (value: unknown) =>
  value === null || value === undefined
    ? null
    : value instanceof Date
      ? value.toISOString()
      : String(value)

/** One entry with what the edit drawer needs, for pages without a month. */
export async function transactionFor(id: string) {
  const db = getDb()
  const [row] = await fetchTransactions(
    db,
    and(eq(transactions.id, id), isNull(transactions.deletedAt))
  )
  return row ? toLedgerTxn(row) : null
}

/** What the edit drawer offers: categories, open accounts and people. */
export async function editorChoices() {
  const db = getDb()
  const [cats, book, open, everyone] = await Promise.all([
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
    accountBook(db),
    db
      .select({ id: accounts.id, name: accounts.name, color: accounts.color })
      .from(accounts)
      .where(eq(accounts.archived, false))
      .orderBy(accounts.sort, accounts.name),
    db
      .select({ id: people.id, name: people.name })
      .from(people)
      .orderBy(people.name),
  ])
  return {
    /** The owner's date, for new entries' defaults. */
    today: await today(db),
    categories: cats,
    accounts: open,
    defaultAccountId: book.defaultAccountId,
    people: everyone,
  }
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
