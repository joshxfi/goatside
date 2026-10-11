import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { schema } from "@workspace/db"
import {
  AccountError,
  accountDetail,
  accountsOverview,
  createAccount,
  fileToAccount,
  removeAccount,
  restoreAccounts,
  setBalance,
  setDefaultAccount,
  updateAccount,
} from "./accounts.server"
import { getDb } from "./services"
import { authMiddleware } from "./session"

export type {
  AccountBalance,
  AccountDetail,
  AccountsOverview,
} from "./accounts.server"

const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)
/** Cents, within what a personal ledger plausibly holds. */
const MONEY = z.number().int().min(-1e13).max(1e13)
const fields = {
  name: z.string().trim().min(1).max(40),
  kind: z.enum(schema.ACCOUNT_KINDS),
  color: z.enum(schema.ACCOUNT_COLORS),
  last4: z
    .string()
    .regex(/^\d{4}$/)
    .nullable(),
  creditLimit: MONEY.positive().nullable(),
  aliases: z.array(z.string().trim().max(30)).max(12),
}

async function attempt<T>(run: () => Promise<T>) {
  try {
    return { ok: true as const, value: await run() }
  } catch (error) {
    if (error instanceof AccountError)
      return { ok: false as const, message: error.message }
    throw error
  }
}

export const getAccounts = createServerFn()
  .middleware([authMiddleware])
  .validator(z.object({ month: MONTH }))
  .handler(({ data }) => accountsOverview(data.month))

export const getAccount = createServerFn()
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid() }))
  .handler(({ data }) => accountDetail(data.id))

export const addAccount = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      name: fields.name,
      kind: fields.kind,
      color: fields.color.optional(),
      last4: fields.last4.optional(),
      creditLimit: fields.creditLimit.optional(),
      balance: MONEY.optional(),
      aliases: fields.aliases.optional(),
    })
  )
  .handler(({ data }) => attempt(() => createAccount(data)))

export const editAccount = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      id: z.uuid(),
      name: fields.name.optional(),
      kind: fields.kind.optional(),
      color: fields.color.optional(),
      last4: fields.last4.optional(),
      creditLimit: fields.creditLimit.optional(),
      aliases: fields.aliases.optional(),
      archived: z.boolean().optional(),
    })
  )
  .handler(({ data }) => attempt(() => updateAccount(data)))

/** Sets what the account holds now (for a card, negative is owed). */
export const setAccountBalance = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid(), balance: MONEY }))
  .handler(({ data }) =>
    attempt(() => setBalance(getDb(), data.id, data.balance))
  )

export const chooseDefaultAccount = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid().nullable() }))
  .handler(({ data }) => attempt(() => setDefaultAccount(data.id)))

export const deleteAccount = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid() }))
  .handler(({ data }) => attempt(() => removeAccount(data.id)))

/** Bulk "file under account" from the table, with the previous values for undo. */
export const moveToAccount = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      ids: z.array(z.uuid()).min(1).max(500),
      accountId: z.uuid().nullable(),
    })
  )
  .handler(({ data }) =>
    attempt(() => fileToAccount(getDb(), data.ids, data.accountId))
  )

export const undoMoveToAccount = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      changes: z
        .array(z.object({ id: z.uuid(), accountId: z.uuid().nullable() }))
        .min(1)
        .max(500),
    })
  )
  .handler(({ data }) => restoreAccounts(data.changes))
