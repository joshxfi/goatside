import { formatPeso } from "@workspace/core/money"
import { cn } from "@workspace/ui/lib/utils"
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
        <span className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
          Spent
        </span>
        <span className="figure font-display text-6xl leading-none tracking-tight">
          {formatPeso(totals.out)}
        </span>
        {showPace && (
          <p className="text-sm text-muted-foreground">
            <span
              className={cn(
                "font-medium",
                diff <= 0 ? "text-gold-foreground" : "text-foreground"
              )}
            >
              {formatPeso(Math.abs(diff))} {diff <= 0 ? "less" : "more"}
            </span>{" "}
            than {isCurrent ? "this point in" : ""} {monthName(previous.month)}
          </p>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-2">
        <Stat label="In" value={formatPeso(totals.in)} tone="gold" />
        <Stat
          label="Net"
          value={formatPeso(totals.net, { sign: true })}
          tone={totals.net >= 0 ? "gold" : "plain"}
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
  value: string
  tone: "gold" | "plain"
}) {
  return (
    <div className="rounded-2xl border bg-card px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "figure font-display text-2xl leading-tight",
          tone === "gold" && "text-gold-foreground"
        )}
      >
        {value}
      </dd>
    </div>
  )
}
