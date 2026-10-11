import { formatPeso } from "@workspace/core/money"
import { cn } from "@workspace/ui/lib/utils"
import { Figure } from "@/components/motion"
import {
  ACCOUNT_KIND_LABELS,
  type AccountKind,
  KIND_ICONS,
  cardBackground,
  owedOn,
} from "@/lib/accounts"

export interface CardAccount {
  name: string
  kind: AccountKind
  color: string
  last4: string | null
  creditLimit: number | null
  balance: number
}

/** What the big number on a card says, and what to call it. */
export function balanceText(account: Pick<CardAccount, "kind" | "balance">) {
  const shown =
    account.kind === "credit_card"
      ? account.balance > 0
        ? { label: "Credit", value: account.balance }
        : { label: "Owed", value: owedOn(account.balance) }
      : { label: "Balance", value: account.balance }
  return { ...shown, amount: formatPeso(shown.value) }
}

/**
 * An account as a card: its color and name, the balance (what's owed, for
 * a credit card), the last four digits, and for cards with a limit how much
 * of it is used.
 */
export function AccountCard({
  account,
  isDefault = false,
  size = "md",
  className,
}: {
  account: CardAccount
  isDefault?: boolean
  size?: "sm" | "md" | "lg"
  className?: string
}) {
  const Icon = KIND_ICONS[account.kind]
  const { label, value } = balanceText(account)
  const limit = account.kind === "credit_card" ? account.creditLimit : null
  const owed = owedOn(account.balance)
  const used = limit ? Math.min(1, owed / limit) : 0

  return (
    <div
      className={cn(
        "relative flex flex-col justify-between overflow-hidden rounded-2xl p-4 text-white shadow-sm ring-1 ring-black/5 ring-inset",
        size === "lg" && "aspect-[1.6] p-5",
        size === "md" && "aspect-[2.1] sm:aspect-[1.7]",
        size === "sm" && "aspect-[1.7] p-3.5",
        className
      )}
      style={{ background: cardBackground(account.color) }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-1.5 text-xs text-white/75">
            <Icon aria-hidden className="size-3.5" />
            {ACCOUNT_KIND_LABELS[account.kind]}
          </span>
          <span
            className={cn(
              "truncate font-medium",
              size === "lg" ? "text-xl" : "text-base"
            )}
          >
            {account.name}
          </span>
        </div>
        {isDefault && (
          <span className="shrink-0 rounded-full bg-white/15 px-2 py-0.5 text-[11px] text-white/90">
            Default
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-end justify-between gap-3">
          <div className="flex min-w-0 flex-col">
            {size !== "sm" && (
              <span className="text-xs text-white/70">{label}</span>
            )}
            <span
              className={cn(
                "figure truncate font-display leading-none",
                size === "lg"
                  ? "text-5xl"
                  : size === "md"
                    ? "text-3xl"
                    : "text-2xl"
              )}
            >
              <Figure value={value} />
              {/* Small cards have no label above, so a card says it here. */}
              {size === "sm" && label !== "Balance" && (
                <span className="ml-1 font-sans text-xs text-white/70">
                  {label.toLowerCase()}
                </span>
              )}
            </span>
          </div>
          {account.last4 && size !== "sm" && (
            <span className="figure shrink-0 text-sm text-white/80">
              •••• {account.last4}
            </span>
          )}
        </div>
        {limit ? (
          <div className="flex flex-col gap-1">
            {/* The text below says the same; the bar is just the picture. */}
            <div
              aria-hidden
              className="h-1 overflow-hidden rounded-full bg-white/20"
            >
              <div
                className="h-full rounded-full bg-white/85"
                style={{ width: `${used * 100}%` }}
              />
            </div>
            <span
              className={cn(
                "figure text-[11px] text-white/70",
                size === "sm" && "sr-only"
              )}
            >
              {formatPeso(Math.max(0, limit - owed))} available of{" "}
              {formatPeso(limit)}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
