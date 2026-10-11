/**
 * Six months of made-up spending for the dashboard preview: everyday food
 * and rides, weekly groceries, bills and subscriptions that repeat, salary
 * on the 15th and the last day. Seeded, so every build draws the same months.
 * October is in progress, as if today were the 18th.
 */
import { addMonths, daysInMonth, weekdayOf } from "@workspace/core/dates"

export const CURRENT_MONTH = "2026-10"
export const TODAY = "2026-10-18"
const MONTHS = 6

export interface SampleCategory {
  name: string
  emoji: string
}

export const CATEGORIES: SampleCategory[] = [
  { name: "Food", emoji: "🍜" },
  { name: "Groceries", emoji: "🛒" },
  { name: "Transport", emoji: "🚕" },
  { name: "Bills", emoji: "🧾" },
  { name: "Subscriptions", emoji: "🔁" },
  { name: "Shopping", emoji: "🛍️" },
  { name: "Health", emoji: "💊" },
  { name: "Fun", emoji: "🎟️" },
]

export interface SampleMonth {
  month: string
  /** The last day counted: today for the current month, else the last day. */
  today: string
  /** Every day of the month; days after `today` spend nothing. */
  daily: { date: string; out: number }[]
  byCategory: (SampleCategory & { out: number })[]
  totals: { in: number; out: number }
  /** Spending that repeats every month (bills, subscriptions). */
  repeating: number
}

/** Mulberry32: small, seeded, good enough for made-up money. */
function random(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Pesos to centavos, rounded to the nearest ₱5 like real prices. */
const pesos = (value: number) => Math.round(value / 5) * 5 * 100

function buildMonth(month: string, seed: number): SampleMonth {
  const next = random(seed)
  const between = (low: number, high: number) => low + next() * (high - low)
  const chance = (p: number) => next() < p

  const days = daysInMonth(month)
  const today = month === CURRENT_MONTH ? TODAY : `${month}-${days}`
  const lastDay = Number(today.slice(8, 10))
  const spent = new Map(CATEGORIES.map((c) => [c.name, 0]))
  const daily: SampleMonth["daily"] = []
  let income = 0
  let repeating = 0

  for (let day = 1; day <= days; day++) {
    const date = `${month}-${String(day).padStart(2, "0")}`
    const weekday = weekdayOf(date)
    const weekend = weekday === 0 || weekday === 6
    const spend: [string, number][] = []

    if (day <= lastDay) {
      // Everyday food: coffee or lunch, sometimes a big dinner out.
      spend.push(["Food", pesos(between(140, 420))])
      if (chance(0.55)) spend.push(["Food", pesos(between(90, 260))])
      if (chance(weekend ? 0.45 : 0.12))
        spend.push(["Food", pesos(between(700, 1900))])

      if (!weekend) spend.push(["Transport", pesos(between(260, 480))])
      else if (chance(0.5)) spend.push(["Transport", pesos(between(150, 320))])

      if (weekday === 6) spend.push(["Groceries", pesos(between(1800, 3300))])
      else if (chance(0.15)) spend.push(["Groceries", pesos(between(350, 800))])

      if (chance(0.09)) spend.push(["Shopping", pesos(between(600, 2600))])
      if (chance(0.04)) spend.push(["Health", pesos(between(300, 1300))])
      if ((weekday === 5 || weekday === 6) && chance(0.4))
        spend.push(["Fun", pesos(between(450, 1500))])

      const bills: [number, string, number][] = [
        [3, "Subscriptions", 14900],
        [5, "Bills", pesos(between(2700, 3700))],
        [8, "Subscriptions", 54900],
        [12, "Bills", 169900],
        [14, "Subscriptions", 14900],
        [20, "Bills", pesos(between(380, 520))],
      ]
      for (const [on, name, amount] of bills) {
        if (on !== day) continue
        spend.push([name, amount])
        repeating += amount
      }

      if (day === 15 || day === days) income += 2500000
      if (day === 10 + (seed % 9)) income += pesos(between(8000, 18000))
    }

    let out = 0
    for (const [name, amount] of spend) {
      spent.set(name, (spent.get(name) ?? 0) + amount)
      out += amount
    }
    daily.push({ date, out })
  }

  const byCategory = CATEGORIES.map((c) => ({
    ...c,
    out: spent.get(c.name) ?? 0,
  }))
  return {
    month,
    today,
    daily,
    byCategory,
    totals: { in: income, out: daily.reduce((sum, d) => sum + d.out, 0) },
    repeating,
  }
}

/** May to October, oldest first. */
export const SAMPLE_MONTHS: SampleMonth[] = Array.from(
  { length: MONTHS },
  (_, i) => {
    const month = addMonths(CURRENT_MONTH, i - (MONTHS - 1))
    return buildMonth(month, 20 + i * 7)
  }
)

/** Categories ranked by six-month spending: the top four get colors. */
export const RANKED = CATEGORIES.map((c) => ({
  ...c,
  total: SAMPLE_MONTHS.reduce(
    (sum, m) => sum + (m.byCategory.find((b) => b.name === c.name)?.out ?? 0),
    0
  ),
}))
  .toSorted((a, b) => b.total - a.total)
  .map((c) => c.name)

/**
 * Where a month is heading: repeating charges count once, everyday
 * spending runs at its daily rate to month end. As in the app's overview.
 */
export function projection(view: SampleMonth) {
  if (view.month !== CURRENT_MONTH) return null
  const day = Number(view.today.slice(8, 10))
  const days = view.daily.length
  const everydayRate = Math.max(view.totals.out - view.repeating, 0) / day
  const total = view.totals.out + everydayRate * (days - day)
  return { day, days, total: Math.round(total / 10000) * 10000 }
}

const monthFormat = new Intl.DateTimeFormat("en-PH", {
  month: "long",
  timeZone: "UTC",
})

/** "October" for "2026-10". */
export const monthName = (month: string) =>
  monthFormat.format(new Date(`${month}-01T00:00:00Z`))
