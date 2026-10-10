import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  type DynamicToolUIPart,
  type ToolUIPart,
  type UITools,
  getToolName,
} from "ai"
import { CheckIcon, Undo2Icon, XIcon } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { toast } from "@workspace/ui/components/sonner"
import { cn } from "@workspace/ui/lib/utils"
import {
  deleteTransactions,
  restoreTransactions,
  undoRecategorize,
} from "@/server/ledger"

/** Tools that change the ledger, and how their confirm card is titled. */
export const ACTION_TITLES: Record<string, string> = {
  moveToCategory: "Re-file entries",
  deleteEntries: "Delete entries",
  logEntries: "Log entries",
  settleUp: "Settle up",
}

type Undo =
  | { kind: "restore"; ids: string[] }
  | { kind: "delete"; ids: string[] }
  | {
      kind: "recategorize"
      changes: { id: string; categoryId: string | null }[]
    }

interface Output {
  done: boolean
  message: string
  undo?: Undo
}

function asOutput(value: unknown): Output | null {
  if (!value || typeof value !== "object" || !("message" in value)) return null
  return value as Output
}

/**
 * One write action in the chat: a confirm card while it waits for the
 * owner, then the result with Undo. The card's text comes from the server.
 */
export function AgentAction({
  part,
  onRespond,
}: {
  part: ToolUIPart<UITools> | DynamicToolUIPart
  onRespond: (response: { id: string; approved: boolean }) => void
}) {
  const queryClient = useQueryClient()
  const [undone, setUndone] = useState(false)
  const title = ACTION_TITLES[getToolName(part)] ?? "Change"
  const approval = "approval" in part ? part.approval : undefined

  const refresh = () =>
    Promise.all(
      ["month", "trend", "people", "categories"].map((key) =>
        queryClient.invalidateQueries({ queryKey: [key] })
      )
    )

  async function undo(action: Undo) {
    try {
      if (action.kind === "restore")
        await restoreTransactions({ data: { ids: action.ids } })
      if (action.kind === "delete")
        await deleteTransactions({ data: { ids: action.ids } })
      if (action.kind === "recategorize")
        await undoRecategorize({ data: { changes: action.changes } })
      setUndone(true)
      await refresh()
      toast("Undone.")
    } catch {
      toast.error("Couldn’t undo that.")
    }
  }

  // Waiting for the owner.
  if (
    part.state === "approval-requested" &&
    approval &&
    !approval.isAutomatic
  ) {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border bg-card p-3.5">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {title}
          </span>
          <p className="text-sm">
            {approval.requestReason ?? "Goatside wants to make a change."}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => onRespond({ id: approval.id, approved: true })}
          >
            <CheckIcon />
            Confirm
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onRespond({ id: approval.id, approved: false })}
          >
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  if (part.state === "output-denied") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <XIcon className="size-3.5" />
        {approval?.isAutomatic && approval.reason
          ? approval.reason
          : `${title}: cancelled`}
      </p>
    )
  }

  if (part.state === "output-available") {
    const output = asOutput(part.output)
    if (!output) return null
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-xl px-3 py-2 text-sm",
          output.done ? "bg-muted" : "text-muted-foreground"
        )}
      >
        {output.done && <CheckIcon className="size-4 shrink-0" />}
        <span className="min-w-0 flex-1">
          {undone ? "Undone." : output.message}
        </span>
        {output.done && output.undo && !undone && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => output.undo && void undo(output.undo)}
          >
            <Undo2Icon />
            Undo
          </Button>
        )}
      </div>
    )
  }

  if (part.state === "output-error") {
    return (
      <p className="text-xs text-destructive">
        {title} failed. Nothing changed.
      </p>
    )
  }

  // Input streaming, approved and running, or an automatic decision in flight.
  return <p className="text-xs text-muted-foreground">{title}…</p>
}
