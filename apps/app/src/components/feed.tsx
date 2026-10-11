import { useState } from "react"
import { ArrowLeftRightIcon, CloudOffIcon } from "lucide-react"
import { formatPeso } from "@workspace/core/money"
import { CoinMark } from "@workspace/ui/components/brand"
import { toast } from "@workspace/ui/components/sonner"
import { cn } from "@workspace/ui/lib/utils"
import { AnimatePresence, CollapseItem } from "@/components/motion"
import { discard, pendingOf, useOnline, usePending } from "@/lib/outbox"
import { capitalize, dayLabel, iouLabel, transferLabel } from "@/lib/format"
import type { LedgerTxn, MonthView } from "@/server/ledger"

export function Feed({
  view,
  onSelect,
}: {
  view: MonthView
  onSelect: (txn: LedgerTxn) => void
}) {
  const keyOf = useRowKeys(view.transactions)
  if (!view.transactions.length)
    return <EmptyFeed isCurrent={view.month === view.today.slice(0, 7)} />

  const days = new Map<string, LedgerTxn[]>()
  for (const t of view.transactions) {
    const list = days.get(t.localDate) ?? []
    list.push(t)
    days.set(t.localDate, list)
  }

  // New entries grow in and deleted ones collapse out. Keyed by month, so
  // switching months swaps the list instead of animating every row.
  return (
    <section key={view.month} aria-label="Activity" className="-mb-6">
      <AnimatePresence initial={false}>
        {[...days].map(([date, txns]) => {
          const out = txns
            .filter((t) => t.kind === "expense")
            .reduce((sum, t) => sum - t.amount, 0)
          return (
            <CollapseItem as="div" key={date}>
              <div className="flex flex-col gap-1 pb-6">
                <h3 className="flex items-baseline justify-between px-1 text-xs font-medium text-muted-foreground">
                  <span>{dayLabel(date, view.today)}</span>
                  {out > 0 && (
                    <span className="figure">{formatPeso(-out)}</span>
                  )}
                </h3>
                <ul className="flex flex-col">
                  <AnimatePresence initial={false}>
                    {txns.map((t) => (
                      <CollapseItem key={keyOf(t)}>
                        <TransactionRow txn={t} onSelect={onSelect} />
                      </CollapseItem>
                    ))}
                  </AnimatePresence>
                </ul>
              </div>
            </CollapseItem>
          )
        })}
      </AnimatePresence>
    </section>
  )
}

const isOptimistic = (t: LedgerTxn) => t.id.startsWith("optimistic:")

/**
 * Row keys that survive the swap from an optimistic row to the saved one,
 * so a just-logged entry stays put instead of collapsing and growing back.
 * A saved row takes the key of a vanished optimistic row with the same
 * amount and date.
 */
export function useRowKeys(txns: LedgerTxn[]) {
  const [seen, setSeen] = useState({ txns, keys: new Map<string, string>() })
  let { keys } = seen
  if (seen.txns !== txns) {
    const gone = seen.txns.filter(
      (o) => isOptimistic(o) && !txns.some((t) => t.id === o.id)
    )
    keys = new Map()
    for (const t of txns) {
      let key = seen.keys.get(t.id) ?? t.id
      if (!isOptimistic(t) && !seen.keys.has(t.id)) {
        const index = gone.findIndex(
          (o) => o.amount === t.amount && o.localDate === t.localDate
        )
        if (index !== -1) key = gone.splice(index, 1)[0]?.id ?? key
      }
      keys.set(t.id, key)
    }
    setSeen({ txns, keys })
  }
  return (t: LedgerTxn) => keys.get(t.id) ?? t.id
}

function TransactionRow({
  txn,
  onSelect,
}: {
  txn: LedgerTxn
  onSelect: (txn: LedgerTxn) => void
}) {
  const optimistic = isOptimistic(txn)
  const online = useOnline()
  const entry = pendingOf(txn, usePending())
  // Not just on its way: no signal, or the server couldn't take it yet.
  const waiting = Boolean(entry && !entry.savedAs && (!online || entry.tries))
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
      disabled={optimistic && !waiting}
      onClick={() => {
        if (!entry) return onSelect(txn)
        toast(`“${entry.text}” is waiting to sync.`, {
          description: online
            ? "Goatside will keep trying."
            : "It’s saved on this phone and syncs once you’re back online.",
          action: { label: "Remove", onClick: () => discard(entry.id) },
        })
      }}
      className="flex w-full items-center gap-3 rounded-xl px-1 py-2.5 text-left transition-[background-color,transform,opacity] duration-150 ease-out active:scale-[0.99] active:bg-muted disabled:opacity-60 [@media(hover:hover)]:hover:bg-muted/60"
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
          {waiting && (
            <span className="flex items-center gap-1 text-bronze">
              <CloudOffIcon aria-hidden className="size-3" />
              Waiting to sync ·
            </span>
          )}
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
