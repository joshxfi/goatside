import { useState } from "react"
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { Link, createFileRoute } from "@tanstack/react-router"
import { PlusIcon, MessageCircleQuestionMarkIcon } from "lucide-react"
import { formatMoney } from "@workspace/core/money"
import { CoinMark } from "@workspace/ui/components/brand"
import { Button } from "@workspace/ui/components/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { toast } from "@workspace/ui/components/sonner"
import { cn } from "@workspace/ui/lib/utils"
import { AccountCard } from "@/components/account-card"
import { AccountDrawer, AccountForm } from "@/components/account-form"
import { useAgent } from "@/components/agent-provider"
import { PageFrame, PageHeader } from "@/components/app-shell"
import { KIND_SECTIONS, owedOn } from "@/lib/accounts"
import { shortDate } from "@/lib/format"
import { accountsQuery, monthQuery } from "@/lib/queries"
import {
  type AccountsOverview,
  addAccount,
  chooseDefaultAccount,
  editAccount,
} from "@/server/accounts"

export const Route = createFileRoute("/_app/accounts/")({
  loader: async ({ context }) => {
    const view = await context.queryClient.ensureQueryData(monthQuery())
    await context.queryClient.ensureQueryData(
      accountsQuery(view.today.slice(0, 7))
    )
  },
  head: () => ({ meta: [{ title: "Accounts · Goatside" }] }),
  component: Accounts,
})

function Accounts() {
  const { viewer } = Route.useRouteContext()
  const { data: view } = useSuspenseQuery(monthQuery())
  const { data } = useSuspenseQuery(accountsQuery(view.today.slice(0, 7)))
  const [adding, setAdding] = useState(false)
  const open = data.accounts.filter((a) => !a.archived)
  const archived = data.accounts.filter((a) => a.archived)

  const held = open
    .filter((a) => a.kind !== "credit_card")
    .reduce((s, a) => s + a.balance, 0)
  const owed = open
    .filter((a) => a.kind === "credit_card")
    .reduce((s, a) => s + owedOn(a.balance), 0)

  return (
    <PageFrame width="default">
      <PageHeader
        title="Accounts"
        viewer={viewer}
        action={
          open.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <PlusIcon />
              Add
              <span className="hidden sm:inline"> account</span>
            </Button>
          )
        }
      />
      <div className="flex flex-col gap-8">
        {open.length ? (
          <>
            <dl className="grid grid-cols-2 gap-2 lg:grid-cols-3 lg:gap-4">
              <Stat label="In your accounts" value={held} />
              <Stat label="Owed on cards" value={owed} />
              <Stat
                label="Net"
                value={held - owed}
                className="col-span-2 lg:col-span-1"
              />
            </dl>
            <DefaultAccount data={data} />
            {KIND_SECTIONS.map(({ kind, title }) => {
              const list = open.filter((a) => a.kind === kind)
              if (!list.length) return null
              return (
                <section
                  key={kind}
                  aria-labelledby={`accounts-${kind}`}
                  className="flex flex-col gap-3"
                >
                  <h2
                    id={`accounts-${kind}`}
                    className="text-sm font-medium text-muted-foreground"
                  >
                    {title}
                  </h2>
                  <ul className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
                    {list.map((a) => (
                      <li key={a.id} className="flex flex-col gap-1.5">
                        <Link
                          to="/accounts/$accountId"
                          params={{ accountId: a.id }}
                          className="rounded-2xl transition-transform duration-150 ease-out outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98]"
                        >
                          <AccountCard
                            account={a}
                            isDefault={a.id === data.defaultAccountId}
                          />
                        </Link>
                        <p className="figure px-1 text-xs text-muted-foreground">
                          {a.thisMonth.in || a.thisMonth.out ? (
                            <>
                              This month
                              {a.thisMonth.in > 0 && (
                                <span className="text-income-foreground">
                                  {" "}
                                  +{formatMoney(a.thisMonth.in)} in
                                </span>
                              )}
                              {a.thisMonth.out > 0 && (
                                <span className="text-expense-foreground">
                                  {" "}
                                  −{formatMoney(a.thisMonth.out)} out
                                </span>
                              )}
                            </>
                          ) : a.lastActivity ? (
                            `Last used ${shortDate(a.lastActivity)}`
                          ) : (
                            "Nothing filed here yet"
                          )}
                        </p>
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}
            {archived.length > 0 && <Archived list={archived} />}
          </>
        ) : (
          <Empty onAdd={() => setAdding(true)} />
        )}
      </div>
      <AddAccount open={adding} onClose={() => setAdding(false)} />
    </PageFrame>
  )
}

function Stat({
  label,
  value,
  className,
}: {
  label: string
  value: number
  className?: string
}) {
  return (
    <div className={cn("rounded-2xl border bg-card px-4 py-3", className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="figure font-display text-3xl">{formatMoney(value)}</dd>
    </div>
  )
}

function useRefresh() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: ["ledger"] })
}

function DefaultAccount({ data }: { data: AccountsOverview }) {
  const refresh = useRefresh()
  const open = data.accounts.filter((a) => !a.archived)
  const choose = useMutation({
    mutationFn: (id: string | null) => chooseDefaultAccount({ data: { id } }),
    onSuccess: async (result) => {
      if (!result.ok) return toast(result.message)
      await refresh()
    },
    onError: () => toast.error("Couldn't change that."),
  })
  const items = [
    { value: "none", label: "Leave them unfiled" },
    ...open.map((a) => ({ value: a.id, label: a.name })),
  ]
  return (
    <div className="flex flex-col gap-2 rounded-2xl border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm">
        Entries that don't name an account go to
        <span className="block text-xs text-muted-foreground">
          Name one in the entry to file it elsewhere, like "via GCash".
        </span>
      </p>
      <Select
        value={data.defaultAccountId ?? "none"}
        onValueChange={(value) =>
          choose.mutate(value && value !== "none" ? String(value) : null)
        }
        items={items}
      >
        <SelectTrigger
          className="h-9 w-full sm:w-52"
          aria-label="Default account"
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
    </div>
  )
}

function AddAccount({ open, onClose }: { open: boolean; onClose: () => void }) {
  const refresh = useRefresh()
  const add = useMutation({
    mutationFn: (fields: Parameters<typeof addAccount>[0]["data"]) =>
      addAccount({ data: fields }),
    onSuccess: async (result, fields) => {
      if (!result.ok) return toast(result.message)
      await refresh()
      onClose()
      toast(`Added ${fields.name}.`)
    },
    onError: () => toast.error("Couldn't add that account."),
  })
  return (
    <AccountDrawer
      open={open}
      onClose={onClose}
      title="Add an account"
      description="A bank, e-wallet, credit card or cash. Name it in an entry and it's filed there."
    >
      {open && (
        <AccountForm
          creating
          pending={add.isPending}
          submitLabel="Add account"
          onSubmit={(fields) => add.mutate(fields)}
        />
      )}
    </AccountDrawer>
  )
}

function Archived({ list }: { list: AccountsOverview["accounts"] }) {
  const refresh = useRefresh()
  const restore = useMutation({
    mutationFn: (id: string) => editAccount({ data: { id, archived: false } }),
    onSuccess: async (result) => {
      if (!result.ok) return toast(result.message)
      await refresh()
    },
  })
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-muted-foreground">Archived</h2>
      <ul className="flex flex-col divide-y rounded-2xl border bg-card">
        {list.map((a) => (
          <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
            <span className="min-w-0 flex-1 truncate">{a.name}</span>
            <span className="figure text-sm text-muted-foreground">
              {formatMoney(a.balance)}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={restore.isPending}
              onClick={() => restore.mutate(a.id)}
            >
              Restore
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Empty({ onAdd }: { onAdd: () => void }) {
  const { ask } = useAgent()
  return (
    <section className="flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-10 text-center lg:max-w-lg">
      <CoinMark className="size-10 text-muted-foreground" />
      <p className="font-display text-2xl">Where does your money sit?</p>
      <p className="text-sm text-muted-foreground">
        Add your banks, e-wallets and credit cards to see their balances. Then
        say which one you used when you log, like "taxi via GCash", and it moves
        the right balance.
      </p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <Button onClick={onAdd}>
          <PlusIcon />
          Add an account
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            ask("Help me set up my bank accounts, e-wallets and credit cards.")
          }
        >
          <MessageCircleQuestionMarkIcon />
          Set up with Goatside
        </Button>
      </div>
    </section>
  )
}
