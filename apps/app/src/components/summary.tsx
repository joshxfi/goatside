import { formatPeso } from "@workspace/core/money"
import { cn } from "@workspace/ui/lib/utils"
import { Figure } from "@/components/motion"
import { monthName } from "@/lib/format"
import type { MonthView } from "@/server/ledger"

export function Summary({ view }: { view: MonthView }) {
  const { totals, previous, month, today } = view
  const isCurrent = month === today.slice(0, 7)
  const diff = totals.out - previous.outToDate
  const showPace = previous.hasData && totals.out > 0

  return (
    <section aria-label="Month summary" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Spent</span>
        <span className="figure font-display text-6xl leading-none tracking-tight text-expense-foreground">
          <Figure value={totals.out} />
        </span>
        {showPace && (
          <p className="text-sm text-muted-foreground">
            <span
              className={cn(
                "font-medium",
                diff <= 0 ? "text-income-foreground" : "text-expense-foreground"
              )}
            >
              {formatPeso(Math.abs(diff))} {diff <= 0 ? "less" : "more"}
            </span>{" "}
            than {isCurrent ? "this point in" : ""} {monthName(previous.month)}
          </p>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-2">
        <Stat label="In" value={<Figure value={totals.in} />} tone="income" />
        <Stat
          label="Net"
          value={<Figure value={totals.net} sign />}
          tone={totals.net >= 0 ? "income" : "expense"}
        />
      </dl>
    </section>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: React.ReactNode
  tone: "income" | "expense"
}) {
  return (
    <div className="rounded-2xl border bg-card px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "figure font-display text-2xl leading-tight",
          tone === "income"
            ? "text-income-foreground"
            : "text-expense-foreground"
        )}
      >
        {value}
      </dd>
    </div>
  )
}
