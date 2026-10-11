import { useState } from "react"
import type { UseChatHelpers } from "@ai-sdk/react"
import { type UIMessage, getToolName, isToolUIPart } from "ai"
import { ArrowUpIcon, SquareIcon } from "lucide-react"
import { ACTION_TITLES, AgentAction } from "@/components/agent-action"
import { useDesktop } from "@/lib/use-desktop"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@workspace/ui/components/drawer"
import { CoinMark } from "@workspace/ui/components/brand"
import { Bubble, BubbleContent } from "@workspace/ui/components/bubble"
import { Message, MessageContent } from "@workspace/ui/components/message"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@workspace/ui/components/message-scroller"

export type AskChat = UseChatHelpers<UIMessage>

const SUGGESTIONS = [
  "How much did I spend this month?",
  "Who owes me, and for what?",
  "Food this month vs last month?",
  "Move all grab rides this month to Transport",
  "I spent 350 on lunch yesterday",
]

const TOOL_LABELS: Record<string, string> = {
  "tool-summarize": "Added up your ledger",
  "tool-findTransactions": "Looked through your entries",
  "tool-balances": "Checked who owes what",
  "tool-iouActivity": "Looked through your IOUs",
  "tool-accounts": "Checked your accounts",
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
  const desktop = useDesktop()
  const busy = chat.status === "submitted" || chat.status === "streaming"
  const last = chat.messages.at(-1)

  function ask(question: string) {
    const trimmed = question.trim()
    if (!trimmed || busy) return
    void chat.sendMessage({ text: trimmed })
    setText("")
  }

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      swipeDirection={desktop ? "right" : "down"}
    >
      <DrawerContent
        className={desktop ? "w-[28rem]" : "mx-auto h-[85dvh] max-w-md"}
      >
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

        {/*
          Follows a streaming answer only while you're at the bottom; scroll
          up to re-read and it stays put, with a button back to the latest.
          Each question you send settles near the top as a new turn.
        */}
        <MessageScrollerProvider autoScroll>
          <MessageScroller className="flex-1">
            <MessageScrollerViewport aria-label="Conversation">
              <MessageScrollerContent className="gap-4 p-4">
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
                    <MessageScrollerItem
                      key={message.id}
                      messageId={message.id}
                      scrollAnchor
                    >
                      <Message align="end" className="enter-rise">
                        <MessageContent>
                          <Bubble
                            variant="muted"
                            align="end"
                            className="max-w-[85%]"
                          >
                            <BubbleContent className="rounded-2xl rounded-br-md px-3.5">
                              {textOf(message)}
                            </BubbleContent>
                          </Bubble>
                        </MessageContent>
                      </Message>
                    </MessageScrollerItem>
                  ) : (
                    <MessageScrollerItem
                      key={message.id}
                      messageId={message.id}
                    >
                      <Message className="enter-fade">
                        <MessageContent className="gap-2 text-[15px] leading-relaxed">
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
                            if (
                              isToolUIPart(part) &&
                              getToolName(part) in ACTION_TITLES
                            ) {
                              return (
                                <AgentAction
                                  key={part.toolCallId}
                                  part={part}
                                  onRespond={(response) =>
                                    void chat.addToolApprovalResponse(response)
                                  }
                                />
                              )
                            }
                            const label = TOOL_LABELS[part.type]
                            if (!label) return null
                            return (
                              <p
                                key={i}
                                className="enter-fade flex items-center gap-1.5 text-xs text-muted-foreground"
                              >
                                <CoinMark rim={false} className="size-3.5" />
                                {label}
                              </p>
                            )
                          })}
                        </MessageContent>
                      </Message>
                    </MessageScrollerItem>
                  )
                )}

                {busy && last?.role === "user" && (
                  <p className="enter-fade flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="coin-stage size-4">
                      <CoinMark className="coin-spinning size-4" />
                    </span>
                    Checking your ledger…
                  </p>
                )}

                {chat.error && (
                  <div className="enter-rise flex flex-col items-start gap-2 rounded-xl border border-dashed p-3 text-sm">
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
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton aria-label="Jump to the latest" />
          </MessageScroller>
        </MessageScrollerProvider>

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
            placeholder={
              chat.messages.length ? "Ask a follow-up" : "Ask about your money"
            }
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
    return "Couldn't reach Goatside. Check your connection and try again."
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
