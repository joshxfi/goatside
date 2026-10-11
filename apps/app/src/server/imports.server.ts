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
import type { AccountKind } from "@workspace/db/schema"
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

export interface StatementInput {
  accountId: string
  fileHash: string
  rows: StatementRow[]
  summary: StatementSummary
  period: StatementPeriod | null
}

/** Logged rows that move together: one row, or the rows of a split bill. */
interface Unit {
  ids: string[]
  /** What it did to the statement's account (or would, if unfiled). */
  change: number
  localDate: string
  description: string
  unfiled: boolean
  transfer: boolean
}

export interface PreviewRow {
  index: number
  localDate: string
  details: string
  amount: number
  fingerprint: string
  status: "imported" | "logged" | "transfer" | "new"
  /** "logged": the entry it matches. */
  match?: {
    ids: string[]
    description: string
    localDate: string
    unfiled: boolean
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

const dayGap = (a: string, b: string) =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) /
  86_400_000

/** One-to-one pairs, closest first, each side used once. */
function pairUp<T>(
  pairs: { row: number; target: T; key: string; score: number }[]
): Map<number, T> {
  const out = new Map<number, T>()
  const used = new Set<string>()
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
    db
      .select({ ref: transactions.importRef })
      .from(transactions)
      .where(
        and(
          isNull(transactions.deletedAt),
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

  // Entries on this account, or unfiled. A split bill is one unit: your
  // share plus the others' shares, together the amount charged.
  const units = new Map<string, Unit>()
  for (const t of nearby) {
    const onA = t.accountId === A || t.toAccountId === A
    const unfiled =
      t.accountId === null && (t.kind === "expense" || t.kind === "income")
    if (!onA && !unfiled) continue
    // Already matched to a statement row. A transfer may carry the other
    // side's ref, so it can still match this side.
    if (t.importRef && t.kind !== "transfer") continue
    const key = t.entryId
      ? `${t.entryId}|${t.description}|${t.localDate}|${t.accountId}`
      : t.id
    const change =
      t.kind === "transfer" && t.toAccountId === A ? -t.amount : t.amount
    const unit = units.get(key) ?? {
      ids: [],
      change: 0,
      localDate: t.localDate,
      description: t.description,
      unfiled,
      transfer: t.kind === "transfer",
    }
    unit.ids.push(t.id)
    unit.change += change
    units.set(key, unit)
  }

  const open = prints.flatMap((print, i) => (imported.has(print) ? [] : [i]))
  const logged = pairUp(
    open.flatMap((i) => {
      const row = rows[i]!
      return [...units.entries()].flatMap(([key, unit]) => {
        const gap = dayGap(row.localDate, unit.localDate)
        const limit = unit.transfer ? TRANSFER_DAYS : MATCH_DAYS
        if (unit.change !== row.amount || gap > limit) return []
        // Exact date first; something already on this account before unfiled.
        return [
          { row: i, target: unit, key, score: gap + (unit.unfiled ? 0.5 : 0) },
        ]
      })
    })
  )

  // Transfers: the other side already logged on another account (spending
  // or income there, opposite amount), or another account named in the
  // details, or a payment to a card.
  const others = book.known.filter((a) => a.id !== A)
  const looksLikeTransfer = (i: number) => {
    const row = rows[i]!
    return (
      TRANSFER_WORDS.test(row.details) ||
      (account.kind === "credit_card" && row.amount > 0)
    )
  }
  const counterparts = pairUp(
    open
      .filter((i) => !logged.has(i))
      .flatMap((i) => {
        const row = rows[i]!
        return nearby.flatMap((t) => {
          if (
            !t.accountId ||
            t.accountId === A ||
            t.toAccountId ||
            t.personId ||
            (t.kind !== "expense" && t.kind !== "income") ||
            t.amount !== -row.amount
          ) {
            return []
          }
          const gap = dayGap(row.localDate, t.localDate)
          const transferish =
            looksLikeTransfer(i) || TRANSFER_WORDS.test(t.description)
          if (gap > TRANSFER_DAYS || !transferish) return []
          return [{ row: i, target: t, key: t.id, score: gap }]
        })
      })
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
    const unit = logged.get(i)
    if (unit) {
      return {
        ...base,
        status: "logged",
        match: {
          ids: unit.ids,
          description: unit.description,
          localDate: unit.localDate,
          unfiled: unit.unfiled,
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
    const named = scanAccounts(row.details, others).mentions[0]?.accountId
    const target =
      named ??
      (account.kind === "credit_card" && row.amount > 0 ? payFrom?.id : null)
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
  if (decision.action === "link") return row.status === "logged"
  return true
}

export interface CommitResult {
  importId: string | null
  added: number
  linked: number
  transfers: number
  /** The account's balance after the import, and what the statement says. */
  balance: number
  statementBalance: number | null
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

  for (const row of preview.rows) {
    let decision = input.decisions[row.index]!
    // Imported meanwhile (a second tab, a resend): nothing to do.
    if (row.status === "imported") decision = { action: "skip" }
    if (!allowed(row, decision)) {
      throw new ImportError("The statement changed since you reviewed it.")
    }
    const source = input.rows[row.index]!

    if (decision.action === "link" && row.match) {
      linked++
      extra.push(
        db
          .update(transactions)
          .set({
            importRef: row.fingerprint,
            ...(row.match.unfiled && { accountId: account.id }),
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
              ...(newTransfers.length
                ? [db.insert(transactions).values(newTransfers)]
                : []),
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
  const printed =
    input.summary.closing ??
    input.rows.findLast((r) => r.balance !== undefined)?.balance
  return {
    importId: touched ? input.importId : null,
    added,
    linked,
    transfers,
    balance,
    statementBalance:
      printed === undefined
        ? null
        : account.kind === "credit_card"
          ? -printed
          : printed,
  }
}

/**
 * Takes an import back: removes the entries it added. Entries it matched
 * keep their link (they're real, and the statement agrees with them).
 */
export async function undoImport(db: Db, importId: string) {
  const record = await db.query.imports.findFirst({
    where: eq(imports.id, importId),
  })
  if (!record) return 0
  const now = new Date()
  const removed = record.entryId
    ? await db
        .update(transactions)
        .set({ deletedAt: now })
        .where(
          and(
            eq(transactions.entryId, record.entryId),
            isNull(transactions.deletedAt)
          )
        )
        .returning({ id: transactions.id })
    : []
  await db.delete(imports).where(eq(imports.id, importId))
  return removed.length
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
