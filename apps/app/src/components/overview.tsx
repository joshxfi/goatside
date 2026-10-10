/**
 * The desktop review surface: headline numbers, charts and repeats. The
 * phone keeps the lighter Summary / DailyBars / Feed stack for logging.
 */
import { useSuspenseQuery } from "@tanstack/react-query"
import { formatPeso } from "@workspace/core/money"
import { cn } from "@workspace/ui/lib/utils"
import { CategoryList } from "@/components/category-list"
import {
  DailyChart,
  PaceChart,
  SERIES_COLORS,
  TrendChart,
} from "@/components/charts"
import { dayLabel, monthName } from "@/lib/format"
import { trendQuery } from "@/lib/queries"
import type { LedgerTxn, MonthView } from "@/server/ledger"

export function Card({
  title,
  description,
  action,
  footer,
  className,
  children,
}: {
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  footer?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col gap-4 rounded-2xl border bg-card p-5",
        className
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-medium">{title}</h2>
          {description && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {action}
      </header>
      {children}
      {footer}
    </section>
  )
}

function daysElapsed(view: MonthView) {
  return view.month === view.today.slice(0, 7)
    ? Number(view.today.slice(8, 10))
    : view.daily.length
}

/** Four headline numbers for the month. */
export function KpiRow({ view }: { view: MonthView }) {
  const { totals, previous } = view
  const isCurrent = view.month === view.today.slice(0, 7)
  const diff = totals.out - previous.outToDate
  const days = daysElapsed(view)
  const biggest = view.daily.reduce((top, d) => (d.out > top.out ? d : top), {
    date: "",
    out: 0,
    in: 0,
  })

  return (
    <dl className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <Kpi
        label="Spent"
        value={formatPeso(totals.out)}
        tone="expense"
        note={
          previous.hasData ? (
            <>
              <span
                className={cn(
                  "font-medium",
                  diff <= 0
                    ? "text-income-foreground"
                    : "text-expense-foreground"
                )}
              >
                {formatPeso(Math.abs(diff))} {diff <= 0 ? "less" : "more"}
              </span>{" "}
              than {isCurrent ? "this point in " : ""}
              {monthName(previous.month)}
            </>
          ) : (
            "No earlier month to compare yet"
          )
        }
        large
      />
      <Kpi
        label="Money in"
        value={formatPeso(totals.in)}
        tone="income"
        note={`${monthName(view.month)} so far`}
      />
      <Kpi
        label="Net"
        value={formatPeso(totals.net, { sign: true })}
        tone={totals.net >= 0 ? "income" : "expense"}
        note={
          totals.net >= 0
            ? "You kept more than you spent"
            : "Spent more than came in"
        }
      />
      <Kpi
        label="Daily average"
        value={formatPeso(
          Math.round(totals.out / Math.max(days, 1) / 100) * 100
        )}
        note={
          biggest.out > 0
            ? `Biggest day: ${dayLabel(biggest.date, view.today)}, ${formatPeso(biggest.out)}`
            : "Nothing spent yet"
        }
      />
    </dl>
  )
}

function Kpi({
  label,
  value,
  note,
  tone,
  large,
}: {
  label: string
  value: string
  note: React.ReactNode
  tone?: "income" | "expense"
  large?: boolean
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-2xl border bg-card px-5 py-4">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "figure truncate leading-tight font-semibold tracking-tight",
          large ? "text-5xl" : "text-4xl",
          tone === "income" && "text-income-foreground",
          tone === "expense" && "text-expense-foreground"
        )}
      >
        {value}
      </dd>
      <dd className="line-clamp-2 text-xs text-muted-foreground">{note}</dd>
    </div>
  )
}

function Legend({
  items,
}: {
  items: { label: string; swatch: React.ReactNode }[]
}) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          {item.swatch}
          {item.label}
        </li>
      ))}
    </ul>
  )
}

/** Pace, categories, trend and daily spending. */
export function Overview({ view }: { view: MonthView }) {
  const { data: trend } = useSuspenseQuery(trendQuery(view.month))
  const hasTrend = trend.months.some((m) => m.out > 0)

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <Card
        title="Pace"
        description={`Running total, ${monthName(view.month)} against ${monthName(view.previous.month)}`}
        className="xl:col-span-2"
        action={
          <Legend
            items={[
              {
                label: monthName(view.month),
                swatch: <span className="h-0.5 w-4 rounded-full bg-expense" />,
              },
              {
                label: monthName(view.previous.month),
                swatch: (
                  <span className="w-4 border-t-2 border-dashed border-muted-foreground/60" />
                ),
              },
            ]}
          />
        }
      >
        <PaceChart view={view} />
      </Card>

      <Card
        title="Where it went"
        description={`${view.byCategory.length} categories`}
      >
        {view.byCategory.length ? (
          <CategoryList
            categories={view.byCategory}
            total={view.totals.out}
            bare
          />
        ) : (
          <p className="text-sm text-muted-foreground">No spending yet.</p>
        )}
      </Card>

      <Card
        title="Day by day"
        description="Spending per day, today in full color"
        className="xl:col-span-2"
      >
        <DailyChart view={view} />
      </Card>

      <Card
        title="Six months"
        description="Spending by top category"
        footer={
          <Legend
            items={trend.series.map((name, i) => ({
              label: name,
              swatch: (
                <span
                  className="size-2.5 rounded-sm"
                  style={{
                    background:
                      name === "Other"
                        ? "var(--muted-foreground)"
                        : SERIES_COLORS[i],
                  }}
                />
              ),
            }))}
          />
        }
      >
        {hasTrend ? (
          <TrendChart trend={trend} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Log a few entries to see your trend.
          </p>
        )}
      </Card>
    </div>
  )
}

/** Recurring charges seen this month: subscriptions, bills, rent. */
export function RepeatsCard({
  view,
  onSelect,
}: {
  view: MonthView
  onSelect: (txn: LedgerTxn) => void
}) {
  const repeats = view.transactions.filter((t) => t.recurring && t.amount < 0)
  if (!repeats.length) return null
  const total = repeats.reduce((sum, t) => sum - t.amount, 0)

  return (
    <Card
      title="Repeats"
      description={`${formatPeso(total)} this month in subscriptions and bills`}
    >
      <ul className="-mx-2 flex flex-col">
        {repeats.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => onSelect(t)}
              className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
            >
              <span aria-hidden>{t.category?.emoji ?? "🔁"}</span>
              <span className="min-w-0 flex-1 truncate">
                {t.description || t.category?.name}
              </span>
              <span className="figure text-muted-foreground">
                {formatPeso(-t.amount)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  )
}
