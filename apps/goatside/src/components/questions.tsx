import { useRef } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "@workspace/ui/components/sonner"
import { formatMoney } from "@workspace/core/money"
import {
  AnswerButton,
  type CategoryChoice,
  OtherCategories,
} from "@/components/category-choices"
import { AnimatePresence, EASE_OUT, m } from "@/components/motion"
import { capitalize } from "@/lib/format"
import { monthQuery } from "@/lib/queries"
import {
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
}: {
  view: MonthView
  viewKey?: string
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
      toast.error("Couldn't save that answer. Try again.")
    },
    onSuccess: (result) => {
      if (!result.ok) toast(result.message)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["ledger"] }),
  })

  const [question] = view.questions

  // An answered card steps back before the next one settles in; the last
  // one also folds away, so the composer below glides down.
  return (
    <AnimatePresence
      mode="wait"
      initial={false}
      custom={view.questions.length > 0}
    >
      {question && (
        <QuestionCard
          key={question.id}
          question={question}
          remaining={view.questions.length}
          categories={view.categories}
          onAnswer={(answer) => reply.mutate({ id: question.id, answer })}
        />
      )}
    </AnimatePresence>
  )
}

/** Fade back; fold away too unless another card takes its place. */
const leave = (followed: boolean) => ({
  opacity: 0,
  scale: 0.98,
  ...(followed ? {} : { height: 0 }),
  transition: { duration: 0.15, height: { duration: 0.2, ease: EASE_OUT } },
})

function QuestionCard({
  question,
  remaining,
  categories,
  onAnswer,
}: {
  question: OpenQuestion
  remaining: number
  categories: CategoryChoice[]
  onAnswer: (answer: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const { transaction } = question
  const what = transaction.description
    ? `"${capitalize(transaction.description)}"`
    : "this"
  const amount = formatMoney(Math.abs(transaction.amount))

  return (
    <m.div
      ref={ref}
      variants={{ leave }}
      exit="leave"
      onAnimationStart={() => {
        if (ref.current) ref.current.style.overflow = "hidden"
      }}
    >
      <section
        aria-label="A question from Goatside"
        className="enter-rise flex flex-col gap-2.5 rounded-2xl border bg-card p-3 shadow-xs"
      >
        <div className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
          <span>
            Quick check{remaining > 1 ? ` · ${remaining} waiting` : ""}
          </span>
          {/* These options already include leaving it as it is. */}
          {question.kind !== "duplicate" && question.kind !== "account" && (
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
          {/* The suggestions can miss: any category, or a new one. */}
          {question.kind === "category" && (
            <OtherCategories
              categories={categories}
              kind={transaction.amount < 0 ? "expense" : "income"}
              exclude={question.options.map((o) => o.value)}
              onPick={(c) => onAnswer(c.id)}
            />
          )}
        </div>
      </section>
    </m.div>
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
          Was {figure} for {what} money out or in?
        </>
      )
    case "relation":
      return (
        <>
          Is {figure} for {what} yours, or between you and{" "}
          {question.people.length > 1 ? "them" : (question.people[0] ?? "them")}
          ?
        </>
      )
    case "duplicate":
      return (
        <>
          {figure} for {what} again?{" "}
          {question.earlier?.description
            ? `It looks like "${capitalize(question.earlier.description)}", which you already logged.`
            : "It looks like an entry you already logged."}
        </>
      )
    case "transfer":
      return (
        <>
          Did you move {figure} for {what} between your accounts, or spend it?
        </>
      )
    case "account":
      return (
        <>
          Is <span className="font-medium">{question.accountName}</span> one of
          your accounts?{" "}
          {question.transaction.amount > 0 ? "It got" : "It paid"} {figure} for{" "}
          {what}.
        </>
      )
    case "category":
      return (
        <>
          Which category fits {figure} for {what}?
        </>
      )
  }
}
