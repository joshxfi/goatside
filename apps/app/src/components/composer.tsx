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
}: {
  view: MonthView
  viewKey?: string
}) {
  const [text, setText] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
  const queryKey = monthQuery(viewKey).queryKey

  const parsed = preparse(text, { today: view.today })

  const log = useMutation({
    mutationFn: (input: string) => logEntry({ data: { text: input } }),
    onMutate: async (input) => {
      const preview = preparse(input, { today: view.today })
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
          status: "pending",
          createdAt: now,
          category: null,
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
      setText((current) => current || input)
      toast.error("Couldn’t save that. Your text is back in the box.")
    },
    onSuccess: (result, input) => {
      if (result.kind === "log") {
        const preview = preparse(input, { today: view.today })
        toast(describe(preview), {
          description: result.signInferred
            ? "No + or −, so we logged it as money out."
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
      toast("Questions arrive with the AI soon.", {
        description:
          "For now, start with − or + and an amount, like −500 lunch.",
      })
      return
    }
    log.mutate(text)
    setText("")
    // Keep the keyboard up for rapid logging.
    inputRef.current?.focus()
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/85 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
      <form
        className="mx-auto flex max-w-md flex-col gap-2 px-4 pt-2 pb-[max(env(safe-area-inset-bottom),0.75rem)]"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Preview parsed={parsed} today={view.today} />
        <div className="flex items-center gap-2">
          <label htmlFor="composer" className="sr-only">
            Log money in or out
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
            line.direction === "in" ? "text-gold-foreground" : "text-foreground"
          )}
        >
          {formatPeso(line.direction === "in" ? line.share : -line.share, {
            sign: line.direction === "in",
          })}
        </span>
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
      <span className="text-muted-foreground">Questions are coming soon</span>
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

function describe(parsed: Preparsed): string {
  if (parsed.kind !== "log") return "Logged."
  const [first, ...rest] = parsed.lines
  if (!first) return "Logged."
  const amount = formatPeso(
    first.direction === "in" ? first.share : -first.share,
    {
      sign: first.direction === "in",
    }
  )
  const what = first.description ? ` · ${first.description}` : ""
  return rest.length
    ? `Logged ${parsed.lines.length} entries.`
    : `Logged ${amount}${what}`
}
