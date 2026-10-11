import { Link } from "@tanstack/react-router"
import { formatPeso } from "@workspace/core/money"
import { ScrollArea, ScrollBar } from "@workspace/ui/components/scroll-area"
import { AccountCard } from "@/components/account-card"
import { owedOn } from "@/lib/accounts"
import type { MonthView } from "@/server/ledger"

/**
 * Balances at a glance: a row of small cards that scrolls sideways (on
 * every screen, so a seventh account doesn't wrap alone), with the total
 * across them. Hidden until there's an account.
 */
export function AccountsStrip({ view }: { view: MonthView }) {
  const accounts = view.accounts
  if (!accounts.length) return null
  const net = accounts.reduce(
    (sum, a) =>
      sum + (a.kind === "credit_card" ? -owedOn(a.balance) : a.balance),
    0
  )
  return (
    <section aria-labelledby="accounts-strip" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2
          id="accounts-strip"
          className="text-sm font-medium text-muted-foreground"
        >
          Accounts{" "}
          <span className="figure font-normal">· {formatPeso(net)} in all</span>
        </h2>
        <Link
          to="/accounts"
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          See all
        </Link>
      </div>
      {/* The viewport is what scrolls, so snapping goes on it. */}
      <ScrollArea className="group/strip -mx-4 *:data-[slot=scroll-area-viewport]:snap-x *:data-[slot=scroll-area-viewport]:scroll-px-4 lg:mx-0 lg:*:data-[slot=scroll-area-viewport]:scroll-px-0">
        <ul className="flex gap-3 px-4 pb-3 lg:px-0">
          {accounts.map((a) => (
            <li key={a.id} className="w-44 shrink-0 snap-start lg:w-52">
              <Link
                to="/accounts/$accountId"
                params={{ accountId: a.id }}
                className="block rounded-2xl transition-transform duration-150 ease-out outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98]"
              >
                <AccountCard
                  account={a}
                  isDefault={a.id === view.defaultAccountId}
                  size="sm"
                />
              </Link>
            </li>
          ))}
        </ul>
        {/* Phones swipe without a bar; on desktop a slim one shows on hover. */}
        <ScrollBar
          orientation="horizontal"
          className="hidden opacity-0 transition-opacity duration-150 group-hover/strip:opacity-100 data-scrolling:opacity-100 *:data-[slot=scroll-area-thumb]:bg-muted-foreground/40 *:data-[slot=scroll-area-thumb]:transition-colors *:data-[slot=scroll-area-thumb]:hover:bg-muted-foreground/60 lg:flex data-horizontal:h-1.5"
        />
      </ScrollArea>
    </section>
  )
}
