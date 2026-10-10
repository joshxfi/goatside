import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react"
import { useChat } from "@ai-sdk/react"
import { useQueryClient } from "@tanstack/react-query"
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai"
import { toast } from "@workspace/ui/components/sonner"
import { AskSheet } from "@/components/ask-sheet"

const transport = new DefaultChatTransport({ api: "/api/ask" })

interface Agent {
  /** Opens the agent; with a question, also asks it. */
  ask: (question?: string) => void
}

const AgentContext = createContext<Agent | null>(null)

/**
 * The agent chat for every page under the app layout, so the sidebar,
 * the composer and ⌘J all reach the same conversation.
 */
export function AgentProvider({
  enabled,
  children,
}: {
  enabled: boolean
  children: React.ReactNode
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const chat = useChat({
    transport,
    // After the owner confirms a change, continue so the tool runs.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    // The agent may have changed the ledger; refresh what's on screen.
    onFinish: () => {
      for (const key of ["month", "trend", "people", "categories"]) {
        void queryClient.invalidateQueries({ queryKey: [key] })
      }
    },
  })
  const { sendMessage } = chat

  const ask = useCallback(
    (question?: string) => {
      if (!enabled) {
        toast("The agent needs AI Gateway.", {
          description:
            "Add AI_GATEWAY_API_KEY to your environment, then restart.",
        })
        return
      }
      setOpen(true)
      if (question) void sendMessage({ text: question })
    },
    [enabled, sendMessage]
  )

  // ⌘J / Ctrl+J opens the agent from anywhere.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        event.preventDefault()
        ask()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [ask])

  const value = useMemo(() => ({ ask }), [ask])

  return (
    <AgentContext value={value}>
      {children}
      <AskSheet chat={chat} open={open} onOpenChange={setOpen} />
    </AgentContext>
  )
}

export function useAgent(): Agent {
  const agent = use(AgentContext)
  if (!agent) throw new Error("useAgent must be used inside AgentProvider")
  return agent
}
