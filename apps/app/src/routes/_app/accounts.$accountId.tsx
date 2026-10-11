import { useState } from "react"
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router"
import {
  ArchiveIcon,
  ArrowLeftRightIcon,
  FileUpIcon,
  PencilIcon,
  StarIcon,
  Trash2Icon,
} from "lucide-react"
import { formatPeso, parseAmount } from "@workspace/core/money"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { toast } from "@workspace/ui/components/sonner"
import { cn } from "@workspace/ui/lib/utils"
import { AccountCard, balanceText } from "@/components/account-card"
import { AccountDrawer, AccountForm } from "@/components/account-form"
import { PageHeader } from "@/components/app-shell"
import { ImportStatement } from "@/components/import-statement"
import { Figure } from "@/components/motion"
import { EntryDrawer } from "@/components/transaction-drawer"
import { owedOn } from "@/lib/accounts"
import { capitalize, iouLabel, shortDate } from "@/lib/format"
import { accountQuery, accountsQuery, monthQuery } from "@/lib/queries"
import {
  type AccountDetail,
  chooseDefaultAccount,
  deleteAccount,
  editAccount,
  setAccountBalance,
} from "@/server/accounts"

export const Route = createFileRoute("/_app/accounts/$accountId")({
  loader: async ({ context, params }) => {
    const [account, view] = await Promise.all([
      context.queryClient.ensureQueryData(accountQuery(params.accountId)),
      context.queryClient.ensureQueryData(monthQuery()),
    ])
    if (!account) throw notFound()
    await context.queryClient.ensureQueryData(
      accountsQuery(view.today.slice(0, 7))
    )
  },
  head: () => ({ meta: [{ title: "Account · Goatside" }] }),
  component: Account,
})

function useRefresh() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: ["ledger"] })
}

function Account() {
  const { viewer } = Route.useRouteContext()
  const { accountId } = Route.useParams()
  const { data } = useSuspenseQuery(accountQuery(accountId))
  const { data: view } = useSuspenseQuery(monthQuery())
  const { data: overview } = useSuspenseQuery(
    accountsQuery(view.today.slice(0, 7))
  )
  if (!data) return null
  const { account } = data
  const isDefault = overview.defaultAccountId === account.id
  const thisMonth = overview.accounts.find((a) => a.id === account.id)
    ?.thisMonth ?? { in: 0, out: 0 }

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-md flex-col gap-8 px-4 pt-[max(env(safe-area-inset-top),1rem)] pb-16 lg:max-w-none lg:px-8 lg:pt-6">
      <PageHeader title={account.name} viewer={viewer} back="/accounts" />
      <div className="grid grid-cols-1 gap-6 lg:mx-auto lg:w-full lg:max-w-5xl lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-4 sm:flex-row">
            <AccountCard
              account={account}
              isDefault={isDefault}
              size="lg"
              className="w-full sm:max-w-sm"
            />
            <dl className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-1 sm:grid-rows-2 sm:gap-4">
              <div className="flex flex-col justify-end rounded-2xl border bg-card px-4 py-3">
                <dt className="text-xs text-muted-foreground">In this month</dt>
                <dd
                  className={cn(
                    "figure font-display text-3xl",
                    thisMonth.in > 0
                      ? "text-income-foreground"
                      : "text-muted-foreground"
                  )}
                >
                  <Figure value={thisMonth.in} />
                </dd>
              </div>
              <div className="flex flex-col justify-end rounded-2xl border bg-card px-4 py-3">
                <dt className="text-xs text-muted-foreground">
                  Out this month
                </dt>
                <dd
                  className={cn(
                    "figure font-display text-3xl",
                    thisMonth.out > 0
                      ? "text-expense-foreground"
                      : "text-muted-foreground"
                  )}
                >
                  <Figure value={thisMonth.out} />
                </dd>
              </div>
            </dl>
          </div>
          <History data={data} />
        </div>
        <aside className="flex flex-col gap-4">
          <Import data={data} accounts={overview.accounts} />
          <SetBalance key={`${account.id}:${account.balance}`} data={data} />
          <Manage data={data} isDefault={isDefault} />
        </aside>
      </div>
    </div>
  )
}

function Import({
  data,
  accounts,
}: {
  data: AccountDetail
  accounts: { id: string; name: string; archived: boolean }[]
}) {
  const [open, setOpen] = useState(false)
  const { account } = data
  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <h2 className="text-sm font-medium">Import a statement</h2>
      <p className="text-xs text-muted-foreground">
        Add the rows from the PDF or CSV your{" "}
        {account.kind === "credit_card" ? "card" : "bank"} sends you. Entries
        you already typed are matched, not added twice.
      </p>
      <Button
        variant="outline"
        size="sm"
        className="h-9 self-start"
        onClick={() => setOpen(true)}
      >
        <FileUpIcon />
        Choose a statement
      </Button>
      <ImportStatement
        account={account}
        accounts={accounts.filter((a) => !a.archived)}
        open={open}
        onClose={() => setOpen(false)}
      />
    </section>
  )
}

function SetBalance({ data }: { data: AccountDetail }) {
  const refresh = useRefresh()
  const { account } = data
  const card = account.kind === "credit_card"
  const [value, setValue] = useState("")
  const amount = parseAmount(value)
  const set = useMutation({
    mutationFn: (balance: number) =>
      setAccountBalance({ data: { id: account.id, balance } }),
    onSuccess: async (result, balance) => {
      if (!result.ok) return toast(result.message)
      const before = account.balance
      await refresh()
      toast(
        `${account.name} now reads ${balanceText({ ...account, balance }).amount}.`,
        {
          action: {
            label: "Undo",
            onClick: async () => {
              await setAccountBalance({
                data: { id: account.id, balance: before },
              })
              await refresh()
            },
          },
        }
      )
    },
    onError: () => toast.error("Couldn't update the balance."),
  })
  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <h2 className="text-sm font-medium">
        {card ? "Correct what's owed" : "Correct the balance"}
      </h2>
      <p className="text-xs text-muted-foreground">
        If the app or statement says something else, type it here. Your entries
        stay as they are.
      </p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (amount === null) return
          set.mutate(card ? -amount : amount)
        }}
      >
        <label htmlFor="balance-now" className="sr-only">
          {card ? "Owed now" : "Balance now"}
        </label>
        <Input
          id="balance-now"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          inputMode="decimal"
          placeholder={
            card
              ? formatPeso(owedOn(account.balance))
              : formatPeso(account.balance)
          }
          className="figure h-9 flex-1"
        />
        <Button
          type="submit"
          size="sm"
          className="h-9"
          disabled={amount === null || set.isPending}
        >
          Save
        </Button>
      </form>
    </section>
  )
}

function Manage({
  data,
  isDefault,
}: {
  data: AccountDetail
  isDefault: boolean
}) {
  const refresh = useRefresh()
  const navigate = useNavigate()
  const { account } = data
  const [editing, setEditing] = useState(false)

  const edit = useMutation({
    mutationFn: (
      fields: Omit<Parameters<typeof editAccount>[0]["data"], "id">
    ) => editAccount({ data: { id: account.id, ...fields } }),
    onSuccess: async (result) => {
      if (!result.ok) return toast(result.message)
      await refresh()
      setEditing(false)
    },
    onError: () => toast.error("Couldn't save that."),
  })
  const makeDefault = useMutation({
    mutationFn: () =>
      chooseDefaultAccount({ data: { id: isDefault ? null : account.id } }),
    onSuccess: async (result) => {
      if (!result.ok) return toast(result.message)
      await refresh()
    },
  })
  const remove = useMutation({
    mutationFn: () => deleteAccount({ data: { id: account.id } }),
    onSuccess: async (result) => {
      if (!result.ok) return toast(result.message)
      await navigate({ to: "/accounts" })
      await refresh()
      toast(
        result.value.archived
          ? `Archived ${account.name}. Its entries keep their account.`
          : `Deleted ${account.name}.`,
        result.value.archived
          ? {
              action: {
                label: "Undo",
                onClick: async () => {
                  await editAccount({
                    data: { id: account.id, archived: false },
                  })
                  await refresh()
                },
              },
            }
          : undefined
      )
    },
  })
  const used = data.history.length > 0

  return (
    <section className="flex flex-col gap-1 rounded-2xl border bg-card p-2">
      {account.aliases.length > 0 && (
        <p className="px-2 pt-1 pb-2 text-xs text-muted-foreground">
          Also goes by {account.aliases.join(", ")}
        </p>
      )}
      <Button
        variant="ghost"
        className="justify-start"
        onClick={() => setEditing(true)}
      >
        <PencilIcon />
        Edit
      </Button>
      <Button
        variant="ghost"
        className="justify-start"
        disabled={makeDefault.isPending}
        onClick={() => makeDefault.mutate()}
      >
        <StarIcon className={cn(isDefault && "fill-current")} />
        {isDefault ? "Stop using as default" : "Use for entries that name none"}
      </Button>
      <Button
        variant="ghost"
        className="justify-start text-destructive"
        disabled={remove.isPending}
        onClick={() => remove.mutate()}
      >
        {used ? <ArchiveIcon /> : <Trash2Icon />}
        {used ? "Archive" : "Delete"}
      </Button>
      <AccountDrawer
        open={editing}
        onClose={() => setEditing(false)}
        title={`Edit ${account.name}`}
      >
        {editing && (
          <AccountForm
            creating={false}
            initial={account}
            pending={edit.isPending}
            submitLabel="Save"
            onSubmit={(fields) => edit.mutate(fields)}
          />
        )}
      </AccountDrawer>
    </section>
  )
}

function History({ data }: { data: AccountDetail }) {
  const { history, account } = data
  const [open, setOpen] = useState<string | null>(null)
  const card = account.kind === "credit_card"
  if (!history.length) {
    return (
      <p className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
        Nothing filed here yet. Mention {account.name} in an entry, like "lunch
        via {account.name}".
      </p>
    )
  }
  return (
    <section aria-label="History" className="flex flex-col gap-3">
      <h2 className="px-1 text-sm font-medium text-muted-foreground">
        History
      </h2>
      <ul className="flex flex-col divide-y rounded-2xl border bg-card">
        {history.map((row) => {
          const iou = row.person
            ? iouLabel(row.kind, row.change, row.person)
            : null
          const transfer = row.kind === "transfer"
          const title =
            capitalize(row.description) ||
            row.category?.name ||
            (transfer ? "Transfer" : "Untitled")
          const after = card
            ? `${formatPeso(owedOn(row.balanceAfter))} owed`
            : formatPeso(row.balanceAfter)
          return (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => setOpen(row.id)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors [@media(hover:hover)]:hover:bg-muted/60"
              >
                <span
                  aria-hidden
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted"
                >
                  {transfer ? (
                    <ArrowLeftRightIcon className="size-4 text-muted-foreground" />
                  ) : iou ? (
                    "🤝"
                  ) : (
                    (row.category?.emoji ?? "·")
                  )}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{title}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {shortDate(row.localDate)}
                    {" · "}
                    {transfer
                      ? row.change > 0
                        ? `from ${row.other ?? "another account"}`
                        : `to ${row.other ?? "another account"}`
                      : (iou ?? row.category?.name ?? "Uncategorized")}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end">
                  <span
                    className={cn(
                      "figure font-display text-lg",
                      !transfer &&
                        !iou &&
                        row.change > 0 &&
                        "text-income-foreground",
                      !transfer &&
                        !iou &&
                        row.change < 0 &&
                        "text-expense-foreground",
                      (transfer || iou) && "text-muted-foreground"
                    )}
                  >
                    {formatPeso(row.change, { sign: row.change > 0 })}
                  </span>
                  <span className="figure text-[11px] text-muted-foreground">
                    {after}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {data.truncated && (
        <p className="px-1 text-xs text-muted-foreground">
          Showing the latest {history.length}.
        </p>
      )}
      <EntryDrawer id={open} onClose={() => setOpen(null)} />
    </section>
  )
}
