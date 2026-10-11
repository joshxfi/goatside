import { useState } from "react"
import {
  ArrowLeftRightIcon,
  CheckIcon,
  FileTextIcon,
  LockIcon,
  RotateCcwIcon,
} from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import { formatPeso } from "@workspace/core/money"
import { AnswerButton, DemoCard } from "./ui"

interface Row {
  details: string
  date: string
  amount: number
  /** What the review says about it, under the details. */
  note?: string
}

// Made up, shaped like a real bank statement.
const MAYBE: Row & { typed: string; typedAmount: number } = {
  details: "Card payment at Sample Cafe",
  date: "Oct 2",
  amount: -18500,
  typed: "iced coffee",
  typedAmount: -18000,
}
const TRANSFER: Row = {
  details: "Withdrawal via ATM",
  date: "Oct 3",
  amount: -200000,
  note: "To Cash",
}
const LOGGED: Row = {
  details: "Qr Payment",
  date: "Oct 4",
  amount: -25000,
  note: 'matches "lunch", same day',
}
const NEW: Row[] = [
  { details: "Grab ride", date: "Oct 5", amount: -22000 },
  { details: "Transfer from Daniel", date: "Oct 6", amount: 150000 },
  { details: "ATM withdrawal fee", date: "Oct 3", amount: -1800 },
]

type Stage = "file" | "review" | "done"

/**
 * A statement import, scripted: read the file, review what's new, what you
 * already typed and what's a transfer, import, and take it back.
 */
export function ImportDemo() {
  const [stage, setStage] = useState<Stage>("file")
  const [same, setSame] = useState(false)

  const added = NEW.length + 1 + (same ? 0 : 1)
  const linked = 1 + (same ? 1 : 0)

  function reset() {
    setStage("file")
    setSame(false)
  }

  return (
    <DemoCard className="flex flex-col gap-4 p-4 md:p-5">
      <div className="flex items-center gap-3 rounded-2xl border bg-background/50 p-2 pl-3">
        <FileTextIcon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm">sample-bank-october.pdf</span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <LockIcon aria-hidden className="size-3" /> Has a password
          </span>
        </span>
        {stage === "file" ? (
          <button
            type="button"
            onClick={() => setStage("review")}
            className="h-8 shrink-0 rounded-xl bg-primary px-3 text-sm text-primary-foreground transition-transform duration-150 ease-out active:scale-[0.97]"
          >
            Read it
          </button>
        ) : (
          <button
            type="button"
            onClick={reset}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <RotateCcwIcon className="size-3.5" />
            Start over
          </button>
        )}
      </div>

      {stage === "file" && (
        <p className="px-1 text-sm text-pretty text-muted-foreground">
          Your browser opens the file and finds the rows. The PDF and its
          password stay on your device.
        </p>
      )}

      {stage === "review" && (
        <div className="enter-rise flex flex-col gap-4">
          <p className="flex items-center gap-2 px-1 text-sm">
            <CheckIcon className="size-4 text-income-foreground" />6 rows. Every
            running balance checks out.
          </p>

          <Group title="Maybe logged">
            <RowItem
              row={MAYBE}
              note={`maybe "${MAYBE.typed}", ${formatPeso(Math.abs(MAYBE.typedAmount))}, same day`}
            >
              <div className="flex gap-1.5">
                <AnswerButton
                  guess={same}
                  className="h-7 px-3 text-xs"
                  onClick={() => setSame(true)}
                >
                  Same entry
                </AnswerButton>
                <AnswerButton
                  guess={!same}
                  className="h-7 px-3 text-xs"
                  onClick={() => setSame(false)}
                >
                  Add as new
                </AnswerButton>
              </div>
              {same && (
                <p className="text-xs text-muted-foreground">
                  Linking it, its amount becomes{" "}
                  {formatPeso(Math.abs(MAYBE.amount))}.
                </p>
              )}
            </RowItem>
          </Group>

          <Group title="Transfers">
            <RowItem row={TRANSFER} transfer />
          </Group>

          <Group title="Already logged">
            <RowItem row={LOGGED} />
          </Group>

          <Group title="New">
            {NEW.map((row) => (
              <RowItem key={row.details} row={row} />
            ))}
          </Group>

          <button
            type="button"
            onClick={() => setStage("done")}
            className="h-10 rounded-xl bg-primary text-sm text-primary-foreground transition-transform duration-150 ease-out active:scale-[0.98]"
          >
            Import 6 rows
          </button>
        </div>
      )}

      {stage === "done" && (
        <div className="enter-rise flex flex-col gap-3 px-1">
          <p className="text-sm">
            Added {added} entries and linked {linked} you'd already logged. One
            is a transfer between your accounts.
          </p>
          <p className="text-sm text-muted-foreground">
            New rows got a category from the agent, like any line you type. Undo
            takes the whole import back.
          </p>
        </div>
      )}
    </DemoCard>
  )
}

function Group({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col">
      <h3 className="px-1 text-xs font-medium text-muted-foreground">
        {title}
      </h3>
      <ul className="flex flex-col divide-y">{children}</ul>
    </section>
  )
}

function RowItem({
  row,
  note = row.note,
  transfer = false,
  children,
}: {
  row: Row
  note?: string
  transfer?: boolean
  children?: React.ReactNode
}) {
  return (
    <li className="flex items-start gap-3 px-1 py-2.5">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-col">
          <span className="truncate text-sm">{row.details}</span>
          <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
            {transfer && <ArrowLeftRightIcon aria-hidden className="size-3" />}
            {row.date}
            {note && ` · ${note}`}
          </span>
        </div>
        {children}
      </div>
      <span
        className={cn(
          "figure shrink-0 font-display text-lg",
          transfer
            ? "text-muted-foreground"
            : row.amount > 0
              ? "text-income-foreground"
              : "text-expense-foreground"
        )}
      >
        {formatPeso(row.amount, { sign: row.amount > 0 })}
      </span>
    </li>
  )
}
