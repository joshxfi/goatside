/**
 * The agent's questions to the owner: listing them with labels, and
 * applying answers (which can re-file, re-sign, split or remove a line).
 * Server-only.
 */
import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm"
import {
  type QuestionDraft,
  type Ranked,
  categoryQuestion,
  kindOf,
} from "@workspace/ai/categorize"
import {
  RELATIONS,
  RELATION_DIRECTION,
  type Relation,
  planRows,
} from "@workspace/ai/people"
import type { Direction } from "@workspace/core/preparse"
import { type Db, schema } from "@workspace/db"
import {
  type LineContext,
  directionOf,
  ensurePeople,
  questionRow,
  rowValues,
} from "./agent.server"

const { categories, corrections, questions, transactions } = schema

export interface AnswerOption {
  value: string
  label: string
  emoji: string | null
  p: number | null
}

const list = (names: string[]) =>
  names.length <= 1
    ? (names[0] ?? "them")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`

export function relationLabel(
  relation: Relation,
  names: string[],
  direction: Direction
): string {
  const who = list(names)
  switch (relation) {
    case "own":
      return direction === "in" ? "Just my income" : "Just my spending"
    case "lent":
      return `Lent to ${who}`
    case "borrowed":
      return `Borrowed from ${who}`
    case "repaid_me":
      return `${who} paid me back`
    case "i_repaid":
      return `Paid ${who} back`
    case "shared":
      return `Split with ${who}`
  }
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
      context: questions.context,
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

  return rows.map((row) => {
    const context = row.context as Partial<LineContext> | null
    const names = (context?.people ?? []).flatMap(
      (i) => context?.candidates?.[i]?.name ?? []
    )
    const direction = directionOf(row.amount)
    const options = row.options.flatMap((option): AnswerOption[] => {
      const plain = (label: string) => [
        { value: option.value, label, emoji: null, p: option.p },
      ]
      switch (row.kind) {
        case "direction":
          return plain(option.value === "in" ? "Money in" : "Money out")
        case "duplicate":
          return plain(
            option.value === "remove" ? "Remove this one" : "Keep both"
          )
        case "relation":
          return RELATIONS.includes(option.value as Relation)
            ? plain(relationLabel(option.value as Relation, names, direction))
            : []
        case "category": {
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
        }
      }
    })
    return {
      id: row.id,
      kind: row.kind,
      guess: row.guess,
      transaction: {
        id: row.txnId,
        description: row.description,
        amount: row.amount,
        localDate: row.localDate,
      },
      people: names,
      earlier: context?.earlier
        ? {
            description: context.earlier.description,
            localDate: context.earlier.localDate,
          }
        : null,
      options,
    }
  })
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
  if (kinds.length) {
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
  }
  await settleStatus(db, transactionId)
}

export class AnswerError extends Error {}

type Txn = typeof transactions.$inferSelect

const emptyContext = (txn: Txn): LineContext => ({
  line: {
    amount: Math.abs(txn.amount),
    share: Math.abs(txn.amount),
    split: txn.split,
  },
  candidates: [],
  people: [],
  rankings: { in: [], out: [] },
  transactionIds: [txn.id],
})

/**
 * Re-files a line as `relation`: rewrites the primary row in place (it
 * holds the questions and corrections) and replaces its IOU rows.
 */
async function refile(
  db: Db,
  txn: Txn,
  context: LineContext,
  relation: Relation
) {
  const direction = RELATION_DIRECTION[relation] ?? directionOf(txn.amount)
  const rows = planRows(context.line, direction, relation, context.people)
  const personIds = await ensurePeople(
    db,
    context.candidates,
    rows.flatMap((r) => (r.person === null ? [] : [r.person]))
  )
  const ranking = context.rankings[direction]
  const keepCategory =
    txn.categoryId && direction === directionOf(txn.amount)
      ? txn.categoryId
      : null
  const [first, ...rest] = rows
  if (!first) return { ranking, ids: [txn.id] }

  const primary = rowValues(
    first,
    {
      entryId: txn.entryId,
      localDate: txn.localDate,
      description: txn.description,
    },
    personIds,
    {
      categoryId: keepCategory ?? ranking[0]?.id ?? null,
      confidence: keepCategory ? txn.aiConfidence : (ranking[0]?.p ?? null),
      recurring: txn.recurring,
      status: "confirmed",
    }
  )
  await db.update(transactions).set(primary).where(eq(transactions.id, txn.id))

  const stale = context.transactionIds.filter((id) => id !== txn.id)
  if (stale.length) {
    await db.delete(transactions).where(inArray(transactions.id, stale))
  }
  const added = rest.length
    ? await db
        .insert(transactions)
        .values(
          rest.map((row) =>
            rowValues(
              row,
              {
                entryId: txn.entryId,
                localDate: txn.localDate,
                description: txn.description,
              },
              personIds,
              {
                categoryId: null,
                confidence: null,
                recurring: false,
                status: "confirmed",
              }
            )
          )
        )
        .returning({ id: transactions.id })
    : []
  return {
    ranking: keepCategory ? [] : ranking,
    ids: [txn.id, ...added.map((a) => a.id)],
  }
}

/** Applies the owner's answer, and asks a follow-up if one is needed. */
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
  const context: LineContext = {
    ...emptyContext(txn),
    ...(question.context as Partial<LineContext> | null),
  }

  let followUp: QuestionDraft | null = null
  let ids = context.transactionIds

  switch (question.kind) {
    case "direction": {
      if (value !== "in" && value !== "out")
        throw new AnswerError("Answer in or out.")
      const ranking: Ranked[] = context.rankings[value]
      if (value !== directionOf(txn.amount)) {
        const [top] = ranking
        await db
          .update(transactions)
          .set({
            amount:
              value === "in" ? Math.abs(txn.amount) : -Math.abs(txn.amount),
            kind: kindOf(value),
            categoryId: top?.id ?? null,
            aiConfidence: top?.p ?? null,
          })
          .where(eq(transactions.id, txn.id))
      }
      followUp = categoryQuestion(ranking)
      break
    }
    case "category": {
      const category = await db.query.categories.findFirst({
        where: eq(categories.id, value),
        columns: { id: true, kind: true },
      })
      if (!category || category.kind !== kindOf(directionOf(txn.amount))) {
        throw new AnswerError("That category doesn't fit this entry.")
      }
      await db
        .update(transactions)
        .set({ categoryId: value })
        .where(eq(transactions.id, txn.id))
      break
    }
    case "relation": {
      if (!RELATIONS.includes(value as Relation)) {
        throw new AnswerError("That isn't one of the options.")
      }
      const relation = value as Relation
      if (relation !== question.guess) {
        const result = await refile(db, txn, context, relation)
        ids = result.ids
        if (relation === "own" || relation === "shared") {
          followUp = categoryQuestion(result.ranking)
        }
      } else {
        followUp = categoryQuestion(context.rankings[directionOf(txn.amount)])
      }
      break
    }
    case "duplicate": {
      if (value !== "keep" && value !== "remove") {
        throw new AnswerError("Keep it or remove it.")
      }
      if (value === "remove") {
        await db
          .update(transactions)
          .set({ deletedAt: new Date() })
          .where(inArray(transactions.id, context.transactionIds))
      }
      break
    }
  }

  await db
    .update(questions)
    .set({ answer: value, resolvedAt: new Date() })
    .where(eq(questions.id, question.id))
  if (value !== question.guess) {
    await db.insert(corrections).values({
      transactionId: txn.id,
      field: question.kind === "category" ? "categoryId" : question.kind,
      fromValue: question.guess,
      toValue: value,
    })
  }
  // A follow-up only makes sense if this entry's category is still a guess.
  if (followUp) {
    const stillOpen = await db.query.questions.findFirst({
      where: and(
        eq(questions.transactionId, txn.id),
        eq(questions.kind, "category"),
        isNull(questions.resolvedAt),
        ne(questions.id, question.id)
      ),
      columns: { id: true },
    })
    if (!stillOpen) {
      await db
        .insert(questions)
        .values(
          questionRow(txn.id, followUp, { ...context, transactionIds: ids })
        )
    }
  }
  await settleStatus(db, txn.id)
}
