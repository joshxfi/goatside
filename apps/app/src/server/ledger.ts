import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { MAX_CENTAVOS } from "@workspace/core/money"
import {
  ENTRY_TYPES,
  EditError,
  editTransaction,
  editorChoices,
  transactionFor,
  logText,
  monthView,
  setDeleted,
  PERIODS,
  settleWith,
  splitOf,
  transactionsView,
  trendView,
} from "./ledger.server"
import { restoreCategories } from "./ask-actions.server"
import { AnswerError, answer } from "./questions.server"
import { getDb } from "./services"
import { authMiddleware } from "./session"

export type {
  LedgerTxn,
  MonthView,
  Period,
  SplitView,
  TransactionsView,
  TrendView,
} from "./ledger.server"
export type { OpenQuestion } from "./questions.server"

const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const IDS = z.object({ ids: z.array(z.uuid()).min(1).max(500) })

export const getMonth = createServerFn()
  .middleware([authMiddleware])
  .validator(z.object({ month: MONTH.optional() }))
  .handler(({ data }) => monthView(data.month))

/** Every transaction in a period, for the Transactions page. */
export const getTransactions = createServerFn()
  .middleware([authMiddleware])
  .validator(z.object({ period: z.enum(PERIODS), month: MONTH.optional() }))
  .handler(({ data }) => transactionsView(data.period, data.month))

/** Six months of totals and top categories, ending at `month`. */
export const getTrend = createServerFn()
  .middleware([authMiddleware])
  .validator(z.object({ month: MONTH }))
  .handler(({ data }) => trendView(data.month, 6))

export const logEntry = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      text: z.string().max(500),
      /** A quick pick: logged on purpose, so skip the duplicate check. */
      repeat: z.boolean().optional(),
      /** The phone's id for this entry; resending it doesn't log it twice. */
      id: z.uuid().optional(),
      /** When it was typed (epoch ms), for entries that waited offline. */
      at: z.number().int().positive().optional(),
    })
  )
  .handler(({ data }) => logText(data.text, data))

export const deleteTransactions = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(IDS)
  .handler(({ data }) => setDeleted(data.ids, true))

export const restoreTransactions = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(IDS)
  .handler(({ data }) => setDeleted(data.ids, false))

/** The owner's own edit of one entry. No model involved. */
export const updateTransaction = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      id: z.uuid(),
      categoryId: z.uuid().nullable().optional(),
      description: z.string().max(200).optional(),
      localDate: DATE.optional(),
      accountId: z.uuid().nullable().optional(),
      toAccountId: z.uuid().optional(),
      /** Centavos, unsigned. For a split, the whole bill. */
      amount: z.number().int().positive().max(MAX_CENTAVOS).optional(),
      type: z.enum(ENTRY_TYPES).optional(),
      /** Who shares the bill, or who the IOU is with. */
      people: z.array(z.uuid()).max(29).optional(),
      /** Ways the bill splits, you included. */
      ways: z.number().int().min(1).max(30).optional(),
      recurring: z.boolean().optional(),
      personId: z.uuid().optional(),
    })
  )
  .handler(async ({ data }) => {
    try {
      await editTransaction(data)
      return { ok: true as const }
    } catch (error) {
      if (error instanceof EditError)
        return { ok: false as const, message: error.message }
      throw error
    }
  })

/** One entry and the drawer's choices, for pages that list entries. */
export const getTransaction = createServerFn()
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    const [txn, choices] = await Promise.all([
      transactionFor(data.id),
      editorChoices(),
    ])
    return txn ? { txn, ...choices } : null
  })

/** Categories, open accounts, people and today, for forms off the month. */
export const getEditorChoices = createServerFn()
  .middleware([authMiddleware])
  .handler(() => editorChoices())

/** A split bill's total and the others' shares, for the edit drawer. */
export const getSplit = createServerFn()
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid() }))
  .handler(({ data }) => splitOf(data.id))

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
        .max(500),
    })
  )
  .handler(({ data }) => restoreCategories(data.changes))
