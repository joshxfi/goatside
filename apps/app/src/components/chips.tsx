import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { PlusIcon } from "lucide-react"
import { Input } from "@workspace/ui/components/input"
import { toast } from "@workspace/ui/components/sonner"
import { cn } from "@workspace/ui/lib/utils"
import { swatch } from "@/lib/accounts"
import { createPerson } from "@/server/people"

/*
 * The pill choices the edit drawer and the IOU form are made of: a labelled
 * group of chips, accounts as chips, and people as chips with "Add someone".
 */

export interface AccountChoice {
  id: string
  name: string
  color: string
}

export function ChipGroup({
  legend,
  children,
  className,
}: {
  legend: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <fieldset className={cn("flex flex-col gap-2", className)}>
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  )
}

export function Chip({
  active,
  className,
  ...props
}: React.ComponentProps<"button"> & { active: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "flex h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] disabled:opacity-60",
        active
          ? "border-foreground bg-foreground text-background"
          : "bg-card [@media(hover:hover)]:hover:bg-muted",
        className
      )}
      {...props}
    />
  )
}

export function AccountPicker({
  legend,
  accounts,
  value,
  disabled,
  onChange,
  allowNone = false,
}: {
  legend: string
  accounts: AccountChoice[]
  value: string | null
  disabled?: boolean
  onChange: (id: string | null) => void
  allowNone?: boolean
}) {
  return (
    <ChipGroup legend={legend}>
      {accounts.map((a) => {
        const active = a.id === value
        return (
          <Chip
            key={a.id}
            active={active}
            disabled={disabled}
            // Tapping the chosen one again clears it (when that's allowed).
            onClick={() => onChange(active ? (allowNone ? null : a.id) : a.id)}
            className="gap-2"
          >
            <span
              aria-hidden
              className="size-2.5 rounded-full"
              style={{ background: swatch(a.color) }}
            />
            {a.name}
          </Chip>
        )
      })}
    </ChipGroup>
  )
}

/**
 * People as chips, one or several, with "Add someone" for a new name. A
 * name that matches someone (or their nickname) picks them instead.
 */
export function PersonPicker({
  legend,
  people,
  value,
  multiple = false,
  disabled,
  onChange,
}: {
  legend: string
  people: { id: string; name: string }[]
  value: string[]
  multiple?: boolean
  disabled?: boolean
  onChange: (ids: string[]) => void
}) {
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState("")
  const pick = (id: string) =>
    onChange(
      multiple
        ? value.includes(id)
          ? value.filter((v) => v !== id)
          : [...value, id]
        : [id]
    )
  const add = useMutation({
    mutationFn: () => createPerson({ data: { name } }),
    onSuccess: async (result) => {
      if (!result.ok) return toast(result.message)
      setAdding(false)
      setName("")
      await queryClient.invalidateQueries({ queryKey: ["ledger", "people"] })
      if (!value.includes(result.value.id)) pick(result.value.id)
    },
    onError: () => toast.error("Couldn't add that person."),
  })

  return (
    <ChipGroup legend={legend}>
      {people.map((p) => (
        <Chip
          key={p.id}
          active={value.includes(p.id)}
          disabled={disabled}
          onClick={() => pick(p.id)}
        >
          {p.name}
        </Chip>
      ))}
      {adding ? (
        // Not a <form>: this sits inside the drawer's form.
        <span className="flex items-center gap-2">
          <Input
            aria-label="Name"
            // Opened by a tap on "Add someone": ready to type.
            ref={(el) => el?.focus()}
            value={name}
            maxLength={60}
            placeholder="Name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                if (name.trim()) add.mutate()
              }
              if (e.key === "Escape") {
                e.stopPropagation()
                setAdding(false)
              }
            }}
            className="h-10 w-36 rounded-full px-3.5 text-base font-normal"
          />
          <Chip
            active={false}
            disabled={!name.trim() || add.isPending}
            onClick={() => add.mutate()}
          >
            Add
          </Chip>
        </span>
      ) : (
        <Chip
          active={false}
          disabled={disabled}
          onClick={() => setAdding(true)}
          className="border-dashed text-muted-foreground"
        >
          <PlusIcon aria-hidden className="size-4" />
          Add someone
        </Chip>
      )}
    </ChipGroup>
  )
}
