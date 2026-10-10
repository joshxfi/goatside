import { useEffect, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ArrowUpIcon } from "lucide-react"
import { toast } from "@workspace/ui/components/sonner"
import { guessTransfer, scanAccounts } from "@workspace/core/accounts"
import { type Preparsed, preparse } from "@workspace/core/preparse"
import { formatPeso } from "@workspace/core/money"
import { cn } from "@workspace/ui/lib/utils"
import { swatch } from "@/lib/accounts"
import { dayLabel } from "@/lib/format"
import { useDesktop } from "@/lib/use-desktop"
import { useShortcut } from "@/lib/use-shortcut"
import { monthQuery } from "@/lib/queries"
import {
  type LedgerTxn,
  type MonthView,
  deleteTransactions,
  logEntry,
  restoreTransactions,
} from "@/server/ledger"

export function Composer({
  view,
  viewKey,
  onAsk,
  children,
}: {
  view: MonthView
  viewKey?: string
  /** Text that isn't an entry goes to the agent. */
  onAsk: (question: string) => void
  /** Shown above the input, e.g. the agent's questions. */
  children?: React.ReactNode
}) {
  const [text, setText] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const desktop = useDesktop()
  const shortcut = useShortcut("K")

  // ⌘K / Ctrl+K jumps to the composer.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])
  const queryClient = useQueryClient()
  const queryKey = monthQuery(viewKey).queryKey

  const parsed = preparse(text, { today: view.today })

  const log = useMutation({
    mutationFn: (input: string | { text: string; repeat: true }) =>
      logEntry({ data: typeof input === "string" ? { text: input } : input }),
    onMutate: async (input) => {
      const preview = preparse(textOf(input), { today: view.today })
      if (preview.kind !== "log") return { previous: undefined }

      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData(queryKey)
      const now = Date.now()
      const optimistic: LedgerTxn[] = preview.lines
        .filter((line) => line.localDate.startsWith(view.month))
        .map((line, i) => {
          const filed = fileLine(line.description, view)
          return {
            id: `optimistic:${now}:${i}`,
            kind: line.direction === "in" ? "income" : "expense",
            amount: line.direction === "in" ? line.share : -line.share,
            localDate: line.localDate,
            description: filed.description,
            split: line.split,
            recurring: false,
            status: "pending",
            createdAt: now,
            category: null,
            person: null,
            account: filed.account,
            toAccount: null,
          }
        })
      if (previous && optimistic.length) {
        queryClient.setQueryData(queryKey, {
          ...previous,
          transactions: [...optimistic, ...previous.transactions].toSorted(
            (a, b) =>
              b.localDate.localeCompare(a.localDate) ||
              b.createdAt - a.createdAt
          ),
        })
      }
      return { previous }
    },
    onError: (_error, input, context) => {
      if (context?.previous)
        queryClient.setQueryData(queryKey, context.previous)
      // A failed quick pick has nothing to put back in the box.
      if (typeof input === "string") setText((current) => current || input)
      toast.error("Couldn’t save that. Your text is back in the box.")
    },
    onSuccess: (result) => {
      if (result.kind === "log") {
        toast(describe(result.saved, view.categories), {
          description: result.asked
            ? "Goatside has a quick question for you."
            : undefined,
          action: {
            label: "Undo",
            onClick: async () => {
              await deleteTransactions({ data: { ids: result.transactionIds } })
              await queryClient.invalidateQueries({ queryKey: ["ledger"] })
              toast("Removed.", {
                action: {
                  label: "Redo",
                  onClick: async () => {
                    await restoreTransactions({
                      data: { ids: result.transactionIds },
                    })
                    await queryClient.invalidateQueries({
                      queryKey: ["ledger"],
                    })
                  },
                },
              })
            },
          },
        })
      } else if (result.kind === "undo") {
        toast(result.undone ? "Undid your last entry." : "Nothing to undo.")
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["ledger"] }),
  })

  function submit() {
    if (parsed.kind === "empty") return
    if (parsed.kind === "ask") {
      onAsk(parsed.text)
      setText("")
      return
    }
    log.mutate(text)
    setText("")
    // Keep the keyboard up for rapid logging.
    inputRef.current?.focus()
  }

  // Quick picks while empty; what the parser read once there's text.
  const hint =
    parsed.kind === "empty" ? (
      view.picks.length > 0 ? (
        <Picks
          picks={view.picks}
          onPick={(pick) => log.mutate({ text: pick.text, repeat: true })}
        />
      ) : null
    ) : (
      <Preview parsed={parsed} view={view} />
    )

  return (
    // Phones: pinned to the thumb zone. Desktop: a one-line bar in the header,
    // with the preview and quick picks in a dropdown while it's focused.
    <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/85 backdrop-blur-md supports-[backdrop-filter]:bg-background/70 lg:static lg:z-30 lg:w-full lg:max-w-xl lg:border-0 lg:bg-transparent lg:backdrop-blur-none lg:supports-[backdrop-filter]:bg-transparent">
      <form
        className="group/composer mx-auto flex max-w-md flex-col gap-2 px-4 pt-2 pb-[max(env(safe-area-inset-bottom),0.75rem)] lg:relative lg:max-w-none lg:p-0"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div className="flex flex-col gap-2 lg:hidden">{children}</div>
        {hint && (
          <div className="lg:absolute lg:inset-x-0 lg:top-full lg:mt-2 lg:hidden lg:rounded-xl lg:border lg:bg-popover lg:p-2.5 lg:shadow-md lg:group-focus-within/composer:block">
            {hint}
          </div>
        )}
        <div className="flex items-center gap-2">
          <label htmlFor="composer" className="sr-only">
            Log money in or out, or ask a question
          </label>
          <div className="relative min-w-0 flex-1">
            <input
              ref={inputRef}
              id="composer"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                desktop
                  ? "Log an expense, or ask anything"
                  : "Log an expense or ask a question"
              }
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="send"
              maxLength={500}
              className="h-12 w-full rounded-full border bg-card px-5 text-base shadow-xs outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 lg:h-10 lg:pr-14 lg:pl-4 lg:text-sm"
            />
            <kbd className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 rounded-md border bg-muted px-1.5 text-[11px] text-muted-foreground lg:block lg:group-focus-within/composer:hidden">
              {shortcut}
            </kbd>
          </div>
          <button
            type="submit"
            disabled={parsed.kind === "empty"}
            aria-label="Log it"
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform duration-150 ease-out active:scale-[0.97] disabled:opacity-30 lg:size-10"
          >
            <ArrowUpIcon className="size-5 lg:size-4" />
          </button>
        </div>
      </form>
    </div>
  )
}

/**
 * Where a line will be filed, read the same way the server reads it. The
 * server also asks the model about transfers, so this is a best guess.
 */
function fileLine(description: string, view: MonthView) {
  const scan = scanAccounts(description, view.accounts)
  const byId = (id: string | null | undefined) =>
    view.accounts.find((a) => a.id === id) ?? null
  const transfer = scan.transferWord
    ? guessTransfer(scan, view.accounts, view.defaultAccountId)
    : null
  const named = byId(
    scan.mentions.find((m) => m.cued)?.accountId ?? scan.mentions[0]?.accountId
  )
  const account = named ?? byId(view.defaultAccountId)
  return {
    description: scan.rest,
    transfer: transfer && {
      from: byId(transfer.from),
      to: byId(transfer.to),
    },
    account: account && {
      id: account.id,
      name: account.name,
      color: account.color,
    },
    named: Boolean(named),
    unknown: scan.mentions.length ? null : scan.unknown,
  }
}

const dot = (color: string) => (
  <span
    aria-hidden
    className="size-2 shrink-0 rounded-full"
    style={{ background: swatch(color) }}
  />
)

function AccountHint({
  description,
  view,
}: {
  description: string
  view: MonthView
}) {
  const filed = fileLine(description, view)
  if (filed.transfer?.from && filed.transfer.to) {
    return (
      <span className="flex items-center gap-1 text-muted-foreground">
        · {dot(filed.transfer.from.color)}
        {filed.transfer.from.name} → {dot(filed.transfer.to.color)}
        {filed.transfer.to.name}
      </span>
    )
  }
  if (filed.unknown && !filed.named) {
    return (
      <span className="text-muted-foreground">
        · {filed.unknown.name}? I’ll ask
      </span>
    )
  }
  if (!filed.account) return null
  return (
    <span className="flex items-center gap-1 text-muted-foreground">
      · {dot(filed.account.color)}
      {filed.account.name}
    </span>
  )
}

const textOf = (input: string | { text: string }) =>
  typeof input === "string" ? input : input.text

/** Frequent entries, one tap to log again. No motion: this is used constantly. */
function Picks({
  picks,
  onPick,
}: {
  picks: MonthView["picks"]
  onPick: (pick: MonthView["picks"][number]) => void
}) {
  return (
    <div className="-mx-1 flex [scrollbar-width:none] gap-1.5 overflow-x-auto px-1">
      {picks.map((pick) => (
        <button
          key={pick.text}
          type="button"
          onClick={() => onPick(pick)}
          aria-label={`Log ${pick.text} again`}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border bg-card px-3 text-xs transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] [@media(hover:hover)]:hover:bg-muted"
        >
          {pick.emoji && <span aria-hidden>{pick.emoji}</span>}
          <span className="max-w-32 truncate">{pick.description}</span>
          <span
            className={cn(
              "figure",
              pick.amount > 0
                ? "text-income-foreground"
                : "text-expense-foreground"
            )}
          >
            {formatPeso(pick.amount, { sign: pick.amount > 0 })}
          </span>
        </button>
      ))}
    </div>
  )
}

/** What the parser understood, shown as you type. Same code the server runs. */
function Preview({ parsed, view }: { parsed: Preparsed; view: MonthView }) {
  const today = view.today
  let content: React.ReactNode = null

  if (parsed.kind === "log") {
    content = parsed.lines.map((line, i) => (
      <span key={i} className="flex items-center gap-1.5">
        <span
          className={cn(
            "figure font-medium",
            line.signInferred
              ? "text-foreground"
              : line.direction === "in"
                ? "text-income-foreground"
                : "text-expense-foreground"
          )}
        >
          {line.signInferred
            ? formatPeso(line.share)
            : formatPeso(line.direction === "in" ? line.share : -line.share, {
                sign: line.direction === "in",
              })}
        </span>
        {line.signInferred && (
          <span className="text-muted-foreground">· in or out? I’ll check</span>
        )}
        {line.split && (
          <span className="text-muted-foreground">
            (your ⅟{line.split} of {formatPeso(line.amount)})
          </span>
        )}
        <span className="text-muted-foreground">
          · {dayLabel(line.localDate, today)}
        </span>
        <AccountHint description={line.description} view={view} />
      </span>
    ))
  } else if (parsed.kind === "undo") {
    content = (
      <span className="text-muted-foreground">Undo your last entry</span>
    )
  } else if (parsed.kind === "ask") {
    content = (
      <span className="text-muted-foreground">
        Ask Goatside · answers come from your ledger
      </span>
    )
  }

  return (
    <div
      aria-live="polite"
      className="flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1 px-2 text-xs"
    >
      {content}
    </div>
  )
}

function describe(
  saved: {
    amount: number
    description: string
    categoryId: string | null
    relation: string
    people: string[]
    account: string | null
    transfer: { from: string; to: string } | null
  }[],
  categories: MonthView["categories"]
): string {
  const [first, ...rest] = saved
  if (!first) return "Logged."
  if (rest.length) return `Logged ${saved.length} entries.`
  if (first.transfer) {
    return `Moved ${formatPeso(Math.abs(first.amount))} · ${first.transfer.from} → ${first.transfer.to}`
  }
  const amount = formatPeso(first.amount, { sign: first.amount > 0 })
  const who = first.people.join(" and ")
  const between: Record<string, string> = {
    lent: `lent to ${who}`,
    borrowed: `borrowed from ${who}`,
    repaid_me: `${who} paid you back`,
    i_repaid: `paid ${who} back`,
    shared: `your share, split with ${who}`,
  }
  const category = categories.find((c) => c.id === first.categoryId)
  return [
    `Logged ${amount}`,
    // For an IOU the relation says it all ("lent to Mara").
    first.relation === "own" || first.relation === "shared"
      ? first.description
      : null,
    between[first.relation] ??
      (category && `${category.emoji} ${category.name}`),
    first.account,
  ]
    .filter(Boolean)
    .join(" · ")
}
