import { useId } from "react"
import { formatPeso } from "@workspace/core/money"
import type { MonthView } from "@/server/ledger"

export function CategoryList({
  categories,
  total,
  bare,
}: {
  categories: MonthView["byCategory"]
  total: number
  /** Inside a card that already has a title. */
  bare?: boolean
}) {
  const headingId = useId()
  if (!categories.length) return null

  return (
    <section
      aria-labelledby={bare ? undefined : headingId}
      aria-label={bare ? "Spending by category" : undefined}
      className="flex flex-col gap-3"
    >
      {!bare && (
        <h2
          id={headingId}
          className="text-sm font-medium text-muted-foreground"
        >
          Where it went
        </h2>
      )}
      <ul className="flex flex-col gap-3">
        {categories.map((c) => {
          const share = total ? c.out / total : 0
          return (
            <li key={c.id ?? "none"} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="flex items-center gap-2">
                  <span aria-hidden>{c.emoji}</span>
                  {c.name}
                </span>
                <span className="figure flex items-baseline gap-2">
                  <span className="text-xs text-muted-foreground">
                    {Math.round(share * 100)}%
                  </span>
                  {formatPeso(c.out)}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-expense/60"
                  style={{ width: `${Math.max(share * 100, 1)}%` }}
                />
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
