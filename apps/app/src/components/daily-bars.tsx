import { formatPeso } from "@workspace/core/money"
import { cn } from "@workspace/ui/lib/utils"
import { dayLabel } from "@/lib/format"
import type { MonthView } from "@/server/ledger"

/** Spending per day of the month. Interim view until TanStack Charts (M4). */
export function DailyBars({
  daily,
  today,
}: {
  daily: MonthView["daily"]
  today: string
}) {
  const max = Math.max(...daily.map((d) => d.out), 1)
  const first = daily[0]?.date
  const last = daily.at(-1)?.date

  return (
    <section aria-label="Daily spending" className="flex flex-col gap-2">
      <ul className="flex h-20 items-end gap-[3px]">
        {daily.map((d) => {
          const future = d.date > today
          const label = `${dayLabel(d.date, today)}: ${formatPeso(d.out)} spent`
          return (
            <li
              key={d.date}
              aria-label={label}
              title={label}
              className="flex h-full flex-1 items-end"
            >
              <div
                className={cn(
                  "w-full rounded-[3px] transition-[height] duration-300 ease-out motion-reduce:transition-none",
                  future ? "bg-muted" : d.out ? "bg-expense/70" : "bg-border",
                  d.date === today && "bg-expense"
                )}
                style={{
                  height: d.out
                    ? `${Math.max((d.out / max) * 100, 6)}%`
                    : "3px",
                }}
              />
            </li>
          )
        })}
      </ul>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{first && Number(first.slice(8))}</span>
        <span>{last && Number(last.slice(8))}</span>
      </div>
    </section>
  )
}
