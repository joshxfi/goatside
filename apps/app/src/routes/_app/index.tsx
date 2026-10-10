import { useState } from "react"
import { useChat } from "@ai-sdk/react"
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai"
import { z } from "zod"
import { toast } from "@workspace/ui/components/sonner"
import { cn } from "@workspace/ui/lib/utils"
import { AskSheet } from "@/components/ask-sheet"
import { CategoryList } from "@/components/category-list"
import { Composer } from "@/components/composer"
import { DailyBars } from "@/components/daily-bars"
import { Feed } from "@/components/feed"
import { MonthHeader } from "@/components/month-header"
import { KpiRow, Overview, RepeatsCard } from "@/components/overview"
import { PeopleList } from "@/components/people-list"
import { Questions } from "@/components/questions"
import { Summary } from "@/components/summary"
import { TransactionDrawer } from "@/components/transaction-drawer"
import { TransactionsTable } from "@/components/transactions-table"
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

const transport = new DefaultChatTransport({ api: "/api/ask" })

function Home() {
  const { m } = Route.useSearch()
  const { viewer } = Route.useRouteContext()
  const { data } = useSuspenseQuery(monthQuery(m))
  const [selected, setSelected] = useState<LedgerTxn | null>(null)
  const [asking, setAsking] = useState(false)
  const queryClient = useQueryClient()
  const chat = useChat({
    transport,
    // After the owner confirms a change, continue so the tool runs.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    // The agent may have changed the ledger; refresh what's on screen.
    onFinish: () => {
      for (const key of ["month", "trend", "people", "categories"]) {
        void queryClient.invalidateQueries({ queryKey: [key] })
      }
    },
  })

  function ask(question: string) {
    if (!viewer.ai) {
      toast("Questions need AI Gateway.", {
        description:
          "Add AI_GATEWAY_API_KEY to your environment, then restart.",
      })
      return
    }
    setAsking(true)
    void chat.sendMessage({ text: question })
  }

  return (
    <div className="mx-auto flex min-h-svh max-w-md flex-col lg:max-w-[90rem] lg:px-8">
      <div className="px-4 pt-[max(env(safe-area-inset-top),1rem)] lg:px-0 lg:pt-6">
        <MonthHeader month={data.month} today={data.today} viewer={viewer} />
      </div>
      <div className="flex flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-6 lg:pt-6 lg:pb-12 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <main
          className={cn(
            "flex flex-col gap-8 px-4 pt-8 pb-40 lg:gap-4 lg:p-0",
            // Room for the question card above the phone composer.
            data.questions.length > 0 && "pb-80 lg:pb-0"
          )}
        >
          {/* Phone: the lighter stack, mostly for logging. */}
          <div className="flex flex-col gap-8 lg:hidden">
            <Summary view={data} />
            <DailyBars daily={data.daily} today={data.today} />
            <CategoryList
              categories={data.byCategory}
              total={data.totals.out}
            />
            <PeopleList people={data.people} />
            <Feed view={data} onSelect={setSelected} />
          </div>
          {/* Desktop: the review surface. */}
          <div className="hidden lg:flex lg:flex-col lg:gap-4">
            <KpiRow view={data} />
            <Overview view={data} />
            <TransactionsTable view={data} onSelect={setSelected} />
          </div>
        </main>
        <aside
          aria-label="Log and review"
          className="lg:sticky lg:top-6 lg:flex lg:flex-col lg:gap-4"
        >
          <Composer view={data} viewKey={m} onAsk={ask}>
            <Questions view={data} viewKey={m} onMore={setSelected} />
          </Composer>
          <div className="hidden lg:contents">
            <PeopleList people={data.people} />
            <RepeatsCard view={data} onSelect={setSelected} />
          </div>
        </aside>
      </div>
      <AskSheet chat={chat} open={asking} onOpenChange={setAsking} />
      <TransactionDrawer
        txn={selected}
        categories={data.categories}
        onClose={() => setSelected(null)}
      />
    </div>
  )
}
