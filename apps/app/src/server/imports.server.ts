/**
 * Statement imports: rows a browser read from a bank or card statement,
 * matched against the ledger and saved through the normal filing pipeline.
 * The statement file never reaches the server; only its rows, totals,
 * period and SHA-256 do. Server-only.
 */
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"
import { scanAccounts } from "@workspace/core/accounts"
import { addDays } from "@workspace/core/dates"
import type { DraftLine } from "@workspace/core/preparse"
import {
  type StatementPeriod,
  type StatementRow,
  type StatementSummary,
  checkStatement,
  fingerprintRows,
} from "@workspace/core/statement"
import { type Db, schema } from "@workspace/db"
import type { AccountKind, ImportUndo } from "@workspace/db/schema"
import { accountBalances } from "./accounts.server"
import { accountBook, saveLines } from "./agent.server"

const { accounts, imports, questions, transactions } = schema

export class ImportError extends Error {}

/** How far apart a statement row and a logged entry can be dated. */
const MATCH_DAYS = 2
/** Transfers and card payments can take a few days to post. */
const TRANSFER_DAYS = 3

/** Words that make a statement row look like money moving between accounts. */
const TRANSFER_WORDS =
  /\b(transfer|bill payment|payment received|cash ?in|top ?up|instapay|pesonet|atm|withdrawal|deposit)\b/i
/** Cash out of a machine: money moving into the owner's cash. */
const ATM_WORDS = /\b(atm|withdrawal)\b/i
/** A bank's charge is spending, even when it says "ATM". */
const FEE_WORDS = /\b(fees?|charges?)\b/i

export interface StatementInput {
  accountId: string
  fileHash: string
  rows: StatementRow[]
  summary: StatementSummary
  period: StatementPeriod | null
}

/** Logged rows that move together: one row, or the rows of a split bill. */
interface Unit {
  key: string
  ids: string[]
  /** What it did to the statement's account (or would, if unfiled). */
  change: number
  localDate: string
  description: string
  unfiled: boolean
  transfer: boolean
  /** Linked to a row of another statement (a CSV of the same month, say). */
  linked: boolean
  /** One plain expense or income row, whose amount a link may correct. */
  single: boolean
}

export interface PreviewRow {
  index: number
  localDate: string
  details: string
  amount: number
  fingerprint: string
  /**
   * "logged": the same amount, within two days. "maybe": close but not
   * exact (amount, date, or another account), so the owner decides.
   */
  status: "imported" | "logged" | "maybe" | "transfer" | "new"
  /** "logged" and "maybe": the entry it matches. */
  match?: {
    ids: string[]
    description: string
    localDate: string
    /** What the entry says now; a "maybe" link sets it to the row's. */
    amount: number
    unfiled: boolean
    /** Filed under another account; linking moves it here. */
    accountName: string | null
  }
  /** "transfer": the other account, and an entry there to turn into it. */
  transfer?: {
    accountId: string
    convert: { id: string; description: string; localDate: string } | null
  }
  /** Worth offering "transfer" for, even when nothing matched. */
  transferish: boolean
}

export interface Preview {
  account: { id: string; name: string; kind: AccountKind }
  rows: PreviewRow[]
  /** When this same file was imported into this account before. */
  importedBefore: Date | null
}

export type ImportDecision =
  | { action: "skip" }
  | { action: "new" }
  | { action: "link" }
  | { action: "transfer"; accountId: string }

/** A typed amount a little off what was charged: within ₱20 or 5%. */
const near = (a: number, b: number) =>
  Math.sign(a) === Math.sign(b) &&
  Math.abs(a - b) <= Math.max(2_000, Math.round(Math.abs(a) * 0.05))

const dayGap = (a: string, b: string) =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) /
  86_400_000

/** One-to-one pairs, closest first, each side used once. */
function pairUp<T>(
  pairs: { row: number; target: T; key: string; score: number }[],
  used = new Set<string>()
): Map<number, T> {
  const out = new Map<number, T>()
  for (const p of pairs.toSorted((a, b) => a.score - b.score)) {
    if (out.has(p.row) || used.has(p.key)) continue
    out.set(p.row, p.target)
    used.add(p.key)
  }
  return out
}

async function loadAccount(db: Db, id: string) {
  const account = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, id), eq(accounts.archived, false)),
    columns: { id: true, name: true, kind: true },
  })
  if (!account) throw new ImportError("That account is gone.")
  return account
}

/**
 * What importing would do, row by row: already imported, already logged
 * (with the entry), a transfer (with the other account), or new. Nothing
 * is written. The rows have to pass the statement checks again here, so a
 * statement that didn't add up in the browser can't be sent anyway.
 */
export async function previewImport(
  db: Db,
  input: StatementInput
): Promise<Preview> {
  const account = await loadAccount(db, input.accountId)
  const { rows } = input
  const check = checkStatement(rows, input.summary, input.period, account.kind)
  if (!check.ok) {
    throw new ImportError(check.problem ?? "The statement doesn't add up.")
  }
  const prints = fingerprintRows(rows)
  const A = account.id

  const dates = rows.map((r) => r.localDate).toSorted()
  const from = addDays(dates[0]!, -TRANSFER_DAYS)
  const to = addDays(dates.at(-1)!, TRANSFER_DAYS)

  const [stored, before, nearby, book] = await Promise.all([
    // Deleted rows count too: a row you deleted after importing stays
    // deleted when an overlapping statement comes in. (Undo clears the ref,
    // so an undone import can be imported again.)
    db
      .select({ ref: transactions.importRef })
      .from(transactions)
      .where(
        and(
          or(eq(transactions.accountId, A), eq(transactions.toAccountId, A)),
          inArray(transactions.importRef, prints)
        )
      ),
    db.query.imports.findFirst({
      where: and(
        eq(imports.accountId, A),
        eq(imports.fileHash, input.fileHash)
      ),
      orderBy: desc(imports.createdAt),
      columns: { createdAt: true },
    }),
    db
      .select({
        id: transactions.id,
        entryId: transactions.entryId,
        kind: transactions.kind,
        amount: transactions.amount,
        localDate: transactions.localDate,
        description: transactions.description,
        accountId: transactions.accountId,
        toAccountId: transactions.toAccountId,
        personId: transactions.personId,
        split: transactions.split,
        importRef: transactions.importRef,
      })
      .from(transactions)
      .where(
        and(
          isNull(transactions.deletedAt),
          sql`${transactions.localDate} between ${from} and ${to}`
        )
      ),
    accountBook(db),
  ])
  const imported = new Set(stored.map((s) => s.ref))
  const others = book.known.filter((a) => a.id !== A)
  const accountName = new Map(book.known.map((a) => [a.id, a.name]))
  // The owner's other account each row names ("Cash in from BPI").
  const named = rows.map(
    (r) => scanAccounts(r.details, others).mentions[0]?.accountId ?? null
  )
  const looksLikeTransfer = (i: number) => {
    const row = rows[i]!
    if (FEE_WORDS.test(row.details)) return false
    return (
      TRANSFER_WORDS.test(row.details) ||
      (account.kind === "credit_card" && row.amount > 0)
    )
  }
  const cardPayment = (i: number) =>
    account.kind === "credit_card" && rows[i]!.amount > 0

  // Entries on this account, or unfiled. A split bill is one unit: your
  // share plus the others' shares, together the amount charged.
  const units = new Map<string, Unit>()
  // Plain entries on the owner's other accounts, by amount: the other side
  // of a transfer, or an entry filed under the wrong account.
  const elsewhere = new Map<number, typeof nearby>()
  for (const t of nearby) {
    const plain =
      (t.kind === "expense" || t.kind === "income") &&
      !t.personId &&
      t.split === null
    if (t.accountId && t.accountId !== A && !t.toAccountId && plain) {
      elsewhere.set(t.amount, [...(elsewhere.get(t.amount) ?? []), t])
    }
    const onA = t.accountId === A || t.toAccountId === A
    const unfiled =
      t.accountId === null && (t.kind === "expense" || t.kind === "income")
    if (!onA && !unfiled) continue
    const key = t.entryId
      ? `${t.entryId}|${t.description}|${t.localDate}|${t.accountId}`
      : t.id
    const change =
      t.kind === "transfer" && t.toAccountId === A ? -t.amount : t.amount
    const unit = units.get(key) ?? {
      key,
      ids: [],
      change: 0,
      localDate: t.localDate,
      description: t.description,
      unfiled,
      transfer: t.kind === "transfer",
      linked: false,
      single: true,
    }
    unit.ids.push(t.id)
    unit.change += change
    // A transfer may carry the other side's ref, so it isn't "linked".
    if (t.importRef && t.kind !== "transfer") unit.linked = true
    unit.single = unit.ids.length === 1 && plain
    units.set(key, unit)
  }
  const byChange = new Map<number, Unit[]>()
  for (const unit of units.values()) {
    byChange.set(unit.change, [...(byChange.get(unit.change) ?? []), unit])
  }

  const open = prints.flatMap((print, i) => (imported.has(print) ? [] : [i]))
  const logged = pairUp(
    open.flatMap((i) => {
      const row = rows[i]!
      return (byChange.get(row.amount) ?? []).flatMap((unit) => {
        const gap = dayGap(row.localDate, unit.localDate)
        const limit = unit.linked
          ? 0
          : unit.transfer
            ? TRANSFER_DAYS
            : MATCH_DAYS
        if (gap > limit) return []
        // A row naming another of your accounts is a transfer; a payment
        // from a friend of the same amount isn't the same money.
        if (named[i] && !unit.transfer) return []
        // Exact date first; something already on this account before unfiled.
        return [
          {
            row: i,
            target: unit,
            key: unit.key,
            score: gap + (unit.unfiled ? 0.5 : 0),
          },
        ]
      })
    })
  )
  const usedUnits = new Set([...logged.values()].map((u) => u.key))

  // Transfers: the other side already logged on another account (spending
  // or income there, opposite amount), or another account named in the
  // details, or a payment to a card.
  const counterparts = pairUp(
    open
      .filter((i) => !logged.has(i))
      .flatMap((i) => {
        const row = rows[i]!
        return (elsewhere.get(-row.amount) ?? []).flatMap((t) => {
          const gap = dayGap(row.localDate, t.localDate)
          const transferish =
            looksLikeTransfer(i) || TRANSFER_WORDS.test(t.description)
          if (gap > TRANSFER_DAYS || !transferish) return []
          return [{ row: i, target: t, key: t.id, score: gap }]
        })
      })
  )

  // Near misses, for the owner to confirm: a typed amount a little off
  // (180 typed, 185 charged), a date up to a week off, or the right amount
  // filed under another account (entries that name none go to the default).
  const usedElsewhere = new Set([...counterparts.values()].map((t) => t.id))
  const maybe = pairUp(
    open
      .filter(
        (i) =>
          !logged.has(i) && !counterparts.has(i) && !named[i] && !cardPayment(i)
      )
      .flatMap((i) => {
        const row = rows[i]!
        const here = [...units.values()].flatMap((unit) => {
          if (!unit.single || unit.transfer || unit.linked) return []
          const gap = dayGap(row.localDate, unit.localDate)
          const exact = unit.change === row.amount
          if (exact ? gap > 7 : gap > 3 || !near(unit.change, row.amount)) {
            return []
          }
          const off = Math.abs(unit.change - row.amount) / Math.abs(row.amount)
          return [
            {
              row: i,
              target: { unit, accountId: null as string | null },
              key: unit.key,
              score: gap + off * 20,
            },
          ]
        })
        const there = (elsewhere.get(row.amount) ?? []).flatMap((t) => {
          const gap = dayGap(row.localDate, t.localDate)
          if (gap > MATCH_DAYS || t.importRef || usedElsewhere.has(t.id))
            return []
          const unit: Unit = {
            key: t.id,
            ids: [t.id],
            change: t.amount,
            localDate: t.localDate,
            description: t.description,
            unfiled: false,
            transfer: false,
            linked: false,
            single: true,
          }
          return [
            {
              row: i,
              target: { unit, accountId: t.accountId },
              key: t.id,
              score: gap + 1,
            },
          ]
        })
        return [...here, ...there]
      }),
    new Set(usedUnits)
  )

  const payFrom =
    others.find(
      (a) => a.id === book.defaultAccountId && a.kind !== "credit_card"
    ) ??
    others.find((a) => a.kind === "bank" || a.kind === "ewallet") ??
    null

  const previewRows = rows.map((row, i): PreviewRow => {
    const base = {
      index: i,
      localDate: row.localDate,
      details: row.details,
      amount: row.amount,
      fingerprint: prints[i]!,
      transferish: looksLikeTransfer(i),
    }
    if (imported.has(prints[i]!)) return { ...base, status: "imported" }
    const matched = logged.get(i)
    const close = maybe.get(i)
    const unit = matched ?? close?.unit
    if (unit) {
      return {
        ...base,
        status: matched ? "logged" : "maybe",
        match: {
          ids: unit.ids,
          description: unit.description,
          localDate: unit.localDate,
          amount: unit.change,
          unfiled: unit.unfiled,
          accountName: close?.accountId
            ? (accountName.get(close.accountId) ?? null)
            : null,
        },
      }
    }
    const other = counterparts.get(i)
    if (other?.accountId) {
      return {
        ...base,
        status: "transfer",
        transferish: true,
        transfer: {
          accountId: other.accountId,
          convert: {
            id: other.id,
            description: other.description,
            localDate: other.localDate,
          },
        },
      }
    }
    const atm =
      row.amount < 0 && base.transferish && ATM_WORDS.test(row.details)
        ? others.find((a) => a.kind === "cash")?.id
        : null
    const target = named[i] ?? atm ?? (cardPayment(i) ? payFrom?.id : null)
    if (target) {
      return {
        ...base,
        status: "transfer",
        transferish: true,
        transfer: { accountId: target, convert: null },
      }
    }
    return { ...base, status: "new" }
  })

  return {
    account,
    rows: previewRows,
    importedBefore: before?.createdAt ?? null,
  }
}

/** Is `decision` one the preview offered for this row? */
function allowed(row: PreviewRow, decision: ImportDecision) {
  if (row.status === "imported") return decision.action === "skip"
  if (decision.action === "link")
    return row.status === "logged" || row.status === "maybe"
  return true
}

export interface CommitResult {
  importId: string | null
  added: number
  linked: number
  transfers: number
  /** The account's balance now, after the import. */
  balance: number
  /** The statement's last day, what it says then, and what Goatside had. */
  end: string
  statementBalance: number | null
  balanceAtEnd: number
}

/**
 * Saves the owner's choices for each row. New rows go through the same
 * filing as typed entries (category, repeats), filed to the statement's
 * account. Matched entries get the row's fingerprint (and the account, if
 * they were unfiled). Transfers turn the other side's entry into the
 * transfer, or add one. Everything lands in one batch.
 *
 * `importId` is chosen by the browser, like a typed entry's id: a second
 * send of the same import fails on it instead of saving twice.
 */
export async function commitImport(
  db: Db,
  input: StatementInput & { importId: string; decisions: ImportDecision[] }
): Promise<CommitResult> {
  const preview = await previewImport(db, input)
  const { account } = preview
  if (input.decisions.length !== preview.rows.length) {
    throw new ImportError("The statement changed since you reviewed it.")
  }
  const known = new Set(
    (await accountBook(db)).known
      .map((a) => a.id)
      .filter((id) => id !== account.id)
  )

  const lines: DraftLine[] = []
  const refs: string[] = []
  const extra: BatchItem<"sqlite">[] = []
  const newTransfers: (typeof transactions.$inferInsert)[] = []
  let linked = 0
  let transfers = 0
  const now = new Date()
  // Entries this import changes instead of adding, with the ref it gives
  // them, so undo can put them back.
  const changed = new Map<string, string>()
  const converted: string[] = []

  for (const row of preview.rows) {
    let decision = input.decisions[row.index]!
    // Imported meanwhile (a second tab, a resend), or a 0.00 line (some
    // banks print reversed holds that way): nothing to save.
    if (row.status === "imported" || row.amount === 0)
      decision = { action: "skip" }
    if (!allowed(row, decision)) {
      throw new ImportError("The statement changed since you reviewed it.")
    }
    const source = input.rows[row.index]!

    if (decision.action === "link" && row.match) {
      linked++
      for (const id of row.match.ids) changed.set(id, row.fingerprint)
      extra.push(
        db
          .update(transactions)
          .set({
            importRef: row.fingerprint,
            // A near match takes the statement's word for the amount and
            // account; the owner confirmed it's the same money.
            ...((row.match.unfiled || row.status === "maybe") && {
              accountId: account.id,
            }),
            ...(row.status === "maybe" && { amount: row.amount }),
          })
          .where(
            and(
              inArray(transactions.id, row.match.ids),
              isNull(transactions.deletedAt)
            )
          )
      )
    } else if (decision.action === "transfer") {
      if (!known.has(decision.accountId)) {
        throw new ImportError("That account is gone.")
      }
      transfers++
      // Stored from the side the money left, as a negative amount.
      const out = row.amount < 0
      const sides = {
        kind: "transfer" as const,
        amount: -Math.abs(row.amount),
        accountId: out ? account.id : decision.accountId,
        toAccountId: out ? decision.accountId : account.id,
      }
      const convert =
        row.transfer?.accountId === decision.accountId
          ? row.transfer.convert
          : null
      if (convert) {
        changed.set(convert.id, row.fingerprint)
        converted.push(convert.id)
        extra.push(
          db
            .update(transactions)
            .set({
              ...sides,
              categoryId: null,
              aiConfidence: null,
              recurring: false,
              status: "parsed",
              importRef: row.fingerprint,
            })
            .where(
              and(
                eq(transactions.id, convert.id),
                isNull(transactions.deletedAt)
              )
            ),
          // Its category question no longer applies.
          db
            .update(questions)
            .set({ resolvedAt: now })
            .where(
              and(
                eq(questions.transactionId, convert.id),
                isNull(questions.resolvedAt)
              )
            )
        )
      } else {
        newTransfers.push({
          ...sides,
          id: crypto.randomUUID(),
          entryId: input.importId,
          localDate: source.localDate,
          description: source.details,
          status: "parsed",
          importRef: row.fingerprint,
        })
      }
    } else if (decision.action === "new") {
      const amount = Math.abs(source.amount)
      lines.push({
        raw: source.details,
        direction: source.amount > 0 ? "in" : "out",
        signInferred: false,
        amount,
        share: amount,
        split: null,
        description: source.details,
        localDate: source.localDate,
        dateFromText: true,
      })
      refs.push(row.fingerprint)
    }
  }

  const added = lines.length + newTransfers.length
  const touched = added + linked + transfers
  if (touched) {
    const ids = [...changed.keys()]
    const [prior, closing] = await Promise.all([
      ids.length
        ? db
            .select({
              id: transactions.id,
              kind: transactions.kind,
              amount: transactions.amount,
              accountId: transactions.accountId,
              toAccountId: transactions.toAccountId,
              categoryId: transactions.categoryId,
              aiConfidence: transactions.aiConfidence,
              recurring: transactions.recurring,
              status: transactions.status,
              importRef: transactions.importRef,
            })
            .from(transactions)
            .where(inArray(transactions.id, ids))
        : [],
      converted.length
        ? db
            .select({ id: questions.id })
            .from(questions)
            .where(
              and(
                inArray(questions.transactionId, converted),
                isNull(questions.resolvedAt)
              )
            )
        : [],
    ])
    const undo: ImportUndo | null = ids.length
      ? {
          rows: prior.map((r) => ({ ...r, ref: changed.get(r.id)! })),
          questionIds: closing.map((q) => q.id),
        }
      : null
    const record = db.insert(imports).values({
      id: input.importId,
      accountId: account.id,
      entryId: added ? input.importId : null,
      fileHash: input.fileHash,
      periodStart: input.period?.start ?? null,
      periodEnd: input.period?.end ?? null,
      opening: input.summary.opening ?? null,
      closing: input.summary.closing ?? null,
      rowCount: input.rows.length,
      addedCount: added,
      undo,
    })
    if (added) {
      const period = input.period
        ? ` (${input.period.start} to ${input.period.end})`
        : ""
      await saveLines(
        db,
        {
          id: input.importId,
          rawText: `Imported ${account.name} statement${period}`,
        },
        lines,
        {
          imported: {
            accountId: account.id,
            refs,
            extra: [
              ...Array.from(
                { length: Math.ceil(newTransfers.length / 200) },
                (_, i) =>
                  db
                    .insert(transactions)
                    .values(newTransfers.slice(i * 200, (i + 1) * 200))
              ),
              ...extra,
              record,
            ],
          },
        }
      )
    } else {
      await db.batch([record, ...extra])
    }
  }

  const balance =
    (await accountBalances(db)).find((a) => a.id === account.id)?.balance ?? 0
  // The statement speaks for its last day. Entries after it (typed since,
  // or a later statement) are taken off before comparing.
  const end =
    input.period?.end ??
    input.rows
      .map((r) => r.localDate)
      .toSorted()
      .at(-1)!
  const [later] = await db
    .select({
      total: sql<number>`coalesce(sum(case when ${transactions.accountId} = ${account.id} then ${transactions.amount} else -${transactions.amount} end), 0)`,
    })
    .from(transactions)
    .where(
      and(
        isNull(transactions.deletedAt),
        sql`${transactions.localDate} > ${end}`,
        or(
          eq(transactions.accountId, account.id),
          and(
            eq(transactions.kind, "transfer"),
            eq(transactions.toAccountId, account.id)
          )
        )
      )
    )
  const printed =
    input.summary.closing ??
    input.rows.findLast((r) => r.balance !== undefined)?.balance
  return {
    importId: touched ? input.importId : null,
    added,
    linked,
    transfers,
    balance,
    end,
    balanceAtEnd: balance - Number(later?.total ?? 0),
    statementBalance:
      printed === undefined
        ? null
        : account.kind === "credit_card"
          ? -printed
          : printed,
  }
}

/**
 * Takes an import back: removes the entries it added, and puts back the
 * entries it linked, moved or turned into transfers, as they were. An entry
 * another import has linked since is left alone. One batch.
 */
export async function undoImport(db: Db, importId: string) {
  const record = await db.query.imports.findFirst({
    where: eq(imports.id, importId),
  })
  if (!record) return 0
  const live = record.entryId
    ? and(
        eq(transactions.entryId, record.entryId),
        isNull(transactions.deletedAt)
      )
    : null
  const added = live
    ? await db.select({ id: transactions.id }).from(transactions).where(live)
    : []
  const { rows = [], questionIds = [] } = record.undo ?? {}
  await db.batch([
    db.delete(imports).where(eq(imports.id, importId)),
    ...rows.map(({ id, ref, ...before }) =>
      db
        .update(transactions)
        .set(before)
        .where(
          and(
            eq(transactions.id, id),
            eq(transactions.importRef, ref),
            isNull(transactions.deletedAt)
          )
        )
    ),
    ...(questionIds.length
      ? [
          db
            .update(questions)
            .set({ resolvedAt: null })
            .where(inArray(questions.id, questionIds)),
        ]
      : []),
    ...(live
      ? [
          db
            .update(transactions)
            .set({ deletedAt: new Date(), importRef: null })
            .where(live),
        ]
      : []),
  ])
  return added.length
}

/** Past imports into an account, newest first. */
export async function importHistory(db: Db, accountId: string) {
  return db
    .select({
      id: imports.id,
      periodStart: imports.periodStart,
      periodEnd: imports.periodEnd,
      rowCount: imports.rowCount,
      addedCount: imports.addedCount,
      createdAt: imports.createdAt,
    })
    .from(imports)
    .where(eq(imports.accountId, accountId))
    .orderBy(desc(imports.createdAt))
    .limit(12)
}
