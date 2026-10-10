import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "@workspace/ui/components/sonner"
import { formatPeso } from "@workspace/core/money"
import { cn } from "@workspace/ui/lib/utils"
import { capitalize } from "@/lib/format"
import { monthQuery } from "@/lib/queries"
import {
  type LedgerTxn,
  type MonthView,
  type OpenQuestion,
  answerQuestion,
} from "@/server/ledger"

/**
 * The agent's open questions, one at a time, above the composer. Each entry
 * is already saved with the agent's guess; answering confirms or fixes it.
 */
export function Questions({
  view,
  viewKey,
  onMore,
}: {
  view: MonthView
  viewKey?: string
  onMore: (txn: LedgerTxn) => void
}) {
  const queryClient = useQueryClient()
  const queryKey = monthQuery(viewKey).queryKey

  const reply = useMutation({
    mutationFn: (input: { id: string; answer: string }) =>
      answerQuestion({ data: input }),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData(queryKey)
      if (previous) {
        queryClient.setQueryData(queryKey, {
          ...previous,
          questions: previous.questions.filter((q) => q.id !== id),
        })
      }
      return { previous }
    },
    onError: (_error, _input, context) => {
      if (context?.previous)
        queryClient.setQueryData(queryKey, context.previous)
      toast.error("Couldn’t save that answer. Try again.")
    },
    onSuccess: (result) => {
      if (!result.ok) toast(result.message)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["ledger"] }),
  })

  const [question] = view.questions
  if (!question) return null
  const more = view.transactions.find((t) => t.id === question.transaction.id)

  return (
    <QuestionCard
      key={question.id}
      question={question}
      remaining={view.questions.length}
      onAnswer={(answer) => reply.mutate({ id: question.id, answer })}
      onMore={more && (() => onMore(more))}
    />
  )
}

function QuestionCard({
  question,
  remaining,
  onAnswer,
  onMore,
}: {
  question: OpenQuestion
  remaining: number
  onAnswer: (answer: string) => void
  onMore?: () => void
}) {
  const { transaction } = question
  const what = transaction.description
    ? `“${capitalize(transaction.description)}”`
    : "this"
  const amount = formatPeso(Math.abs(transaction.amount))

  return (
    <section
      aria-label="A question from Goatside"
      className="question-card flex flex-col gap-2.5 rounded-2xl border bg-card p-3 shadow-xs"
    >
      <div className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
        <span>Quick check{remaining > 1 ? ` · ${remaining} waiting` : ""}</span>
        {/* A duplicate's options already say "keep". */}
        {question.kind !== "duplicate" && (
          <button
            type="button"
            onClick={() => onAnswer(question.guess)}
            className="rounded-md px-1.5 py-0.5 transition-colors hover:text-foreground"
          >
            Keep guess
          </button>
        )}
      </div>
      <p className="text-sm">
        <Prompt question={question} what={what} amount={amount} />
      </p>
      <div className="flex flex-wrap gap-2">
        {question.options.map((option) => (
          <AnswerButton
            key={option.value}
            guess={option.value === question.guess}
            tone={
              question.kind === "direction"
                ? option.value === "in"
                  ? "income"
                  : "expense"
                : undefined
            }
            onClick={() => onAnswer(option.value)}
          >
            {question.kind === "direction" ? (
              <span className="figure">
                {option.value === "in" ? "+" : "−"}
              </span>
            ) : (
              option.emoji && <span aria-hidden>{option.emoji}</span>
            )}
            {option.label}
          </AnswerButton>
        ))}
        {question.kind === "category" && onMore && (
          <AnswerButton onClick={onMore}>Other…</AnswerButton>
        )}
      </div>
    </section>
  )
}

function AnswerButton({
  guess,
  tone,
  className,
  ...props
}: React.ComponentProps<"button"> & {
  /** The value currently saved on the entry. */
  guess?: boolean
  tone?: "income" | "expense"
}) {
  return (
    <button
      type="button"
      aria-pressed={guess ? true : undefined}
      className={cn(
        "flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] [@media(hover:hover)]:hover:bg-muted",
        guess && "border-foreground/40 bg-muted",
        tone === "income" && "text-income-foreground",
        tone === "expense" && "text-expense-foreground",
        className
      )}
      {...props}
    />
  )
}

function Prompt({
  question,
  what,
  amount,
}: {
  question: OpenQuestion
  what: string
  amount: string
}) {
  const figure = <span className="figure font-medium">{amount}</span>
  switch (question.kind) {
    case "direction":
      return (
        <>
          {figure} for {what}: was that money out or in?
        </>
      )
    case "relation":
      return (
        <>
          {figure} for {what}: is that yours, or between you and{" "}
          {question.people.length > 1 ? "them" : (question.people[0] ?? "them")}
          ?
        </>
      )
    case "duplicate":
      return (
        <>
          {figure} for {what} again? It looks like{" "}
          {question.earlier?.description
            ? `“${capitalize(question.earlier.description)}”`
            : "an entry"}{" "}
          you already logged.
        </>
      )
    case "category":
      return (
        <>
          Which category fits {what}{" "}
          <span className="figure text-muted-foreground">({amount})</span>?
        </>
      )
  }
}
