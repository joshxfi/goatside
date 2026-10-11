import { useState } from "react"
import { CheckIcon, CopyIcon, SendIcon } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import { formatPeso } from "@workspace/core/money"
import { AnswerButton, DemoCard } from "./ui"

const SPLIT_LINE = "2400 dinner with nini and daniel split 3"

interface Person {
  name: string
  /** What they owe you, in centavos; negative if you owe them. */
  owes: number
  history: { label: string; phrase: string }[]
}

const START: Person[] = [
  {
    name: "Nini",
    owes: 100000,
    history: [
      {
        label: "₱1,000 lent on Thursday",
        phrase: "₱1,000 I lent you on Thursday",
      },
    ],
  },
  { name: "Daniel", owes: 0, history: [] },
]

/**
 * Who owes whom: log a split bill, watch the balances move, settle up, or
 * have a reminder drafted. Scripted, with the app's wording.
 */
export function PeopleDemo() {
  const [people, setPeople] = useState(START)
  const [logged, setLogged] = useState(false)
  const [reminder, setReminder] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  function logSplit() {
    setLogged(true)
    setPeople((all) =>
      all.map((p) => ({
        ...p,
        owes: p.owes + 80000,
        history: [
          ...p.history,
          { label: "₱800 for dinner, split 3 ways", phrase: "₱800 for dinner" },
        ],
      }))
    )
  }

  function settle(name: string) {
    setPeople((all) =>
      all.map((p) => (p.name === name ? { ...p, owes: 0, history: [] } : p))
    )
    if (reminder?.includes(name)) setReminder(null)
  }

  function remind(person: Person) {
    setCopied(false)
    setReminder(
      `Hi ${person.name}! Just a heads-up, you still owe me ${formatPeso(person.owes)}. That's ${person.history.map((h) => h.phrase).join(", and ")}. No rush, whenever you can. Thanks!`
    )
  }

  function reset() {
    setPeople(START)
    setLogged(false)
    setReminder(null)
  }

  return (
    <DemoCard className="flex flex-col gap-4 p-4 md:p-5">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-background/50 p-2 pl-3">
        <code className="min-w-0 flex-1 truncate font-mono text-sm">
          {SPLIT_LINE}
        </code>
        <button
          type="button"
          disabled={logged}
          onClick={logSplit}
          className="h-8 shrink-0 rounded-xl bg-primary px-3 text-sm text-primary-foreground transition-[opacity,transform] duration-150 ease-out active:scale-[0.97] disabled:opacity-40"
        >
          {logged ? "Logged" : "Log it"}
        </button>
      </div>

      {logged && (
        <p className="enter-rise px-1 text-sm text-muted-foreground">
          <span className="figure text-expense-foreground">−₱800</span> is your
          dinner. The other two shares become what Nini and Daniel owe you, and
          never count as your spending.
        </p>
      )}

      <ul className="flex flex-col divide-y">
        {people.map((person) => (
          <li key={person.name} className="flex flex-col gap-2 py-3">
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted font-medium"
              >
                {person.name[0]}
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span>{person.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {person.owes > 0
                    ? person.history.map((h) => h.label).join(" · ")
                    : "All square"}
                </span>
              </div>
              <span
                className={cn(
                  "figure shrink-0 text-right font-display text-xl leading-none transition-colors",
                  person.owes > 0 ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {person.owes > 0 ? (
                  <>
                    {formatPeso(person.owes)}
                    <span className="block font-sans text-xs text-muted-foreground">
                      owes you
                    </span>
                  </>
                ) : (
                  <span className="flex items-center gap-1 font-sans text-sm">
                    <CheckIcon className="size-4" /> Settled
                  </span>
                )}
              </span>
            </div>
            {person.owes > 0 && (
              <div className="flex gap-1.5 pl-13">
                <AnswerButton onClick={() => settle(person.name)}>
                  Settle
                </AnswerButton>
                <AnswerButton onClick={() => remind(person)}>
                  <SendIcon className="size-3.5" /> Draft a reminder
                </AnswerButton>
              </div>
            )}
          </li>
        ))}
      </ul>

      {reminder && (
        <div className="enter-rise flex flex-col gap-2 rounded-2xl border bg-background/50 p-3">
          <p className="text-sm text-pretty">{reminder}</p>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              The agent drafts it from their open IOUs. Goatside never sends it
              for you.
            </span>
            <AnswerButton
              onClick={() => {
                void navigator.clipboard?.writeText(reminder)
                setCopied(true)
              }}
            >
              {copied ? (
                <CheckIcon className="size-3.5" />
              ) : (
                <CopyIcon className="size-3.5" />
              )}
              {copied ? "Copied" : "Copy"}
            </AnswerButton>
          </div>
        </div>
      )}

      {logged && people.every((p) => p.owes === 0) && (
        <button
          type="button"
          onClick={reset}
          className="self-start text-sm text-muted-foreground underline underline-offset-4"
        >
          Start over
        </button>
      )}
    </DemoCard>
  )
}
