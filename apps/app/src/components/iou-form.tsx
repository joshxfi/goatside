import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { formatPeso, parseAmount } from "@workspace/core/money"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { toast } from "@workspace/ui/components/sonner"
import { AccountDrawer } from "@/components/account-form"
import {
  AccountPicker,
  Chip,
  ChipGroup,
  PersonPicker,
} from "@/components/chips"
import { peopleQuery } from "@/lib/queries"
import { deleteTransactions, getEditorChoices } from "@/server/ledger"
import { recordIou } from "@/server/people"

type IouType = "lent" | "borrowed"

/**
 * "Add an IOU" by hand: who, which way, how much. Saved as typed, with no
 * model reading it, for when the composer or the agent isn't the way.
 */
export function IouDrawer({
  open,
  personId,
  onClose,
}: {
  open: boolean
  /** Preselected on a person's page; picked (or added) in the form otherwise. */
  personId?: string
  onClose: () => void
}) {
  return (
    <AccountDrawer
      open={open}
      onClose={onClose}
      title="Add an IOU"
      description="Money you lent or paid for someone, or they for you. It stays out of your spending."
    >
      {open && <IouForm personId={personId} onDone={onClose} />}
    </AccountDrawer>
  )
}

function IouForm({
  personId,
  onDone,
}: {
  personId?: string
  onDone: () => void
}) {
  const queryClient = useQueryClient()
  const choices = useQuery({
    queryKey: ["ledger", "choices"],
    queryFn: () => getEditorChoices(),
  })
  const everyone = useQuery(peopleQuery())
  const [type, setType] = useState<IouType>("lent")
  const [who, setWho] = useState(personId ? [personId] : [])
  const [amountText, setAmountText] = useState("")
  const [description, setDescription] = useState("")
  const [localDate, setLocalDate] = useState<string | null>(null)
  // Lending moves your money, from the default account unless you say;
  // when someone pays for you, none of your accounts moved.
  const [accountId, setAccountId] = useState<string | null | undefined>()

  const date = localDate ?? choices.data?.today ?? ""
  const account =
    accountId !== undefined
      ? accountId
      : type === "lent"
        ? (choices.data?.defaultAccountId ?? null)
        : null
  const amount = parseAmount(amountText)
  const name = everyone.data?.find((p) => p.id === who[0])?.name

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["ledger"] })

  const save = useMutation({
    mutationFn: () =>
      recordIou({
        data: {
          personId: who[0] ?? "",
          type,
          amount: amount ?? 0,
          description,
          localDate: date,
          accountId: account,
        },
      }),
    onSuccess: async (result) => {
      if (!result.ok) return toast(result.message)
      onDone()
      await refresh()
      const id = result.value.id
      toast(
        type === "lent"
          ? `Lent ${name ?? "them"} ${formatPeso(amount ?? 0)}.`
          : `Borrowed ${formatPeso(amount ?? 0)} from ${name ?? "them"}.`,
        id
          ? {
              action: {
                label: "Undo",
                onClick: async () => {
                  await deleteTransactions({ data: { ids: [id] } })
                  await refresh()
                },
              },
            }
          : undefined
      )
    },
    onError: () => toast.error("Couldn't save that IOU."),
  })

  const ready = who.length === 1 && amount !== null && Boolean(date)

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault()
        if (ready) save.mutate()
      }}
    >
      <ChipGroup legend="What happened">
        <Chip active={type === "lent"} onClick={() => setType("lent")}>
          I lent or paid for them
        </Chip>
        <Chip active={type === "borrowed"} onClick={() => setType("borrowed")}>
          They lent or paid for me
        </Chip>
      </ChipGroup>

      {!personId && (
        <PersonPicker
          legend="Who"
          people={everyone.data ?? []}
          value={who}
          onChange={setWho}
        />
      )}

      <div className="flex flex-col gap-2">
        <label htmlFor="iou-amount" className="text-sm font-medium">
          Amount
        </label>
        <div className="relative">
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
          >
            ₱
          </span>
          <Input
            id="iou-amount"
            inputMode="decimal"
            autoComplete="off"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            aria-invalid={amountText !== "" && amount === null}
            className="figure h-11 pl-7 text-base font-normal"
          />
        </div>
        {amountText !== "" && amount === null && (
          <p className="text-xs text-destructive">
            Type an amount, like 250 or 1,250.50.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="iou-description" className="text-sm font-medium">
          What for <span className="text-muted-foreground">(optional)</span>
        </label>
        <Input
          id="iou-description"
          value={description}
          maxLength={200}
          placeholder="e.g. concert tickets"
          onChange={(e) => setDescription(e.target.value)}
          className="h-11 text-base font-normal"
        />
      </div>

      {(choices.data?.accounts.length ?? 0) > 0 && (
        <AccountPicker
          legend={type === "lent" ? "Paid with" : "Received in"}
          accounts={choices.data?.accounts ?? []}
          value={account}
          onChange={setAccountId}
          allowNone
        />
      )}

      <div className="flex flex-col gap-2">
        <label htmlFor="iou-date" className="text-sm font-medium">
          Date
        </label>
        <Input
          id="iou-date"
          type="date"
          value={date}
          max={choices.data?.today}
          onChange={(e) => e.target.value && setLocalDate(e.target.value)}
          className="h-11 text-base font-normal"
        />
      </div>

      <Button
        type="submit"
        size="lg"
        className="h-11"
        disabled={!ready || save.isPending}
      >
        {save.isPending ? "Saving…" : "Add IOU"}
      </Button>
    </form>
  )
}
