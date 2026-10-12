import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { PlusIcon } from "lucide-react"
import { Input } from "@workspace/ui/components/input"
import { toast } from "@workspace/ui/components/sonner"
import { cn } from "@workspace/ui/lib/utils"
import { addCategory } from "@/server/settings"

/*
 * The pills a confirmation is answered with, and the way past its
 * suggestions: every other category of the right kind, or a new one.
 */

export interface CategoryChoice {
  id: string
  name: string
  emoji: string
  kind: "expense" | "income"
}

export function AnswerButton({
  guess,
  tone,
  className,
  ...props
}: React.ComponentProps<"button"> & {
  /** The value currently saved on the entry. */
  guess?: boolean
  tone?: "income" | "expense"
}) {
  return (
    <button
      type="button"
      aria-pressed={guess ? true : undefined}
      className={cn(
        "flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] disabled:opacity-60 [@media(hover:hover)]:hover:bg-muted",
        guess && "border-foreground/40 bg-muted",
        tone === "income" && "text-income-foreground",
        tone === "expense" && "text-expense-foreground",
        className
      )}
      {...props}
    />
  )
}

/**
 * A pill that opens into the remaining categories of `kind` and "New
 * category". Renders pills only, so it joins the caller's wrapping row. A
 * new name that matches an existing category picks that one instead.
 */
export function OtherCategories({
  categories,
  kind,
  exclude = [],
  label = "Other…",
  disabled,
  onPick,
}: {
  categories: CategoryChoice[]
  kind: CategoryChoice["kind"]
  /** Ids already offered next to this, e.g. the suggestions. */
  exclude?: string[]
  label?: string
  disabled?: boolean
  onPick: (category: Omit<CategoryChoice, "kind">) => void
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState("")
  const ofKind = categories.filter((c) => c.kind === kind)
  const rest = ofKind.filter((c) => !exclude.includes(c.id))
  const emoji = kind === "expense" ? "🏷️" : "💵"

  const add = useMutation({
    mutationFn: (value: string) =>
      addCategory({ data: { kind, name: value, emoji } }),
    onSuccess: async (result, value) => {
      if (!result.ok) return toast(result.message)
      if (!result.value) return
      await Promise.all(
        ["ledger", "categories"].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] })
        )
      )
      onPick({ id: result.value.id, name: value.trim(), emoji })
    },
    onError: () => toast.error("Couldn't add that category."),
  })

  function create() {
    const value = name.trim()
    if (!value || add.isPending) return
    const same = ofKind.find(
      (c) => c.name.toLowerCase() === value.toLowerCase()
    )
    if (same) onPick(same)
    else add.mutate(value)
  }

  if (!open) {
    return (
      <AnswerButton
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="border-dashed text-muted-foreground"
      >
        {label}
      </AnswerButton>
    )
  }

  return (
    <>
      {rest.map((c) => (
        <AnswerButton key={c.id} disabled={disabled} onClick={() => onPick(c)}>
          <span aria-hidden>{c.emoji}</span>
          {c.name}
        </AnswerButton>
      ))}
      {adding ? (
        <span className="flex items-center gap-2">
          <Input
            aria-label="Category name"
            // Opened by a tap on "New category": ready to type.
            ref={(el) => el?.focus()}
            value={name}
            maxLength={40}
            placeholder="Name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                create()
              }
              if (e.key === "Escape") {
                e.stopPropagation()
                setAdding(false)
              }
            }}
            className="h-9 w-36 rounded-full px-3.5 text-base font-normal"
          />
          <AnswerButton
            disabled={disabled || !name.trim() || add.isPending}
            onClick={create}
          >
            Add
          </AnswerButton>
        </span>
      ) : (
        <AnswerButton
          disabled={disabled}
          onClick={() => setAdding(true)}
          className="border-dashed text-muted-foreground"
        >
          <PlusIcon aria-hidden className="size-4" />
          New category
        </AnswerButton>
      )}
    </>
  )
}
