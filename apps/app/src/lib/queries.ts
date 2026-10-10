import { queryOptions } from "@tanstack/react-query"
import { getMonth } from "@/server/ledger"

/** `month` is "YYYY-MM"; omitted means the current month in the owner's timezone. */
export const monthQuery = (month?: string) =>
  queryOptions({
    queryKey: ["month", month ?? "current"],
    queryFn: () => getMonth({ data: { month } }),
  })
