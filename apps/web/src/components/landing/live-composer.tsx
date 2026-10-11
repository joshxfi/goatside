import { useRef, useState } from "react"
import { CornerDownLeftIcon } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import type { AccountKind } from "@workspace/core/accounts"
import { formatMoney } from "@workspace/core/money"
import {
  type DemoQuestion,
  type DemoRow,
  answerRow,
  fileText,
} from "@/lib/demo/file-line"
import { SAMPLE_MONTHS, TODAY } from "@/lib/demo/sample-months"
import { AnswerButton, DemoCard, FeedRow } from "./ui"

const EXAMPLES = [
  "180 iced coffee",
  "+18000 client payment",
  "2400 dinner with nini and daniel split 3",
  "1000 cash in gcash from bpi",
  "500 from mom",
  "1500 groceries using unionbank",
  "89 spotify via bpi card",
  "350 lunch yesterday",
]

const SEED: DemoRow[] = [
  {
    id: "seed-1",
    title: "Grab to work",
    detail: "Transport · GCash",
    icon: "🚕",
    amount: -21500,
    tone: "out",
    date: TODAY,
    counts: 0,
  },
  {
    id: "seed-2",
    title: "Groceries",
    detail: "Groceries · BPI Card",
    icon: "🛒",
    amount: -264500,
    tone: "out",
    date: TODAY,
    counts: 0,
  },
  {
    id: "seed-spotify",
    title: "Spotify",
    detail: "Subscriptions · repeats · BPI Card",
    icon: "🔁",
    amount: -14900,
    tone: "out",
    date: TODAY,
    counts: 0,
  },
  {
    id: "seed-3",
    title: "Lent nini",
    detail: "Nini owes you · GCash",
    icon: "iou",
    amount: -100000,
    tone: "quiet",
    date: "2026-10-17",
    counts: 0,
  },
]

const october = SAMPLE_MONTHS.at(-1)!

type Notice = { text: string; href?: string; link?: string } | null

/**
 * The composer, live: what you type is parsed by Goatside's own code and
 * lands in a feed with the month's totals. Lines it can't settle get a
 * question card, as in the app.
 */
export function LiveComposer() {
  const [rows, setRows] = useState(SEED)
  const [batches, setBatches] = useState<string[][]>([])
  const [questions, setQuestions] = useState<DemoQuestion[]>([])
  const [text, setText] = useState("")
  const [notice, setNotice] = useState<Notice>(null)
  const input = useRef<HTMLInputElement>(null)

  const spent =
    october.totals.out - rows.reduce((s, r) => s + Math.min(r.counts, 0), 0)
  const received =
    october.totals.in + rows.reduce((s, r) => s + Math.max(r.counts, 0), 0)

  function submit(line: string) {
    const filed = fileText(line, TODAY)
    setNotice(null)
    if (filed.kind === "empty") return
    setText("")
    if (filed.kind === "ask") {
      setNotice({
        text: "That reads as a question, so it goes to the agent.",
        link: "Ask it something",
        href: "#ask",
      })
      return
    }
    if (filed.kind === "undo") {
      const last = batches.at(-1)
      if (!last) return setNotice({ text: "Nothing to undo yet." })
      setRows((all) => all.filter((r) => !last.includes(r.id)))
      setQuestions((all) => all.filter((q) => !last.includes(q.rowId)))
      setBatches((all) => all.slice(0, -1))
      return setNotice({ text: "Removed your last line." })
    }
    setRows((all) => [...filed.rows, ...all])
    setBatches((all) => [...all, filed.rows.map((r) => r.id)])
    if (filed.question) {
      const question = filed.question
      setQuestions((all) => [...all, question])
    }
  }

  function answer(
    question: DemoQuestion,
    value: "in" | "out" | AccountKind | "none"
  ) {
    setRows((all) =>
      all.map((r) =>
        r.id === question.rowId ? answerRow(r, question, value) : r
      )
    )
    setQuestions((all) => all.filter((q) => q !== question))
    input.current?.focus({ preventScroll: true })
  }

  const question = questions[0]

  return (
    <div className="flex flex-col gap-3">
      <DemoCard className="flex flex-col overflow-hidden">
        <div className="flex items-end justify-between gap-4 border-b px-5 pt-5 pb-4">
          <div className="flex flex-col gap-1">
            <span className="text-sm text-muted-foreground">October</span>
            <span className="figure font-display text-4xl leading-none text-expense-foreground">
              {formatMoney(spent)}
            </span>
            <span className="text-xs text-muted-foreground">spent so far</span>
          </div>
          <div className="flex flex-col items-end gap-1 text-right">
            <span className="figure font-display text-2xl leading-none text-income-foreground">
              {formatMoney(received)}
            </span>
            <span className="text-xs text-muted-foreground">in</span>
          </div>
        </div>

        {/* Fixed height, with questions over the feed's foot, so the card never jumps. */}
        <div className="relative h-[284px] overflow-hidden" aria-live="polite">
          <ul className="flex flex-col px-4 pt-2">
            {rows.slice(0, 6).map((row) => (
              <li key={row.id} className="enter-rise">
                <FeedRow row={row} today={TODAY} />
              </li>
            ))}
          </ul>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-card" />
          <div className="absolute inset-x-3 bottom-3 flex flex-col gap-2">
            {question && (
              <QuestionCard
                key={question.rowId}
                question={question}
                onAnswer={(value) => answer(question, value)}
              />
            )}
            {notice && !question && (
              <p className="enter-rise rounded-2xl border bg-card px-3.5 py-2.5 text-sm text-muted-foreground shadow-sm">
                {notice.text}{" "}
                {notice.href && (
                  <a
                    href={notice.href}
                    className="text-foreground underline underline-offset-4"
                  >
                    {notice.link}
                  </a>
                )}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2.5 border-t bg-background/40 p-3">
          <div className="-mx-3 flex [scrollbar-width:none] gap-1.5 overflow-x-auto px-3 pb-0.5">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => submit(example)}
                className="h-8 shrink-0 rounded-full border bg-card px-3 font-mono text-xs whitespace-nowrap text-muted-foreground transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.97] [@media(hover:hover)]:hover:bg-muted [@media(hover:hover)]:hover:text-foreground"
              >
                {example}
              </button>
            ))}
          </div>
          <form
            className="flex items-center gap-2 rounded-2xl border bg-card py-1.5 pr-1.5 pl-4 focus-within:ring-3 focus-within:ring-ring/30"
            onSubmit={(event) => {
              event.preventDefault()
              submit(text)
            }}
          >
            <input
              ref={input}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Type what you spent or received"
              aria-label="Try the composer"
              autoComplete="off"
              enterKeyHint="send"
              className="h-9 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
            />
            <button
              type="submit"
              aria-label="Log it"
              disabled={!text.trim()}
              className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-[opacity,transform] duration-150 ease-out active:scale-[0.95] disabled:opacity-30"
            >
              <CornerDownLeftIcon className="size-4" />
            </button>
          </form>
        </div>
      </DemoCard>
    </div>
  )
}

function QuestionCard({
  question,
  onAnswer,
}: {
  question: DemoQuestion
  onAnswer: (value: "in" | "out" | AccountKind | "none") => void
}) {
  const figure = (
    <span className="figure font-medium">{formatMoney(question.amount)}</span>
  )
  return (
    <div className="enter-rise flex flex-col gap-2.5 rounded-2xl border bg-card p-3 shadow-[0_8px_24px_-8px_oklch(0_0_0/18%)]">
      <p className="text-sm">
        {question.kind === "direction" ? (
          <>
            Was {figure} for {question.what} money out or in?
          </>
        ) : (
          <>
            Is <span className="font-medium">{question.accountName}</span> one
            of your accounts? It paid {figure} for {question.what}.
          </>
        )}
      </p>
      <div className={cn("flex flex-wrap gap-1.5")}>
        {question.kind === "direction" ? (
          <>
            <AnswerButton tone="expense" onClick={() => onAnswer("out")}>
              Money out
            </AnswerButton>
            <AnswerButton tone="income" onClick={() => onAnswer("in")}>
              Money in
            </AnswerButton>
          </>
        ) : (
          <>
            <AnswerButton guess onClick={() => onAnswer("bank")}>
              Bank
            </AnswerButton>
            <AnswerButton onClick={() => onAnswer("ewallet")}>
              E-wallet
            </AnswerButton>
            <AnswerButton onClick={() => onAnswer("credit_card")}>
              Credit card
            </AnswerButton>
            <AnswerButton onClick={() => onAnswer("none")}>
              Not an account
            </AnswerButton>
          </>
        )}
      </div>
    </div>
  )
}
