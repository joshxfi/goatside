/**
 * Desktop charts, built with TanStack Charts. Colors come from the theme's
 * --chart-* tokens (mapped to --ts-chart-* in globals.css), so light and
 * dark mode work without rebuilding definitions.
 */
import { useMemo } from "react"
import { barY, defineChart, lineY, ruleY } from "@tanstack/charts"
import { crosshair } from "@tanstack/charts/crosshair"
import { Chart } from "@tanstack/charts/react"
import { scaleBand } from "@tanstack/charts/scales/band"
import { scaleLinear } from "@tanstack/charts/scales/linear"
import { tooltip } from "@tanstack/charts/tooltip"
import { formatPeso, formatPesoCompact } from "@workspace/core/money"
import { monthName } from "@/lib/format"
import type { MonthView, TrendView } from "@/server/ledger"

/** Category colors, in series order; the last is for "Other". */
export const SERIES_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--muted-foreground)",
]

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
 * This month's running total against last month's, day by day. Answers
 * "am I spending faster than last month?" at a glance.
 */
export function PaceChart({ view }: { view: MonthView }) {
  const isCurrent = view.month === view.today.slice(0, 7)
  const todayDay = Number(view.today.slice(8, 10))
  const current = monthName(view.month)
  const previous = monthName(view.previous.month)

  const definition = useMemo(() => {
    const thisMonth = cumulative(view.daily.map((d) => d.out))
      .map((total, i) => ({ day: i + 1, total, series: current }))
      .filter((d) => !isCurrent || d.day <= todayDay)
    const lastMonth = cumulative(view.previous.daily).map((total, i) => ({
      day: i + 1,
      total,
      series: previous,
    }))

    return defineChart({
      marks: [
        lineY(lastMonth, {
          x: "day",
          y: "total",
          stroke: "var(--silver)",
          strokeWidth: 2,
          strokeDasharray: "4 4",
        }),
        lineY(thisMonth, {
          x: "day",
          y: "total",
          stroke: "var(--foreground)",
          strokeWidth: 2.5,
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
          return lines.join("\n")
        },
      },
    })
  }, [view, isCurrent, todayDay, current, previous])

  return (
    <Chart
      definition={definition}
      height={240}
      initialWidth={720}
      ariaLabel={`Running total of spending in ${current} compared with ${previous}`}
      className="goat-chart"
    />
  )
}

/** Spending per day, with today drawn in ink and the rest in silver. */
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
            d.date === view.today ? "var(--foreground)" : "var(--silver)",
          radius: { end: 3 },
          inset: 1,
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
      height={290}
      initialWidth={720}
      ariaLabel={`Spending per day in ${monthName(view.month)}`}
      className="goat-chart"
    />
  )
}

/** Six months of spending, stacked by top category. */
export function TrendChart({ trend }: { trend: TrendView }) {
  const definition = useMemo(() => {
    const rows = trend.stacks.map((s) => ({
      ...s,
      label: monthName(s.month).slice(0, 3),
    }))
    return defineChart({
      marks: [
        barY(rows, {
          x: "label",
          y: "out",
          color: "category",
          inset: 4,
          maxThickness: 56,
        }),
        ruleY([0]),
      ],
      scales: {
        x: { scale: () => scaleBand<string>().padding(0.25) },
        y: { scale: scaleLinear, nice: true, grid: true, axis: moneyAxis },
      },
      color: {
        domain: trend.series,
        range: trend.series.map((name, i) =>
          name === "Other"
            ? "var(--muted-foreground)"
            : (SERIES_COLORS[i] ?? "var(--muted-foreground)")
        ),
      },
      focus: "group-x",
      tooltip: {
        use: tooltip,
        formatGroup: (points) => {
          const month = points[0]?.datum.month ?? ""
          const total = points.reduce((sum, p) => sum + p.datum.out, 0)
          return [
            `${monthName(month)} · ${formatPeso(total)}`,
            ...points
              .filter((p) => p.datum.out > 0)
              .map((p) => `${p.datum.category}: ${formatPeso(p.datum.out)}`),
          ].join("\n")
        },
      },
    })
  }, [trend])

  return (
    <Chart
      definition={definition}
      height={260}
      initialWidth={720}
      ariaLabel="Spending over the last six months by category"
      className="goat-chart"
    />
  )
}
