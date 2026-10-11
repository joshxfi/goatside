import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { RepeatIcon, Trash2Icon } from "lucide-react"
import { toast } from "@workspace/ui/components/sonner"
import { formatPeso, parseAmount } from "@workspace/core/money"
import { Button } from "@workspace/ui/components/button"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@workspace/ui/components/drawer"
import { Input } from "@workspace/ui/components/input"
import { useDesktop } from "@/lib/use-desktop"
import { cn } from "@workspace/ui/lib/utils"
import { swatch } from "@/lib/accounts"
import { iouLabel } from "@/lib/format"
import { peopleQuery } from "@/lib/queries"
import {
  type LedgerTxn,
  type MonthView,
  type SplitView,
  deleteTransactions,
  getSplit,
  restoreTransactions,
  updateTransaction,
} from "@/server/ledger"

export interface AccountChoice {
  id: string
  name: string
  color: string
}

export function TransactionDrawer({
  txn,
  categories,
  accounts = [],
  onClose,
}: {
  txn: LedgerTxn | null
  categories: MonthView["categories"]
  /** Open accounts to file under; the picker hides when there are none. */
  accounts?: AccountChoice[]
  onClose: () => void
}) {
  const desktop = useDesktop()
  // Keep the last transaction around so content doesn't vanish mid-close.
  const [shown, setShown] = useState(txn)
  if (txn && txn !== shown) setShown(txn)

  return (
    <Drawer
      open={Boolean(txn)}
      onOpenChange={(open) => !open && onClose()}
      swipeDirection={desktop ? "right" : "down"}
    >
      <DrawerContent
        className={desktop ? "w-[26rem] justify-center" : undefined}
      >
        {shown && (
          <EditForm
            key={shown.id}
            txn={shown}
            categories={categories}
            accounts={accounts}
            onDone={onClose}
          />
        )}
      </DrawerContent>
    </Drawer>
  )
}

type Kind = LedgerTxn["kind"]
type Changes = Omit<Parameters<typeof updateTransaction>[0]["data"], "id">

const KINDS = [
  { value: "expense", label: "Spent" },
  { value: "income", label: "Received" },
  { value: "transfer", label: "Transfer" },
] as const

/** Centavos as the owner would type them: "1,250" or "1,250.50". */
function typed(centavos: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: centavos % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(centavos / 100)
}

/** Your part of a bill split `ways` ways; the odd centavos go to you. */
const firstShare = (bill: number, ways: number) =>
  Math.floor(bill / ways) + (bill % ways ? 1 : 0)

const signFor = (kind: Kind, was: number) =>
  kind === "income"
    ? 1
    : kind === "lend" || kind === "settle"
      ? Math.sign(was)
      : -1

/**
 * Everything here is the owner's call, saved as typed: no model reads it.
 * Changes stay in the form until Save, so amount, type and accounts move
 * together, and the bigger ones can be undone.
 */
function EditForm({
  txn,
  categories,
  accounts,
  onDone,
}: {
  txn: LedgerTxn
  categories: MonthView["categories"]
  accounts: AccountChoice[]
  onDone: () => void
}) {
  const queryClient = useQueryClient()
  const own =
    txn.kind === "expense" || txn.kind === "income" || txn.kind === "transfer"
  const isSplit = txn.kind === "expense" && (txn.split ?? 0) > 1
  const split = useQuery({
    queryKey: ["ledger", "split", txn.id],
    queryFn: () => getSplit({ data: { id: txn.id } }),
    enabled: isSplit,
  })
  const everyone = useQuery({ ...peopleQuery(), enabled: Boolean(txn.person) })

  const [kind, setKind] = useState<Kind>(txn.kind)
  const [amountText, setAmountText] = useState<string | null>(null)
  const [categoryId, setCategoryId] = useState(txn.category?.id ?? null)
  const [accountId, setAccountId] = useState(txn.account?.id ?? null)
  const [toAccountId, setToAccountId] = useState(txn.toAccount?.id ?? null)
  const [recurring, setRecurring] = useState(txn.recurring)
  const [personId, setPersonId] = useState(txn.person?.id ?? null)
  const [description, setDescription] = useState(txn.description)
  const [localDate, setLocalDate] = useState(txn.localDate)

  // What the amount field edits: a split's whole bill, else the row itself.
  const ways = isSplit ? (txn.split ?? 1) : 1
  const original = isSplit ? split.data?.bill : Math.abs(txn.amount)
  const amount =
    amountText === null ? (original ?? null) : parseAmount(amountText)
  const badAmount = amountText !== null && amount === null
  const tooSmall = amount !== null && amount < ways
  const share =
    amount === null
      ? Math.abs(txn.amount)
      : isSplit
        ? firstShare(amount, ways)
        : amount
  const signed = signFor(kind, txn.amount) * share

  const transfer = kind === "transfer"
  const income = kind === "income"
  const person =
    everyone.data?.find((p) => p.id === personId) ?? txn.person ?? null
  const iou = own ? null : iouLabel(kind, txn.amount, person?.name ?? "someone")
  const options = categories.filter(
    (c) => c.kind === (income ? "income" : "expense")
  )
  const kinds = KINDS.filter(
    (k) =>
      k.value !== "transfer" || accounts.length > 1 || txn.kind === "transfer"
  )

  const changes: Changes = {}
  if (kind !== txn.kind) changes.kind = kind as Changes["kind"]
  if (amount !== null && original !== undefined && amount !== original)
    changes.amount = amount
  if (!transfer && !iou && categoryId !== (txn.category?.id ?? null))
    changes.categoryId = categoryId
  if (accountId !== (txn.account?.id ?? null)) changes.accountId = accountId
  if (transfer && toAccountId && toAccountId !== txn.toAccount?.id)
    changes.toAccountId = toAccountId
  if ((kind === "expense" || income) && recurring !== txn.recurring)
    changes.recurring = recurring
  if (personId && personId !== txn.person?.id) changes.personId = personId
  if (description.trim() !== txn.description)
    changes.description = description.trim()
  if (localDate !== txn.localDate) changes.localDate = localDate
  // A bad amount counts as a change: Done would quietly drop it.
  const dirty = Object.keys(changes).length > 0 || badAmount || tooSmall
  const transferReady =
    !transfer || (accountId && toAccountId && accountId !== toAccountId)
  const valid = !badAmount && !tooSmall && Boolean(transferReady)

  /** The same fields as they were, to put back on Undo. */
  function undoOf(sent: Changes): Changes {
    const back: Changes = {}
    if (sent.kind) {
      back.kind = txn.kind as Changes["kind"]
      if (txn.kind === "transfer" && txn.toAccount)
        back.toAccountId = txn.toAccount.id
      if (txn.recurring) back.recurring = true
    }
    if (sent.amount !== undefined) back.amount = original
    if (sent.categoryId !== undefined || (sent.kind && txn.category))
      back.categoryId = txn.category?.id ?? null
    if (sent.accountId !== undefined || sent.kind)
      back.accountId = txn.account?.id ?? null
    if (sent.toAccountId && txn.toAccount) back.toAccountId = txn.toAccount.id
    if (sent.recurring !== undefined) back.recurring = txn.recurring
    if (sent.personId && txn.person) back.personId = txn.person.id
    if (sent.description !== undefined) back.description = txn.description
    if (sent.localDate !== undefined) back.localDate = txn.localDate
    return back
  }

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["ledger"] }),
      queryClient.invalidateQueries({ queryKey: ["people"] }),
    ])

  const save = (data: Changes) =>
    updateTransaction({ data: { id: txn.id, ...data } })

  const update = useMutation({
    mutationFn: save,
    onSuccess: async (result, sent) => {
      if (!result.ok) return toast(result.message)
      onDone()
      await refresh()
      // Amount, type and who: the edits worth a second chance.
      if (sent.amount === undefined && !sent.kind && !sent.personId) return
      const back = undoOf(sent)
      toast("Saved.", {
        action: {
          label: "Undo",
          onClick: async () => {
            const undone = await save(back)
            if (!undone.ok) toast(undone.message)
            await refresh()
          },
        },
      })
    },
    onError: () => toast.error("Couldn’t save that change."),
  })

  // A split's other shares go with it, or they'd owe for a bill that's gone.
  const ids = [txn.id, ...(split.data?.ids ?? [])]
  const remove = useMutation({
    mutationFn: () => deleteTransactions({ data: { ids } }),
    onSuccess: async () => {
      onDone()
      await refresh()
      toast(ids.length > 1 ? "Deleted, with the others’ shares." : "Deleted.", {
        action: {
          label: "Undo",
          onClick: async () => {
            await restoreTransactions({ data: { ids } })
            await refresh()
          },
        },
      })
    },
  })

  function chooseKind(next: Kind) {
    if (next === kind) return
    // Categories belong to a direction; going back restores the original.
    setCategoryId(next === txn.kind ? (txn.category?.id ?? null) : null)
    if (next === "transfer") {
      if (txn.kind === "transfer") {
        setAccountId(txn.account?.id ?? null)
        setToAccountId(txn.toAccount?.id ?? null)
      } else if (kind === "income") {
        // Money that arrived somewhere came from another of your accounts.
        setToAccountId(accountId)
        setAccountId(null)
      }
    } else if (txn.kind === "transfer") {
      // Spent from the account it left, or received where it arrived.
      setAccountId(
        (next === "income" ? txn.toAccount : txn.account)?.id ?? null
      )
    } else if (kind === "transfer") {
      setAccountId(txn.account?.id ?? null)
    }
    setKind(next)
  }

  const busy = update.isPending || remove.isPending
  const disabledSave = busy || (dirty && !valid) || (isSplit && split.isPending)

  return (
    <form
      className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault()
        if (!dirty) return onDone()
        if (valid) update.mutate(changes)
      }}
    >
      <DrawerHeader className="items-center gap-1 text-center">
        <DrawerTitle
          className={cn(
            "figure font-display text-5xl font-normal",
            income && "text-income-foreground",
            kind === "expense" && "text-expense-foreground"
          )}
        >
          {transfer
            ? formatPeso(share)
            : formatPeso(signed, { sign: signed > 0 })}
        </DrawerTitle>
        <DrawerDescription>
          {transfer
            ? "Moves money between your accounts. Not spending."
            : iou
              ? `🤝 ${iou}. IOUs don’t count toward your spending.`
              : isSplit
                ? `Your share of a ${amount ? formatPeso(amount) : "…"} bill split ${ways} ways.`
                : income
                  ? "Counts as money in."
                  : "Counts toward your spending."}
        </DrawerDescription>
      </DrawerHeader>

      {/* The fields scroll between the figure and the buttons. */}
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-4 pb-2 *:shrink-0">
        {own && !isSplit && (
          <ChipGroup legend="Type">
            {kinds.map((k) => (
              <Chip
                key={k.value}
                active={kind === k.value}
                disabled={busy}
                onClick={() => chooseKind(k.value)}
              >
                {k.label}
              </Chip>
            ))}
          </ChipGroup>
        )}

        <div className="flex flex-col gap-2">
          <label htmlFor="txn-amount" className="text-sm font-medium">
            {isSplit ? "Whole bill" : "Amount"}
          </label>
          <div className="relative">
            <span
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
            >
              ₱
            </span>
            <Input
              id="txn-amount"
              inputMode="decimal"
              autoComplete="off"
              value={
                amountText ?? (original === undefined ? "" : typed(original))
              }
              placeholder={original === undefined ? "Loading…" : undefined}
              disabled={original === undefined}
              onChange={(e) => setAmountText(e.target.value)}
              aria-invalid={badAmount || tooSmall}
              aria-describedby="txn-amount-hint"
              className="figure h-11 pl-7 text-base font-normal"
            />
          </div>
          <p
            id="txn-amount-hint"
            className={cn(
              "text-xs text-muted-foreground",
              (badAmount || tooSmall) && "text-destructive"
            )}
          >
            {badAmount
              ? "Type an amount, like 250 or 1,250.50."
              : tooSmall
                ? `Too small to split ${ways} ways.`
                : isSplit
                  ? splitHint(share, amount ?? 0, ways, split.data)
                  : iou
                    ? "Changes what you and they owe each other."
                    : null}
          </p>
        </div>

        {transfer ? (
          accounts.length > 0 && (
            <>
              <AccountPicker
                legend="From"
                accounts={accounts}
                value={accountId}
                disabled={busy}
                onChange={(id) => id && setAccountId(id)}
              />
              <AccountPicker
                legend="To"
                accounts={accounts.filter((a) => a.id !== accountId)}
                value={toAccountId}
                disabled={busy}
                onChange={(id) => id && setToAccountId(id)}
              />
            </>
          )
        ) : iou ? (
          (everyone.data?.length ?? 0) > 1 && (
            <ChipGroup legend="With">
              {everyone.data?.map((p) => (
                <Chip
                  key={p.id}
                  active={p.id === personId}
                  disabled={busy}
                  onClick={() => setPersonId(p.id)}
                >
                  {p.name}
                </Chip>
              ))}
            </ChipGroup>
          )
        ) : (
          <ChipGroup legend="Category">
            {options.map((c) => {
              const active = c.id === categoryId
              return (
                <Chip
                  key={c.id}
                  active={active}
                  disabled={busy}
                  onClick={() => setCategoryId(active ? null : c.id)}
                >
                  <span aria-hidden>{c.emoji}</span>
                  {c.name}
                </Chip>
              )
            })}
          </ChipGroup>
        )}

        {!transfer && accounts.length > 0 && (
          <AccountPicker
            legend={signed > 0 ? "Received in" : "Paid with"}
            accounts={accounts}
            value={accountId}
            disabled={busy}
            onChange={setAccountId}
            allowNone
          />
        )}

        {(kind === "expense" || income) && (
          <Chip
            active={recurring}
            disabled={busy}
            onClick={() => setRecurring(!recurring)}
            className="self-start"
          >
            <RepeatIcon aria-hidden className="size-4" />
            Repeats every month
          </Chip>
        )}

        <div className="flex flex-col gap-2">
          <label htmlFor="txn-description" className="text-sm font-medium">
            Description
          </label>
          <Input
            id="txn-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={200}
            className="h-11 text-base font-normal"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="txn-date" className="text-sm font-medium">
            Date
          </label>
          <Input
            id="txn-date"
            type="date"
            value={localDate}
            onChange={(e) => e.target.value && setLocalDate(e.target.value)}
            className="h-11 text-base font-normal"
          />
        </div>
      </div>

      <DrawerFooter className="flex-row gap-2 pb-[max(env(safe-area-inset-bottom),1rem)]">
        <Button
          type="button"
          variant="ghost"
          size="lg"
          className="h-11 text-destructive"
          disabled={busy || (isSplit && split.isPending)}
          onClick={() => remove.mutate()}
        >
          <Trash2Icon />
          Delete
        </Button>
        <Button
          type="submit"
          size="lg"
          className="h-11 flex-1"
          disabled={disabledSave}
        >
          {dirty ? "Save" : "Done"}
        </Button>
      </DrawerFooter>
    </form>
  )
}

/** "You ₱334 · Ben ₱333 · Mara ₱333", from the bill as it would split. */
function splitHint(
  share: number,
  bill: number,
  ways: number,
  split: SplitView | null | undefined
) {
  if (!split) return null
  let left = bill - share
  const named = split.people.map((p, i) => {
    const part = Math.floor(bill / ways) + (i + 1 < bill % ways ? 1 : 0)
    left -= part
    return `${p.name} ${formatPeso(part)}`
  })
  const unnamed = ways - 1 - split.people.length
  return [
    `You ${formatPeso(share)}`,
    ...named,
    ...(unnamed > 0 ? [`${unnamed} more ${formatPeso(left)}`] : []),
  ].join(" · ")
}

function ChipGroup({
  legend,
  children,
}: {
  legend: string
  children: React.ReactNode
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  )
}

function Chip({
  active,
  className,
  ...props
}: React.ComponentProps<"button"> & { active: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "flex h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] disabled:opacity-60",
        active
          ? "border-foreground bg-foreground text-background"
          : "bg-card [@media(hover:hover)]:hover:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function AccountPicker({
  legend,
  accounts,
  value,
  disabled,
  onChange,
  allowNone = false,
}: {
  legend: string
  accounts: AccountChoice[]
  value: string | null
  disabled: boolean
  onChange: (id: string | null) => void
  allowNone?: boolean
}) {
  return (
    <ChipGroup legend={legend}>
      {accounts.map((a) => {
        const active = a.id === value
        return (
          <Chip
            key={a.id}
            active={active}
            disabled={disabled}
            // Tapping the chosen one again clears it (when that's allowed).
            onClick={() => onChange(active ? (allowNone ? null : a.id) : a.id)}
            className="gap-2"
          >
            <span
              aria-hidden
              className="size-2.5 rounded-full"
              style={{ background: swatch(a.color) }}
            />
            {a.name}
          </Chip>
        )
      })}
    </ChipGroup>
  )
}
