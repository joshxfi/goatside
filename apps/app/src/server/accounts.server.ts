/**
 * Accounts: balances, history, setup and edits. A balance is the account's
 * `opening` plus everything filed to it, with transfers counted on both
 * ends; setting a balance by hand moves `opening`. Server-only.
 */
import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm"
import { monthRange } from "@workspace/core/dates"
import { type Db, schema } from "@workspace/db"
import { ensureAccount } from "./questions.server"
import { getDb } from "./services"

const { accounts, corrections, settings, transactions } = schema

export class AccountError extends Error {}

type Kind = (typeof schema.ACCOUNT_KINDS)[number]
type Color = (typeof schema.ACCOUNT_COLORS)[number]

/** Money filed to each account, net of transfers in and out. */
async function flows(db: Db) {
  const [out, into] = await Promise.all([
    db
      .select({
        id: transactions.accountId,
        total: sql<number>`sum(${transactions.amount})`,
      })
      .from(transactions)
      .where(
        and(isNull(transactions.deletedAt), isNotNull(transactions.accountId))
      )
      .groupBy(transactions.accountId),
    db
      .select({
        id: transactions.toAccountId,
        total: sql<number>`sum(-${transactions.amount})`,
      })
      .from(transactions)
      .where(
        and(
          isNull(transactions.deletedAt),
          eq(transactions.kind, "transfer"),
          isNotNull(transactions.toAccountId)
        )
      )
      .groupBy(transactions.toAccountId),
  ])
  const totals = new Map<string, number>()
  for (const row of [...out, ...into]) {
    if (!row.id) continue
    totals.set(row.id, (totals.get(row.id) ?? 0) + Number(row.total))
  }
  return totals
}

/** Every account (archived too) with its balance, in the owner's order. */
export async function accountBalances(db: Db) {
  const [list, totals] = await Promise.all([
    db.select().from(accounts).orderBy(accounts.sort, accounts.name),
    flows(db),
  ])
  return list.map((a) => ({
    id: a.id,
    name: a.name,
    kind: a.kind,
    color: a.color,
    aliases: a.aliases,
    last4: a.last4,
    creditLimit: a.creditLimit,
    archived: a.archived,
    /** Centavos. Negative on a credit card is what's owed. */
    balance: a.opening + (totals.get(a.id) ?? 0),
  }))
}

export type AccountBalance = Awaited<ReturnType<typeof accountBalances>>[number]

/** The Accounts page: balances, this month's movement, and the default. */
export async function accountsOverview(month: string) {
  const db = getDb()
  const { start, end } = monthRange(month)
  const [list, prefs, moved, counts] = await Promise.all([
    accountBalances(db),
    db.query.settings.findFirst({
      where: eq(settings.id, 1),
      columns: { defaultAccountId: true },
    }),
    db
      .select({
        accountId: transactions.accountId,
        toAccountId: transactions.toAccountId,
        kind: transactions.kind,
        amount: transactions.amount,
      })
      .from(transactions)
      .where(
        and(
          isNull(transactions.deletedAt),
          sql`${transactions.localDate} between ${start} and ${end}`,
          or(
            isNotNull(transactions.accountId),
            isNotNull(transactions.toAccountId)
          )
        )
      ),
    db
      .select({
        accountId: transactions.accountId,
        count: sql<number>`count(*)`,
        last: sql<string>`max(${transactions.localDate})`,
      })
      .from(transactions)
      .where(
        and(isNull(transactions.deletedAt), isNotNull(transactions.accountId))
      )
      .groupBy(transactions.accountId),
  ])
  const movement = new Map<string, { in: number; out: number }>()
  const bump = (id: string | null, amount: number) => {
    if (!id) return
    const m = movement.get(id) ?? { in: 0, out: 0 }
    if (amount > 0) m.in += amount
    else m.out -= amount
    movement.set(id, m)
  }
  for (const row of moved) {
    bump(row.accountId, row.amount)
    if (row.kind === "transfer") bump(row.toAccountId, -row.amount)
  }
  const activity = new Map(counts.map((c) => [c.accountId, c]))
  return {
    month,
    defaultAccountId: prefs?.defaultAccountId ?? null,
    accounts: list.map((a) => ({
      ...a,
      thisMonth: movement.get(a.id) ?? { in: 0, out: 0 },
      entries: Number(activity.get(a.id)?.count ?? 0),
      lastActivity: activity.get(a.id)?.last ?? null,
    })),
  }
}

export type AccountsOverview = Awaited<ReturnType<typeof accountsOverview>>

const HISTORY = 300

/** One account, newest first, with the balance after each entry. */
export async function accountDetail(id: string) {
  const db = getDb()
  const all = await accountBalances(db)
  const account = all.find((a) => a.id === id)
  if (!account) return null
  const rows = await db
    .select({
      id: transactions.id,
      kind: transactions.kind,
      amount: transactions.amount,
      localDate: transactions.localDate,
      description: transactions.description,
      accountId: transactions.accountId,
      toAccountId: transactions.toAccountId,
      categoryId: transactions.categoryId,
      createdAt: transactions.createdAt,
      categoryName: schema.categories.name,
      categoryEmoji: schema.categories.emoji,
      personName: schema.people.name,
    })
    .from(transactions)
    .leftJoin(
      schema.categories,
      eq(schema.categories.id, transactions.categoryId)
    )
    .leftJoin(schema.people, eq(schema.people.id, transactions.personId))
    .where(
      and(
        isNull(transactions.deletedAt),
        or(eq(transactions.accountId, id), eq(transactions.toAccountId, id))
      )
    )
    .orderBy(desc(transactions.localDate), desc(transactions.createdAt))
    .limit(HISTORY)

  const names = new Map(all.map((a) => [a.id, a.name]))
  let after = account.balance
  const history = rows.map((r) => {
    // A transfer into this account adds what left the other one.
    const incoming = r.kind === "transfer" && r.toAccountId === id
    const change = incoming ? -r.amount : r.amount
    const row = {
      id: r.id,
      kind: r.kind,
      change,
      localDate: r.localDate,
      description: r.description,
      category: r.categoryName
        ? { name: r.categoryName, emoji: r.categoryEmoji ?? "" }
        : null,
      person: r.personName,
      /** For transfers: the account on the other side. */
      other:
        r.kind === "transfer"
          ? (names.get((incoming ? r.accountId : r.toAccountId) ?? "") ?? null)
          : null,
      balanceAfter: after,
    }
    after -= change
    return row
  })
  return { account, history, truncated: rows.length === HISTORY }
}

export type AccountDetail = NonNullable<
  Awaited<ReturnType<typeof accountDetail>>
>

async function assertNameFree(
  db: Db,
  name: string,
  { except, reopening = false }: { except?: string; reopening?: boolean } = {}
) {
  const clash = await db.query.accounts.findFirst({
    where: sql`lower(${accounts.name}) = ${name.trim().toLowerCase()}`,
    columns: { id: true, archived: true },
  })
  // Adding an archived account's name brings that account back.
  if (clash && clash.id !== except && !(reopening && clash.archived)) {
    throw new AccountError(`You already have an account called ${name}.`)
  }
}

export async function createAccount(data: {
  name: string
  kind: Kind
  color?: Color
  last4?: string | null
  creditLimit?: number | null
  /** Centavos. For a credit card, negative means owed. */
  balance?: number
  aliases?: string[]
}) {
  const db = getDb()
  await assertNameFree(db, data.name, { reopening: true })
  const id = await ensureAccount(db, data.name.trim(), data.kind)
  await db
    .update(accounts)
    .set({
      ...(data.color && { color: data.color }),
      last4: data.last4 ?? null,
      creditLimit:
        data.kind === "credit_card" ? (data.creditLimit ?? null) : null,
      aliases: cleanAliases(data.aliases ?? [], data.name),
    })
    .where(eq(accounts.id, id))
  // Through setBalance, so a reopened account reads what was typed even
  // with entries from before it was archived.
  await setBalance(db, id, data.balance ?? 0)
  // The first account becomes the default, so entries start landing somewhere.
  const prefs = await db.query.settings.findFirst({
    where: eq(settings.id, 1),
    columns: { defaultAccountId: true },
  })
  if (!prefs?.defaultAccountId) {
    await db
      .update(settings)
      .set({ defaultAccountId: id })
      .where(eq(settings.id, 1))
  }
  return { id }
}

const cleanAliases = (aliases: string[], name: string) => [
  ...new Set(
    aliases
      .map((a) => a.trim().toLowerCase())
      .filter((a) => a && a !== name.trim().toLowerCase())
  ),
]

export async function updateAccount(data: {
  id: string
  name?: string
  kind?: Kind
  color?: Color
  last4?: string | null
  creditLimit?: number | null
  aliases?: string[]
  archived?: boolean
}) {
  const db = getDb()
  const current = await db.query.accounts.findFirst({
    where: eq(accounts.id, data.id),
  })
  if (!current) throw new AccountError("That account is gone.")
  if (data.name) await assertNameFree(db, data.name, { except: data.id })
  const name = data.name?.trim() ?? current.name
  const kind = data.kind ?? current.kind
  await db
    .update(accounts)
    .set({
      name,
      kind,
      ...(data.color && { color: data.color }),
      ...(data.last4 !== undefined && { last4: data.last4 }),
      creditLimit:
        kind === "credit_card"
          ? data.creditLimit !== undefined
            ? data.creditLimit
            : current.creditLimit
          : null,
      ...(data.aliases && { aliases: cleanAliases(data.aliases, name) }),
      ...(data.archived !== undefined && { archived: data.archived }),
    })
    .where(eq(accounts.id, data.id))
  if (data.archived) {
    await db
      .update(settings)
      .set({ defaultAccountId: null })
      .where(and(eq(settings.id, 1), eq(settings.defaultAccountId, data.id)))
  }
}

/** Makes the balance read `balance` now, keeping every entry as it is. */
export async function setBalance(db: Db, id: string, balance: number) {
  const totals = await flows(db)
  const [row] = await db
    .update(accounts)
    .set({ opening: balance - (totals.get(id) ?? 0) })
    .where(eq(accounts.id, id))
    .returning({ id: accounts.id })
  if (!row) throw new AccountError("That account is gone.")
}

export async function setDefaultAccount(id: string | null) {
  const db = getDb()
  if (id) {
    const account = await db.query.accounts.findFirst({
      where: and(eq(accounts.id, id), eq(accounts.archived, false)),
      columns: { id: true },
    })
    if (!account) throw new AccountError("That account is gone.")
  }
  await db
    .update(settings)
    .set({ defaultAccountId: id })
    .where(eq(settings.id, 1))
}

/**
 * Files entries under an account (or none), recording each change. Transfers
 * keep their own two sides and are skipped.
 */
export async function fileToAccount(
  db: Db,
  ids: string[],
  accountId: string | null
) {
  if (accountId) {
    const exists = await db.query.accounts.findFirst({
      where: eq(accounts.id, accountId),
      columns: { id: true },
    })
    if (!exists) throw new AccountError("That account is gone.")
  }
  const rows = await db
    .select({ id: transactions.id, accountId: transactions.accountId })
    .from(transactions)
    .where(
      and(
        inArray(transactions.id, ids),
        isNull(transactions.deletedAt),
        sql`${transactions.kind} != 'transfer'`
      )
    )
  const moving = rows.filter((r) => r.accountId !== accountId)
  if (!moving.length) return { moved: [] }
  await db
    .update(transactions)
    .set({ accountId })
    .where(
      inArray(
        transactions.id,
        moving.map((r) => r.id)
      )
    )
  await db.insert(corrections).values(
    moving.map((r) => ({
      transactionId: r.id,
      field: "accountId",
      fromValue: r.accountId,
      toValue: accountId,
    }))
  )
  return { moved: moving.map((r) => ({ id: r.id, accountId: r.accountId })) }
}

/** Deletes an account with no entries; otherwise archives it. */
export async function removeAccount(id: string) {
  const db = getDb()
  const [used] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(or(eq(transactions.accountId, id), eq(transactions.toAccountId, id)))
    .limit(1)
  if (used) {
    await updateAccount({ id, archived: true })
    return { archived: true }
  }
  await db
    .update(settings)
    .set({ defaultAccountId: null })
    .where(and(eq(settings.id, 1), eq(settings.defaultAccountId, id)))
  await db.delete(accounts).where(eq(accounts.id, id))
  return { archived: false }
}

/** Undo for fileToAccount: puts each entry back where it was. */
export async function restoreAccounts(
  changes: { id: string; accountId: string | null }[]
) {
  const db = getDb()
  for (const change of changes) {
    await db
      .update(transactions)
      .set({ accountId: change.accountId })
      .where(eq(transactions.id, change.id))
  }
}
