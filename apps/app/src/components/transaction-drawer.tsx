import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Trash2Icon } from "lucide-react"
import { toast } from "@workspace/ui/components/sonner"
import { formatPeso } from "@workspace/core/money"
import { Button } from "@workspace/ui/components/button"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@workspace/ui/components/drawer"
import { Input } from "@workspace/ui/components/input"
import { useDesktop } from "@/lib/use-desktop"
import { cn } from "@workspace/ui/lib/utils"
import { iouLabel } from "@/lib/format"
import {
  type LedgerTxn,
  type MonthView,
  deleteTransactions,
  restoreTransactions,
  updateTransaction,
} from "@/server/ledger"

export function TransactionDrawer({
  txn,
  categories,
  onClose,
}: {
  txn: LedgerTxn | null
  categories: MonthView["categories"]
  onClose: () => void
}) {
  const desktop = useDesktop()
  // Keep the last transaction around so content doesn't vanish mid-close.
  const [shown, setShown] = useState(txn)
  if (txn && txn !== shown) setShown(txn)

  return (
    <Drawer
      open={Boolean(txn)}
      onOpenChange={(open) => !open && onClose()}
      swipeDirection={desktop ? "right" : "down"}
    >
      <DrawerContent
        className={desktop ? "w-[26rem] justify-center" : undefined}
      >
        {shown && (
          <EditForm
            key={shown.id}
            txn={shown}
            categories={categories}
            onDone={onClose}
          />
        )}
      </DrawerContent>
    </Drawer>
  )
}

function EditForm({
  txn,
  categories,
  onDone,
}: {
  txn: LedgerTxn
  categories: MonthView["categories"]
  onDone: () => void
}) {
  const queryClient = useQueryClient()
  const [description, setDescription] = useState(txn.description)
  const [localDate, setLocalDate] = useState(txn.localDate)
  const iou = txn.person
    ? iouLabel(txn.kind, txn.amount, txn.person.name)
    : null
  const income = txn.amount > 0 && !iou
  const options = categories.filter(
    (c) => c.kind === (income ? "income" : "expense")
  )

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["month"] })

  const update = useMutation({
    mutationFn: (changes: {
      categoryId?: string | null
      description?: string
      localDate?: string
    }) => updateTransaction({ data: { id: txn.id, ...changes } }),
    onSuccess: () => {
      onDone()
      return refresh()
    },
    onError: () => toast.error("Couldn’t save that change."),
  })

  const remove = useMutation({
    mutationFn: () => deleteTransactions({ data: { ids: [txn.id] } }),
    onSuccess: async () => {
      onDone()
      await refresh()
      toast("Deleted.", {
        action: {
          label: "Undo",
          onClick: async () => {
            await restoreTransactions({ data: { ids: [txn.id] } })
            await refresh()
          },
        },
      })
    },
  })

  const dirty = description !== txn.description || localDate !== txn.localDate

  return (
    <form
      className="mx-auto flex w-full max-w-md flex-col"
      onSubmit={(e) => {
        e.preventDefault()
        if (dirty) update.mutate({ description: description.trim(), localDate })
        else onDone()
      }}
    >
      <DrawerHeader className="items-center gap-1 text-center">
        <DrawerTitle
          className={cn(
            "figure font-display text-5xl font-normal",
            income && "text-gold-foreground"
          )}
        >
          {formatPeso(txn.amount, { sign: txn.amount > 0 })}
        </DrawerTitle>
        <DrawerDescription>
          {txn.split ? `Your share of a ${txn.split}-way split. ` : ""}
          Amounts stay exactly as typed.
        </DrawerDescription>
      </DrawerHeader>

      <div className="flex flex-col gap-5 px-4">
        {iou ? (
          <p className="rounded-xl bg-muted px-3.5 py-3 text-sm">
            🤝 {iou}. IOUs don’t count toward your spending.
          </p>
        ) : (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">Category</legend>
            <div className="flex flex-wrap gap-2">
              {options.map((c) => {
                const active = c.id === txn.category?.id
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={active}
                    disabled={update.isPending}
                    onClick={() =>
                      update.mutate({ categoryId: active ? null : c.id })
                    }
                    className={cn(
                      "flex h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm transition-[background-color,transform] duration-150 ease-out active:scale-[0.97]",
                      active
                        ? "border-foreground bg-foreground text-background"
                        : "bg-card [@media(hover:hover)]:hover:bg-muted"
                    )}
                  >
                    <span aria-hidden>{c.emoji}</span>
                    {c.name}
                  </button>
                )
              })}
            </div>
          </fieldset>
        )}

        <div className="flex flex-col gap-2">
          <label htmlFor="txn-description" className="text-sm font-medium">
            Description
          </label>
          <Input
            id="txn-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={200}
            className="h-11 text-base font-normal"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="txn-date" className="text-sm font-medium">
            Date
          </label>
          <Input
            id="txn-date"
            type="date"
            value={localDate}
            onChange={(e) => e.target.value && setLocalDate(e.target.value)}
            className="h-11 text-base font-normal"
          />
        </div>
      </div>

      <DrawerFooter className="flex-row gap-2 pb-[max(env(safe-area-inset-bottom),1rem)]">
        <Button
          type="button"
          variant="ghost"
          size="lg"
          className="h-11 text-destructive"
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
        >
          <Trash2Icon />
          Delete
        </Button>
        <Button
          type="submit"
          size="lg"
          className="h-11 flex-1"
          disabled={update.isPending}
        >
          {dirty ? "Save" : "Done"}
        </Button>
      </DrawerFooter>
    </form>
  )
}
