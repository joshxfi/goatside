/**
 * How the ask agent finds entries. The read tool and the write tools share
 * one filter, so the entries the owner sees in an answer are the ones a
 * change applies to. Every kind of entry is searchable (transfers and IOUs
 * too), dates are optional, and accounts match by name, nickname, last four
 * digits or kind. Server-only.
 */
import {
  type SQL,
  and,
  asc,
  between,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm"
import { alias } from "drizzle-orm/sqlite-core"
import { z } from "zod"
import { formatMoney } from "@workspace/core/money"
import { type Db, schema } from "@workspace/db"
import { peopleWithBalances } from "./agent.server"
import { type AccountBalance, accountBalances } from "./accounts.server"
import { matchPerson } from "./ask-people.server"

const { accounts, categories, people, transactions } = schema
const toAccounts = alias(accounts, "to_accounts")

type Kind = (typeof schema.TRANSACTION_KINDS)[number]

/** Entry types in the agent's words. */
export const ENTRY_KINDS = [
  "spending",
  "income",
  "transfer",
  "lent",
  "borrowed",
  "repayment",
] as const
export type EntryKind = (typeof ENTRY_KINDS)[number]

export const DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("YYYY-MM-DD in the owner's timezone")

/** Which entries to look at. Every field narrows; leave out what's unknown. */
export const FILTER = z.object({
  from: DATE.optional().describe(
    "First day, YYYY-MM-DD. Leave out from and to to search every date"
  ),
  to: DATE.optional().describe("Last day, YYYY-MM-DD"),
  types: z
    .array(z.enum(ENTRY_KINDS))
    .optional()
    .describe("Only these kinds of entry. Leave out for every kind"),
  direction: z
    .enum(["out", "in", "both"])
    .default("both")
    .describe("out = money out, in = money in"),
  text: z
    .string()
    .max(100)
    .optional()
    .describe(
      "Words in the description or note, e.g. a shop; every word must appear"
    ),
  category: z.string().optional().describe("Current category name"),
  amount: z
    .number()
    .positive()
    .optional()
    .describe("Exact amount in the owner's currency, e.g. 1299.50"),
  account: z
    .string()
    .optional()
    .describe(
      "Only entries in this account, by name, nickname or last four digits; transfers to and from it count"
    ),
  person: z
    .string()
    .optional()
    .describe("Only IOUs and repayments with this person, by name"),
  ids: z
    .array(z.string())
    .max(50)
    .optional()
    .describe("Only these entries, by the ids findTransactions returned"),
})
export type Filter = z.input<typeof FILTER>

const kindsOf: Record<EntryKind, Kind> = {
  spending: "expense",
  income: "income",
  transfer: "transfer",
  lent: "lend",
  borrowed: "lend",
  repayment: "settle",
}

/** An entry's type as the agent names it. */
export function entryKind(row: { kind: Kind; amount: number }): EntryKind {
  if (row.kind === "lend") return row.amount < 0 ? "lent" : "borrowed"
  if (row.kind === "settle") return "repayment"
  if (row.kind === "expense") return "spending"
  return row.kind
}

const words = (text: string) =>
  text.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8)

/** Words that say nothing about which account: "my BPI account". */
const NOISE = new Set(["my", "the", "account", "acct"])

const KIND_WORDS: [RegExp, AccountBalance["kind"]][] = [
  [/\b(credit ?card|cc|card)\b/, "credit_card"],
  [/\b(e-?wallet|wallet)\b/, "ewallet"],
  [/\bbank\b/, "bank"],
  [/\bcash\b/, "cash"],
]

/**
 * The account a name means, trying in turn: its name or a nickname, its
 * last four digits, every word of it ("bpi card" for "BPI Credit Card"),
 * one word plus its kind ("gcash wallet" for "GCash"), or the only
 * account of a kind ("my card"). Several fits come back as `ambiguous`.
 */
export function matchAccount<
  T extends Pick<AccountBalance, "name" | "aliases" | "last4" | "kind">,
>(list: T[], name: string): { found: T } | { ambiguous: T[] } | null {
  const key = name.trim().toLowerCase()
  const names = (a: T) => [a.name, ...a.aliases].map((n) => n.toLowerCase())
  const parts = words(key).filter((w) => !NOISE.has(w))
  const kind = KIND_WORDS.find(([pattern]) => pattern.test(key))?.[1]
  const last4 = key.match(/\b\d{4}\b/)?.[0]

  const tries: ((a: T) => boolean)[] = [
    (a) => names(a).includes(key),
    (a) => Boolean(last4) && a.last4 === last4,
    (a) =>
      parts.length > 0 &&
      names(a).some((n) => parts.every((w) => n.includes(w))),
    (a) =>
      Boolean(kind) &&
      a.kind === kind &&
      names(a).some((n) => parts.some((w) => words(n).includes(w))),
    (a) => Boolean(kind) && a.kind === kind,
  ]
  for (const fits of tries) {
    const found = list.filter(fits)
    if (found.length === 1) return { found: found[0] as T }
    if (found.length > 1) return { ambiguous: found }
  }
  return null
}

/** What to tell the model when a name fits no account, or several. */
export function accountProblem(
  name: string,
  fit: { ambiguous: { name: string }[] } | null,
  list: { name: string }[]
) {
  return fit
    ? `"${name}" could be ${fit.ambiguous.map((a) => a.name).join(" or ")}. Use the full name.`
    : `No account called "${name}". Accounts: ${list.map((a) => a.name).join(", ") || "none yet"}.`
}

const escapeLike = (word: string) => word.replace(/[\\%_]/g, "\\$&")

/** The description, note and person, lowercased, for text search. */
const haystack = sql`lower(${transactions.description} || ' ' || coalesce(${transactions.note}, '') || ' ' || coalesce(${people.name}, ''))`

function textMatch(text: string, every: boolean) {
  const found = words(text).map(
    (w) => sql`${haystack} like ${`%${escapeLike(w)}%`} escape '\\'`
  )
  if (!found.length) return undefined
  return every ? and(...found) : or(...found)
}

/**
 * Turns a filter into a where clause. Names that fit nothing come back as
 * a `problem` the model can act on, rather than as an empty result.
 */
export async function entryWhere(
  db: Db,
  filter: Filter,
  options: { kinds?: Kind[]; looseText?: boolean } = {}
): Promise<
  { where: SQL | undefined; accountId?: string } | { problem: string }
> {
  let accountId: string | undefined
  if (filter.account) {
    const list = await accountBalances(db)
    // Archived accounts still hold history worth finding.
    const fit =
      matchAccount(
        list.filter((a) => !a.archived),
        filter.account
      ) ?? matchAccount(list, filter.account)
    if (!fit || !("found" in fit))
      return {
        problem: accountProblem(
          filter.account,
          fit,
          list.filter((a) => !a.archived)
        ),
      }
    accountId = fit.found.id
  }

  let personId: string | undefined
  if (filter.person) {
    const everyone = await peopleWithBalances(db)
    const found = matchPerson(everyone, filter.person)
    if (!found)
      return {
        problem: `No one called "${filter.person}". People: ${everyone.map((p) => p.name).join(", ") || "none yet"}.`,
      }
    personId = found.id
  }

  if (filter.category) {
    const key = filter.category.trim().toLowerCase()
    const exists =
      key === "uncategorized" ||
      (await db.query.categories.findFirst({
        where: sql`lower(${categories.name}) = ${key}`,
        columns: { id: true },
      }))
    if (!exists) return { problem: `No category called "${filter.category}".` }
  }

  const types = filter.types?.length ? filter.types : undefined
  const typeMatch = types
    ? or(
        ...types.map((t) =>
          t === "lent"
            ? and(
                eq(transactions.kind, "lend"),
                sql`${transactions.amount} < 0`
              )
            : t === "borrowed"
              ? and(
                  eq(transactions.kind, "lend"),
                  sql`${transactions.amount} > 0`
                )
              : eq(transactions.kind, kindsOf[t])
        )
      )
    : undefined

  // With an account, a transfer into it is money in.
  const into = accountId ? eq(transactions.toAccountId, accountId) : undefined
  const direction = filter.direction ?? "both"
  const flow =
    direction === "both"
      ? undefined
      : accountId
        ? direction === "in"
          ? or(
              into,
              and(
                eq(transactions.accountId, accountId),
                sql`${transactions.amount} > 0`
              )
            )
          : and(
              eq(transactions.accountId, accountId),
              sql`${transactions.amount} < 0`
            )
        : direction === "in"
          ? sql`${transactions.amount} > 0`
          : sql`${transactions.amount} < 0`

  return {
    accountId,
    where: and(
      isNull(transactions.deletedAt),
      options.kinds ? inArray(transactions.kind, options.kinds) : undefined,
      typeMatch,
      filter.from && filter.to
        ? between(transactions.localDate, filter.from, filter.to)
        : filter.from
          ? gte(transactions.localDate, filter.from)
          : filter.to
            ? lte(transactions.localDate, filter.to)
            : undefined,
      flow,
      filter.category
        ? sql`lower(coalesce(${categories.name}, 'uncategorized')) = ${filter.category.trim().toLowerCase()}`
        : undefined,
      filter.text ? textMatch(filter.text, !options.looseText) : undefined,
      filter.amount
        ? sql`abs(${transactions.amount}) = ${Math.round(filter.amount * 100)}`
        : undefined,
      accountId ? or(eq(transactions.accountId, accountId), into) : undefined,
      personId ? eq(transactions.personId, personId) : undefined,
      filter.ids?.length ? inArray(transactions.id, filter.ids) : undefined
    ),
  }
}

export const entryColumns = {
  id: transactions.id,
  entryId: transactions.entryId,
  kind: transactions.kind,
  amount: transactions.amount,
  localDate: transactions.localDate,
  description: transactions.description,
  note: transactions.note,
  split: transactions.split,
  categoryId: transactions.categoryId,
  categoryName: categories.name,
  accountId: transactions.accountId,
  accountName: accounts.name,
  toAccountId: transactions.toAccountId,
  toAccountName: toAccounts.name,
  personId: transactions.personId,
  personName: people.name,
}

export type Sort = "newest" | "oldest" | "largest"

const ORDER: Record<Sort, SQL[]> = {
  newest: [desc(transactions.localDate), desc(transactions.createdAt)],
  oldest: [asc(transactions.localDate), asc(transactions.createdAt)],
  largest: [
    desc(sql`abs(${transactions.amount})`),
    desc(transactions.localDate),
  ],
}

/** Rows that match, in order, at most `limit`. */
export function entryRows(
  db: Db,
  where: SQL | undefined,
  { sort = "newest", limit }: { sort?: Sort; limit: number }
) {
  return db
    .select(entryColumns)
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(toAccounts, eq(toAccounts.id, transactions.toAccountId))
    .leftJoin(people, eq(people.id, transactions.personId))
    .where(where)
    .orderBy(...ORDER[sort])
    .limit(limit)
}

export type EntryRow = Awaited<ReturnType<typeof entryRows>>[number]

/**
 * How many rows match and their net, in cents. With an account, a
 * transfer counts as money into or out of it; without one, transfers
 * only move money around and count as zero.
 */
export async function entryTotals(
  db: Db,
  where: SQL | undefined,
  accountId?: string
) {
  const transfer = accountId
    ? sql`case when ${transactions.toAccountId} = ${accountId} then -${transactions.amount} else ${transactions.amount} end`
    : sql`0`
  const [totals] = await db
    .select({
      count: sql<number>`count(*)`,
      net: sql<number>`coalesce(sum(case when ${transactions.kind} = 'transfer' then ${transfer} else ${transactions.amount} end), 0)`,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(people, eq(people.id, transactions.personId))
    .where(where)
  return { count: Number(totals?.count ?? 0), net: Number(totals?.net ?? 0) }
}

export const money = (cents: number) => ({
  value: Math.round(cents) / 100,
  text: formatMoney(cents),
})

/** One entry as the model sees it. */
export function entrySummary(r: EntryRow) {
  const kind = entryKind(r)
  return {
    id: r.id,
    date: r.localDate,
    type: kind,
    description: r.description || "untitled",
    amount: money(kind === "transfer" ? Math.abs(r.amount) : r.amount),
    ...(kind === "transfer"
      ? {
          from: r.accountName ?? "no account",
          to: r.toAccountName ?? "no account",
        }
      : r.accountName && { account: r.accountName }),
    ...((kind === "spending" || kind === "income") && {
      category: r.categoryName ?? "Uncategorized",
    }),
    ...(r.personName && { person: r.personName }),
    ...(r.split && r.split > 1 && { splitWays: r.split }),
    ...(r.note && { note: r.note }),
  }
}

/** How an entry reads on a card: "lunch" or "lent to Mara: grab". */
export function entryLabel(r: EntryRow) {
  const who = r.personName ?? "someone"
  const iou =
    r.kind === "lend"
      ? r.amount < 0
        ? `lent to ${who}`
        : `borrowed from ${who}`
      : r.kind === "settle"
        ? r.amount > 0
          ? `${who} paid you back`
          : `paid ${who} back`
        : r.kind === "transfer"
          ? "transfer"
          : null
  const description = r.description || null
  return iou && description
    ? `${iou}: ${description}`
    : (iou ?? description ?? "untitled")
}
