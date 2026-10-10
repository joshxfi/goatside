import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import {
  editTransaction,
  logText,
  monthView,
  setDeleted,
  settleWith,
  trendView,
} from "./ledger.server"
import { restoreCategories } from "./ask-actions.server"
import { AnswerError, answer } from "./questions.server"
import { getDb } from "./services"
import { authMiddleware } from "./session"

export type { LedgerTxn, MonthView, TrendView } from "./ledger.server"
export type { OpenQuestion } from "./questions.server"

const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const IDS = z.object({ ids: z.array(z.uuid()).min(1).max(50) })

export const getMonth = createServerFn()
  .middleware([authMiddleware])
  .validator(z.object({ month: MONTH.optional() }))
  .handler(({ data }) => monthView(data.month))

/** Six months of totals and top categories, ending at `month`. */
export const getTrend = createServerFn()
  .middleware([authMiddleware])
  .validator(z.object({ month: MONTH }))
  .handler(({ data }) => trendView(data.month, 6))

export const logEntry = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ text: z.string().max(500) }))
  .handler(({ data }) => logText(data.text))

export const deleteTransactions = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(IDS)
  .handler(({ data }) => setDeleted(data.ids, true))

export const restoreTransactions = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(IDS)
  .handler(({ data }) => setDeleted(data.ids, false))

export const updateTransaction = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      id: z.uuid(),
      categoryId: z.uuid().nullable().optional(),
      description: z.string().max(200).optional(),
      localDate: DATE.optional(),
    })
  )
  .handler(({ data }) => editTransaction(data))

/** The owner's answer to one of the agent's questions. */
export const answerQuestion = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid(), answer: z.string().min(1).max(64) }))
  .handler(async ({ data }) => {
    try {
      await answer(getDb(), data.id, data.answer)
      return { ok: true as const }
    } catch (error) {
      if (error instanceof AnswerError)
        return { ok: false as const, message: error.message }
      throw error
    }
  })

/** Marks a person as square with the owner (logs the settlement). */
export const settleUp = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      personId: z.uuid(),
      /** Centavos; omit to settle the whole balance. */
      amount: z.number().int().positive().optional(),
    })
  )
  .handler(({ data }) => settleWith(data.personId, data.amount))

/** Undo for the agent's moveToCategory: puts entries back where they were. */
export const undoRecategorize = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      changes: z
        .array(z.object({ id: z.uuid(), categoryId: z.uuid().nullable() }))
        .min(1)
        .max(200),
    })
  )
  .handler(({ data }) => restoreCategories(data.changes))
