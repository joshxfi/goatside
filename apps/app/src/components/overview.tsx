/**
 * The desktop review surface: headline numbers, charts and repeats. The
 * phone keeps the lighter Summary / DailyBars / Feed stack for logging.
 */
import { useSuspenseQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { formatPeso } from "@workspace/core/money"
import { cn } from "@workspace/ui/lib/utils"
import {
  CalendarHeatmap,
  CashFlowChart,
  DailyChart,
  HeatLegend,
  PaceChart,
  SpendingDonut,
  TrendChart,
  projection,
  spendingSlices,
} from "@/components/charts"
import { capitalize, dayLabel, monthName } from "@/lib/format"
import { trendQuery } from "@/lib/queries"
import { OTHER, STACK_ORDER, seriesColors } from "@/lib/series"
import type { LedgerTxn, MonthView, TrendView } from "@/server/ledger"

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
          "figure truncate font-display leading-tight tracking-tight",
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

const lineKey = (className: string) => <span className={cn("w-4", className)} />

/**
 * The month's spending as a donut (top categories by six-month rank, then
 * Other) above a list that doubles as its legend: each slice's share and
 * amount, with the categories Other folds in listed under it.
 */
export function SpendingBreakdown({
  view,
  trend,
  size = 200,
}: {
  view: MonthView
  trend: TrendView
  size?: number
}) {
  const slices = spendingSlices(view, trend)
  const total = view.totals.out
  if (!view.byCategory.length) {
    return <p className="text-sm text-muted-foreground">No spending yet.</p>
  }
  const named = new Set(slices.map((s) => s.name))
  const folded = view.byCategory.filter((c) => !named.has(c.name))
  const rows = slices.toSorted(
    (a, b) =>
      Number(a.name === OTHER) - Number(b.name === OTHER) || b.out - a.out
  )
  return (
    <div className="flex flex-col gap-5">
      <SpendingDonut slices={slices} total={total} size={size} />
      <ul className="flex flex-col gap-2.5" aria-label="Spending by category">
        {rows.map((s) => (
          <li key={s.name} className="flex flex-col gap-1">
            <ShareRow
              emoji={s.name === OTHER ? undefined : s.emoji}
              name={s.name}
              out={s.out}
              total={total}
              color={s.color}
            />
            {s.name === OTHER && (
              <ul className="mt-1 flex flex-col gap-1 pl-[1.125rem]">
                {folded.map((c) => (
                  <li
                    key={c.id ?? "none"}
                    className="flex items-center gap-2 text-xs text-muted-foreground"
                  >
                    <span aria-hidden>{c.emoji}</span>
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    <span className="figure">{formatPeso(c.out)}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ShareRow({
  emoji,
  name,
  out,
  total,
  color,
}: {
  emoji?: string
  name: string
  out: number
  total: number
  color: string
}) {
  const share = total ? out / total : 0
  return (
    <>
      <div className="flex items-center gap-2 text-sm">
        <span
          aria-hidden
          className="size-2.5 shrink-0 rounded-sm"
          style={{ background: color }}
        />
        {emoji && <span aria-hidden>{emoji}</span>}
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <span className="figure text-xs text-muted-foreground">
          {Math.round(share * 100)}%
        </span>
        <span className="figure">{formatPeso(out)}</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.max(share * 100, 1)}%`, background: color }}
        />
      </div>
    </>
  )
}

/** Pace, categories, rhythm, and the six-month view. */
export function Overview({ view }: { view: MonthView }) {
  const { data: trend } = useSuspenseQuery(trendQuery(view.month))
  const hasTrend = trend.months.some((m) => m.out > 0 || m.in > 0)
  const ahead = projection(view)
  const colors = seriesColors(trend.series)

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <Card
        title="Pace"
        description={
          ahead ? (
            <>
              Heading for{" "}
              <span className="figure font-medium text-foreground">
                {formatPeso(ahead.total)}
              </span>{" "}
              by the end of {monthName(view.month)}
              {view.previous.hasData && (
                <>
                  {" "}
                  · {monthName(view.previous.month)} ended at{" "}
                  {formatPeso(view.previous.daily.reduce((s, d) => s + d, 0))}
                </>
              )}
            </>
          ) : (
            `Running total, ${monthName(view.month)} against ${monthName(view.previous.month)}`
          )
        }
        className="xl:col-span-2"
        action={
          <Legend
            items={[
              {
                label: monthName(view.month),
                swatch: lineKey("h-0.5 rounded-full bg-expense"),
              },
              ...(ahead
                ? [
                    {
                      label: "Projected",
                      swatch: lineKey(
                        "border-t-2 border-dotted border-expense/60"
                      ),
                    },
                  ]
                : []),
              {
                label: monthName(view.previous.month),
                swatch: lineKey(
                  "border-t-2 border-dashed border-muted-foreground/60"
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
        description={`${view.byCategory.length} ${view.byCategory.length === 1 ? "category" : "categories"} this month`}
      >
        <SpendingBreakdown view={view} trend={trend} />
      </Card>

      <Card
        title="Day by day"
        description="Spending per day, today in full color"
        className="xl:col-span-2"
      >
        <DailyChart view={view} />
      </Card>

      <Card
        title="Calendar"
        description={`${monthName(view.month)}, redder on bigger days`}
        footer={<HeatLegend />}
      >
        <CalendarHeatmap view={view} />
      </Card>

      <Card
        title="Six months by category"
        description="Top categories keep their colors across every chart"
        className="xl:col-span-2"
        footer={
          <Legend
            items={colors
              .ordered(STACK_ORDER)
              .filter((name) => trend.series.includes(name))
              .map((name) => ({
                label: name,
                swatch: (
                  <span
                    className="size-2.5 rounded-sm"
                    style={{ background: colors.color(name) }}
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

      <Card
        title="Money in and out"
        description="Six months, side by side"
        action={
          <Legend
            items={[
              {
                label: "In",
                swatch: <span className="size-2.5 rounded-sm bg-income" />,
              },
              {
                label: "Out",
                swatch: <span className="size-2.5 rounded-sm bg-expense" />,
              },
            ]}
          />
        }
      >
        {hasTrend ? (
          <CashFlowChart trend={trend} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Log a few entries to see your cash flow.
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

/** Categories that moved most against last month at the same point. */
export function ChangesCard({ view }: { view: MonthView }) {
  const isCurrent = view.month === view.today.slice(0, 7)
  return (
    <Card
      title="Biggest changes"
      description={`Against ${isCurrent ? "this point in " : ""}${monthName(view.previous.month)}`}
    >
      {view.changes.length ? (
        <ul className="flex flex-col gap-3">
          {view.changes.map((c) => {
            const up = c.delta > 0
            return (
              <li
                key={c.id ?? "none"}
                className="flex items-center gap-3 text-sm"
              >
                <span aria-hidden className="text-base">
                  {c.emoji}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{c.name}</span>
                  <span className="figure text-xs text-muted-foreground">
                    {formatPeso(c.now)} vs {formatPeso(c.before)}
                  </span>
                </span>
                <span
                  className={cn(
                    "figure font-display text-lg",
                    // More spending is the red side; less is the green one.
                    up ? "text-expense-foreground" : "text-income-foreground"
                  )}
                >
                  {up ? "↑" : "↓"} {formatPeso(Math.abs(c.delta))}
                </span>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          Nothing to compare yet. Changes show up once last month has entries.
        </p>
      )}
    </Card>
  )
}

function TxnLine({
  txn,
  today,
  onSelect,
}: {
  txn: LedgerTxn
  today: string
  onSelect: (t: LedgerTxn) => void
}) {
  const income =
    txn.amount > 0 && (txn.kind === "income" || txn.kind === "expense")
  const iou = txn.kind === "lend" || txn.kind === "settle"
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(txn)}
        className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
      >
        <span aria-hidden className="text-base">
          {iou ? "🤝" : (txn.category?.emoji ?? "·")}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">
            {capitalize(txn.description) || txn.category?.name || "Untitled"}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {dayLabel(txn.localDate, today)}
            {txn.category ? ` · ${txn.category.name}` : ""}
          </span>
        </span>
        <span
          className={cn(
            "figure font-display text-lg",
            iou
              ? "text-muted-foreground"
              : income
                ? "text-income-foreground"
                : "text-expense-foreground"
          )}
        >
          {formatPeso(txn.amount, { sign: txn.amount > 0 })}
        </span>
      </button>
    </li>
  )
}

/** The month's biggest single expenses. */
export function LargestCard({
  view,
  onSelect,
}: {
  view: MonthView
  onSelect: (t: LedgerTxn) => void
}) {
  const largest = view.transactions
    .filter((t) => t.kind === "expense" && !t.id.startsWith("optimistic:"))
    .toSorted((a, b) => a.amount - b.amount)
    .slice(0, 5)
  return (
    <Card
      title="Largest expenses"
      description="Your biggest single payments this month"
    >
      {largest.length ? (
        <ul className="-mx-2 flex flex-col">
          {largest.map((t) => (
            <TxnLine
              key={t.id}
              txn={t}
              today={view.today}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No spending yet.</p>
      )}
    </Card>
  )
}

/** The latest entries, with a way into the full list. */
export function RecentCard({
  view,
  onSelect,
}: {
  view: MonthView
  onSelect: (t: LedgerTxn) => void
}) {
  const recent = view.transactions.slice(0, 6)
  const isCurrent = view.month === view.today.slice(0, 7)
  return (
    <Card
      title="Recent"
      description={`${view.transactions.length} ${view.transactions.length === 1 ? "entry" : "entries"} in ${monthName(view.month)}`}
      action={
        <Link
          to="/transactions"
          search={{ m: isCurrent ? undefined : view.month }}
          className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          See all
        </Link>
      }
    >
      {recent.length ? (
        <ul className="-mx-2 flex flex-col">
          {recent.map((t) => (
            <TxnLine
              key={t.id}
              txn={t}
              today={view.today}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          Nothing logged this month yet.
        </p>
      )}
    </Card>
  )
}
