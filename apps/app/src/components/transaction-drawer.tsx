import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { MinusIcon, PlusIcon, RepeatIcon, Trash2Icon } from "lucide-react"
import { toast } from "@workspace/ui/components/sonner"
import { currencySymbol, formatMoney, parseAmount } from "@workspace/core/money"
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
import {
  type AccountChoice,
  AccountPicker,
  Chip,
  ChipGroup,
  PersonPicker,
} from "@/components/chips"
import { iouLabel } from "@/lib/format"
import { peopleQuery } from "@/lib/queries"
import {
  type LedgerTxn,
  type MonthView,
  deleteTransactions,
  getSplit,
  getTransaction,
  restoreTransactions,
  updateTransaction,
} from "@/server/ledger"

export type { AccountChoice }

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

/**
 * The same drawer for pages that list entries without a month view
 * (People, Accounts): it loads the entry and the choices by id.
 */
export function EntryDrawer({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const entry = useQuery({
    queryKey: ["ledger", "entry", id],
    queryFn: () => getTransaction({ data: { id: id ?? "" } }),
    enabled: Boolean(id),
  })
  return (
    <TransactionDrawer
      txn={id ? (entry.data?.txn ?? null) : null}
      categories={entry.data?.categories ?? []}
      accounts={entry.data?.accounts ?? []}
      onClose={onClose}
    />
  )
}

type Type = "expense" | "income" | "transfer" | "lent" | "borrowed" | "settle"
type Changes = Omit<Parameters<typeof updateTransaction>[0]["data"], "id">

const TYPES = [
  { value: "expense", label: "Spent" },
  { value: "income", label: "Received" },
  { value: "transfer", label: "Transfer" },
  { value: "lent", label: "Lent" },
  { value: "borrowed", label: "Borrowed" },
] as const

const typeOf = (txn: LedgerTxn): Type =>
  txn.kind === "lend" ? (txn.amount < 0 ? "lent" : "borrowed") : txn.kind

const isIou = (type: Type) =>
  type === "lent" || type === "borrowed" || type === "settle"

/** Cents as the owner would type them: "1,250" or "1,250.50". */
function typed(cents: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: cents % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

/** A bill in `n` parts that add up exactly; odd cents go first (you). */
function sharesOf(total: number, n: number) {
  const base = Math.floor(total / n)
  return Array.from(
    { length: n },
    (_, i) => base + (i < total - base * n ? 1 : 0)
  )
}

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i])

/**
 * Everything here is the owner's call, saved as typed: no model reads it.
 * Changes stay in the form until Save, so amount, type, people and
 * accounts move together, and the bigger ones can be undone.
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
  const original = typeOf(txn)
  // A split bill, seen from your share or from someone else's.
  const split = useQuery({
    queryKey: ["ledger", "split", txn.id],
    queryFn: () => getSplit({ data: { id: txn.id } }),
    enabled:
      (txn.kind === "expense" && (txn.split ?? 0) > 1) || txn.kind === "lend",
  })
  const everyone = useQuery(peopleQuery())
  const people = everyone.data ?? []
  const role = split.data?.role ?? null
  const share = role === "share"
  const loading = split.isPending && split.fetchStatus !== "idle"

  // What the entry is now.
  const origWays =
    txn.kind === "expense" && txn.split && txn.split > 1 ? txn.split : 1
  const origPeople =
    role === "own"
      ? (split.data?.people.map((p) => p.id) ?? [])
      : txn.person
        ? [txn.person.id]
        : []
  const origWhole = origWays > 1 ? split.data?.bill : Math.abs(txn.amount)

  const [type, setType] = useState<Type>(original)
  const [whoPicked, setWho] = useState<string[] | null>(null)
  const [waysPicked, setWays] = useState<number | null>(null)
  const [amountText, setAmountText] = useState<string | null>(null)
  const [categoryId, setCategoryId] = useState(txn.category?.id ?? null)
  const [accountId, setAccountId] = useState(txn.account?.id ?? null)
  const [toAccountId, setToAccountId] = useState(txn.toAccount?.id ?? null)
  const [recurring, setRecurring] = useState(txn.recurring)
  const [description, setDescription] = useState(txn.description)
  const [localDate, setLocalDate] = useState(txn.localDate)

  // What it will be.
  const who = whoPicked ?? origPeople
  const ways =
    type === "expense" ? (waysPicked ?? (type === original ? origWays : 1)) : 1
  const amount =
    amountText === null ? (origWhole ?? null) : parseAmount(amountText)
  const badAmount = amountText !== null && amount === null
  const tooSmall = amount !== null && amount < ways
  const parts = amount !== null && ways > 1 ? sharesOf(amount, ways) : null
  const mine = parts?.[0] ?? amount ?? Math.abs(txn.amount)
  const sign =
    type === "income" || type === "borrowed"
      ? 1
      : type === "settle"
        ? Math.sign(txn.amount)
        : -1
  const signed = sign * mine

  const transfer = type === "transfer"
  const income = type === "income"
  const categorized = type === "expense" || income
  const nameOf = (id: string | undefined) =>
    people.find((p) => p.id === id)?.name ??
    (id === txn.person?.id ? txn.person?.name : undefined) ??
    "someone"
  const iou = isIou(type)
    ? iouLabel(
        type === "settle" ? "settle" : "lend",
        type === "settle" ? txn.amount : signed,
        nameOf(who[0])
      )
    : null
  const options = categories.filter(
    (c) => c.kind === (income ? "income" : "expense")
  )
  const types = TYPES.filter(
    (t) =>
      t.value !== "transfer" || accounts.length > 1 || original === "transfer"
  )

  // The edit, as only what changed.
  const reshaped =
    type !== original ||
    (whoPicked !== null && !sameList(who, origPeople)) ||
    (type === "expense" && ways !== origWays)
  const changes: Changes = {}
  if (reshaped && !share && type !== "settle") {
    changes.type = type
    changes.people = transfer || income ? [] : who
    if (type === "expense") changes.ways = ways
  }
  if ((type === "settle" || share) && who[0] && who[0] !== txn.person?.id)
    changes.personId = who[0]
  if (amount !== null && origWhole !== undefined && amount !== origWhole)
    changes.amount = amount
  if (categorized && categoryId !== (txn.category?.id ?? null))
    changes.categoryId = categoryId
  if (accountId !== (txn.account?.id ?? null)) changes.accountId = accountId
  if (transfer && toAccountId && toAccountId !== txn.toAccount?.id)
    changes.toAccountId = toAccountId
  if (categorized && recurring !== txn.recurring) changes.recurring = recurring
  if (description.trim() !== txn.description)
    changes.description = description.trim()
  if (localDate !== txn.localDate) changes.localDate = localDate
  // A bad amount counts as a change: Done would quietly drop it.
  const dirty = Object.keys(changes).length > 0 || badAmount || tooSmall
  const ready =
    (!transfer || (accountId && toAccountId && accountId !== toAccountId)) &&
    (type !== "lent" && type !== "borrowed" ? true : who.length === 1)
  const valid = !badAmount && !tooSmall && Boolean(ready)

  /** The same fields as they were, to put back on Undo. */
  function undoOf(sent: Changes): Changes {
    const back: Changes = {}
    if (sent.type) {
      back.type = original as Changes["type"]
      back.people = origPeople
      if (original === "expense") back.ways = origWays
      if (original === "transfer" && txn.toAccount)
        back.toAccountId = txn.toAccount.id
      if (txn.recurring) back.recurring = true
    }
    if (sent.amount !== undefined || sent.type) back.amount = origWhole
    if (sent.categoryId !== undefined || (sent.type && txn.category))
      back.categoryId = txn.category?.id ?? null
    if (sent.accountId !== undefined || sent.type)
      back.accountId = txn.account?.id ?? null
    if (sent.toAccountId && txn.toAccount) back.toAccountId = txn.toAccount.id
    if (sent.recurring !== undefined) back.recurring = txn.recurring
    if (sent.personId && txn.person) back.personId = txn.person.id
    if (sent.description !== undefined) back.description = txn.description
    if (sent.localDate !== undefined) back.localDate = txn.localDate
    return back
  }

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["ledger"] })

  const save = (data: Changes) =>
    updateTransaction({ data: { id: txn.id, ...data } })

  const update = useMutation({
    mutationFn: save,
    onSuccess: async (result, sent) => {
      if (!result.ok) return toast(result.message)
      onDone()
      await refresh()
      // Amount, type and who: the edits worth a second chance.
      if (sent.amount === undefined && !sent.type && !sent.personId) return
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
    onError: () => toast.error("Couldn't save that change."),
  })

  // A split's other shares go with it, or they'd owe for a bill that's gone.
  const ids = [txn.id, ...(role === "own" ? (split.data?.ids ?? []) : [])]
  const remove = useMutation({
    mutationFn: () => deleteTransactions({ data: { ids } }),
    onSuccess: async () => {
      onDone()
      await refresh()
      toast(ids.length > 1 ? "Deleted, with the others' shares." : "Deleted.", {
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

  function chooseType(next: Type) {
    if (next === type) return
    // Categories belong to a direction; going back restores the original.
    setCategoryId(next === original ? (txn.category?.id ?? null) : null)
    // Who's involved: back to how it was, or what carries over.
    if (next === original) {
      setWho(null)
      setWays(null)
    } else if (next === "lent" || next === "borrowed") {
      setWho(who.slice(0, 1))
    } else {
      setWho([])
      setWays(next === "expense" ? 1 : null)
    }
    // Accounts: a transfer's sides become the account it left or reached.
    if (next === "transfer") {
      if (original === "transfer") {
        setAccountId(txn.account?.id ?? null)
        setToAccountId(txn.toAccount?.id ?? null)
      } else if (type === "income") {
        setToAccountId(accountId)
        setAccountId(null)
      }
    } else if (original === "transfer") {
      setAccountId(
        (next === "income" ? txn.toAccount : txn.account)?.id ?? null
      )
    } else if (type === "transfer") {
      setAccountId(txn.account?.id ?? null)
    }
    setType(next)
  }

  /** Who shares the bill; the ways follow unless set to more. */
  function chooseSharers(next: string[]) {
    const named = ways === who.length + 1
    setWho(next)
    setWays(named || ways < next.length + 1 ? next.length + 1 : ways)
  }

  const busy = update.isPending || remove.isPending
  const disabledSave = busy || (dirty && !valid) || loading

  return (
    <form
      className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault()
        if (!dirty) return onDone()
        if (valid) update.mutate(changes)
      }}
    >
      <DrawerHeader className="items-center gap-1 pb-5 text-center md:text-center">
        <DrawerTitle
          className={cn(
            "figure font-display text-5xl font-normal",
            income && "text-income-foreground",
            type === "expense" && "text-expense-foreground"
          )}
        >
          {transfer
            ? formatMoney(mine)
            : formatMoney(signed, { sign: signed > 0 })}
        </DrawerTitle>
        <DrawerDescription className="max-w-xs text-balance">
          {transfer
            ? "Moves money between your accounts. Not spending."
            : share
              ? `🤝 ${nameOf(who[0])}'s share of a ${formatMoney(split.data?.bill ?? 0)} bill. Open your share to change the split.`
              : iou
                ? `🤝 ${iou}. IOUs don't count toward your spending.`
                : ways > 1
                  ? `Your share of a ${amount ? formatMoney(amount) : "…"} bill split ${ways} ways.`
                  : income
                    ? "Counts as money in."
                    : "Counts toward your spending."}
        </DrawerDescription>
      </DrawerHeader>

      {/* The fields scroll between the figure and the buttons. */}
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-4 pb-2 *:shrink-0">
        {original !== "settle" && !share && !loading && (
          <ChipGroup legend="Type">
            {types.map((t) => (
              <Chip
                key={t.value}
                active={type === t.value}
                disabled={busy}
                onClick={() => chooseType(t.value)}
              >
                {t.label}
              </Chip>
            ))}
          </ChipGroup>
        )}

        <div className="flex flex-col gap-2">
          <label htmlFor="txn-amount" className="text-sm font-medium">
            {ways > 1 ? "Whole bill" : "Amount"}
          </label>
          <div className="relative">
            <span
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
            >
              {currencySymbol()}
            </span>
            <Input
              id="txn-amount"
              inputMode="decimal"
              autoComplete="off"
              value={
                amountText ?? (origWhole === undefined ? "" : typed(origWhole))
              }
              placeholder={origWhole === undefined ? "Loading…" : undefined}
              disabled={origWhole === undefined}
              onChange={(e) => setAmountText(e.target.value)}
              aria-invalid={badAmount || tooSmall}
              aria-describedby="txn-amount-hint"
              className="figure h-11 text-base font-normal"
              style={{
                paddingLeft: `calc(1.25rem + ${currencySymbol().length}ch)`,
              }}
            />
          </div>
          <p
            id="txn-amount-hint"
            className={cn(
              "text-xs text-muted-foreground empty:hidden",
              (badAmount || tooSmall) && "text-destructive"
            )}
          >
            {badAmount
              ? "Type an amount, like 250 or 1,250.50."
              : tooSmall
                ? `Too small to split ${ways} ways.`
                : parts
                  ? [
                      `You ${formatMoney(parts[0] ?? 0)}`,
                      ...who.map(
                        (id, i) =>
                          `${nameOf(id)} ${formatMoney(parts[i + 1] ?? 0)}`
                      ),
                      ...(ways - 1 > who.length
                        ? [
                            `${ways - 1 - who.length} more ${formatMoney(
                              parts
                                .slice(who.length + 1)
                                .reduce((s, p) => s + p, 0)
                            )}`,
                          ]
                        : []),
                    ].join(" · ")
                  : iou
                    ? "Changes what you and they owe each other."
                    : null}
          </p>
        </div>

        {type === "expense" && !loading && (
          <>
            <PersonPicker
              legend="Split with"
              people={people}
              value={who}
              multiple
              disabled={busy}
              onChange={chooseSharers}
            />
            <Ways
              ways={ways}
              min={who.length + 1}
              disabled={busy}
              onChange={setWays}
            />
          </>
        )}

        {isIou(type) && (
          <PersonPicker
            legend={
              type === "lent"
                ? "Lent to"
                : type === "borrowed"
                  ? "Borrowed from"
                  : "With"
            }
            people={people}
            value={who.slice(0, 1)}
            disabled={busy}
            onChange={setWho}
          />
        )}

        {transfer
          ? accounts.length > 0 && (
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
          : categorized && (
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

        {categorized && (
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
          disabled={busy || loading}
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

/** How many ways the bill splits, you included: "Just you" at one. */
function Ways({
  ways,
  min,
  disabled,
  onChange,
}: {
  ways: number
  min: number
  disabled: boolean
  onChange: (ways: number) => void
}) {
  return (
    <div className="flex items-center gap-3">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-10 rounded-full"
        aria-label="Fewer ways"
        disabled={disabled || ways <= Math.max(1, min)}
        onClick={() => onChange(ways - 1)}
      >
        <MinusIcon />
      </Button>
      <span className="min-w-28 text-center text-sm" aria-live="polite">
        {ways > 1 ? `Split ${ways} ways` : "Just you"}
      </span>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-10 rounded-full"
        aria-label="More ways"
        disabled={disabled || ways >= 30}
        onClick={() => onChange(ways + 1)}
      >
        <PlusIcon />
      </Button>
    </div>
  )
}
