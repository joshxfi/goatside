/**
 * The logging agent: files each line with the decision model and asks the
 * owner about whatever it isn't sure of. Server-only.
 */
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm"
import {
  type CategoryOption,
  type LineInput,
  type Memory,
  type QuestionDraft,
  type Ranked,
  type Resolved,
  askModel,
  categoryQuestion,
  kindOf,
  needsModel,
  resolveLine,
} from "@workspace/ai/categorize"
import type { Direction } from "@workspace/core/preparse"
import { type Db, schema } from "@workspace/db"
import { serverEnv } from "./env"
import { aiEnabled } from "./services"

const { categories, corrections, questions, transactions } = schema

const MODEL_TIMEOUT_MS = 6000
const EXAMPLE_POOL = 400
const EXAMPLES_PER_CATEGORY = 6

export const normalize = (description: string) =>
  description.trim().toLowerCase().replace(/\s+/g, " ")

const directionOf = (amount: number): Direction => (amount > 0 ? "in" : "out")

/** Active categories, each with recent descriptions filed under it. */
async function categoryOptions(db: Db): Promise<CategoryOption[]> {
  const [active, recent] = await Promise.all([
    db
      .select({
        id: categories.id,
        name: categories.name,
        kind: categories.kind,
      })
      .from(categories)
      .where(eq(categories.archived, false))
      .orderBy(categories.kind, categories.sort),
    db
      .select({
        categoryId: transactions.categoryId,
        description: transactions.description,
      })
      .from(transactions)
      .where(
        and(
          isNull(transactions.deletedAt),
          ne(transactions.description, ""),
          inArray(transactions.status, ["confirmed", "parsed"])
        )
      )
      // Owner-confirmed rows first: they're the ground truth.
      .orderBy(
        sql`${transactions.status} = 'confirmed' desc`,
        desc(transactions.createdAt)
      )
      .limit(EXAMPLE_POOL),
  ])

  const examples = new Map<string, Set<string>>()
  for (const row of recent) {
    if (!row.categoryId) continue
    const set = examples.get(row.categoryId) ?? new Set()
    if (set.size < EXAMPLES_PER_CATEGORY) set.add(normalize(row.description))
    examples.set(row.categoryId, set)
  }
  return active.map((c) => ({
    ...c,
    examples: [...(examples.get(c.id) ?? [])],
  }))
}

/** The newest owner-confirmed transaction with the same description. */
async function memoryFor(db: Db, description: string): Promise<Memory | null> {
  if (!description) return null
  const [row] = await db
    .select({
      amount: transactions.amount,
      categoryId: transactions.categoryId,
      recurring: transactions.recurring,
    })
    .from(transactions)
    .where(
      and(
        isNull(transactions.deletedAt),
        eq(transactions.status, "confirmed"),
        inArray(transactions.kind, ["expense", "income"]),
        sql`lower(trim(${transactions.description})) = ${normalize(description)}`
      )
    )
    .orderBy(desc(transactions.updatedAt))
    .limit(1)
  return row
    ? {
        direction: directionOf(row.amount),
        categoryId: row.categoryId,
        recurring: row.recurring,
      }
    : null
}

/**
 * Decides direction, category and recurrence for each line. Never throws on
 * model trouble: a failed call just means a less certain result.
 */
export async function categorize(
  db: Db,
  lines: LineInput[]
): Promise<Resolved[]> {
  if (!lines.length) return []
  const options = await categoryOptions(db)
  const useModel = aiEnabled()

  return Promise.all(
    lines.map(async (line) => {
      const memory = await memoryFor(db, line.description)
      let signals = null
      if (useModel && needsModel(line, memory)) {
        signals = await askModel(serverEnv().DECISION_MODEL, line, options, {
          abortSignal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
        }).catch((error: unknown) => {
          console.error("[goatside] categorization failed:", error)
          return null
        })
      }
      return resolveLine(line, signals, memory)
    })
  )
}

function toRow(transactionId: string, draft: QuestionDraft) {
  return {
    transactionId,
    kind: draft.kind,
    guess: draft.guess,
    options: draft.options,
    context: draft.kind === "direction" ? { rankings: draft.rankings } : null,
  }
}

export async function saveQuestions(
  db: Db,
  drafts: { transactionId: string; draft: QuestionDraft }[]
) {
  if (!drafts.length) return
  await db
    .insert(questions)
    .values(
      drafts.map(({ transactionId, draft }) => toRow(transactionId, draft))
    )
}

export interface AnswerOption {
  value: string
  label: string
  emoji: string | null
  p: number | null
}

/** Open questions, newest first, with labels for each option. */
export async function openQuestions(
  db: Db,
  labels: Map<string, { name: string; emoji: string }>
) {
  const rows = await db
    .select({
      id: questions.id,
      kind: questions.kind,
      guess: questions.guess,
      options: questions.options,
      createdAt: questions.createdAt,
      txnId: transactions.id,
      description: transactions.description,
      amount: transactions.amount,
      localDate: transactions.localDate,
    })
    .from(questions)
    .innerJoin(transactions, eq(transactions.id, questions.transactionId))
    .where(and(isNull(questions.resolvedAt), isNull(transactions.deletedAt)))
    .orderBy(desc(questions.createdAt))
    .limit(20)

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    guess: row.guess,
    transaction: {
      id: row.txnId,
      description: row.description,
      amount: row.amount,
      localDate: row.localDate,
    },
    options: row.options.flatMap((option): AnswerOption[] => {
      if (row.kind === "direction") {
        return [
          {
            value: option.value,
            label: option.value === "in" ? "Money in" : "Money out",
            emoji: null,
            p: option.p,
          },
        ]
      }
      // Skip categories that were deleted or archived since.
      const label = labels.get(option.value)
      return label
        ? [
            {
              value: option.value,
              label: label.name,
              emoji: label.emoji,
              p: option.p,
            },
          ]
        : []
    }),
  }))
}

export type OpenQuestion = Awaited<ReturnType<typeof openQuestions>>[number]

/** Confirmed once nothing about it is still open. */
async function settleStatus(db: Db, transactionId: string) {
  const [open] = await db
    .select({ id: questions.id })
    .from(questions)
    .where(
      and(
        eq(questions.transactionId, transactionId),
        isNull(questions.resolvedAt)
      )
    )
    .limit(1)
  await db
    .update(transactions)
    .set({ status: open ? "needs_review" : "confirmed" })
    .where(eq(transactions.id, transactionId))
}

/** Closes open questions of these kinds, e.g. after a manual edit. */
export async function resolveQuestionsFor(
  db: Db,
  transactionId: string,
  kinds: QuestionDraft["kind"][]
) {
  await db
    .update(questions)
    .set({ resolvedAt: new Date() })
    .where(
      and(
        eq(questions.transactionId, transactionId),
        inArray(questions.kind, kinds),
        isNull(questions.resolvedAt)
      )
    )
  await settleStatus(db, transactionId)
}

export class AnswerError extends Error {}

/**
 * Applies the owner's answer. A direction answer flips the sign if needed,
 * re-files the category for the new side, and may ask a category follow-up.
 */
export async function answer(db: Db, questionId: string, value: string) {
  const question = await db.query.questions.findFirst({
    where: and(eq(questions.id, questionId), isNull(questions.resolvedAt)),
  })
  if (!question) throw new AnswerError("That question was already answered.")
  const txn = await db.query.transactions.findFirst({
    where: and(
      eq(transactions.id, question.transactionId),
      isNull(transactions.deletedAt)
    ),
  })
  if (!txn) throw new AnswerError("That entry was deleted.")

  const changes: Partial<typeof transactions.$inferInsert> = {}
  let followUp: QuestionDraft | null = null

  if (question.kind === "direction") {
    if (value !== "in" && value !== "out")
      throw new AnswerError("Answer in or out.")
    const rankings = (
      question.context as { rankings?: Record<Direction, Ranked[]> } | null
    )?.rankings ?? { in: [], out: [] }
    const ranking = rankings[value]
    if (value !== directionOf(txn.amount)) {
      const [top] = ranking
      changes.amount =
        value === "in" ? Math.abs(txn.amount) : -Math.abs(txn.amount)
      changes.kind = kindOf(value)
      changes.categoryId = top?.id ?? null
      changes.aiConfidence = top?.p ?? null
    }
    followUp = categoryQuestion(ranking)
  } else {
    const category = await db.query.categories.findFirst({
      where: eq(categories.id, value),
      columns: { id: true, kind: true },
    })
    if (!category || category.kind !== kindOf(directionOf(txn.amount))) {
      throw new AnswerError("That category doesn't fit this entry.")
    }
    changes.categoryId = value
  }

  if (Object.keys(changes).length) {
    await db
      .update(transactions)
      .set(changes)
      .where(eq(transactions.id, txn.id))
  }
  await db
    .update(questions)
    .set({ answer: value, resolvedAt: new Date() })
    .where(eq(questions.id, question.id))
  if (value !== question.guess) {
    await db.insert(corrections).values({
      transactionId: txn.id,
      field: question.kind === "direction" ? "direction" : "categoryId",
      fromValue: question.guess,
      toValue: value,
    })
  }
  if (followUp)
    await saveQuestions(db, [{ transactionId: txn.id, draft: followUp }])
  await settleStatus(db, txn.id)
}
