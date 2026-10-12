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
  type EditBefore,
  deleteTransactions,
  restoreTransactions,
  undoEdits,
  undoRecategorize,
} from "@/server/ledger"
import {
  deleteAccount,
  setAccountBalance,
  undoMoveToAccount,
} from "@/server/accounts"

/** Tools that change the ledger, and how their confirm card is titled. */
export const ACTION_TITLES: Record<string, string> = {
  moveToCategory: "Re-file entries",
  deleteEntries: "Delete entries",
  logEntries: "Log entries",
  recordIou: "Record an IOU",
  settleUp: "Record a repayment",
  addAccount: "Add an account",
  setAccountBalance: "Correct a balance",
  moveToAccount: "File under an account",
  editEntries: "Change entries",
}

type Undo =
  | { kind: "restore"; ids: string[] }
  | { kind: "delete"; ids: string[] }
  | {
      kind: "recategorize"
      changes: { id: string; categoryId: string | null }[]
    }
  | { kind: "removeAccount"; id: string }
  | { kind: "setBalance"; id: string; balance: number }
  | {
      kind: "refileAccounts"
      changes: { id: string; accountId: string | null }[]
    }
  | { kind: "edits"; changes: EditBefore[] }

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
      ["ledger", "categories"].map((key) =>
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
      if (action.kind === "removeAccount")
        await deleteAccount({ data: { id: action.id } })
      if (action.kind === "setBalance")
        await setAccountBalance({
          data: { id: action.id, balance: action.balance },
        })
      if (action.kind === "refileAccounts")
        await undoMoveToAccount({ data: { changes: action.changes } })
      if (action.kind === "edits") {
        const result = await undoEdits({ data: { changes: action.changes } })
        if (!result.ok) throw new Error(result.message)
      }
      setUndone(true)
      await refresh()
      toast("Undone.")
    } catch {
      toast.error("Couldn't undo that.")
    }
  }

  // Waiting for the owner.
  if (
    part.state === "approval-requested" &&
    approval &&
    !approval.isAutomatic
  ) {
    return (
      <div className="enter-rise flex flex-col gap-3 rounded-2xl border bg-card p-3.5">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">
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
      <p className="enter-fade flex items-center gap-1.5 text-xs text-muted-foreground">
        <XIcon className="size-3.5" />
        {approval?.isAutomatic && approval.reason
          ? approval.reason
          : "Cancelled. Nothing changed."}
      </p>
    )
  }

  if (part.state === "output-available") {
    const output = asOutput(part.output)
    if (!output) return null
    return (
      <div
        className={cn(
          "enter-fade flex items-center gap-2 rounded-xl px-3 py-2 text-sm",
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
      <p className="enter-fade text-xs text-destructive">
        {title} failed. Nothing changed.
      </p>
    )
  }

  // Input streaming, approved and running, or an automatic decision in flight.
  return <p className="text-xs text-muted-foreground">{title}…</p>
}
