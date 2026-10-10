/**
 * Charts, built with TanStack Charts. Money colors (green in, red out) and
 * category colors (lib/series.ts) come from theme tokens, so light and dark
 * mode work without rebuilding definitions.
 *
 * Mark specs follow the dataviz rules: bars ≤ 24px with 4px rounded ends,
 * 2px lines, a 2px surface gap between touching segments, recessive grids.
 */
import { useMemo } from "react"
import { barY, cell, defineChart, group, lineY, ruleY } from "@tanstack/charts"
import { crosshair } from "@tanstack/charts/crosshair"
import { pie, polar, radialArc } from "@tanstack/charts/polar"
import { Chart } from "@tanstack/charts/react"
import { scaleBand } from "@tanstack/charts/scales/band"
import { scaleLinear } from "@tanstack/charts/scales/linear"
import { tooltip } from "@tanstack/charts/tooltip"
import { daysInMonth } from "@workspace/core/dates"
import { formatPeso, formatPesoCompact } from "@workspace/core/money"
import { monthName } from "@/lib/format"
import { OTHER, RING_ORDER, STACK_ORDER, seriesColors } from "@/lib/series"
import type { MonthView, TrendView } from "@/server/ledger"

/** The card's own color, used for the gaps between touching segments. */
const SURFACE = "var(--card)"

const moneyAxis = {
  ticks: { count: 4, format: (value: number) => formatPesoCompact(value) },
}

/** Running totals: [1, 2, 3] → [1, 3, 6]. */
function cumulative(values: number[]): number[] {
  return values.reduce<number[]>(
    (totals, value) => [...totals, (totals.at(-1) ?? 0) + value],
    []
  )
}

/**
 * Where this month is heading. Repeating charges (rent, bills) are counted
 * once as paid, not extrapolated: only everyday spending is projected at its
 * daily rate. Null for past months and the first two days.
 */
export function projection(view: MonthView) {
  const isCurrent = view.month === view.today.slice(0, 7)
  const day = Number(view.today.slice(8, 10))
  const days = daysInMonth(view.month)
  if (!isCurrent || day < 3 || day >= days || view.totals.out === 0) return null
  const repeating = view.transactions
    .filter((t) => t.recurring && t.kind === "expense")
    .reduce((sum, t) => sum - t.amount, 0)
  const everydayRate = Math.max(view.totals.out - repeating, 0) / day
  const total = view.totals.out + everydayRate * (days - day)
  // Whole pesos: a projection is an estimate, not a receipt.
  return { day, days, total: Math.round(total / 100) * 100 }
}

/**
 * This month's running total against last month's, day by day, with a
 * dashed projection to month end. Answers "am I spending faster?".
 */
export function PaceChart({ view }: { view: MonthView }) {
  const isCurrent = view.month === view.today.slice(0, 7)
  const todayDay = Number(view.today.slice(8, 10))
  const current = monthName(view.month)
  const previous = monthName(view.previous.month)

  const definition = useMemo(() => {
    const thisMonth = cumulative(view.daily.map((d) => d.out))
      .map((total, i) => ({ day: i + 1, total }))
      .filter((d) => !isCurrent || d.day <= todayDay)
    const lastMonth = cumulative(view.previous.daily).map((total, i) => ({
      day: i + 1,
      total,
    }))
    const ahead = projection(view)
    const projected = ahead
      ? [
          { day: ahead.day, total: thisMonth.at(-1)?.total ?? 0 },
          { day: ahead.days, total: ahead.total },
        ]
      : []

    return defineChart({
      marks: [
        lineY(lastMonth, {
          x: "day",
          y: "total",
          stroke: "var(--muted-foreground)",
          strokeOpacity: 0.7,
          strokeWidth: 2,
          strokeDasharray: "4 4",
        }),
        lineY(projected, {
          x: "day",
          y: "total",
          stroke: "var(--expense)",
          strokeOpacity: 0.55,
          strokeWidth: 2,
          strokeDasharray: "2 5",
        }),
        lineY(thisMonth, {
          x: "day",
          y: "total",
          stroke: "var(--expense)",
          strokeWidth: 2,
        }),
        crosshair({ x: true, y: false }),
      ],
      scales: {
        x: {
          scale: scaleLinear,
          axis: { ticks: { count: 6, format: (day: number) => `${day}` } },
        },
        y: { scale: scaleLinear, nice: true, grid: true, axis: moneyAxis },
      },
      focus: "nearest-x",
      maxFocusDistance: Number.POSITIVE_INFINITY,
      tooltip: {
        use: tooltip,
        // Both months for the hovered day, whichever line is nearest.
        format: (point) => {
          const day = point.datum.day
          const lines = [`Day ${day}`]
          const now = thisMonth[day - 1]
          if (now) lines.push(`${current}: ${formatPeso(now.total)}`)
          const then = lastMonth[day - 1]
          if (then) lines.push(`${previous}: ${formatPeso(then.total)}`)
          if (ahead && day === ahead.days) {
            lines.push(`Projected: ${formatPeso(ahead.total)}`)
          }
          return lines.join("\n")
        },
      },
    })
  }, [view, isCurrent, todayDay, current, previous])

  return (
    <Chart
      definition={definition}
      height={360}
      initialWidth={720}
      ariaLabel={`Running total of spending in ${current} compared with ${previous}`}
      className="goat-chart"
    />
  )
}

/** Spending per day in red, today at full strength. */
export function DailyChart({ view }: { view: MonthView }) {
  const definition = useMemo(() => {
    const rows = view.daily.map((d, i) => ({
      day: i + 1,
      date: d.date,
      out: d.out,
    }))
    return defineChart({
      marks: [
        barY(rows, {
          x: "day",
          y: "out",
          fill: (d) =>
            d.date === view.today
              ? "var(--expense)"
              : "color-mix(in oklch, var(--expense) 55%, transparent)",
          radius: { end: 4 },
          maxThickness: 24,
        }),
        ruleY([0]),
      ],
      scales: {
        x: {
          scale: () => scaleBand<number>().padding(0.2),
          axis: {
            ticks: {
              format: (day: number) =>
                day === 1 || day % 5 === 0 ? `${day}` : "",
            },
          },
        },
        y: { scale: scaleLinear, nice: true, grid: true, axis: moneyAxis },
      },
      tooltip: {
        use: tooltip,
        format: (point) =>
          `${monthName(view.month)} ${point.datum.day}: ${formatPeso(point.datum.out)}`,
      },
    })
  }, [view])

  return (
    <Chart
      definition={definition}
      height={240}
      initialWidth={720}
      ariaLabel={`Spending per day in ${monthName(view.month)}`}
      className="goat-chart"
    />
  )
}

export interface Slice {
  name: string
  emoji: string
  out: number
  color: string
}

/**
 * This month's spending split into the top categories (by six-month rank)
 * and Other, in the ring order where touching hues stay distinguishable.
 */
export function spendingSlices(view: MonthView, trend: TrendView): Slice[] {
  const colors = seriesColors(trend.series)
  const byName = new Map(view.byCategory.map((c) => [c.name, c]))
  const named = colors
    .ordered(RING_ORDER)
    .filter((name) => name !== OTHER)
    .flatMap((name) => {
      const category = byName.get(name)
      return category && category.out > 0
        ? [
            {
              name,
              emoji: category.emoji,
              out: category.out,
              color: colors.color(name),
            },
          ]
        : []
    })
  const covered = new Set(named.map((s) => s.name))
  const other = view.byCategory
    .filter((c) => !covered.has(c.name))
    .reduce((sum, c) => sum + c.out, 0)
  return other > 0
    ? [
        ...named,
        { name: OTHER, emoji: "·", out: other, color: colors.color(OTHER) },
      ]
    : named
}

/** Part-to-whole for the month: a donut with the total in its center. */
export function SpendingDonut({
  slices,
  total,
  size = 220,
}: {
  slices: Slice[]
  total: number
  size?: number
}) {
  const definition = useMemo(() => {
    const arcs = pie(slices, { value: "out", gapAngle: 0.025 })
    return defineChart({
      marks: [
        polar({
          inset: 4,
          marks: [
            radialArc(arcs, {
              innerRadius: ({ radius }) => radius * 0.66,
              cornerRadius: 4,
              color: "name",
              key: "name",
            }),
          ],
          scales: { angle: null, radius: null },
        }),
      ],
      scales: { x: null, y: null },
      color: {
        domain: slices.map((s) => s.name),
        range: slices.map((s) => s.color),
      },
      tooltip: {
        use: tooltip,
        format: (point) => {
          const share = total ? Math.round((point.datum.out / total) * 100) : 0
          return `${point.datum.name}: ${formatPeso(point.datum.out)} (${share}%)`
        },
      },
    })
  }, [slices, total])

  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <Chart
        definition={definition}
        width={size}
        height={size}
        ariaLabel="Spending by category this month"
        className="goat-chart"
      />
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-xs text-muted-foreground">Spent</span>
        <span className="figure font-display text-3xl leading-none">
          {formatPesoCompact(total)}
        </span>
      </div>
    </div>
  )
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

/**
 * Steps of one hue (sequential): more spending reads stronger. Mixed in
 * oklab so the steps stay red; oklch would swing through the card's warm hue.
 */
const HEAT = [25, 45, 70, 100].map(
  (pct) => `color-mix(in oklab, var(--expense) ${pct}%, var(--card))`
)

/**
 * A calendar of the month, one cell per day, shaded by spending. Shows the
 * rhythm of a month (weekends, paydays) that bars spread thin.
 */
export function CalendarHeatmap({ view }: { view: MonthView }) {
  const definition = useMemo(() => {
    const first = new Date(`${view.month}-01T00:00:00Z`).getUTCDay()
    const offset = (first + 6) % 7 // Monday-first
    const spent = view.daily.map((d) => d.out).filter((out) => out > 0)
    const sorted = spent.toSorted((a, b) => a - b)
    const cut = (q: number) => sorted[Math.floor((sorted.length - 1) * q)] ?? 0
    const thresholds = [cut(0.25), cut(0.5), cut(0.8)]
    const level = (out: number) => thresholds.filter((t) => out > t).length

    const rows = view.daily.map((d, i) => {
      const slot = i + offset
      return {
        date: d.date,
        day: i + 1,
        out: d.out,
        weekday: WEEKDAYS[slot % 7] ?? "Mon",
        week: `w${Math.floor(slot / 7)}`,
        future: d.date > view.today,
        level:
          d.date > view.today
            ? "future"
            : d.out > 0
              ? `l${level(d.out)}`
              : "none",
      }
    })
    const weeks = [...new Set(rows.map((r) => r.week))]

    return defineChart({
      marks: [
        cell(rows, {
          x: "weekday",
          y: "week",
          color: "level",
          inset: 2,
          radius: 4,
        }),
        // Today, outlined on top.
        cell(
          rows.filter((r) => r.date === view.today),
          {
            x: "weekday",
            y: "week",
            fill: "transparent",
            stroke: "var(--foreground)",
            strokeWidth: 1.5,
            inset: 2,
            radius: 4,
          }
        ),
      ],
      scales: {
        x: {
          scale: scaleBand<string>().domain(WEEKDAYS).padding(0),
          axis: { ticks: { format: (w: string) => w.slice(0, 1) } },
        },
        y: { scale: scaleBand<string>().domain(weeks).padding(0), axis: false },
      },
      color: {
        domain: ["none", "l0", "l1", "l2", "l3", "future"],
        range: [
          "var(--muted)",
          ...HEAT,
          "color-mix(in oklch, var(--muted) 45%, transparent)",
        ],
      },
      tooltip: {
        use: tooltip,
        format: (point) =>
          point.datum.future
            ? `${monthName(view.month)} ${point.datum.day}`
            : `${monthName(view.month)} ${point.datum.day}: ${point.datum.out ? formatPeso(point.datum.out) : "nothing spent"}`,
      },
    })
  }, [view])

  return (
    <Chart
      definition={definition}
      height={230}
      initialWidth={360}
      ariaLabel={`Calendar of spending per day in ${monthName(view.month)}`}
      className="goat-chart"
    />
  )
}

/** The scale legend for the heatmap: less to more. */
export function HeatLegend() {
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      Less
      <span className="size-2.5 rounded-sm bg-muted" />
      {HEAT.map((fill) => (
        <span
          key={fill}
          className="size-2.5 rounded-sm"
          style={{ background: fill }}
        />
      ))}
      More
    </span>
  )
}

/** Money in and out per month, side by side, over the trend window. */
export function CashFlowChart({ trend }: { trend: TrendView }) {
  const definition = useMemo(() => {
    const rows = trend.months.flatMap((m) => {
      const label = monthName(m.month).slice(0, 3)
      return [
        { month: m.month, label, side: "In", value: m.in },
        { month: m.month, label, side: "Out", value: m.out },
      ]
    })
    const byMonth = new Map(trend.months.map((m) => [m.month, m]))
    return defineChart({
      marks: [
        barY(rows, {
          x: "label",
          y: "value",
          color: "side",
          layout: group({ padding: 0.15 }),
          radius: { end: 4 },
          maxThickness: 18,
        }),
        ruleY([0]),
      ],
      scales: {
        x: { scale: () => scaleBand<string>().padding(0.3) },
        y: { scale: scaleLinear, nice: true, grid: true, axis: moneyAxis },
      },
      color: {
        domain: ["In", "Out"],
        range: ["var(--income)", "var(--expense)"],
      },
      tooltip: {
        use: tooltip,
        format: (point) => {
          const m = byMonth.get(point.datum.month)
          if (!m) return ""
          const net = m.in - m.out
          return [
            monthName(m.month),
            `In: ${formatPeso(m.in)}`,
            `Out: ${formatPeso(m.out)}`,
            `Net: ${formatPeso(net, { sign: true })}`,
          ].join("\n")
        },
      },
    })
  }, [trend])

  return (
    <Chart
      definition={definition}
      height={240}
      initialWidth={360}
      ariaLabel="Money in and out per month over the last six months"
      className="goat-chart"
    />
  )
}

/** Six months of spending, stacked by the top categories, then Other. */
export function TrendChart({ trend }: { trend: TrendView }) {
  const definition = useMemo(() => {
    const colors = seriesColors(trend.series)
    const order = colors.ordered(STACK_ORDER)
    const rows = trend.stacks
      .filter((s) => s.out > 0)
      .map((s) => ({ ...s, label: monthName(s.month).slice(0, 3) }))
      .toSorted((a, b) => order.indexOf(a.category) - order.indexOf(b.category))
    return defineChart({
      marks: [
        barY(rows, {
          x: "label",
          y: "out",
          color: "category",
          maxThickness: 24,
          radius: { end: 4 },
          // The surface gap between stacked segments.
          stroke: SURFACE,
          strokeWidth: 2,
        }),
        ruleY([0]),
      ],
      scales: {
        x: { scale: () => scaleBand<string>().padding(0.3) },
        y: { scale: scaleLinear, nice: true, grid: true, axis: moneyAxis },
      },
      color: { domain: order, range: order.map((name) => colors.color(name)) },
      focus: "group-x",
      tooltip: {
        use: tooltip,
        formatGroup: (points) => {
          const month = points[0]?.datum.month ?? ""
          const total = points.reduce((sum, p) => sum + p.datum.out, 0)
          return [
            `${monthName(month)} · ${formatPeso(total)}`,
            // Same order as the legend, not the stack's top-down order.
            ...points
              .toSorted(
                (a, b) =>
                  order.indexOf(a.datum.category) -
                  order.indexOf(b.datum.category)
              )
              .map((p) => `${p.datum.category}: ${formatPeso(p.datum.out)}`),
          ].join("\n")
        },
      },
    })
  }, [trend])

  return (
    <Chart
      definition={definition}
      height={240}
      initialWidth={720}
      ariaLabel="Spending over the last six months by category"
      className="goat-chart"
    />
  )
}
