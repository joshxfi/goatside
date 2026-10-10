import { useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ArrowUpIcon } from "lucide-react"
import { toast } from "@workspace/ui/components/sonner"
import { type Preparsed, preparse } from "@workspace/core/preparse"
import { formatPeso } from "@workspace/core/money"
import { cn } from "@workspace/ui/lib/utils"
import { dayLabel } from "@/lib/format"
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
        .map((line, i) => ({
          id: `optimistic:${now}:${i}`,
          kind: line.direction === "in" ? "income" : "expense",
          amount: line.direction === "in" ? line.share : -line.share,
          localDate: line.localDate,
          description: line.description,
          split: line.split,
          recurring: false,
          status: "pending",
          createdAt: now,
          category: null,
          person: null,
        }))
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
            ? "Goatside has a quick question for you below."
            : undefined,
          action: {
            label: "Undo",
            onClick: async () => {
              await deleteTransactions({ data: { ids: result.transactionIds } })
              await queryClient.invalidateQueries({ queryKey: ["month"] })
              toast("Removed.", {
                action: {
                  label: "Redo",
                  onClick: async () => {
                    await restoreTransactions({
                      data: { ids: result.transactionIds },
                    })
                    await queryClient.invalidateQueries({ queryKey: ["month"] })
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
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["month"] }),
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

  return (
    // Pinned to the thumb zone on phones; the top of the side column on desktop.
    <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/85 backdrop-blur-md supports-[backdrop-filter]:bg-background/70 lg:static lg:z-auto lg:rounded-2xl lg:border lg:bg-card lg:backdrop-blur-none lg:supports-[backdrop-filter]:bg-card">
      <form
        className="mx-auto flex max-w-md flex-col gap-2 px-4 pt-2 pb-[max(env(safe-area-inset-bottom),0.75rem)] lg:max-w-none lg:p-3"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        {children}
        {parsed.kind === "empty" && view.picks.length > 0 ? (
          <Picks
            picks={view.picks}
            onPick={(pick) => log.mutate({ text: pick.text, repeat: true })}
          />
        ) : (
          <Preview parsed={parsed} today={view.today} />
        )}
        <div className="flex items-center gap-2">
          <label htmlFor="composer" className="sr-only">
            Log money in or out, or ask a question
          </label>
          <input
            ref={inputRef}
            id="composer"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="-500 lunch at berto's"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="send"
            maxLength={500}
            className="h-12 min-w-0 flex-1 rounded-full border bg-card px-5 text-base shadow-xs outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
          />
          <button
            type="submit"
            disabled={parsed.kind === "empty"}
            aria-label="Log it"
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform duration-150 ease-out active:scale-[0.97] disabled:opacity-30"
          >
            <ArrowUpIcon className="size-5" />
          </button>
        </div>
      </form>
    </div>
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
              "figure text-muted-foreground",
              pick.amount > 0 && "text-gold-foreground"
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
function Preview({ parsed, today }: { parsed: Preparsed; today: string }) {
  let content: React.ReactNode = (
    <span className="text-muted-foreground">
      Start with <b className="font-medium text-foreground">−</b> for money out
      or <b className="font-medium text-foreground">+</b> for money in.
    </span>
  )

  if (parsed.kind === "log") {
    content = parsed.lines.map((line, i) => (
      <span key={i} className="flex items-center gap-1.5">
        <span
          className={cn(
            "figure font-medium",
            line.direction === "in" && !line.signInferred
              ? "text-gold-foreground"
              : "text-foreground"
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
  }[],
  categories: MonthView["categories"]
): string {
  const [first, ...rest] = saved
  if (!first) return "Logged."
  if (rest.length) return `Logged ${saved.length} entries.`
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
  ]
    .filter(Boolean)
    .join(" · ")
}
