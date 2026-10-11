import { useState } from "react"
import { useSuspenseQuery } from "@tanstack/react-query"
import { Link, createFileRoute } from "@tanstack/react-router"
import { ChevronRightIcon, PlusIcon } from "lucide-react"
import { formatPeso } from "@workspace/core/money"
import { CoinMark } from "@workspace/ui/components/brand"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { PageHeader } from "@/components/app-shell"
import { IouDrawer } from "@/components/iou-form"
import { Figure } from "@/components/motion"
import { shortDate } from "@/lib/format"
import { peopleQuery } from "@/lib/queries"

export const Route = createFileRoute("/_app/people/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(peopleQuery()),
  head: () => ({ meta: [{ title: "People · Goatside" }] }),
  component: People,
})

function People() {
  const { viewer } = Route.useRouteContext()
  const { data: people } = useSuspenseQuery(peopleQuery())
  const [adding, setAdding] = useState(false)
  const owedToYou = people
    .filter((p) => p.owed > 0)
    .reduce((s, p) => s + p.owed, 0)
  const youOwe = people
    .filter((p) => p.owed < 0)
    .reduce((s, p) => s - p.owed, 0)

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-md flex-col gap-8 px-4 pt-[max(env(safe-area-inset-top),1rem)] pb-16 lg:max-w-none lg:px-8 lg:pt-6">
      <PageHeader
        title="People"
        viewer={viewer}
        action={
          <Button variant="outline" onClick={() => setAdding(true)}>
            <PlusIcon />
            Add an IOU
          </Button>
        }
      />
      <IouDrawer open={adding} onClose={() => setAdding(false)} />
      <div className="flex flex-col gap-6 lg:mx-auto lg:w-full lg:max-w-3xl">
        <p className="text-sm text-muted-foreground">
          Loans, repayments and shared bills, kept apart from your spending.
        </p>

        <dl className="grid grid-cols-2 gap-2 lg:gap-4">
          <div className="rounded-2xl border bg-card px-4 py-3">
            <dt className="text-xs text-muted-foreground">Owed to you</dt>
            <dd className="figure font-display text-3xl text-income-foreground">
              <Figure value={owedToYou} />
            </dd>
          </div>
          <div className="rounded-2xl border bg-card px-4 py-3">
            <dt className="text-xs text-muted-foreground">You owe</dt>
            <dd className="figure font-display text-3xl">
              <Figure value={youOwe} />
            </dd>
          </div>
        </dl>

        {people.length ? (
          <ul className="flex flex-col divide-y rounded-2xl border bg-card">
            {people.map((p) => (
              <li key={p.id}>
                <Link
                  to="/people/$personId"
                  params={{ personId: p.id }}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60"
                >
                  <span
                    aria-hidden
                    className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted font-medium"
                  >
                    {p.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{p.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {p.entries
                        ? `${p.entries} IOU${p.entries === 1 ? "" : "s"}`
                        : "No IOUs yet"}
                      {p.lastActivity
                        ? ` · last ${shortDate(p.lastActivity)}`
                        : ""}
                      {p.aliases.length ? ` · aka ${p.aliases.join(", ")}` : ""}
                    </span>
                  </span>
                  <span className="flex flex-col items-end">
                    <span
                      className={cn(
                        "figure font-display text-xl",
                        p.owed > 0 && "text-income-foreground",
                        p.owed === 0 && "text-muted-foreground"
                      )}
                    >
                      {p.owed === 0 ? "Square" : formatPeso(Math.abs(p.owed))}
                    </span>
                    {p.owed !== 0 && (
                      <span className="text-xs text-muted-foreground">
                        {p.owed > 0 ? "owes you" : "you owe"}
                      </span>
                    )}
                  </span>
                  <ChevronRightIcon
                    aria-hidden
                    className="size-4 text-muted-foreground"
                  />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <section className="flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-10 text-center">
            <CoinMark className="size-10 text-muted-foreground" />
            <p className="font-display text-2xl">No one yet.</p>
            <p className="text-sm text-muted-foreground">
              When you lend, borrow or split a bill with someone, they'll show
              up here with what you owe each other.
            </p>
          </section>
        )}
      </div>
    </div>
  )
}
