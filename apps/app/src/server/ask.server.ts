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
import { and, between, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { z } from "zod"
import { askInstructions } from "@workspace/ai/ask"
import { DEFAULT_TIME_ZONE, todayIn } from "@workspace/core/dates"
import { formatPeso } from "@workspace/core/money"
import { type Db, schema } from "@workspace/db"
import { peopleWithBalances } from "./agent.server"
import {
  actionApprovals,
  actionTools,
  approvalSecret,
} from "./ask-actions.server"
import { serverEnv } from "./env"
import { getDb } from "./services"

const { categories, settings, transactions } = schema

/** Keep requests small: the agent only needs the recent conversation. */
const MAX_MESSAGES = 12
const MAX_ROWS = 25

const DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("YYYY-MM-DD in the owner's timezone")
const DIRECTION = z
  .enum(["out", "in", "both"])
  .default("both")
  .describe("out = spending, in = money received")

const pesos = (centavos: number) => Math.round(centavos) / 100
const money = (centavos: number) => ({
  pesos: pesos(centavos),
  text: formatPeso(centavos),
})

async function ledgerRows(
  db: Db,
  {
    from,
    to,
    direction,
    category,
    text,
  }: {
    from: string
    to: string
    direction: "out" | "in" | "both"
    category?: string
    text?: string
  }
) {
  return db
    .select({
      amount: transactions.amount,
      localDate: transactions.localDate,
      description: transactions.description,
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
        text
          ? sql`lower(${transactions.description}) like ${`%${text.trim().toLowerCase()}%`}`
          : undefined
      )
    )
    .orderBy(desc(transactions.localDate), desc(transactions.createdAt))
}

function ledgerTools(db: Db) {
  return {
    balances: tool({
      description:
        "Who owes the owner money and whom the owner owes (IOUs, loans, shared bills), with each person's recent IOU entries. Use it for 'who owes me', 'how much does X owe me', 'do I owe anyone'.",
      inputSchema: z.object({
        person: z.string().optional().describe("Only this person, by name"),
      }),
      execute: async ({ person }) => {
        const all = await peopleWithBalances(db)
        const wanted = person
          ? all.filter(
              (p) => p.name.toLowerCase() === person.trim().toLowerCase()
            )
          : all.filter((p) => p.owed !== 0)
        return Promise.all(
          wanted.map(async (p) => {
            const recent = await db
              .select({
                date: transactions.localDate,
                description: transactions.description,
                kind: transactions.kind,
                amount: transactions.amount,
              })
              .from(transactions)
              .where(
                and(
                  isNull(transactions.deletedAt),
                  eq(transactions.personId, p.id),
                  inArray(transactions.kind, ["lend", "settle"])
                )
              )
              .orderBy(desc(transactions.localDate))
              .limit(5)
            return {
              name: p.name,
              status:
                p.owed > 0
                  ? `owes the owner ${formatPeso(p.owed)}`
                  : p.owed < 0
                    ? `the owner owes them ${formatPeso(-p.owed)}`
                    : "square",
              recent: recent.map((r) => ({
                date: r.date,
                description: r.description,
                type: r.kind === "lend" ? "loan or shared bill" : "repayment",
                cashFlow: money(r.amount),
              })),
            }
          })
        )
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
      }),
      execute: async ({ from, to, groupBy, direction, category }) => {
        const rows = await ledgerRows(db, { from, to, direction, category })
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
        "Individual transactions in a date range, filtered by text, category or direction. Use it for 'what did I buy', 'biggest expense', or 'when did I last pay X'.",
      inputSchema: z.object({
        from: DATE,
        to: DATE,
        direction: DIRECTION,
        category: z.string().optional().describe("Category name"),
        text: z
          .string()
          .optional()
          .describe("Words to find in the description, e.g. a shop or person"),
        sort: z.enum(["newest", "largest"]).default("newest"),
        limit: z.number().int().min(1).max(MAX_ROWS).default(10),
      }),
      execute: async ({ from, to, direction, category, text, sort, limit }) => {
        const rows = await ledgerRows(db, {
          from,
          to,
          direction,
          category,
          text,
        })
        const sorted =
          sort === "largest"
            ? rows.toSorted((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
            : rows
        return {
          matches: rows.length,
          total: money(rows.reduce((sum, r) => sum + r.amount, 0)),
          transactions: sorted.slice(0, limit).map((r) => ({
            date: r.localDate,
            description: r.description,
            amount: money(r.amount),
            category: r.categoryName ?? "Uncategorized",
          })),
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
  return "Couldn’t get an answer. Try again."
}

/** Streams an answer to the conversation in `body`. */
export async function answerAsk(body: unknown) {
  const db = getDb()
  const messages = (body as { messages?: unknown })?.messages
  const tools = { ...ledgerTools(db), ...actionTools(db) }
  const validated = await validateUIMessages<UIMessage>({
    messages: Array.isArray(messages) ? messages.slice(-MAX_MESSAGES) : [],
    tools,
  })

  const [timeZone, active] = await Promise.all([
    db.query.settings
      .findFirst({ where: eq(settings.id, 1), columns: { timeZone: true } })
      .then((row) => row?.timeZone ?? DEFAULT_TIME_ZONE),
    db
      .select({ name: categories.name, kind: categories.kind })
      .from(categories)
      .where(eq(categories.archived, false))
      .orderBy(categories.kind, categories.sort),
  ])

  const result = streamText({
    model: serverEnv().CHAT_MODEL,
    system: askInstructions({
      today: todayIn(timeZone),
      timeZone,
      categories: active,
    }),
    messages: await convertToModelMessages(validated),
    tools,
    toolApproval: actionApprovals(db),
    experimental_toolApprovalSecret: approvalSecret(),
    stopWhen: isStepCount(6),
    reasoning: "none",
    maxOutputTokens: 800,
  })

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream, onError: explain }),
  })
}
