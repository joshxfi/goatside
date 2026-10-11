/*
 * Category colors. A category keeps its color everywhere (donut, stacks,
 * lists): slots are assigned by six-month spending rank, so they're stable
 * across months in that window. Past four, categories fold into "Other".
 *
 * The four hues were validated with the dataviz palette checker against the
 * card surface in both modes. Only blue↔violet fails as a pair, so each
 * chart draws segments in an order where they never touch:
 * - stacks:  1 2 3 4 (blue, yellow, magenta, violet). Every touching pair
 *   passes, including when one category is missing that month.
 * - rings:   1 2 4 3 (blue, yellow, violet, magenta), so the wrap-around
 *   back to blue lands on magenta, not violet.
 */

export const OTHER = "Other"

const SLOTS = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
]
export const OTHER_COLOR = "var(--series-other)"

export const MAX_SERIES = SLOTS.length

/** Slot indexes in drawing order for each chart form. */
export const STACK_ORDER = [0, 1, 2, 3]
export const RING_ORDER = [0, 1, 3, 2]

/** `series` is the ranked category names (top first), as trendView returns. */
export function seriesColors(series: string[]) {
  const named = series.filter((name) => name !== OTHER).slice(0, MAX_SERIES)
  const colors = new Map(
    named.map((name, i) => [name, SLOTS[i] ?? OTHER_COLOR])
  )
  return {
    named,
    color: (name: string) => colors.get(name) ?? OTHER_COLOR,
    /** Named series in this form's drawing order, then Other. */
    ordered: (order: number[]) => [
      ...order.flatMap((i) => (named[i] ? [named[i]] : [])),
      OTHER,
    ],
  }
}
