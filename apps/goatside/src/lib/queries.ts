import { queryOptions } from "@tanstack/react-query"

/*
 * Ledger queries (month, trend, transactions) share the "ledger" prefix, so
 * any change to entries refreshes them all with one invalidation.
 */
import {
  type Period,
  getMonth,
  getTransactions,
  getTrend,
} from "@/server/ledger"
import { getAccount, getAccounts } from "@/server/accounts"
import { getImports } from "@/server/imports"
import { getPeople, getPerson } from "@/server/people"
import { getCategories } from "@/server/settings"

/** `month` is "YYYY-MM"; omitted means the current month in the owner's timezone. */
export const monthQuery = (month?: string) =>
  queryOptions({
    queryKey: ["ledger", "month", month ?? "current"],
    queryFn: () => getMonth({ data: { month } }),
  })

/** Six months ending at `month` ("YYYY-MM"), for the desktop trend chart. */
export const trendQuery = (month: string) =>
  queryOptions({
    queryKey: ["ledger", "trend", month],
    queryFn: () => getTrend({ data: { month } }),
  })

export const categoriesQuery = () =>
  queryOptions({
    queryKey: ["categories"],
    queryFn: () => getCategories(),
  })

/** IOU balances move with every entry, so people live under "ledger" too. */
export const peopleQuery = () =>
  queryOptions({ queryKey: ["ledger", "people"], queryFn: () => getPeople() })

export const personQuery = (id: string) =>
  queryOptions({
    queryKey: ["ledger", "people", id],
    queryFn: () => getPerson({ data: { id } }),
  })

export const transactionsQuery = (period: Period, month?: string) =>
  queryOptions({
    queryKey: ["ledger", "transactions", period, month ?? "current"],
    queryFn: () => getTransactions({ data: { period, month } }),
  })

/** Balances move with every entry, so accounts live under "ledger" too. */
export const accountsQuery = (month: string) =>
  queryOptions({
    queryKey: ["ledger", "accounts", month],
    queryFn: () => getAccounts({ data: { month } }),
  })

export const accountQuery = (id: string) =>
  queryOptions({
    queryKey: ["ledger", "account", id],
    queryFn: () => getAccount({ data: { id } }),
  })

/** Statements imported into an account; undoing one changes the ledger. */
export const importsQuery = (accountId: string) =>
  queryOptions({
    queryKey: ["ledger", "imports", accountId],
    queryFn: () => getImports({ data: { accountId } }),
  })
