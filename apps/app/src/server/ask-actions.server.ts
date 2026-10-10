/**
 * Ask mode's write tools. Every one needs the owner's approval: the server
 * finds what would change and writes the confirmation text itself, so the
 * card shows real entries, not the model's description of them. Results
 * carry what the UI needs to offer Undo. Server-only.
 */
import { createHmac } from "node:crypto"
import { type ToolApprovalStatus, tool } from "ai"
import { and, between, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { z } from "zod"
import { ACCOUNT_KIND_LABELS } from "@workspace/core/accounts"
import { formatPeso } from "@workspace/core/money"
import { preparse } from "@workspace/core/preparse"
import { type Db, schema } from "@workspace/db"
import { peopleWithBalances } from "./agent.server"
import {
  accountBalances,
  createAccount,
  fileToAccount,
  setBalance,
} from "./accounts.server"
import { serverEnv } from "./env"
import { logText, settleWith, today } from "./ledger.server"
import { getDb } from "./services"

const { categories, corrections, transactions } = schema

const MAX_MOVE = 200
const MAX_DELETE = 50
const LISTED = 6

/** Signs approvals so a modified client can't forge one (AI SDK verifies it). */
export function approvalSecret() {
  return createHmac("sha256", serverEnv().SESSION_SECRET)
    .update("goatside-tool-approval")
    .digest("hex")
}

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** Which entries a change applies to. Same vocabulary as findTransactions. */
const FILTER = z.object({
  from: DATE.describe("First day, YYYY-MM-DD"),
  to: DATE.describe("Last day, YYYY-MM-DD"),
  text: z
    .string()
    .optional()
    .describe("Words in the description, e.g. 'grab' or 'netflix'"),
  category: z.string().optional().describe("Current category name"),
  amount: z
    .number()
    .positive()
    .optional()
    .describe("Exact amount in pesos, e.g. 500"),
  direction: z.enum(["out", "in", "both"]).default("both"),
})
type Filter = z.infer<typeof FILTER>

const MOVE = FILTER.extend({
  newCategory: z.string().describe("Category to move them to, by name"),
})

const FILE = FILTER.extend({
  account: z.string().describe("Account to file them under, by name"),
})

const NEW_ACCOUNT = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .describe("e.g. 'GCash', 'BPI Savings'"),
  kind: z.enum(schema.ACCOUNT_KINDS),
  balance: z
    .number()
    .min(0)
    .optional()
    .describe("Pesos it holds now; for a credit card, what's owed now"),
  creditLimit: z.number().positive().optional().describe("Credit cards, pesos"),
  last4: z
    .string()
    .regex(/^\d{4}$/)
    .optional()
    .describe("Last four digits, if the owner gave them"),
  aliases: z
    .array(z.string().max(30))
    .max(6)
    .optional()
    .describe("Short names the owner uses for it, e.g. 'sb'"),
})

const BALANCE = z.object({
  account: z.string().describe("Account name"),
  balance: z
    .number()
    .min(0)
    .describe("Pesos it holds now; for a credit card, what's owed now"),
})

const centavos = (pesos: number) => Math.round(pesos * 100)

/** An open account by name or nickname, with its balance. */
async function findAccount(db: Db, name: string) {
  const key = name.trim().toLowerCase()
  return (await accountBalances(db)).find(
    (a) =>
      !a.archived &&
      (a.name.toLowerCase() === key || a.aliases.some((x) => x === key))
  )
}

/** "₱1,200" or "₱1,200 owed" for a card. */
const reads = (a: { kind: string; balance: number }) =>
  a.kind === "credit_card"
    ? `${formatPeso(Math.max(0, -a.balance))} owed`
    : formatPeso(a.balance)

function matches(db: Db, filter: Filter, limit: number) {
  return db
    .select({
      id: transactions.id,
      amount: transactions.amount,
      localDate: transactions.localDate,
      description: transactions.description,
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      accountId: transactions.accountId,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        isNull(transactions.deletedAt),
        inArray(transactions.kind, ["expense", "income"]),
        between(transactions.localDate, filter.from, filter.to),
        filter.direction === "out"
          ? sql`${transactions.amount} < 0`
          : filter.direction === "in"
            ? sql`${transactions.amount} > 0`
            : undefined,
        filter.category
          ? sql`lower(coalesce(${categories.name}, 'uncategorized')) = ${filter.category.trim().toLowerCase()}`
          : undefined,
        filter.text
          ? sql`lower(${transactions.description}) like ${`%${filter.text.trim().toLowerCase()}%`}`
          : undefined,
        filter.amount
          ? sql`abs(${transactions.amount}) = ${Math.round(filter.amount * 100)}`
          : undefined
      )
    )
    .orderBy(desc(transactions.localDate), desc(transactions.createdAt))
    .limit(limit + 1)
}

type Match = Awaited<ReturnType<typeof matches>>[number]

function listed(rows: Match[]) {
  const shown = rows
    .slice(0, LISTED)
    .map(
      (r) =>
        `${r.description || "untitled"} (${r.localDate.slice(5)}, ${formatPeso(Math.abs(r.amount))})`
    )
    .join("; ")
  return rows.length > LISTED
    ? `${shown}; and ${rows.length - LISTED} more`
    : shown
}

const denied = (reason: string): ToolApprovalStatus => ({
  type: "denied",
  reason,
})

async function findCategory(db: Db, name: string) {
  return db.query.categories.findFirst({
    where: and(
      sql`lower(${categories.name}) = ${name.trim().toLowerCase()}`,
      eq(categories.archived, false)
    ),
  })
}

export function actionTools(db: Db) {
  const tools = {
    moveToCategory: tool({
      description:
        "Re-file matching entries under another category, e.g. 'move all grab rides this month to Transport'. The owner confirms first.",
      inputSchema: MOVE,
      execute: async (input) => {
        const target = await findCategory(db, input.newCategory)
        if (!target)
          return { done: false, message: "That category doesn't exist." }
        const rows = (await matches(db, input, MAX_MOVE)).filter(
          (r) =>
            (r.amount > 0 ? "income" : "expense") === target.kind &&
            r.categoryId !== target.id
        )
        if (!rows.length)
          return { done: false, message: "Nothing left to move." }
        await db
          .update(transactions)
          .set({ categoryId: target.id, status: "confirmed" })
          .where(
            inArray(
              transactions.id,
              rows.map((r) => r.id)
            )
          )
        await db.insert(corrections).values(
          rows.map((r) => ({
            transactionId: r.id,
            field: "categoryId",
            fromValue: r.categoryId,
            toValue: target.id,
          }))
        )
        return {
          done: true,
          message: `Moved ${rows.length} ${rows.length === 1 ? "entry" : "entries"} to ${target.emoji} ${target.name}.`,
          undo: {
            kind: "recategorize" as const,
            changes: rows.map((r) => ({ id: r.id, categoryId: r.categoryId })),
          },
        }
      },
    }),

    deleteEntries: tool({
      description:
        "Delete matching entries, e.g. 'delete the duplicate 500 lunch from yesterday'. Use a narrow filter. The owner confirms first, and can undo.",
      inputSchema: FILTER,
      execute: async (input) => {
        const rows = await matches(db, input, MAX_DELETE)
        if (!rows.length) return { done: false, message: "Nothing matched." }
        const ids = rows.slice(0, MAX_DELETE).map((r) => r.id)
        await db
          .update(transactions)
          .set({ deletedAt: new Date() })
          .where(inArray(transactions.id, ids))
        return {
          done: true,
          message: `Deleted ${ids.length} ${ids.length === 1 ? "entry" : "entries"}.`,
          undo: { kind: "restore" as const, ids },
        }
      },
    }),

    logEntries: tool({
      description:
        "Log new entries for the owner using composer syntax, one line per entry: a sign, an amount, a description, and optional date words. Examples: '-500 lunch yesterday', '+15000 salary', '-1200 dinner w/ mara and ben split 3'. Use - for money out and + for money in. The owner confirms first.",
      inputSchema: z.object({
        text: z
          .string()
          .max(500)
          .describe("Composer text; separate several entries with commas"),
      }),
      execute: async ({ text }) => {
        const result = await logText(text)
        if (result.kind !== "log")
          return { done: false, message: "Couldn't read an amount in that." }
        return {
          done: true,
          message: `Logged ${result.saved.length} ${result.saved.length === 1 ? "entry" : "entries"}${result.asked ? "; Goatside has a quick question about it" : ""}.`,
          undo: { kind: "delete" as const, ids: result.transactionIds },
        }
      },
    }),

    settleUp: tool({
      description:
        "Record that a person paid the owner back (or the owner paid them back): the whole balance, or part of it in pesos. The owner confirms first.",
      inputSchema: z.object({
        person: z.string().describe("Person's name or nickname"),
        amount: z
          .number()
          .positive()
          .optional()
          .describe("Pesos; omit to settle everything"),
      }),
      execute: async ({ person, amount }) => {
        const found = await findPerson(db, person)
        if (!found) return { done: false, message: `No one called ${person}.` }
        const result = await settleWith(
          found.id,
          amount ? Math.round(amount * 100) : undefined
        )
        if (!result.id)
          return {
            done: false,
            message: `You and ${found.name} are already square.`,
          }
        return {
          done: true,
          message: `Recorded ${formatPeso(Math.abs(result.amount))} ${result.amount > 0 ? "from" : "to"} ${found.name}.`,
          undo: { kind: "delete" as const, ids: [result.id] },
        }
      },
    }),

    addAccount: tool({
      description:
        "Add one of the owner's accounts (bank, e-wallet, credit card or cash) with what it holds now. Call once per account. The owner confirms first.",
      inputSchema: NEW_ACCOUNT,
      execute: async (input) => {
        if (await findAccount(db, input.name))
          return { done: false, message: `${input.name} is already set up.` }
        const card = input.kind === "credit_card"
        const balance = centavos(input.balance ?? 0)
        const { id } = await createAccount({
          name: input.name,
          kind: input.kind,
          last4: input.last4 ?? null,
          creditLimit: input.creditLimit ? centavos(input.creditLimit) : null,
          balance: card ? -balance : balance,
          aliases: input.aliases,
        })
        return {
          done: true,
          message: `Added ${input.name}.`,
          undo: { kind: "removeAccount" as const, id },
        }
      },
    }),

    setAccountBalance: tool({
      description:
        "Correct what an account holds now (for a credit card, what's owed), when the owner says the real figure differs. Entries stay as they are. The owner confirms first.",
      inputSchema: BALANCE,
      execute: async ({ account, balance }) => {
        const found = await findAccount(db, account)
        if (!found)
          return { done: false, message: `No account called ${account}.` }
        const value =
          found.kind === "credit_card" ? -centavos(balance) : centavos(balance)
        await setBalance(db, found.id, value)
        return {
          done: true,
          message: `${found.name} now reads ${reads({ ...found, balance: value })}.`,
          undo: {
            kind: "setBalance" as const,
            id: found.id,
            balance: found.balance,
          },
        }
      },
    }),

    moveToAccount: tool({
      description:
        "File matching entries under one of the owner's accounts, e.g. 'those grab rides were on my credit card'. The owner confirms first.",
      inputSchema: FILE,
      execute: async (input) => {
        const found = await findAccount(db, input.account)
        if (!found)
          return { done: false, message: `No account called ${input.account}.` }
        const rows = (await matches(db, input, MAX_MOVE)).filter(
          (r) => r.accountId !== found.id
        )
        if (!rows.length) return { done: false, message: "Nothing to move." }
        const { moved } = await fileToAccount(
          db,
          rows.map((r) => r.id),
          found.id
        )
        return {
          done: true,
          message: `Filed ${moved.length} ${moved.length === 1 ? "entry" : "entries"} under ${found.name}.`,
          undo: { kind: "refileAccounts" as const, changes: moved },
        }
      },
    }),
  }
  return tools
}

async function findPerson(db: Db, name: string) {
  const key = name.trim().toLowerCase()
  const everyone = await peopleWithBalances(db)
  return everyone.find(
    (p) =>
      p.name.toLowerCase() === key ||
      p.aliases.some((a) => a.toLowerCase() === key)
  )
}

/**
 * The confirmation shown to the owner, computed from the database. Nothing
 * to change means an automatic denial with the reason, so the model can
 * try a better filter instead of asking the owner to approve nothing.
 */
export function actionApprovals(db: Db) {
  return {
    ...accountApprovals(db),
    moveToCategory: async (input: z.infer<typeof MOVE>) => {
      const target = await findCategory(db, input.newCategory)
      if (!target)
        return denied(
          `There's no "${input.newCategory}" category. Check the category list.`
        )
      const rows = (await matches(db, input, MAX_MOVE)).filter(
        (r) =>
          (r.amount > 0 ? "income" : "expense") === target.kind &&
          r.categoryId !== target.id
      )
      if (!rows.length)
        return denied(
          "No entries match that filter (or they're already there)."
        )
      if (rows.length > MAX_MOVE)
        return denied(
          `That matches more than ${MAX_MOVE} entries. Narrow it down.`
        )
      return {
        type: "user-approval" as const,
        reason: `Move ${rows.length} ${rows.length === 1 ? "entry" : "entries"} to ${target.emoji} ${target.name}: ${listed(rows)}`,
      }
    },
    deleteEntries: async (input: Filter) => {
      const rows = await matches(db, input, MAX_DELETE)
      if (!rows.length) return denied("No entries match that filter.")
      if (rows.length > MAX_DELETE)
        return denied(
          `That matches more than ${MAX_DELETE} entries. Narrow it down.`
        )
      return {
        type: "user-approval" as const,
        reason: `Delete ${rows.length} ${rows.length === 1 ? "entry" : "entries"}: ${listed(rows)}`,
      }
    },
    logEntries: async ({ text }: { text: string }) => {
      const parsed = preparse(text, { today: await today(db) })
      if (parsed.kind !== "log")
        return denied(
          "That has no amount to log. Start each entry with - or + and an amount."
        )
      const lines = parsed.lines
        .map((l) =>
          `${l.signInferred ? "" : l.direction === "in" ? "+" : "−"}${formatPeso(l.share)} ${l.description || ""} (${l.localDate})`.trim()
        )
        .join("; ")
      return { type: "user-approval" as const, reason: `Log ${lines}` }
    },
    settleUp: async ({
      person,
      amount,
    }: {
      person: string
      amount?: number
    }) => {
      const found = await findPerson(db, person)
      if (!found) return denied(`There's no one called ${person}.`)
      if (found.owed === 0)
        return denied(`${found.name} and the owner are already square.`)
      const size = Math.min(
        Math.abs(found.owed),
        amount ? Math.round(amount * 100) : Number.POSITIVE_INFINITY
      )
      return {
        type: "user-approval" as const,
        reason:
          found.owed > 0
            ? `Record ${formatPeso(size)} from ${found.name} (owes ${formatPeso(found.owed)})`
            : `Record ${formatPeso(size)} paid to ${found.name} (you owe ${formatPeso(-found.owed)})`,
      }
    },
  }
}

/** Approval cards for the account tools, kept beside the others below. */
function accountApprovals(db: Db) {
  return {
    addAccount: async (input: z.infer<typeof NEW_ACCOUNT>) => {
      if (await findAccount(db, input.name))
        return denied(`${input.name} is already one of the owner's accounts.`)
      const card = input.kind === "credit_card"
      const balance = centavos(input.balance ?? 0)
      const details = [
        card
          ? `${formatPeso(balance)} owed`
          : `${formatPeso(balance)} in it now`,
        input.creditLimit && `${formatPeso(centavos(input.creditLimit))} limit`,
        input.last4 && `ending ${input.last4}`,
        input.aliases?.length &&
          `also called ${input.aliases.map((a) => `"${a}"`).join(", ")}`,
      ].filter(Boolean)
      return {
        type: "user-approval" as const,
        reason: `Add ${ACCOUNT_KIND_LABELS[input.kind].toLowerCase()} ${input.name}: ${details.join(", ")}`,
      }
    },
    setAccountBalance: async (input: z.infer<typeof BALANCE>) => {
      const found = await findAccount(db, input.account)
      if (!found)
        return denied(
          `There's no account called ${input.account}. Check the accounts tool.`
        )
      const value =
        found.kind === "credit_card"
          ? -centavos(input.balance)
          : centavos(input.balance)
      if (value === found.balance)
        return denied(`${found.name} already reads ${reads(found)}.`)
      return {
        type: "user-approval" as const,
        reason: `Set ${found.name} to ${reads({ ...found, balance: value })} (it reads ${reads(found)} now)`,
      }
    },
    moveToAccount: async (input: z.infer<typeof FILE>) => {
      const found = await findAccount(db, input.account)
      if (!found)
        return denied(
          `There's no account called ${input.account}. Check the accounts tool.`
        )
      const rows = (await matches(db, input, MAX_MOVE)).filter(
        (r) => r.accountId !== found.id
      )
      if (!rows.length)
        return denied(
          "No entries match that filter (or they're already there)."
        )
      if (rows.length > MAX_MOVE)
        return denied(
          `That matches more than ${MAX_MOVE} entries. Narrow it down.`
        )
      return {
        type: "user-approval" as const,
        reason: `File ${rows.length} ${rows.length === 1 ? "entry" : "entries"} under ${found.name}: ${listed(rows)}`,
      }
    },
  }
}

/** Undo for a recategorize: put each entry back where it was. */
export async function restoreCategories(
  changes: { id: string; categoryId: string | null }[]
) {
  const db = getDb()
  for (const change of changes) {
    await db
      .update(transactions)
      .set({ categoryId: change.categoryId })
      .where(eq(transactions.id, change.id))
  }
}
