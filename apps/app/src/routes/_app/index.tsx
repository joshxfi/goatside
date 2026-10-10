import { useState } from "react"
import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { CategoryList } from "@/components/category-list"
import { Composer } from "@/components/composer"
import { DailyBars } from "@/components/daily-bars"
import { Feed } from "@/components/feed"
import { MonthHeader } from "@/components/month-header"
import { Summary } from "@/components/summary"
import { TransactionDrawer } from "@/components/transaction-drawer"
import { monthQuery } from "@/lib/queries"
import type { LedgerTxn } from "@/server/ledger"

export const Route = createFileRoute("/_app/")({
  validateSearch: z.object({
    m: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional()
      .catch(undefined),
  }),
  loaderDeps: ({ search }) => ({ m: search.m }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(monthQuery(deps.m)),
  headers: () => ({ "Cache-Control": "private, no-store" }),
  component: Home,
})

function Home() {
  const { m } = Route.useSearch()
  const { viewer } = Route.useRouteContext()
  const { data } = useSuspenseQuery(monthQuery(m))
  const [selected, setSelected] = useState<LedgerTxn | null>(null)

  return (
    <div className="mx-auto flex min-h-svh max-w-md flex-col">
      <main className="flex flex-1 flex-col gap-8 px-4 pt-[max(env(safe-area-inset-top),1rem)] pb-40">
        <MonthHeader month={data.month} today={data.today} viewer={viewer} />
        <Summary view={data} />
        <DailyBars daily={data.daily} today={data.today} />
        <CategoryList categories={data.byCategory} total={data.totals.out} />
        <Feed view={data} onSelect={setSelected} />
      </main>
      <Composer view={data} viewKey={m} />
      <TransactionDrawer
        txn={selected}
        categories={data.categories}
        onClose={() => setSelected(null)}
      />
    </div>
  )
}
