import { useState } from "react"
import type { UseChatHelpers } from "@ai-sdk/react"
import type { UIMessage } from "ai"
import { ArrowUpIcon, SquareIcon } from "lucide-react"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@workspace/ui/components/drawer"
import { CoinMark } from "@workspace/ui/components/brand"

export type AskChat = UseChatHelpers<UIMessage>

const SUGGESTIONS = [
  "How much did I spend this month?",
  "What was my biggest expense last week?",
  "Food this month vs last month?",
]

const TOOL_LABELS: Record<string, string> = {
  "tool-summarize": "Added up your ledger",
  "tool-findTransactions": "Looked through your entries",
  "tool-balances": "Checked who owes what",
}

/** Ask mode: questions about your money, answered from your own ledger. */
export function AskSheet({
  chat,
  open,
  onOpenChange,
}: {
  chat: AskChat
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [text, setText] = useState("")
  const busy = chat.status === "submitted" || chat.status === "streaming"
  const last = chat.messages.at(-1)

  // Changes as the answer streams in; remounting the end marker follows it.
  const progress = `${chat.messages.length}:${last ? textOf(last).length : 0}:${chat.status}`

  function ask(question: string) {
    const trimmed = question.trim()
    if (!trimmed || busy) return
    void chat.sendMessage({ text: trimmed })
    setText("")
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto h-[85dvh] max-w-md">
        <DrawerHeader className="flex-row items-start justify-between gap-3 group-data-[swipe-axis=y]/drawer-popup:text-left">
          <div className="flex flex-col gap-0.5">
            <DrawerTitle className="font-display text-2xl font-normal">
              Ask Goatside
            </DrawerTitle>
            <DrawerDescription>
              Answers come from your own ledger.
            </DrawerDescription>
          </div>
          {chat.messages.length > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => chat.setMessages([])}
              className="rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            >
              New chat
            </button>
          )}
        </DrawerHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pt-4 pb-4">
          {chat.messages.length === 0 && (
            <div className="flex flex-col items-start gap-2 pt-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => ask(suggestion)}
                  className="rounded-full border px-3.5 py-2 text-left text-sm transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] [@media(hover:hover)]:hover:bg-muted"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}

          {chat.messages.map((message) =>
            message.role === "user" ? (
              <p
                key={message.id}
                className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-muted px-3.5 py-2 text-sm"
              >
                {textOf(message)}
              </p>
            ) : (
              <div
                key={message.id}
                className="flex flex-col gap-2 text-[15px] leading-relaxed"
              >
                {message.parts.map((part, i, parts) => {
                  if (part.type === "text") {
                    // Text before a tool call is narration ("I'll check…").
                    const lastTool = parts.findLastIndex((p) =>
                      p.type.startsWith("tool-")
                    )
                    return i > lastTool ? (
                      <Answer key={i} text={part.text} />
                    ) : null
                  }
                  const label = TOOL_LABELS[part.type]
                  if (!label) return null
                  return (
                    <p
                      key={i}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground"
                    >
                      <CoinMark rim={false} className="size-3.5" />
                      {label}
                    </p>
                  )
                })}
              </div>
            )
          )}

          {busy && last?.role === "user" && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="coin-stage size-4">
                <CoinMark className="coin-spinning size-4" />
              </span>
              Checking your ledger…
            </p>
          )}

          {chat.error && (
            <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed p-3 text-sm">
              <p>{errorMessage(chat.error)}</p>
              <button
                type="button"
                onClick={() => void chat.regenerate()}
                className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                Try again
              </button>
            </div>
          )}
          <div
            key={progress}
            ref={(el) => el?.scrollIntoView({ block: "end" })}
          />
        </div>

        <form
          className="flex items-center gap-2 border-t px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]"
          onSubmit={(e) => {
            e.preventDefault()
            ask(text)
          }}
        >
          <label htmlFor="ask" className="sr-only">
            Ask about your money
          </label>
          <input
            id="ask"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ask a follow-up"
            autoComplete="off"
            enterKeyHint="send"
            maxLength={500}
            className="h-11 min-w-0 flex-1 rounded-full border bg-card px-4 text-base outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
          />
          {busy ? (
            <button
              type="button"
              onClick={() => void chat.stop()}
              aria-label="Stop"
              className="flex size-11 shrink-0 items-center justify-center rounded-full border transition-transform duration-150 ease-out active:scale-[0.97]"
            >
              <SquareIcon className="size-4" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!text.trim()}
              aria-label="Ask"
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform duration-150 ease-out active:scale-[0.97] disabled:opacity-30"
            >
              <ArrowUpIcon className="size-5" />
            </button>
          )}
        </form>
      </DrawerContent>
    </Drawer>
  )
}

function textOf(message: UIMessage) {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
}

/**
 * Errors before streaming arrive as the route's `{ error }` JSON; errors
 * mid-stream carry the server's message. A failed fetch is a TypeError.
 */
function errorMessage(error: Error) {
  try {
    const parsed: unknown = JSON.parse(error.message)
    if (parsed && typeof parsed === "object" && "error" in parsed) {
      return String(parsed.error)
    }
  } catch {
    // Not JSON: a streamed error message, or a network failure.
  }
  if (error.name === "TypeError" || !error.message) {
    return "Couldn’t reach Goatside. Check your connection and try again."
  }
  return error.message
}

/** Just enough formatting for short answers: paragraphs, "- " lists, **bold**. */
function Answer({ text }: { text: string }) {
  const blocks: { list: boolean; lines: string[] }[] = []
  let current: (typeof blocks)[number] | null = null
  for (const line of text.split("\n")) {
    if (!line.trim()) {
      current = null
      continue
    }
    const item = /^\s*[-*•]\s+(.*)$/.exec(line)
    const list = item !== null
    if (!current || current.list !== list) {
      current = { list, lines: [] }
      blocks.push(current)
    }
    current.lines.push(item?.[1] ?? line.trimEnd())
  }

  return (
    <>
      {blocks.map((block, i) =>
        block.list ? (
          <ul key={i} className="flex list-disc flex-col gap-1 pl-5">
            {block.lines.map((line, j) => (
              <li key={j}>
                <Inline text={line} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={i} className="whitespace-pre-wrap">
            <Inline text={block.lines.join("\n")} />
          </p>
        )
      )}
    </>
  )
}

function Inline({ text }: { text: string }) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((chunk, i) =>
    chunk.startsWith("**") && chunk.endsWith("**") && chunk.length > 4 ? (
      <strong key={i} className="font-semibold">
        {chunk.slice(2, -2)}
      </strong>
    ) : (
      chunk
    )
  )
}
