import { ArrowLeftRightIcon } from "lucide-react"
import { formatPeso } from "@workspace/core/money"
import { CoinMark } from "@workspace/ui/components/brand"
import { cn } from "@workspace/ui/lib/utils"
import { capitalize, dayLabel, iouLabel, transferLabel } from "@/lib/format"
import type { LedgerTxn, MonthView } from "@/server/ledger"

export function Feed({
  view,
  onSelect,
}: {
  view: MonthView
  onSelect: (txn: LedgerTxn) => void
}) {
  if (!view.transactions.length)
    return <EmptyFeed isCurrent={view.month === view.today.slice(0, 7)} />

  const days = new Map<string, LedgerTxn[]>()
  for (const t of view.transactions) {
    const list = days.get(t.localDate) ?? []
    list.push(t)
    days.set(t.localDate, list)
  }

  return (
    <section aria-label="Activity" className="flex flex-col gap-6">
      {[...days].map(([date, txns]) => {
        const out = txns
          .filter((t) => t.kind === "expense")
          .reduce((sum, t) => sum - t.amount, 0)
        return (
          <div key={date} className="flex flex-col gap-1">
            <h3 className="flex items-baseline justify-between px-1 text-xs font-medium text-muted-foreground">
              <span>{dayLabel(date, view.today)}</span>
              {out > 0 && <span className="figure">{formatPeso(-out)}</span>}
            </h3>
            <ul className="flex flex-col">
              {txns.map((t) => (
                <li key={t.id}>
                  <TransactionRow txn={t} onSelect={onSelect} />
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </section>
  )
}

function TransactionRow({
  txn,
  onSelect,
}: {
  txn: LedgerTxn
  onSelect: (txn: LedgerTxn) => void
}) {
  const optimistic = txn.id.startsWith("optimistic:")
  const iou = txn.person
    ? iouLabel(txn.kind, txn.amount, txn.person.name)
    : null
  const transfer = txn.kind === "transfer"
  const quiet = Boolean(iou) || transfer
  const income = txn.amount > 0 && !quiet
  const title =
    capitalize(txn.description) ||
    txn.category?.name ||
    (transfer ? "Transfer" : "Untitled")

  return (
    <button
      type="button"
      disabled={optimistic}
      onClick={() => onSelect(txn)}
      className="flex w-full items-center gap-3 rounded-xl px-1 py-2.5 text-left transition-[background-color,transform] duration-150 ease-out active:scale-[0.99] active:bg-muted disabled:opacity-60 [@media(hover:hover)]:hover:bg-muted/60"
    >
      <span
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-lg"
      >
        {transfer ? (
          <ArrowLeftRightIcon className="size-4 text-muted-foreground" />
        ) : iou ? (
          "🤝"
        ) : (
          (txn.category?.emoji ?? (
            <CoinMark rim={false} className="size-5 text-muted-foreground" />
          ))
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{title}</span>
        <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
          {txn.status === "needs_review" && (
            <span className="flex items-center gap-1 text-bronze">
              <span aria-hidden className="size-1.5 rounded-full bg-bronze" />
              Check ·
            </span>
          )}
          <span className="truncate">
            {transfer
              ? transferLabel(txn)
              : (iou ?? txn.category?.name ?? "Uncategorized")}
            {txn.split ? ` · split ${txn.split} ways` : ""}
            {txn.recurring ? " · repeats" : ""}
            {!transfer && txn.account ? ` · ${txn.account.name}` : ""}
          </span>
        </span>
      </span>
      <span
        className={cn(
          "figure shrink-0 font-display text-xl",
          income && "text-income-foreground",
          txn.amount < 0 && !quiet && "text-expense-foreground",
          // IOUs and transfers aren't spending or income, so they stay quiet.
          quiet && "text-muted-foreground"
        )}
      >
        {transfer
          ? formatPeso(Math.abs(txn.amount))
          : formatPeso(txn.amount, { sign: txn.amount > 0 })}
      </span>
    </button>
  )
}

function EmptyFeed({ isCurrent }: { isCurrent: boolean }) {
  return (
    <section className="flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-10 text-center">
      <CoinMark className="size-10 text-muted-foreground" />
      {isCurrent ? (
        <>
          <p className="font-display text-2xl">Nothing logged yet.</p>
          <p className="text-sm text-muted-foreground">
            Type what you spent or received below, in your own words.
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">No activity this month.</p>
      )}
    </section>
  )
}
