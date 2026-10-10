import { queryOptions } from "@tanstack/react-query"
import { getMonth, getTrend } from "@/server/ledger"

/** `month` is "YYYY-MM"; omitted means the current month in the owner's timezone. */
export const monthQuery = (month?: string) =>
  queryOptions({
    queryKey: ["month", month ?? "current"],
    queryFn: () => getMonth({ data: { month } }),
  })

/** Six months ending at `month` ("YYYY-MM"), for the desktop trend chart. */
export const trendQuery = (month: string) =>
  queryOptions({
    queryKey: ["trend", month],
    queryFn: () => getTrend({ data: { month } }),
  })
