import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import {
  editTransaction,
  logText,
  monthView,
  setDeleted,
} from "./ledger.server"
import { authMiddleware } from "./session"

export type { LedgerTxn, MonthView } from "./ledger.server"

const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const IDS = z.object({ ids: z.array(z.uuid()).min(1).max(50) })

export const getMonth = createServerFn()
  .middleware([authMiddleware])
  .validator(z.object({ month: MONTH.optional() }))
  .handler(({ data }) => monthView(data.month))

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
