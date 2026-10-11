import { useId, useState } from "react"
import { formatPeso, parseAmount } from "@workspace/core/money"
import { Button } from "@workspace/ui/components/button"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@workspace/ui/components/drawer"
import { Input } from "@workspace/ui/components/input"
import { cn } from "@workspace/ui/lib/utils"
import { AccountCard } from "@/components/account-card"
import {
  ACCOUNT_COLORS,
  ACCOUNT_KIND_LABELS,
  type AccountColor,
  type AccountKind,
  KIND_ICONS,
  colorName,
  swatch,
} from "@/lib/accounts"
import { useDesktop } from "@/lib/use-desktop"

export interface AccountFields {
  name: string
  kind: AccountKind
  color: AccountColor
  last4: string | null
  creditLimit: number | null
  aliases: string[]
  /** Only when adding: what it holds now (a card: negative is owed). */
  balance?: number
}

const KINDS = Object.keys(ACCOUNT_KIND_LABELS) as AccountKind[]

/** Opens from the right on desktop, from the bottom on phones. */
export function AccountDrawer({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: React.ReactNode
}) {
  const desktop = useDesktop()
  return (
    <Drawer
      open={open}
      onOpenChange={(next) => !next && onClose()}
      swipeDirection={desktop ? "right" : "down"}
    >
      <DrawerContent className={desktop ? "w-[28rem]" : undefined}>
        <div className="mx-auto flex w-full max-w-md flex-col gap-2 overflow-y-auto pb-[max(env(safe-area-inset-bottom),1.25rem)]">
          <DrawerHeader className="text-left">
            <DrawerTitle className="font-display text-3xl font-normal">
              {title}
            </DrawerTitle>
            {description && (
              <DrawerDescription>{description}</DrawerDescription>
            )}
          </DrawerHeader>
          <div className="px-4">{children}</div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}

/** Add or edit an account. The card preview updates as you type. */
export function AccountForm({
  initial,
  creating,
  pending,
  submitLabel,
  onSubmit,
}: {
  initial?: Partial<AccountFields>
  creating: boolean
  pending: boolean
  submitLabel: string
  onSubmit: (fields: AccountFields) => void
}) {
  const id = useId()
  const [name, setName] = useState(initial?.name ?? "")
  const [kind, setKind] = useState<AccountKind>(initial?.kind ?? "bank")
  const [color, setColor] = useState<AccountColor>(
    initial?.color ?? ACCOUNT_COLORS[1]
  )
  const [last4, setLast4] = useState(initial?.last4 ?? "")
  const [limit, setLimit] = useState(
    initial?.creditLimit ? String(initial.creditLimit / 100) : ""
  )
  const [balance, setBalance] = useState("")
  const [aliases, setAliases] = useState((initial?.aliases ?? []).join(", "))

  const card = kind === "credit_card"
  const limitValue = card && limit.trim() ? parseAmount(limit) : null
  const balanceValue = balance.trim() ? parseAmount(balance) : 0
  const signed = card ? -(balanceValue ?? 0) : (balanceValue ?? 0)
  const valid =
    name.trim().length > 0 &&
    (last4 === "" || /^\d{4}$/.test(last4)) &&
    (limit.trim() === "" || !card || (limitValue ?? 0) > 0) &&
    balanceValue !== null

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid) return
        onSubmit({
          name: name.trim(),
          kind,
          color,
          last4: last4 || null,
          creditLimit: card ? limitValue : null,
          aliases: aliases
            .split(",")
            .map((a) => a.trim())
            .filter(Boolean),
          ...(creating && { balance: signed }),
        })
      }}
    >
      <AccountCard
        account={{
          name: name.trim() || "New account",
          kind,
          color,
          last4: /^\d{4}$/.test(last4) ? last4 : null,
          creditLimit: limitValue,
          balance: creating ? signed : (initial?.balance ?? 0),
        }}
        className="mx-auto w-full max-w-xs"
      />

      <div className="flex flex-col gap-2">
        <label htmlFor={`${id}-name`} className="text-sm font-medium">
          Name
        </label>
        <Input
          id={`${id}-name`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          placeholder="GCash, BPI Savings, Cash…"
          autoComplete="off"
          className="h-11 text-base font-normal"
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Type</legend>
        <div className="grid grid-cols-2 gap-2">
          {KINDS.map((k) => {
            const Icon = KIND_ICONS[k]
            const active = k === kind
            return (
              <button
                key={k}
                type="button"
                aria-pressed={active}
                onClick={() => setKind(k)}
                className={cn(
                  "flex h-11 items-center gap-2 rounded-xl border px-3 text-sm transition-[background-color,transform] duration-150 ease-out active:scale-[0.97]",
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "bg-card [@media(hover:hover)]:hover:bg-muted"
                )}
              >
                <Icon aria-hidden className="size-4" />
                {ACCOUNT_KIND_LABELS[k]}
              </button>
            )
          })}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Color</legend>
        <div className="flex flex-wrap gap-2">
          {ACCOUNT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={c === color}
              aria-label={colorName(c)}
              title={colorName(c)}
              onClick={() => setColor(c)}
              className={cn(
                "size-8 rounded-full ring-offset-2 ring-offset-background transition-transform duration-150 ease-out active:scale-[0.94]",
                c === color && "ring-2 ring-foreground"
              )}
              style={{ background: swatch(c) }}
            />
          ))}
        </div>
      </fieldset>

      {creating && (
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-balance`} className="text-sm font-medium">
            {card ? "Owed on it now" : "Balance now"}
          </label>
          <Input
            id={`${id}-balance`}
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            inputMode="decimal"
            placeholder="0"
            className="figure h-11 text-base font-normal"
          />
          <p className="text-xs text-muted-foreground">
            {card
              ? "What the statement says you owe. Spending on the card adds to it; paying it off brings it down."
              : "Entries you log from now on move it up and down. You can correct it any time."}
          </p>
        </div>
      )}

      {card && (
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-limit`} className="text-sm font-medium">
            Credit limit
          </label>
          <Input
            id={`${id}-limit`}
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            inputMode="decimal"
            placeholder="Optional"
            className="figure h-11 text-base font-normal"
          />
          {limitValue ? (
            <p className="text-xs text-muted-foreground">
              {formatPeso(limitValue)}
            </p>
          ) : null}
        </div>
      )}

      {kind !== "cash" && (
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-last4`} className="text-sm font-medium">
            Last 4 digits
          </label>
          <Input
            id={`${id}-last4`}
            value={last4}
            onChange={(e) =>
              setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))
            }
            inputMode="numeric"
            placeholder="Optional, shown on the card"
            className="figure h-11 text-base font-normal"
          />
        </div>
      )}

      <div className="flex flex-col gap-2">
        <label htmlFor={`${id}-aliases`} className="text-sm font-medium">
          Other names
        </label>
        <Input
          id={`${id}-aliases`}
          value={aliases}
          onChange={(e) => setAliases(e.target.value)}
          maxLength={200}
          placeholder="Optional, comma separated"
          autoComplete="off"
          className="h-11 text-base font-normal"
        />
        <p className="text-xs text-muted-foreground">
          Short names you type in entries, so "via sb" finds Security Bank.
        </p>
      </div>

      <Button
        type="submit"
        size="lg"
        className="h-11"
        disabled={!valid || pending}
      >
        {submitLabel}
      </Button>
    </form>
  )
}
