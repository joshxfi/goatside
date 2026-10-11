import { useState } from "react"
import { useSuspenseQuery } from "@tanstack/react-query"
import { Link, createFileRoute } from "@tanstack/react-router"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { z } from "zod"
import { addMonths } from "@workspace/core/dates"
import { formatPeso } from "@workspace/core/money"
import { buttonVariants } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { PageFrame, PageHeader } from "@/components/app-shell"
import { TransactionDrawer } from "@/components/transaction-drawer"
import { TransactionsTable } from "@/components/transactions-table"
import { monthLabel } from "@/lib/format"
import { transactionsQuery } from "@/lib/queries"
import type { LedgerTxn, Period, TransactionsView } from "@/server/ledger"

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

export const Route = createFileRoute("/_app/transactions")({
  validateSearch: z.object({
    period: z
      .enum(["month", "last-3-months", "this-year", "all"])
      .optional()
      .catch(undefined),
    m: z.string().regex(MONTH).optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({
    period: search.period ?? "month",
    m: search.m,
  }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(transactionsQuery(deps.period, deps.m)),
  head: () => ({ meta: [{ title: "Transactions · Goatside" }] }),
  headers: () => ({ "Cache-Control": "private, no-store" }),
  component: Transactions,
})

const PERIOD_LABELS: Record<Period, string> = {
  month: "Month",
  "last-3-months": "3 months",
  "this-year": "This year",
  all: "All time",
}

function Transactions() {
  const { viewer } = Route.useRouteContext()
  const { period = "month", m } = Route.useSearch()
  const { data } = useSuspenseQuery(transactionsQuery(period, m))
  const [selected, setSelected] = useState<LedgerTxn | null>(null)

  return (
    <PageFrame width="wide">
      <PageHeader title="Transactions" viewer={viewer} />
      <div className="flex flex-col gap-4">
        <PeriodPicker view={data} period={period} />
        <PeriodSummary view={data} />
        {data.truncated && (
          <p className="text-xs text-muted-foreground">
            Showing the latest 5,000 entries. Pick a shorter period to see the
            rest.
          </p>
        )}
        <TransactionsTable
          transactions={data.transactions}
          categories={data.categories}
          accounts={data.accounts}
          onSelect={setSelected}
          exportName={`goatside-${data.month ?? period}.csv`}
          empty="No entries in this period."
        />
      </div>
      <TransactionDrawer
        txn={selected}
        categories={data.categories}
        accounts={data.accounts}
        onClose={() => setSelected(null)}
      />
    </PageFrame>
  )
}

function PeriodPicker({
  view,
  period,
}: {
  view: TransactionsView
  period: Period
}) {
  const current = view.today.slice(0, 7)
  const month = view.month ?? current
  const nav = cn(
    buttonVariants({ variant: "ghost", size: "icon-sm" }),
    "rounded-full"
  )
  const toMonth = (target: string) => ({
    period: undefined,
    m: target === current ? undefined : target,
  })

  return (
    <div className="flex flex-wrap items-center gap-3">
      <nav
        aria-label="Period"
        className="flex rounded-full border bg-card p-0.5 text-sm"
      >
        {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
          <Link
            key={p}
            to="/transactions"
            search={p === "month" ? toMonth(month) : { period: p }}
            aria-current={p === period ? "page" : undefined}
            className={cn(
              "rounded-full px-3 py-1 text-muted-foreground transition-colors hover:text-foreground",
              p === period && "bg-muted text-foreground"
            )}
          >
            {PERIOD_LABELS[p]}
          </Link>
        ))}
      </nav>
      {period === "month" && (
        <div className="flex items-center gap-1">
          <Link
            to="/transactions"
            search={toMonth(addMonths(month, -1))}
            className={nav}
            aria-label="Previous month"
          >
            <ChevronLeftIcon />
          </Link>
          <span className="min-w-36 text-center font-display text-xl">
            {monthLabel(month)}
          </span>
          {month < current ? (
            <Link
              to="/transactions"
              search={toMonth(addMonths(month, 1))}
              className={nav}
              aria-label="Next month"
            >
              <ChevronRightIcon />
            </Link>
          ) : (
            <span
              className={cn(nav, "pointer-events-none opacity-30")}
              aria-hidden
            >
              <ChevronRightIcon />
            </span>
          )}
        </div>
      )}
      {period !== "month" && (
        <span className="text-sm text-muted-foreground">
          {period === "all"
            ? "Everything you've logged"
            : `${view.range.start} to ${view.range.end}`}
        </span>
      )}
    </div>
  )
}

/** Spending and income for the period. IOUs are kept apart, as everywhere. */
function PeriodSummary({ view }: { view: TransactionsView }) {
  const own = view.transactions.filter(
    (t) => t.kind === "expense" || t.kind === "income"
  )
  const spent = own
    .filter((t) => t.amount < 0)
    .reduce((s, t) => s - t.amount, 0)
  const received = own
    .filter((t) => t.amount > 0)
    .reduce((s, t) => s + t.amount, 0)
  const net = received - spent

  return (
    <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4 lg:gap-4">
      <Stat label="Spent" value={formatPeso(spent)} tone="expense" />
      <Stat label="Received" value={formatPeso(received)} tone="income" />
      <Stat
        label="Net"
        value={formatPeso(net, { sign: true })}
        tone={net >= 0 ? "income" : "expense"}
      />
      <Stat label="Entries" value={String(view.transactions.length)} />
    </dl>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: "income" | "expense"
}) {
  return (
    <div className="rounded-2xl border bg-card px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "figure font-display text-3xl leading-tight",
          tone === "income" && "text-income-foreground",
          tone === "expense" && "text-expense-foreground"
        )}
      >
        {value}
      </dd>
    </div>
  )
}
