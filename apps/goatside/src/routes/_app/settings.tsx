import { useId, useState } from "react"
import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { createFileRoute, useRouter } from "@tanstack/react-router"
import {
  DownloadIcon,
  EyeIcon,
  EyeOffIcon,
  MergeIcon,
  MoreHorizontalIcon,
  SearchIcon,
} from "lucide-react"
import {
  COMMON_CURRENCIES,
  currencyName,
  formatMoney,
} from "@workspace/core/money"
import { Button } from "@workspace/ui/components/button"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@workspace/ui/components/drawer"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { toast } from "@workspace/ui/components/sonner"
import { ThemeSwitch } from "@workspace/ui/components/theme-switch"
import { cn } from "@workspace/ui/lib/utils"
import { PageFrame, PageHeader } from "@/components/app-shell"
import { capitalize, shortDate } from "@/lib/format"
import { useInstall } from "@/lib/offline"
import { categoriesQuery } from "@/lib/queries"
import { useDesktop } from "@/lib/use-desktop"
import {
  type CategoriesView,
  addCategory,
  applyRefile,
  editCategory,
  getRefileSuggestions,
  mergeCategories,
  updateCurrency,
  updateTimeZone,
} from "@/server/settings"

export const Route = createFileRoute("/_app/settings")({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(categoriesQuery()),
  head: () => ({ meta: [{ title: "Settings · Goatside" }] }),
  component: Settings,
})

type Category = CategoriesView["categories"][number]
type Kind = Category["kind"]

/** Refreshes everything that shows categories. */
function useRefresh() {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["categories"] }),
      queryClient.invalidateQueries({ queryKey: ["ledger"] }),
    ])
}

function Settings() {
  const { viewer } = Route.useRouteContext()
  const { data } = useSuspenseQuery(categoriesQuery())
  const [merging, setMerging] = useState<Category | null>(null)
  const [suggesting, setSuggesting] = useState<Category | null>(null)

  return (
    <PageFrame width="default">
      <PageHeader title="Settings" viewer={viewer} back="/" />
      <div className="flex flex-col gap-8">
        <p className="text-sm text-muted-foreground">
          Your categories teach the agent how you file things.
        </p>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          {(["expense", "income"] as const).map((kind) => (
            <CategorySection
              key={kind}
              kind={kind}
              categories={data.categories.filter((c) => c.kind === kind)}
              onMerge={setMerging}
              onSuggest={setSuggesting}
            />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          <Currency current={data.currency} />
          <TimeZone current={data.timeZone} />
          <Appearance />
          <InstallApp />
        </div>
      </div>
      <MergeDrawer
        from={merging}
        options={data.categories.filter(
          (c) =>
            merging &&
            c.kind === merging.kind &&
            c.id !== merging.id &&
            !c.archived
        )}
        onClose={() => setMerging(null)}
      />
      <SuggestDrawer
        category={suggesting}
        onClose={() => setSuggesting(null)}
      />
    </PageFrame>
  )
}

function CategorySection({
  kind,
  categories,
  onMerge,
  onSuggest,
}: {
  kind: Kind
  categories: Category[]
  onMerge: (c: Category) => void
  onSuggest: (c: Category) => void
}) {
  const headingId = useId()
  const active = categories.filter((c) => !c.archived)
  const hidden = categories.filter((c) => c.archived)

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-sm font-medium text-muted-foreground">
        {kind === "expense" ? "Spending categories" : "Income categories"}
      </h2>
      <ul className="flex flex-col divide-y rounded-2xl border bg-card">
        {active.map((c) => (
          <CategoryRow
            key={c.id}
            category={c}
            onMerge={onMerge}
            onSuggest={onSuggest}
          />
        ))}
        <li>
          <AddCategory kind={kind} onAdded={onSuggest} />
        </li>
      </ul>
      {hidden.length > 0 && (
        <details className="group px-1 text-sm">
          <summary className="cursor-pointer text-muted-foreground select-none">
            {hidden.length} hidden
          </summary>
          <ul className="mt-2 flex flex-col divide-y rounded-2xl border bg-card opacity-70">
            {hidden.map((c) => (
              <CategoryRow
                key={c.id}
                category={c}
                onMerge={onMerge}
                onSuggest={onSuggest}
              />
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

function CategoryRow({
  category,
  onMerge,
  onSuggest,
}: {
  category: Category
  onMerge: (c: Category) => void
  onSuggest: (c: Category) => void
}) {
  const refresh = useRefresh()
  const [name, setName] = useState(category.name)
  const [emoji, setEmoji] = useState(category.emoji)

  const edit = useMutation({
    mutationFn: (changes: {
      name?: string
      emoji?: string
      archived?: boolean
    }) => editCategory({ data: { id: category.id, ...changes } }),
    onSuccess: async (result) => {
      if (!result.ok) {
        toast(result.message)
        setName(category.name)
        setEmoji(category.emoji)
        return
      }
      await refresh()
    },
    onError: () => toast.error("Couldn't save that change."),
  })

  const saveName = () => {
    const next = name.trim()
    if (!next) return setName(category.name)
    if (next !== category.name) edit.mutate({ name: next })
  }
  const saveEmoji = () => {
    const next = emoji.trim()
    if (!next) return setEmoji(category.emoji)
    if (next !== category.emoji) edit.mutate({ emoji: next })
  }

  return (
    <li className="flex items-center gap-2 px-3 py-2">
      <label className="sr-only" htmlFor={`emoji-${category.id}`}>
        Emoji for {category.name}
      </label>
      <input
        id={`emoji-${category.id}`}
        value={emoji}
        onChange={(e) => setEmoji(e.target.value)}
        onBlur={saveEmoji}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        maxLength={16}
        className="size-9 shrink-0 rounded-full bg-muted text-center text-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
      />
      <label className="sr-only" htmlFor={`name-${category.id}`}>
        Name
      </label>
      <input
        id={`name-${category.id}`}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={saveName}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        maxLength={40}
        className="min-w-0 flex-1 rounded-md bg-transparent px-1.5 py-1 outline-none hover:bg-muted/60 focus-visible:bg-muted"
      />
      <span className="figure shrink-0 text-right text-xs text-muted-foreground">
        {category.count ? (
          <>
            {category.count} · {formatMoney(category.total)}
          </>
        ) : (
          "unused"
        )}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`More for ${category.name}`}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          <MoreHorizontalIcon className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          {!category.archived && (
            <DropdownMenuItem onClick={() => onSuggest(category)}>
              <SearchIcon />
              Find entries for this
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => onMerge(category)}>
            <MergeIcon />
            Merge into…
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => edit.mutate({ archived: !category.archived })}
          >
            {category.archived ? <EyeIcon /> : <EyeOffIcon />}
            {category.archived ? "Show again" : "Hide"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

function AddCategory({
  kind,
  onAdded,
}: {
  kind: Kind
  onAdded: (c: Category) => void
}) {
  const refresh = useRefresh()
  const [name, setName] = useState("")
  const [emoji, setEmoji] = useState("")
  const id = useId()

  const add = useMutation({
    mutationFn: () =>
      addCategory({
        data: {
          kind,
          name,
          emoji: emoji.trim() || (kind === "expense" ? "🏷️" : "💵"),
        },
      }),
    onSuccess: async (result) => {
      if (!result.ok) return toast(result.message)
      await refresh()
      setName("")
      setEmoji("")
      // Offer to move existing entries that belong in the new category.
      if (result.value) {
        onAdded({
          id: result.value.id,
          name: name.trim(),
          emoji: emoji.trim(),
          kind,
          archived: false,
          count: 0,
          total: 0,
          lastUsed: null,
        })
      }
    },
    onError: () => toast.error("Couldn't add that category."),
  })

  return (
    <form
      className="flex items-center gap-2 px-3 py-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (name.trim()) add.mutate()
      }}
    >
      <label className="sr-only" htmlFor={`${id}-emoji`}>
        Emoji
      </label>
      <input
        id={`${id}-emoji`}
        value={emoji}
        onChange={(e) => setEmoji(e.target.value)}
        placeholder="＋"
        maxLength={16}
        className="size-9 shrink-0 rounded-full border border-dashed bg-transparent text-center text-lg outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/30"
      />
      <label className="sr-only" htmlFor={`${id}-name`}>
        New {kind === "expense" ? "spending" : "income"} category
      </label>
      <input
        id={`${id}-name`}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={
          kind === "expense"
            ? "Add a category, e.g. Pets"
            : "Add a category, e.g. Allowance"
        }
        maxLength={40}
        className="min-w-0 flex-1 rounded-md bg-transparent px-1.5 py-1 outline-none placeholder:text-muted-foreground/70 focus-visible:bg-muted"
      />
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={!name.trim() || add.isPending}
      >
        Add
      </Button>
    </form>
  )
}

function SideDrawer({
  open,
  onClose,
  children,
}: {
  open: boolean
  onClose: () => void
  children: React.ReactNode
}) {
  const desktop = useDesktop()
  return (
    <Drawer
      open={open}
      onOpenChange={(next) => !next && onClose()}
      swipeDirection={desktop ? "right" : "down"}
    >
      <DrawerContent className={desktop ? "w-[28rem]" : undefined}>
        <div className="mx-auto flex w-full max-w-md flex-col gap-4 overflow-y-auto pb-[max(env(safe-area-inset-bottom),1.25rem)]">
          {children}
        </div>
      </DrawerContent>
    </Drawer>
  )
}

function MergeDrawer({
  from,
  options,
  onClose,
}: {
  from: Category | null
  options: Category[]
  onClose: () => void
}) {
  const refresh = useRefresh()
  const merge = useMutation({
    mutationFn: (into: Category) =>
      mergeCategories({ data: { from: from?.id ?? "", into: into.id } }),
    onSuccess: async (result, into) => {
      if (!result.ok) return toast(result.message)
      await refresh()
      onClose()
      toast(
        `Merged ${from?.name} into ${into.name}${
          result.value.moved ? ` · moved ${result.value.moved} entries` : ""
        }.`
      )
    },
    onError: () => toast.error("Couldn't merge those."),
  })

  return (
    <SideDrawer open={Boolean(from)} onClose={onClose}>
      <DrawerHeader className="text-left group-data-[swipe-axis=y]/drawer-popup:text-left">
        <DrawerTitle className="font-display text-2xl font-normal">
          Merge {from?.emoji} {from?.name} into…
        </DrawerTitle>
        <DrawerDescription>
          {from?.count
            ? `Its ${from.count} entries move over, and ${from.name} is removed.`
            : `${from?.name} is removed.`}{" "}
          The agent learns the new home for those entries.
        </DrawerDescription>
      </DrawerHeader>
      <ul className="flex flex-wrap gap-2 px-4">
        {options.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              disabled={merge.isPending}
              onClick={() => merge.mutate(c)}
              className="flex h-10 items-center gap-1.5 rounded-full border bg-card px-3.5 text-sm transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] disabled:opacity-50 [@media(hover:hover)]:hover:bg-muted"
            >
              <span aria-hidden>{c.emoji}</span>
              {c.name}
            </button>
          </li>
        ))}
      </ul>
    </SideDrawer>
  )
}

/** After adding a category: entries the agent thinks belong there. */
function SuggestDrawer({
  category,
  onClose,
}: {
  category: Category | null
  onClose: () => void
}) {
  return (
    <SideDrawer open={Boolean(category)} onClose={onClose}>
      {category && (
        <Suggestions key={category.id} category={category} onClose={onClose} />
      )}
    </SideDrawer>
  )
}

function Suggestions({
  category,
  onClose,
}: {
  category: Category
  onClose: () => void
}) {
  const refresh = useRefresh()
  const [picked, setPicked] = useState<Set<string> | null>(null)

  // One fresh look per drawer open; the answer depends on the model, not a cache.
  const suggestions = useQuery({
    queryKey: ["refile-suggestions", category.id],
    queryFn: () => getRefileSuggestions({ data: { categoryId: category.id } }),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    retry: false,
  })
  const rows = suggestions.data ?? []
  const selected = picked ?? new Set(rows.map((r) => r.id))

  const apply = useMutation({
    mutationFn: () =>
      applyRefile({ data: { ids: [...selected], categoryId: category.id } }),
    onSuccess: async (result) => {
      if (!result.ok) return toast(result.message)
      await refresh()
      onClose()
      toast(
        `Moved ${result.value.moved} entries to ${category.emoji} ${category.name}.`
      )
    },
    onError: () => toast.error("Couldn't move those."),
  })

  return (
    <>
      <DrawerHeader className="text-left group-data-[swipe-axis=y]/drawer-popup:text-left">
        <DrawerTitle className="font-display text-2xl font-normal">
          {category.emoji} {category.name}
        </DrawerTitle>
        <DrawerDescription>
          {suggestions.isPending
            ? "Looking through your last few months for entries that belong here…"
            : rows.length
              ? `These look like they belong in ${category.name}. Untick any that don't.`
              : `Nothing earlier looks like ${category.name}. Goatside will file new ones here as they come.`}
        </DrawerDescription>
      </DrawerHeader>
      {suggestions.isPending && (
        <div className="flex flex-col gap-2 px-4" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-11 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      )}
      {rows.length > 0 && (
        <>
          <ul className="flex flex-col px-2">
            {rows.map((r) => {
              const on = selected.has(r.id)
              return (
                <li key={r.id}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 hover:bg-muted">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => {
                        const next = new Set(selected)
                        if (on) next.delete(r.id)
                        else next.add(r.id)
                        setPicked(next)
                      }}
                      className="size-4 accent-foreground"
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm">
                        {capitalize(r.description)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {shortDate(r.localDate)} · now in {r.from}
                      </span>
                    </span>
                    <span className="figure text-sm">
                      {formatMoney(Math.abs(r.amount))}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
          <div className="flex gap-2 px-4">
            <Button variant="ghost" onClick={onClose} className="flex-1">
              Not now
            </Button>
            <Button
              onClick={() => apply.mutate()}
              disabled={!selected.size || apply.isPending}
              className="flex-1"
            >
              Move {selected.size}
            </Button>
          </div>
        </>
      )}
      {!suggestions.isPending && !rows.length && (
        <div className="px-4">
          <Button variant="outline" onClick={onClose} className="w-full">
            Done
          </Button>
        </div>
      )}
    </>
  )
}

const ZONES = [
  "Asia/Manila",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Hong_Kong",
  "Asia/Dubai",
  "Australia/Sydney",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "UTC",
]

function TimeZone({ current }: { current: string }) {
  const refresh = useRefresh()
  const zones = ZONES.includes(current) ? ZONES : [current, ...ZONES]
  const save = useMutation({
    mutationFn: (timeZone: string) => updateTimeZone({ data: { timeZone } }),
    onSuccess: async (result) => {
      if (!result.ok) return toast(result.message)
      await refresh()
      toast('Time zone saved. "Today" now follows it.')
    },
  })

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-muted-foreground">Time zone</h2>
      <div className="flex items-center justify-between gap-4 rounded-2xl border bg-card px-4 py-3">
        <p className="text-sm text-muted-foreground">
          Decides which day an entry lands on, and when a month starts.
        </p>
        <Select
          value={current}
          onValueChange={(value) => value && save.mutate(String(value))}
          items={zones.map((z) => ({ value: z, label: z.replace("_", " ") }))}
        >
          <SelectTrigger
            className={cn("h-9 w-52 shrink-0")}
            aria-label="Time zone"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {zones.map((z) => (
              <SelectItem key={z} value={z}>
                {z.replace("_", " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </section>
  )
}

function Currency({ current }: { current: string }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const codes: string[] = COMMON_CURRENCIES.includes(
    current as (typeof COMMON_CURRENCIES)[number]
  )
    ? [...COMMON_CURRENCIES]
    : [current, ...COMMON_CURRENCIES]
  const items = codes
    .map((code) => ({ value: code, label: `${currencyName(code)} (${code})` }))
    .toSorted((a, b) => a.label.localeCompare(b.label))
  const save = useMutation({
    mutationFn: (currency: string) => updateCurrency({ data: { currency } }),
    onSuccess: async (result, currency) => {
      if (!result.ok) return toast(result.message)
      // The layout reads the currency from the route context and remounts.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["categories"] }),
        router.invalidate(),
      ])
      toast(`Amounts now show in ${currencyName(currency)}.`)
    },
  })

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-muted-foreground">Currency</h2>
      <div className="flex items-center justify-between gap-4 rounded-2xl border bg-card px-4 py-3">
        <p className="text-sm text-muted-foreground">
          Every amount shows in it. Changing it doesn't convert anything.
        </p>
        <Select
          value={current}
          onValueChange={(value) => value && save.mutate(String(value))}
          items={items}
        >
          <SelectTrigger className="h-9 w-52 shrink-0" aria-label="Currency">
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
    </section>
  )
}

function Appearance() {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-muted-foreground">Appearance</h2>
      <div className="flex items-center justify-between gap-4 rounded-2xl border bg-card px-4 py-3">
        <p className="text-sm text-muted-foreground">
          Light, dark, or your device's setting. Saved on this device.
        </p>
        <ThemeSwitch labels />
      </div>
    </section>
  )
}

/** Home-screen install: one tap where the browser allows it, steps on iOS. */
function InstallApp() {
  const { state, install } = useInstall()
  const text = {
    installed: "Installed. Goatside opens from your home screen.",
    prompt:
      "Opens full screen from your home screen, and logs entries offline.",
    ios: "On iPhone or iPad, tap Share, then Add to Home Screen. It opens full screen and logs entries offline.",
    manual:
      "Use your browser's Install app or Add to Home Screen option. It opens full screen and logs entries offline.",
  }[state]

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-muted-foreground">Home screen</h2>
      <div className="flex items-center justify-between gap-4 rounded-2xl border bg-card px-4 py-3">
        <p className="text-sm text-muted-foreground">{text}</p>
        {state === "prompt" && (
          <Button
            size="sm"
            className="h-9 shrink-0"
            onClick={async () => {
              if (await install()) toast("Installed. Look for the coin.")
            }}
          >
            <DownloadIcon />
            Install
          </Button>
        )}
      </div>
    </section>
  )
}
