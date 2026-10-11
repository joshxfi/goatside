import { useState } from "react"
import {
  ArrowLeftRightIcon,
  BanknoteIcon,
  CreditCardIcon,
  LandmarkIcon,
  type LucideIcon,
  SmartphoneIcon,
} from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import { cardBackground } from "@workspace/ui/lib/account-colors"
import { ACCOUNT_KIND_LABELS, type AccountKind } from "@workspace/core/accounts"
import { formatPeso } from "@workspace/core/money"
import { DEMO_ACCOUNTS, fileText } from "@/lib/demo/file-line"
import { TODAY } from "@/lib/demo/sample-months"
import type { DemoRow } from "@/lib/demo/file-line"
import { DemoCard, FeedRow } from "./ui"

const ICONS: Record<AccountKind, LucideIcon> = {
  bank: LandmarkIcon,
  ewallet: SmartphoneIcon,
  credit_card: CreditCardIcon,
  cash: BanknoteIcon,
}

const START: Record<string, number> = {
  gcash: 820000,
  bpi: 4850000,
  "bpi-card": -1268000,
  cash: 150000,
}
const CARD_LIMIT = 6000000

/** Each line filed once, by the same code as the hero's composer. */
const TRANSFERS = [
  "1000 cash in gcash from bpi",
  "3000 atm",
  "5000 pay bpi card from bpi",
].flatMap((line) => {
  const filed = fileText(line, TODAY)
  const row = filed.kind === "log" ? filed.rows[0] : undefined
  if (!row || row.icon !== "transfer") return []
  const [fromName, toName] = row.detail.split(" → ")
  const from = DEMO_ACCOUNTS.find((a) => a.name === fromName)?.id
  const to = DEMO_ACCOUNTS.find((a) => a.name === toName)?.id
  return from && to ? [{ line, row, from, to }] : []
})

/**
 * Accounts as the app draws them. Logging a transfer moves money between
 * two cards and leaves spending alone.
 */
export function AccountsDemo() {
  const [balances, setBalances] = useState(START)
  const [moved, setMoved] = useState<{ from: string; to: string } | null>(null)
  const [rows, setRows] = useState<DemoRow[]>([])

  function log(transfer: (typeof TRANSFERS)[number]) {
    const { from, to, row } = transfer
    setBalances((all) => ({
      ...all,
      [from]: (all[from] ?? 0) - row.amount,
      [to]: (all[to] ?? 0) + row.amount,
    }))
    setMoved({ from, to })
    setRows((all) =>
      [{ ...row, id: `${row.id}-${all.length}-${Date.now()}` }, ...all].slice(
        0,
        3
      )
    )
  }

  const total = Object.entries(balances).reduce((sum, [, b]) => sum + b, 0)

  return (
    <DemoCard className="flex flex-col gap-4 p-4 md:p-5">
      <div className="grid grid-cols-2 gap-2.5">
        {DEMO_ACCOUNTS.map((account) => {
          const balance = balances[account.id] ?? 0
          const card = account.kind === "credit_card"
          const Icon = ICONS[account.kind]
          const active = moved?.from === account.id || moved?.to === account.id
          return (
            <div
              key={account.id}
              className={cn(
                "relative flex aspect-[1.7] flex-col justify-between overflow-hidden rounded-2xl p-3.5 text-white shadow-sm ring-1 ring-black/5 transition-transform duration-200 ease-out ring-inset",
                active && "scale-[1.02]"
              )}
              style={{ background: cardBackground(account.color) }}
            >
              <div className="flex flex-col gap-0.5">
                <span className="flex items-center gap-1.5 text-xs text-white/75">
                  <Icon aria-hidden className="size-3.5" />
                  {ACCOUNT_KIND_LABELS[account.kind]}
                </span>
                <span className="font-medium">{account.name}</span>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="figure font-display text-2xl leading-none md:text-3xl">
                  {formatPeso(card ? -balance : balance)}
                  {card && (
                    <span className="ml-1 font-sans text-xs text-white/70">
                      owed
                    </span>
                  )}
                </span>
                {card && (
                  <span className="h-1 overflow-hidden rounded-full bg-white/20">
                    <span
                      className="block h-full rounded-full bg-white/80 transition-[width] duration-300 ease-out"
                      style={{ width: `${(-balance / CARD_LIMIT) * 100}%` }}
                    />
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex flex-col gap-1 px-1">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="text-muted-foreground">Net across accounts</span>
          <span className="figure font-display text-2xl">
            {formatPeso(total)}
          </span>
        </div>
        {moved && (
          <p className="enter-fade text-xs text-muted-foreground">
            A transfer moves money between your own accounts. Your net and your
            spending stay the same.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="px-1 text-sm text-muted-foreground">
          Log a transfer
        </span>
        <div className="flex flex-wrap gap-1.5">
          {TRANSFERS.map((transfer) => (
            <button
              key={transfer.line}
              type="button"
              // Only what the account has, and never more than a card owes.
              disabled={
                (balances[transfer.from] ?? 0) < transfer.row.amount ||
                (transfer.to === "bpi-card" &&
                  -(balances[transfer.to] ?? 0) < transfer.row.amount)
              }
              onClick={() => log(transfer)}
              className="flex h-8 items-center gap-1.5 rounded-full border bg-card px-3 font-mono text-xs text-muted-foreground transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.97] disabled:opacity-40 [@media(hover:hover)]:hover:bg-muted [@media(hover:hover)]:hover:text-foreground"
            >
              <ArrowLeftRightIcon aria-hidden className="size-3" />
              {transfer.line}
            </button>
          ))}
        </div>
      </div>

      {rows.length > 0 && (
        <ul className="flex flex-col border-t pt-1">
          {rows.map((row) => (
            <li key={row.id} className="enter-rise">
              <FeedRow row={row} today={TODAY} />
            </li>
          ))}
        </ul>
      )}
    </DemoCard>
  )
}
