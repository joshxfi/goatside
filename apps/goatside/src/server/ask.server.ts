/**
 * Ask mode on the server: the chat agent, its read-only ledger tools, and
 * write tools that only run after the owner approves (ask-actions.server).
 * Every tool runs a fixed query; the model never writes SQL.
 */
import {
  type UIMessage,
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  tool,
  validateUIMessages,
} from "ai"
import { and, between, eq, inArray, isNull, sql } from "drizzle-orm"
import { z } from "zod"
import { askInstructions } from "@workspace/ai/ask"
import { DEFAULT_TIME_ZONE, todayIn } from "@workspace/core/dates"
import { type Db, schema } from "@workspace/db"
import { ACCOUNT_KIND_LABELS } from "@workspace/core/accounts"
import { accountBook } from "./agent.server"
import { accountBalances } from "./accounts.server"
import {
  actionApprovals,
  actionTools,
  approvalSecret,
} from "./ask-actions.server"
import { peopleTools } from "./ask-people.server"
import {
  FILTER,
  entryRows,
  entrySummary,
  entryTotals,
  entryWhere,
  money,
} from "./ask-search.server"
import { serverEnv } from "./env"
import { getDb } from "./services"
import { loadCurrency } from "./settings.server"

const { categories, settings, transactions } = schema

/** Keep requests small: the agent only needs the recent conversation. */
const MAX_MESSAGES = 12
const MAX_ROWS = 40

const DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("YYYY-MM-DD in the owner's timezone")
const DIRECTION = z
  .enum(["out", "in", "both"])
  .default("both")
  .describe("out = spending, in = money received")

/** Spending and income rows for totals; transfers and IOUs aren't either. */
async function ledgerRows(
  db: Db,
  {
    from,
    to,
    direction,
    category,
    accountId,
  }: {
    from: string
    to: string
    direction: "out" | "in" | "both"
    category?: string
    accountId?: string
  }
) {
  return db
    .select({
      amount: transactions.amount,
      localDate: transactions.localDate,
      categoryName: categories.name,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        isNull(transactions.deletedAt),
        inArray(transactions.kind, ["expense", "income"]),
        between(transactions.localDate, from, to),
        direction === "out"
          ? sql`${transactions.amount} < 0`
          : direction === "in"
            ? sql`${transactions.amount} > 0`
            : undefined,
        category
          ? sql`lower(coalesce(${categories.name}, 'uncategorized')) = ${category.trim().toLowerCase()}`
          : undefined,
        accountId ? eq(transactions.accountId, accountId) : undefined
      )
    )
}

const ACCOUNT = z
  .string()
  .optional()
  .describe(
    "Only entries paid from or received in this account, by name, nickname or last four digits"
  )

function ledgerTools(db: Db) {
  return {
    accounts: tool({
      description:
        "The owner's banks, e-wallets, credit cards and cash, with what each holds now (for a credit card, what's owed and the credit left). Use it for 'how much is in my GCash', 'how much do I owe on my card', 'how much money do I have'.",
      inputSchema: z.object({}),
      execute: async () => {
        const [list, book] = await Promise.all([
          accountBalances(db),
          accountBook(db),
        ])
        return list
          .filter((a) => !a.archived)
          .map((a) => {
            const card = a.kind === "credit_card"
            return {
              name: a.name,
              type: ACCOUNT_KIND_LABELS[a.kind].toLowerCase(),
              ...(card
                ? {
                    owed: money(Math.max(0, -a.balance)),
                    ...(a.creditLimit && {
                      available: money(
                        Math.max(0, a.creditLimit + Math.min(0, a.balance))
                      ),
                    }),
                  }
                : { balance: money(a.balance) }),
              ...(a.id === book.defaultAccountId && {
                default: "entries that name no account are filed here",
              }),
            }
          })
      },
    }),
    summarize: tool({
      description:
        "Totals for a date range, optionally grouped by category, day or month. Use it for 'how much did I spend/earn' questions and comparisons (call once per period).",
      inputSchema: z.object({
        from: DATE,
        to: DATE,
        groupBy: z.enum(["total", "category", "day", "month"]).default("total"),
        direction: DIRECTION,
        category: z.string().optional().describe("Only this category, by name"),
        account: ACCOUNT,
      }),
      execute: async ({ from, to, groupBy, direction, category, account }) => {
        let accountId: string | undefined
        if (account) {
          const found = await entryWhere(db, { account })
          if ("problem" in found) return { problem: found.problem }
          accountId = found.accountId
        }
        const rows = await ledgerRows(db, {
          from,
          to,
          direction,
          category,
          accountId,
        })
        let out = 0
        let income = 0
        const groups = new Map<
          string,
          { out: number; in: number; count: number }
        >()
        for (const row of rows) {
          if (row.amount < 0) out -= row.amount
          else income += row.amount
          if (groupBy === "total") continue
          const key =
            groupBy === "category"
              ? (row.categoryName ?? "Uncategorized")
              : groupBy === "day"
                ? row.localDate
                : row.localDate.slice(0, 7)
          const group = groups.get(key) ?? { out: 0, in: 0, count: 0 }
          if (row.amount < 0) group.out -= row.amount
          else group.in += row.amount
          group.count += 1
          groups.set(key, group)
        }
        return {
          from,
          to,
          transactions: rows.length,
          spent: money(out),
          received: money(income),
          net: money(income - out),
          ...(groupBy !== "total" && {
            groups: [...groups]
              .toSorted(([a, ga], [b, gb]) =>
                groupBy === "category"
                  ? gb.out + gb.in - (ga.out + ga.in)
                  : a.localeCompare(b)
              )
              .slice(0, 62)
              .map(([key, g]) => ({
                [groupBy]: key,
                spent: money(g.out),
                received: money(g.in),
                count: g.count,
              })),
          }),
        }
      },
    }),
    findTransactions: tool({
      description:
        "Find entries of any kind: spending, income, transfers between accounts (card payments too), IOUs and repayments. Filter by any mix of dates, words, amount, account, category, person or kind; leave dates out to search all of them. Use it for 'what did I buy', 'biggest expense', 'when did I last pay X', 'what's on my card', and to get the ids of entries to change.",
      inputSchema: FILTER.omit({ ids: true }).extend({
        sort: z.enum(["newest", "oldest", "largest"]).default("newest"),
        limit: z.number().int().min(1).max(MAX_ROWS).default(15),
      }),
      execute: async ({ sort, limit, ...filter }) => {
        let found = await entryWhere(db, filter)
        if ("problem" in found) return { matches: 0, problem: found.problem }
        let totals = await entryTotals(db, found.where, found.accountId)
        // No entry has every word: show ones with some of them, flagged.
        let loose = false
        if (!totals.count && filter.text && filter.text.trim().includes(" ")) {
          const some = await entryWhere(db, filter, { looseText: true })
          if (!("problem" in some)) {
            found = some
            totals = await entryTotals(db, some.where, some.accountId)
            loose = totals.count > 0
          }
        }
        const rows = await entryRows(db, found.where, { sort, limit })
        return {
          matches: totals.count,
          ...(loose && {
            note: "No entry has every word; these have some of them. Check they're the right ones.",
          }),
          ...(totals.count > rows.length && {
            showing: rows.length,
          }),
          net: money(totals.net),
          transactions: rows.map(entrySummary),
        }
      },
    }),
  }
}

/** What the owner sees when the model call fails. Details stay in the logs. */
function explain(error: unknown) {
  console.error("[goatside] ask failed:", error)
  const name = error instanceof Error ? error.name : ""
  if (name === "GatewayAuthenticationError") {
    return "AI Gateway rejected the request. Check AI_GATEWAY_API_KEY."
  }
  if (name === "GatewayRateLimitError") {
    return "AI Gateway is rate limiting. Try again in a minute."
  }
  return "Couldn't get an answer. Try again."
}

/**
 * Everything the agent runs with: instructions built from the ledger, the
 * tools, and the approval gate. Shared by the route and the eval.
 */
export async function askAgent(db: Db) {
  const [timeZone, currency, active, book] = await Promise.all([
    db.query.settings
      .findFirst({ where: eq(settings.id, 1), columns: { timeZone: true } })
      .then((row) => row?.timeZone ?? DEFAULT_TIME_ZONE),
    loadCurrency(db),
    db
      .select({ name: categories.name, kind: categories.kind })
      .from(categories)
      .where(eq(categories.archived, false))
      .orderBy(categories.kind, categories.sort),
    accountBook(db),
  ])
  return {
    system: askInstructions({
      today: todayIn(timeZone),
      timeZone,
      currency,
      categories: active,
      accounts: book.known.map((a) => ({
        name: a.name,
        kind: a.kind,
        aliases: a.aliases,
        isDefault: a.id === book.defaultAccountId,
      })),
    }),
    tools: askTools(db),
    toolApproval: actionApprovals(db),
  }
}

export const askTools = (db: Db) => ({
  ...ledgerTools(db),
  ...peopleTools(db),
  ...actionTools(db),
})

/**
 * The latest messages, starting at one of the owner's: a cut that starts
 * mid-answer leaves the model a tool call with no question before it.
 */
function recent(messages: unknown[]) {
  const tail = messages.slice(-MAX_MESSAGES)
  const start = tail.findIndex(
    (m) => (m as { role?: unknown } | null)?.role === "user"
  )
  return start === -1 ? tail : tail.slice(start)
}

/** Streams an answer to the conversation in `body`. */
export async function answerAsk(body: unknown) {
  const db = getDb()
  const messages = (body as { messages?: unknown })?.messages
  const agent = await askAgent(db)
  const validated = await validateUIMessages<UIMessage>({
    messages: Array.isArray(messages) ? recent(messages) : [],
    tools: agent.tools,
  })

  const result = streamText({
    model: serverEnv().CHAT_MODEL,
    ...agent,
    messages: await convertToModelMessages(validated),
    experimental_toolApprovalSecret: approvalSecret(),
    stopWhen: isStepCount(8),
    reasoning: "none",
    maxOutputTokens: 800,
  })

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream, onError: explain }),
  })
}
