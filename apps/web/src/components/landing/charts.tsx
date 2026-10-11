/**
 * The app's overview charts (apps/app/src/components/charts.tsx), drawn from
 * sample months instead of a ledger. Same TanStack Charts definitions, theme
 * tokens and mark specs, so the preview looks like the real dashboard.
 */
import { useMemo } from "react"
import { barY, cell, defineChart, lineY, ruleY } from "@tanstack/charts"
import { crosshair } from "@tanstack/charts/crosshair"
import { pie, polar, radialArc } from "@tanstack/charts/polar"
import { Chart } from "@tanstack/charts/react"
import { scaleBand } from "@tanstack/charts/scales/band"
import { scaleLinear } from "@tanstack/charts/scales/linear"
import { tooltip } from "@tanstack/charts/tooltip"
import { formatMoney, formatMoneyCompact } from "@workspace/core/money"
import {
  RANKED,
  SAMPLE_MONTHS,
  type SampleMonth,
  monthName,
  projection,
} from "@/lib/demo/sample-months"

/*
 * Category colors, as in the app (lib/series.ts): the top four categories by
 * six-month spending get the four validated hues, the rest fold into Other.
 * Stacks draw 1 2 3 4 and rings 1 2 4 3, so blue and violet never touch.
 */
export const OTHER = "Other"
const SLOTS = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
]
const NAMED = RANKED.slice(0, SLOTS.length)
export const colorOf = (name: string) =>
  SLOTS[NAMED.indexOf(name)] ?? "var(--series-other)"
const STACK_ORDER = [...NAMED, OTHER]
const RING_ORDER = [NAMED[0], NAMED[1], NAMED[3], NAMED[2], OTHER].filter(
  (name): name is string => Boolean(name)
)

/** The card's own color, for the gaps between touching segments. */
const SURFACE = "var(--card)"

const moneyAxis = {
  ticks: { count: 4, format: (value: number) => formatMoneyCompact(value) },
}

const cumulative = (values: number[]) =>
  values.reduce<number[]>(
    (totals, value) => [...totals, (totals.at(-1) ?? 0) + value],
    []
  )

function previousOf(view: SampleMonth) {
  const i = SAMPLE_MONTHS.findIndex((m) => m.month === view.month)
  return SAMPLE_MONTHS[i - 1] ?? null
}

/** This month's running total against last month's, with a projection. */
export function PaceChart({ view }: { view: SampleMonth }) {
  const previous = previousOf(view)
  const current = monthName(view.month)
  const before = previous ? monthName(previous.month) : ""

  const definition = useMemo(() => {
    const lastDay = Number(view.today.slice(8, 10))
    const thisMonth = cumulative(view.daily.map((d) => d.out))
      .map((total, i) => ({ day: i + 1, total }))
      .filter((d) => d.day <= lastDay)
    const lastMonth = previous
      ? cumulative(previous.daily.map((d) => d.out)).map((total, i) => ({
          day: i + 1,
          total,
        }))
      : []
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
        format: (point) => {
          const day = point.datum.day
          const lines = [`Day ${day}`]
          const now = thisMonth[day - 1]
          if (now) lines.push(`${current}: ${formatMoney(now.total)}`)
          const then = lastMonth[day - 1]
          if (then) lines.push(`${before}: ${formatMoney(then.total)}`)
          if (ahead && day === ahead.days) {
            lines.push(`Projected: ${formatMoney(ahead.total)}`)
          }
          return lines.join("\n")
        },
      },
    })
  }, [view, previous, current, before])

  return (
    <Chart
      definition={definition}
      height={260}
      initialWidth={720}
      ariaLabel={`Running total of spending in ${current} compared with ${before}`}
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

/** A month's spending as the top four categories plus Other, in ring order. */
export function spendingSlices(view: SampleMonth): Slice[] {
  const byName = new Map(view.byCategory.map((c) => [c.name, c]))
  const named = RING_ORDER.filter((name) => name !== OTHER).flatMap((name) => {
    const category = byName.get(name)
    return category && category.out > 0
      ? [{ ...category, color: colorOf(name) }]
      : []
  })
  const other = view.byCategory
    .filter((c) => !NAMED.includes(c.name))
    .reduce((sum, c) => sum + c.out, 0)
  return other > 0
    ? [...named, { name: OTHER, emoji: "·", out: other, color: colorOf(OTHER) }]
    : named
}

/** Part-to-whole: a donut with the total in its center. */
export function SpendingDonut({
  slices,
  total,
  size = 200,
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
          return `${point.datum.name}: ${formatMoney(point.datum.out)} (${share}%)`
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
        ariaLabel="Spending by category"
        className="goat-chart"
      />
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-xs text-muted-foreground">Spent</span>
        <span className="figure font-display text-3xl leading-none">
          {formatMoneyCompact(total)}
        </span>
      </div>
    </div>
  )
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

/** One hue, stronger for bigger days. Mixed in oklab so the steps stay red. */
const HEAT = [25, 45, 70, 100].map(
  (pct) => `color-mix(in oklab, var(--expense) ${pct}%, var(--card))`
)

/** The month as a calendar, one cell per day, shaded by spending. */
export function CalendarHeatmap({ view }: { view: SampleMonth }) {
  const definition = useMemo(() => {
    const first = new Date(`${view.month}-01T00:00:00Z`).getUTCDay()
    const offset = (first + 6) % 7 // Monday-first
    const sorted = view.daily
      .map((d) => d.out)
      .filter((out) => out > 0)
      .toSorted((a, b) => a - b)
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
    const isCurrent = view.today < view.daily.at(-1)!.date

    return defineChart({
      marks: [
        cell(rows, {
          x: "weekday",
          y: "week",
          color: "level",
          inset: 2,
          radius: 4,
        }),
        cell(
          rows.filter((r) => isCurrent && r.date === view.today),
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
            : `${monthName(view.month)} ${point.datum.day}: ${point.datum.out ? formatMoney(point.datum.out) : "nothing spent"}`,
      },
    })
  }, [view])

  return (
    <Chart
      definition={definition}
      height={210}
      initialWidth={320}
      ariaLabel={`Calendar of spending per day in ${monthName(view.month)}`}
      className="goat-chart"
    />
  )
}

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

/** Six months of spending, stacked by the top categories, then Other. */
export function TrendChart({ selected }: { selected: string }) {
  const definition = useMemo(() => {
    const rows = SAMPLE_MONTHS.flatMap((m) => {
      const label = monthName(m.month).slice(0, 3)
      const other = m.byCategory
        .filter((c) => !NAMED.includes(c.name))
        .reduce((sum, c) => sum + c.out, 0)
      return [
        ...NAMED.map((name) => ({
          month: m.month,
          label,
          category: name,
          out: m.byCategory.find((c) => c.name === name)?.out ?? 0,
        })),
        { month: m.month, label, category: OTHER, out: other },
      ]
    })
      .filter((r) => r.out > 0)
      .toSorted(
        (a, b) =>
          STACK_ORDER.indexOf(a.category) - STACK_ORDER.indexOf(b.category)
      )

    return defineChart({
      marks: [
        barY(rows, {
          x: "label",
          y: "out",
          // The month you're looking at at full strength, the rest faded.
          fill: (d) =>
            d.month === selected
              ? colorOf(d.category)
              : `color-mix(in oklab, ${colorOf(d.category)} 40%, var(--card))`,
          maxThickness: 24,
          radius: { end: 4 },
          stroke: SURFACE,
          strokeWidth: 2,
        }),
        ruleY([0]),
      ],
      scales: {
        x: { scale: () => scaleBand<string>().padding(0.3) },
        y: { scale: scaleLinear, nice: true, grid: true, axis: moneyAxis },
      },
      focus: "group-x",
      tooltip: {
        use: tooltip,
        formatGroup: (points) => {
          const month = points[0]?.datum.month ?? ""
          const total = points.reduce((sum, p) => sum + p.datum.out, 0)
          return [
            `${monthName(month)} · ${formatMoney(total)}`,
            ...points
              .toSorted(
                (a, b) =>
                  STACK_ORDER.indexOf(a.datum.category) -
                  STACK_ORDER.indexOf(b.datum.category)
              )
              .map((p) => `${p.datum.category}: ${formatMoney(p.datum.out)}`),
          ].join("\n")
        },
      },
    })
  }, [selected])

  return (
    <Chart
      definition={definition}
      height={220}
      initialWidth={480}
      ariaLabel="Spending over six months by category"
      className="goat-chart"
    />
  )
}

/** Legend for the stacked trend: the four named categories, then Other. */
export function TrendLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      {STACK_ORDER.map((name) => (
        <li key={name} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-2.5 rounded-sm"
            style={{ background: colorOf(name) }}
          />
          {name}
        </li>
      ))}
    </ul>
  )
}
