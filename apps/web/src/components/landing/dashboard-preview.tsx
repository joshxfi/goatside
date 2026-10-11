import { useState } from "react"
import { formatMoney } from "@workspace/core/money"
import { cn } from "@workspace/ui/lib/utils"
import { SAMPLE_MONTHS, monthName, projection } from "@/lib/demo/sample-months"
import {
  CalendarHeatmap,
  HeatLegend,
  PaceChart,
  SpendingDonut,
  TrendChart,
  TrendLegend,
  spendingSlices,
} from "./charts"
import { DemoCard } from "./ui"

const CHOICES = SAMPLE_MONTHS.slice(-3)

/** The desktop overview on sample months, with a month switcher. */
export function DashboardPreview() {
  const [month, setMonth] = useState(CHOICES.at(-1)!.month)
  const index = SAMPLE_MONTHS.findIndex((m) => m.month === month)
  const view = SAMPLE_MONTHS[index]!
  const previous = SAMPLE_MONTHS[index - 1]
  const ahead = projection(view)
  const slices = spendingSlices(view)
  const left = view.totals.in - view.totals.out

  // Against the same day last month, so a month in progress compares fairly.
  const day = Number(view.today.slice(8, 10))
  const lastMonthByNow = previous
    ? previous.daily.slice(0, day).reduce((sum, d) => sum + d.out, 0)
    : 0
  const change = lastMonthByNow
    ? Math.round(((view.totals.out - lastMonthByNow) / lastMonthByNow) * 100)
    : 0

  return (
    <DemoCard className="flex flex-col gap-5 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="font-display text-3xl leading-none">
            {monthName(view.month)}
          </span>
          <span className="text-sm text-muted-foreground">
            {ahead ? `Day ${ahead.day} of ${ahead.days}` : "The whole month"}
          </span>
        </div>
        <fieldset className="flex rounded-full border bg-background p-0.5">
          <legend className="sr-only">Month</legend>
          {CHOICES.map((m) => (
            <button
              key={m.month}
              type="button"
              aria-pressed={m.month === month}
              onClick={() => setMonth(m.month)}
              className={cn(
                "h-8 rounded-full px-3.5 text-sm transition-[background-color,color] duration-150",
                m.month === month
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground [@media(hover:hover)]:hover:text-foreground"
              )}
            >
              {monthName(m.month).slice(0, 3)}
            </button>
          ))}
        </fieldset>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
        <Figure
          label="Money in"
          value={formatMoney(view.totals.in)}
          tone="in"
        />
        <Figure
          label="Money out"
          value={formatMoney(view.totals.out)}
          tone="out"
        />
        <Figure label="Left" value={formatMoney(left, { sign: left > 0 })} />
        <Figure
          label={ahead ? "On pace for" : "vs last month"}
          value={
            ahead
              ? formatMoney(ahead.total)
              : `${change > 0 ? "+" : change < 0 ? "−" : ""}${Math.abs(change)}%`
          }
          hint={
            ahead
              ? `${change > 0 ? "+" : change < 0 ? "−" : ""}${Math.abs(change)}% vs ${monthName(previous?.month ?? view.month).slice(0, 3)} by now`
              : undefined
          }
        />
      </dl>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Panel
          title="Pace"
          aside={
            <span className="flex items-center gap-3 text-xs text-muted-foreground">
              <Key className="bg-expense" /> {monthName(view.month).slice(0, 3)}
              <Key dashed />{" "}
              {monthName(previous?.month ?? view.month).slice(0, 3)}
            </span>
          }
        >
          <PaceChart view={view} />
        </Panel>
        <Panel title="Where it went">
          <div className="flex flex-col items-center gap-4 sm:flex-row lg:flex-col xl:flex-row">
            <SpendingDonut slices={slices} total={view.totals.out} size={176} />
            <ul className="flex w-full flex-col gap-1.5 text-sm">
              {slices.map((s) => (
                <li key={s.name} className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-sm"
                    style={{ background: s.color }}
                  />
                  <span className="flex-1 truncate">{s.name}</span>
                  <span className="figure text-muted-foreground">
                    {formatMoney(s.out)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.6fr]">
        <Panel title="Day by day" aside={<HeatLegend />}>
          <CalendarHeatmap view={view} />
        </Panel>
        <Panel title="Six months" aside={<TrendLegend />}>
          <TrendChart selected={view.month} />
        </Panel>
      </div>
    </DemoCard>
  )
}

function Figure({
  label,
  value,
  tone,
  hint,
}: {
  label: string
  value: string
  tone?: "in" | "out"
  hint?: string
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "figure truncate font-display text-3xl leading-none md:text-4xl",
          tone === "in" && "text-income-foreground",
          tone === "out" && "text-expense-foreground"
        )}
      >
        {value}
      </dd>
      {hint && <dd className="text-xs text-muted-foreground">{hint}</dd>}
    </div>
  )
}

function Panel({
  title,
  aside,
  children,
}: {
  title: string
  aside?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-2xl border bg-background/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

function Key({ className, dashed }: { className?: string; dashed?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block h-0.5 w-4 rounded-full",
        dashed &&
          "border-t-2 border-dashed border-muted-foreground/70 bg-transparent",
        className
      )}
    />
  )
}
