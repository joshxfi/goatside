import { useState } from "react"
import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { cn } from "@workspace/ui/lib/utils"
import { AccountsStrip } from "@/components/accounts-strip"
import { useAgent } from "@/components/agent-provider"
import { Composer } from "@/components/composer"
import { DailyBars } from "@/components/daily-bars"
import { Feed } from "@/components/feed"
import { MonthHeader } from "@/components/month-header"
import {
  ChangesCard,
  KpiRow,
  LargestCard,
  Overview,
  RecentCard,
  RepeatsCard,
  SpendingBreakdown,
} from "@/components/overview"
import { PeopleList } from "@/components/people-list"
import { Questions } from "@/components/questions"
import { Summary } from "@/components/summary"
import { TransactionDrawer } from "@/components/transaction-drawer"
import { monthQuery, trendQuery } from "@/lib/queries"
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
  loader: async ({ context, deps }) => {
    const view = await context.queryClient.ensureQueryData(monthQuery(deps.m))
    // The desktop overview's trend; small, so it's fetched for every layout.
    await context.queryClient.ensureQueryData(trendQuery(view.month))
  },
  headers: () => ({ "Cache-Control": "private, no-store" }),
  component: Home,
})

function Home() {
  const { m } = Route.useSearch()
  const { viewer } = Route.useRouteContext()
  const { data } = useSuspenseQuery(monthQuery(m))
  const { data: trend } = useSuspenseQuery(trendQuery(data.month))
  const [selected, setSelected] = useState<LedgerTxn | null>(null)
  const { ask } = useAgent()
  const hasRepeats = data.transactions.some((t) => t.recurring && t.amount < 0)
  const hasPeople = data.people.length > 0

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-md flex-col lg:max-w-[90rem] lg:px-8">
      <div className="px-4 pt-[max(env(safe-area-inset-top),1rem)] lg:sticky lg:top-0 lg:z-30 lg:bg-background/90 lg:px-0 lg:py-4 lg:backdrop-blur-md">
        <MonthHeader month={data.month} today={data.today} viewer={viewer}>
          {/* One instance: a header bar on desktop, the bottom dock on phones. */}
          <Composer view={data} viewKey={m} onAsk={ask}>
            <Questions view={data} viewKey={m} onMore={setSelected} />
          </Composer>
        </MonthHeader>
      </div>
      <main
        className={cn(
          "flex flex-col gap-8 px-4 pt-8 pb-40 lg:gap-4 lg:px-0 lg:pt-2 lg:pb-12",
          // Room for the question card above the phone composer.
          data.questions.length > 0 && "pb-80"
        )}
      >
        {/* Phone: the lighter stack, mostly for logging. */}
        <div className="flex flex-col gap-8 lg:hidden">
          <Summary view={data} />
          <AccountsStrip view={data} />
          <DailyBars daily={data.daily} today={data.today} />
          <section
            aria-labelledby="phone-categories"
            className="flex flex-col gap-3"
          >
            <h2
              id="phone-categories"
              className="text-sm font-medium text-muted-foreground"
            >
              Where it went
            </h2>
            <SpendingBreakdown view={data} trend={trend} size={180} />
          </section>
          <PeopleList people={data.people} />
          <Feed view={data} onSelect={setSelected} />
        </div>
        {/* Desktop: the review surface. */}
        <div className="hidden lg:flex lg:flex-col lg:gap-4">
          {data.questions.length > 0 && (
            <div className="max-w-2xl">
              <Questions view={data} viewKey={m} onMore={setSelected} />
            </div>
          )}
          <KpiRow view={data} />
          <AccountsStrip view={data} />
          <Overview view={data} />
          <div className="grid gap-4 xl:grid-cols-3">
            <ChangesCard view={data} />
            <LargestCard view={data} onSelect={setSelected} />
            <RecentCard view={data} onSelect={setSelected} />
          </div>
          {(hasPeople || hasRepeats) && (
            <div
              className={cn(
                "grid gap-4",
                hasPeople && hasRepeats && "xl:grid-cols-2"
              )}
            >
              {hasPeople && <PeopleList people={data.people} />}
              <RepeatsCard view={data} onSelect={setSelected} />
            </div>
          )}
        </div>
      </main>
      <TransactionDrawer
        txn={selected}
        categories={data.categories}
        accounts={data.accounts}
        onClose={() => setSelected(null)}
      />
    </div>
  )
}
