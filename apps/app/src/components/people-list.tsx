import { useId } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { formatPeso } from "@workspace/core/money"
import { toast } from "@workspace/ui/components/sonner"
import { cn } from "@workspace/ui/lib/utils"
import { type MonthView, deleteTransactions, settleUp } from "@/server/ledger"

/** Open IOUs: who owes you, and whom you owe. Hidden when everyone's square. */
export function PeopleList({ people }: { people: MonthView["people"] }) {
  const headingId = useId()
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["month"] })

  const settle = useMutation({
    mutationFn: (person: MonthView["people"][number]) =>
      settleUp({ data: { personId: person.id } }),
    onSuccess: async (result, person) => {
      await refresh()
      toast(`You and ${person.name} are square.`, {
        action: result.id
          ? {
              label: "Undo",
              onClick: async () => {
                if (result.id)
                  await deleteTransactions({ data: { ids: [result.id] } })
                await refresh()
              },
            }
          : undefined,
      })
    },
    onError: () => toast.error("Couldn’t settle that. Try again."),
  })

  if (!people.length) return null

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2
        id={headingId}
        className="px-1 text-sm font-medium text-muted-foreground"
      >
        People
        <Link
          to="/people"
          className="ml-2 font-normal underline-offset-4 hover:text-foreground hover:underline"
        >
          See all
        </Link>
      </h2>
      <ul className="flex flex-col divide-y rounded-2xl border bg-card">
        {people.map((person) => {
          const owesYou = person.owed > 0
          return (
            <li key={person.id} className="flex items-center gap-3 px-3 py-2.5">
              <span
                aria-hidden
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium"
              >
                {person.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <Link
                  to="/people/$personId"
                  params={{ personId: person.id }}
                  className="truncate underline-offset-4 hover:underline"
                >
                  {person.name}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {owesYou ? "owes you" : "you owe"}
                </span>
              </span>
              <span
                className={cn(
                  "figure font-display text-xl",
                  owesYou && "text-income-foreground"
                )}
              >
                {formatPeso(Math.abs(person.owed))}
              </span>
              <button
                type="button"
                disabled={settle.isPending}
                onClick={() => settle.mutate(person)}
                className="rounded-full border px-3 py-1.5 text-xs transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] disabled:opacity-40 [@media(hover:hover)]:hover:bg-muted"
              >
                Settle
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
