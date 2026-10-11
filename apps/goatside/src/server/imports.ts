import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { isValidDate } from "@workspace/core/dates"
import { MAX_CENTS } from "@workspace/core/money"
import {
  ImportError,
  commitImport,
  importHistory,
  previewImport,
  undoImport,
} from "./imports.server"
import { getDb } from "./services"
import { authMiddleware } from "./session"

export type {
  CommitResult,
  ImportDecision,
  Preview,
  PreviewRow,
} from "./imports.server"

const DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => {
    const [y, m, day] = d.split("-").map(Number)
    return isValidDate(y!, m!, day!)
  }, "Not a real date")
const AMOUNT = z.number().int().min(-MAX_CENTS).max(MAX_CENTS)
/** Balances can sit past a single entry's limit, so allow ten times. */
const BALANCE = z
  .number()
  .int()
  .min(-MAX_CENTS * 10)
  .max(MAX_CENTS * 10)
const MAX_ROWS = 2000

const statement = {
  accountId: z.uuid(),
  fileHash: z.string().regex(/^[0-9a-f]{64}$/),
  rows: z
    .array(
      z.object({
        localDate: DATE,
        postedDate: DATE.optional(),
        details: z.string().trim().max(300),
        amount: AMOUNT,
        balance: BALANCE.optional(),
        page: z.number().int().min(1).max(10_000),
        y: z.number().finite(),
      })
    )
    .min(1)
    .max(MAX_ROWS),
  summary: z.object({
    opening: BALANCE.optional(),
    closing: BALANCE.optional(),
    totalIn: BALANCE.nonnegative().optional(),
    totalOut: BALANCE.nonnegative().optional(),
  }),
  period: z.object({ start: DATE, end: DATE }).nullable(),
}

async function attempt<T>(run: () => Promise<T>) {
  try {
    return { ok: true as const, value: await run() }
  } catch (error) {
    if (error instanceof ImportError)
      return { ok: false as const, message: error.message }
    throw error
  }
}

/** What importing would do. Writes nothing. */
export const previewStatement = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object(statement))
  .handler(({ data }) => attempt(() => previewImport(getDb(), data)))

export const importStatement = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      ...statement,
      /** Chosen by the browser, so a resend doesn't import twice. */
      importId: z.uuid(),
      decisions: z
        .array(
          z.discriminatedUnion("action", [
            z.object({ action: z.literal("skip") }),
            z.object({ action: z.literal("new") }),
            z.object({ action: z.literal("link") }),
            z.object({ action: z.literal("transfer"), accountId: z.uuid() }),
          ])
        )
        .max(MAX_ROWS),
    })
  )
  .handler(({ data }) => attempt(() => commitImport(getDb(), data)))

export const undoStatementImport = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid() }))
  .handler(({ data }) => undoImport(getDb(), data.id))

export const getImports = createServerFn()
  .middleware([authMiddleware])
  .validator(z.object({ accountId: z.uuid() }))
  .handler(({ data }) => importHistory(getDb(), data.accountId))
