import { useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { FileTextIcon, LockIcon } from "lucide-react"
import { formatPeso } from "@workspace/core/money"
import {
  type StatementResult,
  type StatementRow,
  linesFromCsv,
  readStatement,
  statementMentions,
} from "@workspace/core/statement"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { toast } from "@workspace/ui/components/sonner"
import { cn } from "@workspace/ui/lib/utils"
import { AccountDrawer } from "@/components/account-form"
import { balanceText } from "@/components/account-card"
import { periodLabel, shortDate } from "@/lib/format"
import { importsQuery } from "@/lib/queries"
import { PasswordError, fileHash, readPdfLines } from "@/lib/statement-pdf"
import { type AccountBalance, setAccountBalance } from "@/server/accounts"
import {
  type CommitResult,
  type ImportDecision,
  type Preview,
  type PreviewRow,
  importStatement,
  previewStatement,
  undoStatementImport,
} from "@/server/imports"

type Account = Pick<
  AccountBalance,
  "id" | "name" | "kind" | "last4" | "balance"
>

type Statement = Parameters<typeof previewStatement>[0]["data"]

type Step =
  | { name: "pick" }
  | { name: "password"; bytes: Uint8Array; wrong: boolean }
  | { name: "reading" }
  | { name: "failed"; message: string; row?: StatementRow }
  | {
      name: "review"
      statement: Statement
      preview: Preview
      checked: string
      warning: string | null
    }
  | { name: "done"; result: CommitResult }

/** What the checks confirmed, in a sentence. */
function checkedText(result: StatementResult) {
  const rows = `${result.rows.length} ${result.rows.length === 1 ? "row" : "rows"}`
  if (result.check.running === "pass")
    return `${rows}. Every running balance checks out.`
  return `${rows}. The totals match the statement.`
}

/** The preview's suggestion for a row. */
function suggested(row: PreviewRow): ImportDecision {
  if (row.status === "imported") return { action: "skip" }
  if (row.status === "logged") return { action: "link" }
  if (row.status === "transfer" && row.transfer)
    return { action: "transfer", accountId: row.transfer.accountId }
  return { action: "new" }
}

/**
 * Import a bank or card statement into `account`. The PDF is opened and
 * read here, in the browser; only the rows it finds go to the server, and
 * only after the statement's own balances check out.
 */
export function ImportStatement({
  account,
  accounts,
  open,
  onClose,
}: {
  account: Account
  /** The owner's other open accounts, for transfers. */
  accounts: Pick<AccountBalance, "id" | "name">[]
  open: boolean
  onClose: () => void
}) {
  const [step, setStep] = useState<Step>({ name: "pick" })
  const card = account.kind === "credit_card"

  const close = () => {
    onClose()
    setStep({ name: "pick" })
  }

  async function read(bytes: Uint8Array, csv: boolean, password?: string) {
    setStep({ name: "reading" })
    try {
      const lines = csv
        ? linesFromCsv(new TextDecoder().decode(bytes))
        : await readPdfLines(bytes, password)
      const result = readStatement(lines, { kind: account.kind })
      if (!result.ok) {
        const at = result.check.firstBreak
        return setStep({
          name: "failed",
          message: result.problem ?? "This statement doesn't add up.",
          row: at === undefined ? undefined : result.rows[at],
        })
      }
      const statement: Statement = {
        accountId: account.id,
        fileHash: await fileHash(bytes),
        rows: result.rows.map((r) => ({
          ...r,
          details: r.details.slice(0, 300),
        })),
        summary: result.summary,
        period: result.period,
      }
      const preview = await previewStatement({ data: statement })
      if (!preview.ok)
        return setStep({ name: "failed", message: preview.message })
      const mentioned =
        !account.last4 || statementMentions(lines, account.last4)
      setStep({
        name: "review",
        statement,
        preview: preview.value,
        checked: checkedText(result),
        warning: mentioned
          ? null
          : `This statement doesn't mention the ${card ? "card" : "account"} ending ${account.last4}. Check it's for ${account.name}.`,
      })
    } catch (error) {
      if (error instanceof PasswordError) {
        return setStep({ name: "password", bytes, wrong: error.wrong })
      }
      console.error("[goatside] statement import:", error)
      setStep({
        name: "failed",
        message: "Couldn't read that file. Is it a PDF or CSV statement?",
      })
    }
  }

  return (
    <AccountDrawer
      open={open}
      onClose={close}
      title="Import a statement"
      description={`Into ${account.name}`}
    >
      {step.name === "pick" && (
        <Pick
          account={account}
          onFile={(bytes, csv) => void read(bytes, csv)}
        />
      )}
      {step.name === "password" && (
        <Password
          wrong={step.wrong}
          onSubmit={(password) => void read(step.bytes, false, password)}
          onCancel={() => setStep({ name: "pick" })}
        />
      )}
      {step.name === "reading" && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Reading the statement…
        </p>
      )}
      {step.name === "failed" && (
        <Failed
          message={step.message}
          row={step.row}
          onRetry={() => setStep({ name: "pick" })}
        />
      )}
      {step.name === "review" && (
        <Review
          key={step.statement.fileHash}
          account={account}
          accounts={accounts}
          statement={step.statement}
          preview={step.preview}
          checked={step.checked}
          warning={step.warning}
          onDone={(result) => setStep({ name: "done", result })}
        />
      )}
      {step.name === "done" && (
        <Done account={account} result={step.result} onClose={close} />
      )}
    </AccountDrawer>
  )
}

function Pick({
  account,
  onFile,
}: {
  account: Account
  onFile: (bytes: Uint8Array, csv: boolean) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
  const { data: history = [] } = useQuery(importsQuery(account.id))
  const undo = useMutation({
    mutationFn: (id: string) => undoStatementImport({ data: { id } }),
    onSuccess: async (removed) => {
      await queryClient.invalidateQueries({ queryKey: ["ledger"] })
      toast(
        removed
          ? `Removed ${removed} ${removed === 1 ? "entry" : "entries"} from that import.`
          : "Removed that import."
      )
    },
    onError: () => toast.error("Couldn't undo that import."),
  })

  return (
    <div className="flex flex-col gap-5 pb-2">
      <p className="text-sm text-muted-foreground">
        Pick the PDF your bank or card sends you, or a CSV export. Goatside
        reads it on this device. The file and its password never leave it; only
        the rows it finds are saved.
      </p>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf,text/csv,.csv"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ""
          if (!file) return
          const csv = file.type === "text/csv" || /\.csv$/i.test(file.name)
          onFile(new Uint8Array(await file.arrayBuffer()), csv)
        }}
      />
      <Button onClick={() => input.current?.click()}>
        <FileTextIcon />
        Choose a file
      </Button>
      {history.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-muted-foreground">
            Imported before
          </h3>
          <ul className="flex flex-col divide-y rounded-2xl border">
            {history.map((h) => (
              <li key={h.id} className="flex items-center gap-3 px-3 py-2">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm">
                    {h.periodStart && h.periodEnd
                      ? periodLabel(h.periodStart, h.periodEnd)
                      : "A statement"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {h.rowCount} rows, {h.addedCount} added
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={undo.isPending}
                  onClick={() => undo.mutate(h.id)}
                >
                  Undo
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function Password({
  wrong,
  onSubmit,
  onCancel,
}: {
  wrong: boolean
  onSubmit: (password: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState("")
  return (
    <form
      className="flex flex-col gap-3 pb-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (value) onSubmit(value)
      }}
    >
      <label htmlFor="statement-password" className="text-sm">
        This file has a password. Banks often use your birthday or part of your
        account number. It's used once, here, and never saved.
      </label>
      <Input
        id="statement-password"
        type="password"
        autoComplete="off"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-invalid={wrong || undefined}
        aria-describedby={wrong ? "statement-password-error" : undefined}
      />
      {wrong && (
        <p id="statement-password-error" className="text-sm text-destructive">
          That password didn't work.
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={!value} className="flex-1">
          <LockIcon />
          Open
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function Failed({
  message,
  row,
  onRetry,
}: {
  message: string
  row?: StatementRow
  onRetry: () => void
}) {
  return (
    <div className="flex flex-col gap-4 pb-2">
      <p className="text-sm">{message} Nothing was imported.</p>
      {row && (
        <div className="rounded-2xl border px-3 py-2">
          <p className="text-xs text-muted-foreground">
            The first row that doesn't fit, page {row.page}
          </p>
          <div className="flex items-baseline gap-3">
            <span className="min-w-0 flex-1 truncate text-sm">
              {shortDate(row.localDate)} · {row.details}
            </span>
            <Amount value={row.amount} />
          </div>
        </div>
      )}
      <Button variant="outline" onClick={onRetry}>
        Choose another file
      </Button>
    </div>
  )
}

function Amount({ value, muted }: { value: number; muted?: boolean }) {
  return (
    <span
      className={cn(
        "figure shrink-0 font-display text-lg",
        muted
          ? "text-muted-foreground"
          : value > 0
            ? "text-income-foreground"
            : "text-expense-foreground"
      )}
    >
      {formatPeso(value, { sign: value > 0 })}
    </span>
  )
}

const NOT_TRANSFER = "none"

function Review({
  account,
  accounts,
  statement,
  preview,
  checked,
  warning,
  onDone,
}: {
  account: Account
  accounts: Pick<AccountBalance, "id" | "name">[]
  statement: Statement
  preview: Preview
  checked: string
  warning: string | null
  onDone: (result: CommitResult) => void
}) {
  const queryClient = useQueryClient()
  const [importId] = useState(() => crypto.randomUUID())
  const [decisions, setDecisions] = useState(() => preview.rows.map(suggested))
  const others = accounts.filter((a) => a.id !== account.id)
  const decide = (index: number, decision: ImportDecision) =>
    setDecisions((all) => all.map((d, i) => (i === index ? decision : d)))

  const commit = useMutation({
    mutationFn: () =>
      importStatement({ data: { ...statement, importId, decisions } }),
    onSuccess: async (result) => {
      if (!result.ok) return toast(result.message)
      await queryClient.invalidateQueries({ queryKey: ["ledger"] })
      onDone(result.value)
    },
    onError: () => toast.error("Couldn't import the statement."),
  })

  const groups = {
    logged: preview.rows.filter((r) => r.status === "logged"),
    transfer: preview.rows.filter((r) => r.status === "transfer"),
    new: preview.rows.filter((r) => r.status === "new"),
    imported: preview.rows.filter((r) => r.status === "imported"),
  }
  const count = decisions.filter((d) => d.action !== "skip").length

  const transferSelect = (row: PreviewRow, fallback: "none" | "skip") => {
    const decision = decisions[row.index]!
    const value =
      decision.action === "transfer" ? decision.accountId : NOT_TRANSFER
    const side = row.amount < 0 ? "To" : "From"
    const items = [
      { value: NOT_TRANSFER, label: row.amount < 0 ? "Spending" : "Income" },
      ...others.map((a) => ({ value: a.id, label: `${side} ${a.name}` })),
    ]
    return (
      <Select
        value={value}
        items={items}
        onValueChange={(next) =>
          decide(
            row.index,
            !next || next === NOT_TRANSFER
              ? { action: fallback === "skip" ? "skip" : "new" }
              : { action: "transfer", accountId: String(next) }
          )
        }
      >
        <SelectTrigger
          className="mt-1.5 h-8 w-full text-xs"
          aria-label={`What "${row.details}" is`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  const rowItem = (
    row: PreviewRow,
    note: React.ReactNode,
    control?: React.ReactNode
  ) => {
    const decision = decisions[row.index]!
    const included = decision.action !== "skip"
    return (
      <li key={row.index} className="flex items-start gap-3 py-2.5">
        <input
          type="checkbox"
          className="mt-1 size-4 shrink-0 accent-primary"
          checked={included}
          aria-label={`Import "${row.details}"`}
          onChange={(e) =>
            decide(
              row.index,
              e.target.checked ? suggested(row) : { action: "skip" }
            )
          }
        />
        <div className={cn("min-w-0 flex-1", !included && "opacity-50")}>
          <p className="truncate text-sm">{row.details || "No details"}</p>
          <p className="text-xs text-muted-foreground">
            {shortDate(row.localDate)}
            {note && <> · {note}</>}
          </p>
          {included && control}
        </div>
        <Amount value={row.amount} muted={!included} />
      </li>
    )
  }

  return (
    <div className="flex flex-col gap-5 pb-2">
      <div className="flex flex-col gap-1">
        <p className="text-sm">{checked}</p>
        {preview.importedBefore && (
          <p className="text-sm text-muted-foreground">
            You imported this file on{" "}
            {shortDate(
              new Date(preview.importedBefore).toISOString().slice(0, 10)
            )}
            .
          </p>
        )}
        {warning && <p className="text-sm text-destructive">{warning}</p>}
      </div>

      {groups.new.length > 0 && (
        <Group title="New" hint="Goatside files these like typed entries.">
          {groups.new.map((row) =>
            rowItem(
              row,
              null,
              row.transferish && others.length > 0
                ? transferSelect(row, "none")
                : undefined
            )
          )}
        </Group>
      )}
      {groups.transfer.length > 0 && (
        <Group
          title="Transfers"
          hint="Money moving between your accounts isn't spending."
        >
          {groups.transfer.map((row) =>
            rowItem(
              row,
              row.transfer?.convert &&
                decisions[row.index]?.action === "transfer" &&
                (decisions[row.index] as { accountId: string }).accountId ===
                  row.transfer.accountId
                ? `joins "${row.transfer.convert.description}"`
                : null,
              transferSelect(row, "none")
            )
          )}
        </Group>
      )}
      {groups.logged.length > 0 && (
        <Group
          title="Already logged"
          hint="These match entries you typed, so they're linked, not added again."
        >
          {groups.logged.map((row) => {
            const decision = decisions[row.index]!
            const linking = decision.action === "link"
            return rowItem(
              row,
              linking
                ? `matches "${row.match?.description || "an entry"}", ${shortDate(row.match!.localDate)}`
                : "will be added as new",
              <button
                type="button"
                className="mt-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                onClick={() =>
                  decide(row.index, { action: linking ? "new" : "link" })
                }
              >
                {linking ? "Not the same" : "Link it instead"}
              </button>
            )
          })}
        </Group>
      )}
      {groups.imported.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {groups.imported.length}{" "}
          {groups.imported.length === 1 ? "row was" : "rows were"} imported
          before and will be left alone.
        </p>
      )}

      <Button
        disabled={!count || commit.isPending}
        onClick={() => commit.mutate()}
      >
        {commit.isPending
          ? "Importing…"
          : count
            ? `Import ${count} ${count === 1 ? "row" : "rows"}`
            : "Nothing new to import"}
      </Button>
    </div>
  )
}

function Group({
  title,
  hint,
  children,
}: {
  title: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <ul className="flex flex-col divide-y">{children}</ul>
    </section>
  )
}

function Done({
  account,
  result,
  onClose,
}: {
  account: Account
  result: CommitResult
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["ledger"] })
  const [balance, setBalance] = useState(result.balance)
  const target = result.statementBalance
  const fix = useMutation({
    mutationFn: (value: number) =>
      setAccountBalance({ data: { id: account.id, balance: value } }),
    onSuccess: async (res, value) => {
      if (!res.ok) return toast(res.message)
      setBalance(value)
      await refresh()
    },
  })
  const undo = useMutation({
    mutationFn: () => undoStatementImport({ data: { id: result.importId! } }),
    onSuccess: async () => {
      await refresh()
      onClose()
      toast("Took the import back.")
    },
  })

  const parts = [
    result.added && `added ${result.added}`,
    result.linked && `linked ${result.linked}`,
  ].filter(Boolean)
  const said = (value: number) => {
    const text = balanceText({ ...account, balance: value })
    return text.label === "Owed" ? `${text.amount} owed` : text.amount
  }

  return (
    <div className="flex flex-col gap-4 pb-2">
      <p className="text-sm">
        {parts.length
          ? `Done: ${parts.join(", ")}.`
          : "Nothing needed importing."}
        {result.transfers > 0 &&
          ` ${result.transfers} ${result.transfers === 1 ? "is a transfer" : "are transfers"} between your accounts.`}
      </p>
      {target !== null && target !== balance && (
        <div className="flex flex-col gap-2 rounded-2xl border px-3 py-3">
          <p className="text-sm">
            The statement ends at {said(target)}. Goatside has {said(balance)}{" "}
            for {account.name}, maybe from entries after the statement or before
            you started.
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={fix.isPending}
            onClick={() => fix.mutate(target)}
          >
            Use the statement's{" "}
            {account.kind === "credit_card" ? "amount owed" : "balance"}
          </Button>
        </div>
      )}
      <div className="flex gap-2">
        <Button className="flex-1" onClick={onClose}>
          Done
        </Button>
        {result.importId && (
          <Button
            variant="ghost"
            disabled={undo.isPending}
            onClick={() => undo.mutate()}
          >
            Undo import
          </Button>
        )}
      </div>
    </div>
  )
}
