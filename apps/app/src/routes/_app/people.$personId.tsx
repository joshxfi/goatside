import { useState } from "react"
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router"
import { CopyIcon, MergeIcon, SendIcon, XIcon } from "lucide-react"
import { formatPeso, parseAmount } from "@workspace/core/money"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Input } from "@workspace/ui/components/input"
import { toast } from "@workspace/ui/components/sonner"
import { cn } from "@workspace/ui/lib/utils"
import { PageHeader } from "@/components/app-shell"
import { capitalize, iouLabel, shortDate } from "@/lib/format"
import { peopleQuery, personQuery } from "@/lib/queries"
import { deleteTransactions, settleUp } from "@/server/ledger"
import {
  type PersonDetail,
  editPerson,
  mergePerson,
  remindPerson,
} from "@/server/people"

export const Route = createFileRoute("/_app/people/$personId")({
  loader: async ({ context, params }) => {
    const [person] = await Promise.all([
      context.queryClient.ensureQueryData(personQuery(params.personId)),
      context.queryClient.ensureQueryData(peopleQuery()),
    ])
    if (!person) throw notFound()
  },
  head: () => ({ meta: [{ title: "Person · Goatside" }] }),
  component: Person,
})

function useRefresh() {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["people"] }),
      queryClient.invalidateQueries({ queryKey: ["month"] }),
    ])
}

function Person() {
  const { viewer } = Route.useRouteContext()
  const { personId } = Route.useParams()
  const { data: person } = useSuspenseQuery(personQuery(personId))
  if (!person) return null

  return (
    <div className="mx-auto flex min-h-svh max-w-md flex-col gap-8 px-4 pt-[max(env(safe-area-inset-top),1rem)] pb-16 lg:max-w-[90rem] lg:px-8 lg:pt-6">
      <PageHeader title={person.name} viewer={viewer} back="/people" />
      <div className="grid gap-6 lg:mx-auto lg:w-full lg:max-w-5xl lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="flex flex-col gap-6">
          <Balance key={`${person.id}:${person.owed}`} person={person} />
          <History person={person} />
        </div>
        <aside className="flex flex-col gap-4">
          <Nicknames key={person.id} person={person} />
          <Manage person={person} />
        </aside>
      </div>
    </div>
  )
}

function Balance({ person }: { person: PersonDetail }) {
  const refresh = useRefresh()
  const [part, setPart] = useState("")
  const [reminder, setReminder] = useState<string | null>(null)
  const owesYou = person.owed > 0
  const square = person.owed === 0

  const settle = useMutation({
    mutationFn: (amount?: number) =>
      settleUp({ data: { personId: person.id, amount } }),
    onSuccess: async (result) => {
      await refresh()
      setPart("")
      if (!result.id) return
      const id = result.id
      toast(
        `Recorded ${formatPeso(Math.abs(result.amount))} ${result.amount > 0 ? "from" : "to"} ${person.name}.`,
        {
          action: {
            label: "Undo",
            onClick: async () => {
              await deleteTransactions({ data: { ids: [id] } })
              await refresh()
            },
          },
        }
      )
    },
    onError: () => toast.error("Couldn’t record that."),
  })

  const remind = useMutation({
    mutationFn: () => remindPerson({ data: { id: person.id } }),
    onSuccess: (result) => {
      if (!result.ok) return toast(result.message)
      setReminder(result.value.text)
    },
    onError: () => toast.error("Couldn’t draft a reminder. Try again."),
  })

  const partAmount = parseAmount(part)

  return (
    <section className="flex flex-col gap-4 rounded-2xl border bg-card p-5">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-4xl leading-none">{person.name}</h1>
        <p className="text-sm text-muted-foreground">
          {square ? "You’re square." : owesYou ? "owes you" : "you owe"}
        </p>
        {!square && (
          <p
            className={cn(
              "figure font-display text-6xl leading-none tracking-tight",
              owesYou && "text-gold-foreground"
            )}
          >
            {formatPeso(Math.abs(person.owed))}
          </p>
        )}
      </div>

      {!square && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => settle.mutate(undefined)}
            disabled={settle.isPending}
          >
            {owesYou ? "They paid it all" : "I paid it all"}
          </Button>
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (partAmount) settle.mutate(partAmount)
            }}
          >
            <label htmlFor="part" className="sr-only">
              Amount paid back
            </label>
            <Input
              id="part"
              inputMode="decimal"
              value={part}
              onChange={(e) => setPart(e.target.value)}
              placeholder="Part, e.g. 500"
              className="h-9 w-36"
            />
            <Button
              type="submit"
              variant="outline"
              disabled={!partAmount || settle.isPending}
            >
              Record part
            </Button>
          </form>
          {owesYou && (
            <Button
              variant="ghost"
              onClick={() => remind.mutate()}
              disabled={remind.isPending}
              className="ml-auto"
            >
              <SendIcon />
              {remind.isPending ? "Drafting…" : "Draft a reminder"}
            </Button>
          )}
        </div>
      )}

      {reminder && (
        <div className="flex flex-col gap-2 rounded-xl bg-muted p-3">
          <label htmlFor="reminder" className="text-xs text-muted-foreground">
            Drafted by Goatside. Edit it, then copy or share. Nothing is sent
            for you.
          </label>
          <textarea
            id="reminder"
            value={reminder}
            onChange={(e) => setReminder(e.target.value)}
            rows={3}
            className="resize-none rounded-lg bg-card p-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(reminder)
                toast("Copied.")
              }}
            >
              <CopyIcon />
              Copy
            </Button>
            {typeof navigator !== "undefined" && "share" in navigator && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  navigator.share({ text: reminder }).catch(() => {})
                }
              >
                <SendIcon />
                Share
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={() => setReminder(null)}
            >
              Close
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}

function History({ person }: { person: PersonDetail }) {
  return (
    <section aria-labelledby="history-heading" className="flex flex-col gap-3">
      <h2
        id="history-heading"
        className="px-1 text-sm font-medium text-muted-foreground"
      >
        History
      </h2>
      {person.history.length ? (
        <ol className="flex flex-col divide-y rounded-2xl border bg-card">
          {person.history.map((h) => (
            <li key={h.id} className="flex items-center gap-3 px-4 py-3">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">
                  {capitalize(h.description) || "IOU"}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {shortDate(h.localDate)} ·{" "}
                  {iouLabel(h.kind, h.amount, person.name)}
                </span>
              </span>
              <span className="flex flex-col items-end">
                <span className="figure font-display text-lg">
                  {formatPeso(h.amount, { sign: h.amount > 0 })}
                </span>
                <span className="figure text-xs text-muted-foreground">
                  {h.owedAfter === 0
                    ? "square after"
                    : `${h.owedAfter > 0 ? "owes" : "you owe"} ${formatPeso(Math.abs(h.owedAfter))} after`}
                </span>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="rounded-2xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          No IOUs with {person.name} yet.
        </p>
      )}
    </section>
  )
}

/** Names Goatside should also read as this person: "mars", "kuya ben". */
function Nicknames({ person }: { person: PersonDetail }) {
  const refresh = useRefresh()
  const [draft, setDraft] = useState("")
  const save = useMutation({
    mutationFn: (aliases: string[]) =>
      editPerson({ data: { id: person.id, aliases } }),
    onSuccess: async (result) => {
      if (!result.ok) return toast(result.message)
      setDraft("")
      await refresh()
    },
  })

  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-medium">Nicknames</h2>
        <p className="text-xs text-muted-foreground">
          Goatside matches these in what you type, so “paid by mars” goes to{" "}
          {person.name}.
        </p>
      </div>
      {person.aliases.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {person.aliases.map((a) => (
            <li
              key={a}
              className="flex items-center gap-1 rounded-full bg-muted py-1 pr-1 pl-3 text-sm"
            >
              {a}
              <button
                type="button"
                aria-label={`Remove ${a}`}
                onClick={() =>
                  save.mutate(person.aliases.filter((x) => x !== a))
                }
                className="flex size-5 items-center justify-center rounded-full hover:bg-background"
              >
                <XIcon className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (draft.trim()) save.mutate([...person.aliases, draft])
        }}
      >
        <label htmlFor="nickname" className="sr-only">
          Add a nickname
        </label>
        <Input
          id="nickname"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a nickname"
          maxLength={40}
          className="h-9"
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={!draft.trim() || save.isPending}
        >
          Add
        </Button>
      </form>
    </section>
  )
}

function Manage({ person }: { person: PersonDetail }) {
  const refresh = useRefresh()
  const router = useRouter()
  const { data: everyone } = useSuspenseQuery(peopleQuery())
  const others = everyone.filter((p) => p.id !== person.id)
  const [name, setName] = useState(person.name)

  const rename = useMutation({
    mutationFn: () => editPerson({ data: { id: person.id, name } }),
    onSuccess: async (result) => {
      if (!result.ok) {
        setName(person.name)
        return toast(result.message)
      }
      await refresh()
      toast("Renamed.")
    },
  })
  const merge = useMutation({
    mutationFn: (into: string) =>
      mergePerson({ data: { from: person.id, into } }),
    onSuccess: async (result, into) => {
      if (!result.ok) return toast(result.message)
      await refresh()
      toast(`Merged. ${person.name} is now a nickname.`)
      await router.navigate({
        to: "/people/$personId",
        params: { personId: into },
      })
    },
  })

  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <h2 className="text-sm font-medium">Details</h2>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim() && name.trim() !== person.name) rename.mutate()
        }}
      >
        <label htmlFor="person-name" className="sr-only">
          Name
        </label>
        <Input
          id="person-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          className="h-9"
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={!name.trim() || name.trim() === person.name}
        >
          Rename
        </Button>
      </form>
      {others.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger className="flex h-9 items-center justify-center gap-2 rounded-lg border text-sm transition-colors hover:bg-muted">
            <MergeIcon className="size-4" />
            Same person as…
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Merge {person.name} into</DropdownMenuLabel>
              {others.map((o) => (
                <DropdownMenuItem key={o.id} onClick={() => merge.mutate(o.id)}>
                  {o.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </section>
  )
}
