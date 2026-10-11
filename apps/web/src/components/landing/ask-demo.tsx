import { useEffect, useRef, useState } from "react"
import { ArrowUpIcon, CheckIcon, Undo2Icon } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import { formatPeso } from "@workspace/core/money"
import { SAMPLE_MONTHS } from "@/lib/demo/sample-months"
import { AnswerButton, DemoCard } from "./ui"

const october = SAMPLE_MONTHS.at(-1)!
const september = SAMPLE_MONTHS.at(-2)!
const spentOn = (month: typeof october, name: string) =>
  month.byCategory.find((c) => c.name === name)?.out ?? 0

interface Script {
  ask: string
  answer: string
  /** A change the agent wants to make; nothing happens until you approve. */
  approval?: { title: string; entries: string[]; done: string }
}

const SCRIPTS: Script[] = [
  {
    ask: "how much on food this month?",
    answer: `${formatPeso(spentOn(october, "Food"))} on food so far this October. All of September came to ${formatPeso(spentOn(september, "Food"))}, so you're on track to land close to it.`,
  },
  {
    ask: "sino may utang sakin?",
    answer:
      "Dalawa: si Nini, ₱1,800 (₱1,000 na pinahiram mo noong Huwebes at ₱800 sa dinner), at si Daniel, ₱800 para sa dinner din.",
  },
  {
    ask: "biggest expenses this month?",
    answer:
      "Your three biggest this October: ₱3,345 for Meralco on the 5th, ₱3,180 for groceries on the 10th, and ₱2,590 for shoes on the 13th.",
  },
  {
    ask: "move all grab rides this month to Transport",
    answer: "I found 3 rides filed under Others. Here's what would change:",
    approval: {
      title: "Move 3 entries to 🚕 Transport",
      entries: [
        "Grab bgc · Oct 2 · ₱180",
        "Grab home · Oct 9 · ₱215",
        "Grab to work · Oct 15 · ₱160",
      ],
      done: "Moved 3 entries to Transport.",
    },
  },
]

type Approval = NonNullable<Script["approval"]> & {
  state: "open" | "approved" | "declined" | "undone"
}

interface Message {
  id: number
  role: "you" | "agent"
  text: string
  approval?: Approval
}

const FALLBACK =
  "In your own Goatside, I'd answer that from your ledger. This preview only knows the questions above."

/**
 * Ask Goatside, scripted. Answers stream in like the real agent's; the
 * write action waits for your approval and can be undone.
 */
export function AskDemo() {
  const [messages, setMessages] = useState<Message[]>([])
  const [streaming, setStreaming] = useState<{
    id: number
    shown: number
  } | null>(null)
  const [text, setText] = useState("")
  const list = useRef<HTMLDivElement>(null)
  const ids = useRef(0)

  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearInterval(timer.current), [])

  const scrollDown = () =>
    requestAnimationFrame(() =>
      list.current?.scrollTo({ top: list.current.scrollHeight })
    )

  /** Reveals an answer a few characters at a time, like the agent's stream. */
  function stream(id: number, length: number) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return scrollDown()
    }
    let shown = 0
    setStreaming({ id, shown })
    timer.current = window.setInterval(() => {
      shown += 6
      if (shown >= length) {
        window.clearInterval(timer.current)
        setStreaming(null)
      } else {
        setStreaming({ id, shown })
      }
      scrollDown()
    }, 24)
  }

  function ask(question: string) {
    const trimmed = question.trim()
    if (!trimmed || streaming) return
    const script = SCRIPTS.find(
      (s) => s.ask.toLowerCase() === trimmed.toLowerCase()
    )
    const you = { id: ++ids.current, role: "you" as const, text: trimmed }
    const agent: Message = {
      id: ++ids.current,
      role: "agent",
      text: script?.answer ?? FALLBACK,
      approval: script?.approval && { ...script.approval, state: "open" },
    }
    setMessages((all) => [...all, you, agent])
    stream(agent.id, agent.text.length)
    setText("")
  }

  function decide(id: number, state: Approval["state"]) {
    setMessages((all) =>
      all.map((m) =>
        m.id === id && m.approval
          ? { ...m, approval: { ...m.approval, state } }
          : m
      )
    )
    scrollDown()
  }

  const asked = new Set(
    messages.filter((m) => m.role === "you").map((m) => m.text)
  )

  return (
    <DemoCard className="flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b px-5 py-3.5">
        <span className="font-medium">Ask Goatside</span>
        <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
          <kbd className="rounded border px-1 font-sans">⌘</kbd>
          <kbd className="rounded border px-1 font-sans">J</kbd>
        </span>
      </div>

      <div
        ref={list}
        className="flex h-[340px] flex-col gap-3 overflow-y-auto px-4 py-4"
        aria-live="polite"
      >
        {messages.length === 0 && (
          <p className="m-auto max-w-64 text-center text-sm text-muted-foreground">
            Ask about your money in your own words, in English or Taglish.
          </p>
        )}
        {messages.map((m) => {
          const live = streaming?.id === m.id
          const shown = live ? m.text.slice(0, streaming.shown) : m.text
          return m.role === "you" ? (
            <p
              key={m.id}
              className="enter-rise max-w-[85%] self-end rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm text-primary-foreground"
            >
              {m.text}
            </p>
          ) : (
            <div
              key={m.id}
              className="flex max-w-[92%] flex-col gap-2 self-start"
            >
              <p className="text-sm text-pretty">{shown}</p>
              {m.approval && !live && (
                <ApprovalCard
                  approval={m.approval}
                  onDecide={(state) => decide(m.id, state)}
                />
              )}
            </div>
          )
        })}
      </div>

      <div className="flex flex-col gap-2.5 border-t bg-background/40 p-3">
        <div className="-mx-3 flex [scrollbar-width:none] gap-1.5 overflow-x-auto px-3 pb-0.5">
          {SCRIPTS.filter((s) => !asked.has(s.ask)).map((s) => (
            <button
              key={s.ask}
              type="button"
              disabled={Boolean(streaming)}
              onClick={() => ask(s.ask)}
              className="h-8 shrink-0 rounded-full border bg-card px-3 text-xs whitespace-nowrap text-muted-foreground transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.97] disabled:opacity-50 [@media(hover:hover)]:hover:bg-muted [@media(hover:hover)]:hover:text-foreground"
            >
              {s.ask}
            </button>
          ))}
        </div>
        <form
          className="flex items-center gap-2 rounded-2xl border bg-card py-1.5 pr-1.5 pl-4 focus-within:ring-3 focus-within:ring-ring/30"
          onSubmit={(event) => {
            event.preventDefault()
            ask(text)
          }}
        >
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Ask about your money"
            aria-label="Ask Goatside"
            autoComplete="off"
            enterKeyHint="send"
            className="h-9 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            aria-label="Ask"
            disabled={!text.trim() || Boolean(streaming)}
            className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-[opacity,transform] duration-150 ease-out active:scale-[0.95] disabled:opacity-30"
          >
            <ArrowUpIcon className="size-4" />
          </button>
        </form>
      </div>
    </DemoCard>
  )
}

function ApprovalCard({
  approval,
  onDecide,
}: {
  approval: Approval
  onDecide: (state: Approval["state"]) => void
}) {
  return (
    <div className="enter-rise flex flex-col gap-2.5 rounded-2xl border bg-background/60 p-3">
      <p className="text-sm font-medium">{approval.title}</p>
      <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
        {approval.entries.map((entry) => (
          <li
            key={entry}
            className={cn(
              "figure transition-colors",
              approval.state === "approved" && "text-foreground"
            )}
          >
            {entry}
          </li>
        ))}
      </ul>
      {approval.state === "open" ? (
        <div className="flex gap-1.5">
          <AnswerButton
            className="border-primary bg-primary text-primary-foreground [@media(hover:hover)]:hover:bg-primary/90"
            onClick={() => onDecide("approved")}
          >
            Approve
          </AnswerButton>
          <AnswerButton onClick={() => onDecide("declined")}>
            Decline
          </AnswerButton>
        </div>
      ) : (
        <div className="enter-fade flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            {approval.state === "approved" && (
              <>
                <CheckIcon className="size-4 text-income-foreground" />
                {approval.done}
              </>
            )}
            {approval.state === "declined" && "Declined. Nothing changed."}
            {approval.state === "undone" &&
              "Undone. They're back where they were."}
          </span>
          {approval.state === "approved" && (
            <AnswerButton onClick={() => onDecide("undone")}>
              <Undo2Icon className="size-3.5" /> Undo
            </AnswerButton>
          )}
        </div>
      )}
    </div>
  )
}
