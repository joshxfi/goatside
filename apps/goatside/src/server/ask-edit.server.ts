/**
 * Ask mode's editEntries: change what entries are (spending, income, a
 * transfer, an IOU) and their category, account, person, description or
 * date, by the ids findTransactions returned. Every change runs the edit
 * drawer's own checks (`prepareEdit`) before the card is shown, so the
 * owner only approves edits that will apply. Amounts never change here.
 * Server-only.
 */
import { type ToolApprovalStatus, tool } from "ai"
import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import { z } from "zod"
import { formatMoney } from "@workspace/core/money"
import { type Db, schema } from "@workspace/db"
import { peopleWithBalances } from "./agent.server"
import { accountBalances } from "./accounts.server"
import { matchPerson } from "./ask-people.server"
import {
  DATE,
  type EntryKind,
  type EntryRow,
  accountProblem,
  entryKind,
  entryLabel,
  entryRows,
  entrySummary,
  matchAccount,
} from "./ask-search.server"
import {
  type EditInput,
  EditError,
  editTransaction,
  prepareEdit,
} from "./ledger.server"

const { categories, transactions } = schema

const MAX_EDIT = 20
const LISTED = 6

const TYPES = ["spending", "income", "transfer", "lent", "borrowed"] as const
type Target = (typeof TYPES)[number]

const ENTRY_TYPE: Record<Target, EditInput["type"]> = {
  spending: "expense",
  income: "income",
  transfer: "transfer",
  lent: "lent",
  borrowed: "borrowed",
}

export const EDIT = z.object({
  ids: z
    .array(z.string())
    .min(1)
    .max(MAX_EDIT)
    .describe("The entries to change, by the ids findTransactions returned"),
  type: z
    .enum(TYPES)
    .optional()
    .describe(
      "What the entry really is. transfer = money moved between two of the owner's accounts, like paying a credit card from a bank; lent or borrowed = an IOU"
    ),
  category: z
    .string()
    .optional()
    .describe(
      "Category name. Pass one when changing an entry to spending or income"
    ),
  account: z
    .string()
    .optional()
    .describe(
      "The account the money left or arrived in. Not for transfers: use fromAccount and toAccount"
    ),
  fromAccount: z
    .string()
    .optional()
    .describe(
      "Transfers: the account the money left. Leave out when it's the entry's own account and money left it"
    ),
  toAccount: z
    .string()
    .optional()
    .describe(
      "Transfers: the account the money went to. Leave out when it's the entry's own account and money arrived in it"
    ),
  person: z.string().optional().describe("Lent or borrowed: who with, by name"),
  description: z.string().trim().min(1).max(200).optional(),
  date: DATE.optional(),
})
type Edit = z.infer<typeof EDIT>

/** The fields an edit changed, as they were, so Undo can put them back. */
export interface EditBefore {
  id: string
  type?: EditInput["type"]
  categoryId?: string | null
  accountId?: string | null
  toAccountId?: string
  description?: string
  localDate?: string
  personId?: string
}

interface Planned {
  row: EntryRow
  write: () => Promise<void>
  /** What the entry becomes, for the card. */
  after: string
  before: EditBefore
}

const plural = (n: number) => (n === 1 ? "entry" : "entries")

const A: Record<EntryKind, string> = {
  spending: "spending",
  income: "income",
  transfer: "a transfer",
  lent: "money lent",
  borrowed: "money borrowed",
  repayment: "a repayment",
}

/**
 * Works out each entry's change and checks it, without writing. Anything
 * that doesn't fit comes back as one `problem` for the model to fix.
 */
async function planEdits(
  db: Db,
  input: Edit
): Promise<
  { problem: string } | { planned: Planned[]; unchanged: EntryRow[] }
> {
  const { ids, ...change } = input
  if (!Object.values(change).some((v) => v !== undefined))
    return {
      problem:
        "Say what to change: type, category, account, person, description or date.",
    }
  const wanted = [...new Set(ids)]
  const rows = await entryRows(
    db,
    and(isNull(transactions.deletedAt), inArray(transactions.id, wanted)),
    { limit: MAX_EDIT }
  )
  if (rows.length < wanted.length)
    return {
      problem:
        "Some of those ids aren't entries any more. Look them up again with findTransactions.",
    }

  // Names to ids, once for every entry.
  const open = (await accountBalances(db)).filter((a) => !a.archived)
  const accountName = new Map(open.map((a) => [a.id, a.name]))
  const accountIds: Partial<
    Record<"account" | "fromAccount" | "toAccount", string>
  > = {}
  for (const key of ["account", "fromAccount", "toAccount"] as const) {
    const name = input[key]
    if (!name) continue
    const fit = matchAccount(open, name)
    if (!fit || !("found" in fit))
      return { problem: accountProblem(name, fit, open) }
    accountIds[key] = fit.found.id
  }
  let person: { id: string; name: string } | undefined
  if (input.person) {
    const everyone = await peopleWithBalances(db)
    const found = matchPerson(everyone, input.person)
    if (!found)
      return {
        problem: `No one called "${input.person}". People: ${everyone.map((p) => p.name).join(", ") || "none yet"}.`,
      }
    person = found
  }

  const problems: string[] = []
  const planned: Planned[] = []
  const unchanged: EntryRow[] = []
  for (const row of rows) {
    const name = `"${entryLabel(row)}" (${row.localDate})`
    const was = entryKind(row)
    const target: EntryKind = input.type ?? was
    const edit: EditInput = { id: row.id }
    const after: string[] = []

    if (input.type && input.type !== was) {
      if (row.split && row.split > 1) {
        problems.push(
          `${name} is a split bill. Change its type from the entry itself.`
        )
        continue
      }
      edit.type = ENTRY_TYPE[input.type]
    }

    let categoryText: string | undefined
    if (input.category) {
      if (target !== "spending" && target !== "income") {
        problems.push(
          `Only spending and income have a category, and ${name} is ${A[target]}.`
        )
        continue
      }
      const kind = target === "spending" ? "expense" : "income"
      const category = await db.query.categories.findFirst({
        where: and(
          sql`lower(${categories.name}) = ${input.category.trim().toLowerCase()}`,
          eq(categories.kind, kind),
          eq(categories.archived, false)
        ),
      })
      if (!category) {
        problems.push(`There's no ${A[target]} category "${input.category}".`)
        continue
      }
      edit.categoryId = category.id
      categoryText = `${category.emoji} ${category.name}`
    }

    if (target === "transfer") {
      if (input.account) {
        problems.push(
          "For a transfer, name the accounts with fromAccount and toAccount."
        )
        continue
      }
      if (
        was !== "transfer" ||
        accountIds.fromAccount ||
        accountIds.toAccount
      ) {
        // The entry's own account is one end: where money left it, or
        // where it arrived.
        const from =
          accountIds.fromAccount ??
          (was === "transfer" || row.amount < 0 ? row.accountId : null)
        const to =
          accountIds.toAccount ??
          (was === "transfer"
            ? row.toAccountId
            : row.amount > 0
              ? row.accountId
              : null)
        if (!from || !to) {
          problems.push(
            `Say which account the money for ${name} ${from ? "went to" : "came from"}.`
          )
          continue
        }
        edit.accountId = from
        edit.toAccountId = to
        after.push(
          `${was === "transfer" ? "" : "a transfer "}from ${accountName.get(from) ?? "an account"} to ${accountName.get(to) ?? "an account"}`.trim()
        )
      }
    } else {
      if (accountIds.fromAccount || accountIds.toAccount) {
        problems.push(
          "fromAccount and toAccount are only for transfers. Use account."
        )
        continue
      }
      if (edit.type)
        after.push(
          target === "lent"
            ? `lent to ${person?.name ?? row.personName ?? "someone"}`
            : target === "borrowed"
              ? `borrowed from ${person?.name ?? row.personName ?? "someone"}`
              : `${target}${categoryText ? "" : ", no category"}`
        )
      if (accountIds.account) {
        edit.accountId = accountIds.account
        after.push(`in ${accountName.get(accountIds.account)}`)
      }
    }
    if (categoryText) after.push(`under ${categoryText}`)

    if (person) {
      if (target !== "lent" && target !== "borrowed") {
        problems.push(
          `Only money lent or borrowed is with someone, and ${name} is ${A[target]}. To split a bill, change it from the entry itself.`
        )
        continue
      }
      edit.people = [person.id]
      if (!edit.type) after.push(`with ${person.name}`)
    } else if ((target === "lent" || target === "borrowed") && !row.personId) {
      problems.push(
        `Say who ${name} was ${target} ${target === "lent" ? "to" : "from"}.`
      )
      continue
    }

    // The model often repeats what's already there; only list real changes.
    if (input.description && input.description !== row.description) {
      edit.description = input.description
      after.push(`called "${input.description}"`)
    }
    if (input.date && input.date !== row.localDate) {
      edit.localDate = input.date
      after.push(`dated ${input.date}`)
    }

    let write: (() => Promise<void>) | null
    try {
      write = await prepareEdit(edit)
    } catch (error) {
      if (!(error instanceof EditError)) throw error
      problems.push(`${name}: ${error.message}`)
      continue
    }
    if (!write) {
      unchanged.push(row)
      continue
    }
    planned.push({
      row,
      write,
      after: after.join(", "),
      before: beforeOf(row, edit),
    })
  }
  if (problems.length) return { problem: problems.join(" ") }
  return { planned, unchanged }
}

/** What Undo needs: each field the edit touches, as it is now. */
function beforeOf(row: EntryRow, edit: EditInput): EditBefore {
  const retyped = edit.type !== undefined
  const was = entryKind(row)
  return {
    id: row.id,
    ...(retyped &&
      was !== "repayment" && {
        type: was === "spending" ? "expense" : was,
      }),
    ...((retyped || edit.categoryId !== undefined) && {
      categoryId: row.categoryId,
    }),
    ...((retyped || edit.accountId !== undefined) && {
      accountId: row.accountId,
    }),
    ...(row.kind === "transfer" &&
      row.toAccountId &&
      (retyped || edit.toAccountId !== undefined) && {
        toAccountId: row.toAccountId,
      }),
    ...(edit.description !== undefined && { description: row.description }),
    ...(edit.localDate !== undefined && { localDate: row.localDate }),
    ...(row.kind === "lend" &&
      row.personId &&
      (retyped || edit.people) && { personId: row.personId }),
  }
}

export function editTools(db: Db) {
  return {
    editEntries: tool({
      description:
        "Change entries the owner points at, by the ids findTransactions returned: what they are (spending, income, a transfer between their accounts, money lent or borrowed), their category, account, person, description or date. Use it for 'that's a card payment, not income', 'make it a transfer from BPI to my card', 'that was a loan to Nini'. Amounts stay as they are. The owner confirms first.",
      inputSchema: EDIT,
      execute: async (input) => {
        const plan = await planEdits(db, input)
        if ("problem" in plan) return { done: false, message: plan.problem }
        if (!plan.planned.length)
          return { done: false, message: "They're already that way." }
        const before: EditBefore[] = []
        const failed: string[] = []
        for (const p of plan.planned) {
          try {
            await p.write()
            before.push(p.before)
          } catch (error) {
            if (!(error instanceof EditError)) throw error
            failed.push(`${entryLabel(p.row)}: ${error.message}`)
          }
        }
        const now = await entryRows(
          db,
          inArray(
            transactions.id,
            before.map((b) => b.id)
          ),
          { limit: MAX_EDIT }
        )
        return {
          done: before.length > 0,
          message: [
            before.length &&
              `Changed ${before.length} ${plural(before.length)}.`,
            failed.length && `Couldn't change ${failed.join("; ")}.`,
          ]
            .filter(Boolean)
            .join(" "),
          // For the model, so it reports what the entries are now.
          entries: now.map(entrySummary),
          ...(before.length && {
            undo: { kind: "edits" as const, changes: before },
          }),
        }
      },
    }),
  }
}

const denied = (reason: string): ToolApprovalStatus => ({
  type: "denied",
  reason,
})

export function editApprovals(db: Db) {
  return {
    editEntries: async (input: Edit) => {
      const plan = await planEdits(db, input)
      if ("problem" in plan) return denied(plan.problem)
      const { planned, unchanged } = plan
      if (!planned.length) return denied("Those entries are already that way.")
      const shown = planned
        .slice(0, LISTED)
        .map(
          (p) =>
            `${entryLabel(p.row)} (${p.row.localDate.slice(5)}, ${formatMoney(Math.abs(p.row.amount))}): now ${p.after}`
        )
        .join("; ")
      const more =
        planned.length > LISTED ? `; and ${planned.length - LISTED} more` : ""
      const same = unchanged.length
        ? `. ${unchanged.length} other ${plural(unchanged.length)} already ${unchanged.length === 1 ? "is" : "are"} that way`
        : ""
      return {
        type: "user-approval" as const,
        reason: `Change ${planned.length} ${plural(planned.length)}: ${shown}${more}${same}`,
      }
    },
  }
}

/** Undo for editEntries: put each entry back the way it was. */
export async function restoreEdits(changes: EditBefore[]) {
  for (const { personId, ...change } of changes)
    await editTransaction({
      ...change,
      ...(personId && { people: [personId] }),
    })
}
