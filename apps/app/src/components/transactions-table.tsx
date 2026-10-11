import { useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  columnFilteringFeature,
  createColumnHelper,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_includesString,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  tableFeatures,
  useTable,
} from "@tanstack/react-table"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  DownloadIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { formatPeso } from "@workspace/core/money"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { toast } from "@workspace/ui/components/sonner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group"
import { cn } from "@workspace/ui/lib/utils"
import { swatch } from "@/lib/accounts"
import { capitalize, iouLabel, shortDate, transferLabel } from "@/lib/format"
import {
  type LedgerTxn,
  type MonthView,
  deleteTransactions,
  restoreTransactions,
  undoRecategorize,
} from "@/server/ledger"
import { moveToAccount, undoMoveToAccount } from "@/server/accounts"
import { applyRefile } from "@/server/settings"
import type { AccountChoice } from "@/components/transaction-drawer"

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic },
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  filterFns: { includesString: filterFn_includesString },
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
  rowSelectionFeature,
})

/** A row as the table sees it: plain values to sort and search on. */
interface Row {
  txn: LedgerTxn
  date: string
  description: string
  category: string
  account: string
  amount: number
}

const helper = createColumnHelper<typeof features, Row>()

type Kind = "all" | "out" | "in" | "iou" | "transfer"
const KINDS: { value: Kind; label: string }[] = [
  { value: "all", label: "All" },
  { value: "out", label: "Out" },
  { value: "in", label: "In" },
  { value: "iou", label: "IOUs" },
  { value: "transfer", label: "Transfers" },
]

const isIou = (t: LedgerTxn) => t.kind === "lend" || t.kind === "settle"
const isTransfer = (t: LedgerTxn) => t.kind === "transfer"
/** Neither spending nor income: no category, no green or red. */
const isQuiet = (t: LedgerTxn) => isIou(t) || isTransfer(t)

const NO_ACCOUNT = "No account"

function accountOf(t: LedgerTxn) {
  if (isTransfer(t)) return transferLabel(t)
  return t.account?.name ?? NO_ACCOUNT
}

function categoryOf(t: LedgerTxn) {
  if (isTransfer(t)) return "Transfer"
  if (t.person) return iouLabel(t.kind, t.amount, t.person.name) ?? ""
  return t.category?.name ?? "Uncategorized"
}

function Checkbox({
  checked,
  indeterminate = false,
  label,
  onClick,
}: {
  checked: boolean
  indeterminate?: boolean
  label: string
  onClick: (event: React.MouseEvent) => void
}) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      ref={(el) => {
        if (el) el.indeterminate = indeterminate
      }}
      // Click, not change: the handler needs the Shift key for ranges.
      onClick={(event) => {
        event.stopPropagation()
        onClick(event)
      }}
      onChange={() => {}}
      className="size-4 cursor-pointer align-middle accent-foreground"
    />
  )
}

/** Defined once: cells read only their row, so nothing here depends on render. */
const columns = helper.columns([
  helper.display({
    id: "select",
    header: ({ table }) => (
      <Checkbox
        label="Select this page"
        checked={table.getIsAllPageRowsSelected()}
        indeterminate={table.getIsSomePageRowsSelected()}
        onClick={table.getToggleAllPageRowsSelectedHandler()}
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        label={`Select ${row.original.description || "entry"}`}
        checked={row.getIsSelected()}
        onClick={row.getToggleSelectedHandler()}
      />
    ),
  }),
  helper.accessor("date", {
    header: "Date",
    sortFn: "alphanumeric",
    cell: (info) => (
      <span className="text-xs text-muted-foreground md:text-sm">
        {shortDate(info.getValue())}
      </span>
    ),
  }),
  helper.accessor("description", {
    header: "Description",
    sortFn: "alphanumeric",
    cell: (info) => {
      const txn = info.row.original.txn
      return (
        <span className="flex items-center gap-2">
          <span className="truncate">
            {capitalize(info.getValue()) || "Untitled"}
          </span>
          {txn.status === "needs_review" && (
            <span className="flex shrink-0 items-center gap-1 text-xs text-bronze">
              <span aria-hidden className="size-1.5 rounded-full bg-bronze" />
              Check
            </span>
          )}
          {txn.recurring && (
            <span className="hidden shrink-0 text-xs text-muted-foreground md:inline">
              repeats
            </span>
          )}
        </span>
      )
    },
  }),
  helper.accessor("category", {
    header: "Category",
    sortFn: "alphanumeric",
    cell: (info) => {
      const txn = info.row.original.txn
      return (
        <span className="flex items-center gap-2 text-muted-foreground">
          <span aria-hidden>
            {isTransfer(txn)
              ? "↔"
              : txn.person
                ? "🤝"
                : (txn.category?.emoji ?? "·")}
          </span>
          <span className="truncate">{info.getValue()}</span>
          {txn.split ? ` · ⅟${txn.split}` : ""}
        </span>
      )
    },
  }),
  helper.accessor("account", {
    header: "Account",
    sortFn: "alphanumeric",
    cell: (info) => {
      const txn = info.row.original.txn
      const dots = isTransfer(txn)
        ? [txn.account, txn.toAccount]
        : [txn.account]
      return (
        <span className="flex items-center gap-2 text-muted-foreground">
          <span aria-hidden className="flex -space-x-1">
            {dots.map((a, i) =>
              a ? (
                <span
                  key={i}
                  className="size-2.5 rounded-full ring-2 ring-card"
                  style={{ background: swatch(a.color) }}
                />
              ) : null
            )}
          </span>
          <span className="truncate">{info.getValue()}</span>
        </span>
      )
    },
  }),
  helper.accessor("amount", {
    header: "Amount",
    sortFn: "basic",
    enableGlobalFilter: false,
    cell: (info) => {
      const txn = info.row.original.txn
      const amount = info.getValue()
      return (
        <span
          className={cn(
            "figure block text-right font-display text-lg",
            amount > 0 && !isQuiet(txn) && "text-income-foreground",
            amount < 0 && !isQuiet(txn) && "text-expense-foreground",
            isQuiet(txn) && "text-muted-foreground"
          )}
        >
          {isTransfer(txn)
            ? formatPeso(Math.abs(amount))
            : formatPeso(amount, { sign: amount > 0 })}
        </span>
      )
    },
  }),
])

const csvCell = (value: string | number) => {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/** Downloads rows as a CSV the owner can open in a spreadsheet. */
function exportCsv(rows: Row[], filename: string) {
  const header = [
    "date",
    "description",
    "category",
    "amount",
    "type",
    "person",
    "account",
    "to_account",
  ]
  const lines = rows.map(({ txn }) =>
    [
      txn.localDate,
      txn.description,
      txn.category?.name ?? "",
      (txn.amount / 100).toFixed(2),
      txn.kind,
      txn.person?.name ?? "",
      txn.account?.name ?? "",
      txn.toAccount?.name ?? "",
    ]
      .map(csvCell)
      .join(",")
  )
  const blob = new Blob([[header.join(","), ...lines].join("\n")], {
    type: "text/csv;charset=utf-8",
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

/**
 * Searchable, sortable, filterable list of transactions with multi-select
 * for bulk re-filing and deleting, and CSV export of what's filtered.
 */
export function TransactionsTable({
  transactions,
  categories,
  accounts = [],
  onSelect,
  exportName = "goatside-transactions.csv",
  pageSize = 25,
  empty = "Nothing here yet.",
}: {
  transactions: LedgerTxn[]
  categories: MonthView["categories"]
  /** Open accounts, for the filter and "file under account". */
  accounts?: AccountChoice[]
  onSelect: (txn: LedgerTxn) => void
  exportName?: string
  pageSize?: number
  empty?: string
}) {
  const queryClient = useQueryClient()
  const [kind, setKind] = useState<Kind>("all")
  const [category, setCategory] = useState<string>("all")
  const [account, setAccount] = useState<string>("all")
  const [search, setSearch] = useState("")

  const usedCategories = useMemo(() => {
    const names = new Set(
      transactions.filter((t) => !isQuiet(t)).map(categoryOf)
    )
    return [...names].toSorted()
  }, [transactions])
  const hasUnfiled = transactions.some((t) => !t.account && !isTransfer(t))

  // Kind and category are app-level slices; search, sort, paging and
  // selection are the table's.
  const data = useMemo<Row[]>(
    () =>
      transactions
        .filter((t) => !t.id.startsWith("optimistic:"))
        .filter((t) =>
          kind === "all"
            ? true
            : kind === "iou"
              ? isIou(t)
              : kind === "transfer"
                ? isTransfer(t)
                : !isQuiet(t) && (kind === "in" ? t.amount > 0 : t.amount < 0)
        )
        .filter((t) => category === "all" || categoryOf(t) === category)
        .filter((t) =>
          account === "all"
            ? true
            : account === "none"
              ? !t.account && !isTransfer(t)
              : t.account?.id === account || t.toAccount?.id === account
        )
        .map((t) => ({
          txn: t,
          date: t.localDate,
          description: t.description,
          category: categoryOf(t),
          account: accountOf(t),
          amount: t.amount,
        })),
    [transactions, kind, category, account]
  )

  const table = useTable({
    features,
    columns,
    data,
    getRowId: (row) => row.txn.id,
    state: { globalFilter: search },
    onGlobalFilterChange: (updater) =>
      setSearch((current) =>
        typeof updater === "function"
          ? String(updater(current) ?? "")
          : String(updater ?? "")
      ),
    globalFilterFn: "includesString",
    getColumnCanGlobalFilter: (column) =>
      column.id === "description" ||
      column.id === "category" ||
      column.id === "account",
    initialState: {
      sorting: [{ id: "date", desc: true }],
      pagination: { pageIndex: 0, pageSize },
    },
  })

  const refresh = () =>
    Promise.all(
      ["ledger", "people", "categories"].map((key) =>
        queryClient.invalidateQueries({ queryKey: [key] })
      )
    )

  const rows = table.getRowModel().rows
  const filteredRows = table.getFilteredRowModel().rows
  const filtered = filteredRows.length
  const selected = table.getSelectedRowModel().rows.map((r) => r.original.txn)
  const { pageIndex } = table.state.pagination
  const counted = filteredRows.filter((r) => !isQuiet(r.original.txn))
  const net = counted.reduce((sum, r) => sum + r.original.amount, 0)

  // Bulk moves apply to the selected entries whose side fits the category.
  const selectedKinds = new Set(
    selected
      .filter((t) => !isQuiet(t))
      .map((t) => (t.amount > 0 ? "income" : "expense"))
  )
  const movable = categories.filter((c) => selectedKinds.has(c.kind))

  async function moveSelected(target: MonthView["categories"][number]) {
    const fits = selected.filter(
      (t) =>
        !isQuiet(t) && (t.amount > 0 ? "income" : "expense") === target.kind
    )
    if (!fits.length) return
    const result = await applyRefile({
      data: { ids: fits.map((t) => t.id), categoryId: target.id },
    })
    if (!result.ok) return toast(result.message)
    table.resetRowSelection()
    await refresh()
    const changes = fits.map((t) => ({
      id: t.id,
      categoryId: t.category?.id ?? null,
    }))
    toast(`Moved ${result.value.moved} to ${target.emoji} ${target.name}.`, {
      action: {
        label: "Undo",
        onClick: async () => {
          await undoRecategorize({ data: { changes } })
          await refresh()
        },
      },
    })
  }

  // Transfers keep their two sides; everything else can be filed anywhere.
  const fileable = selected.filter((t) => !isTransfer(t))

  async function fileSelected(target: AccountChoice | null) {
    if (!fileable.length) return
    const result = await moveToAccount({
      data: { ids: fileable.map((t) => t.id), accountId: target?.id ?? null },
    })
    if (!result.ok) return toast(result.message)
    table.resetRowSelection()
    await refresh()
    const changes = result.value.moved
    const count = changes.length
    toast(
      target
        ? `Filed ${count} under ${target.name}.`
        : `Took ${count} out of their account.`,
      changes.length
        ? {
            action: {
              label: "Undo",
              onClick: async () => {
                await undoMoveToAccount({ data: { changes } })
                await refresh()
              },
            },
          }
        : undefined
    )
  }

  async function deleteSelected() {
    const ids = selected.map((t) => t.id)
    if (!ids.length) return
    await deleteTransactions({ data: { ids } })
    table.resetRowSelection()
    await refresh()
    toast(`Deleted ${ids.length} ${ids.length === 1 ? "entry" : "entries"}.`, {
      action: {
        label: "Undo",
        onClick: async () => {
          await restoreTransactions({ data: { ids } })
          await refresh()
        },
      },
    })
  }

  return (
    <section aria-label="Transactions" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {selected.length > 0 ? (
          <div className="enter-fade flex min-h-9 flex-1 flex-wrap items-center gap-2 rounded-full bg-muted py-1 pr-1 pl-4 text-sm">
            <span className="mr-auto font-medium">
              {selected.length} selected
            </span>
            {movable.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button size="sm" variant="outline" className="bg-card" />
                  }
                >
                  Move to…
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-80 min-w-52">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Move to category</DropdownMenuLabel>
                    {movable.map((c) => (
                      <DropdownMenuItem
                        key={c.id}
                        onClick={() => void moveSelected(c)}
                      >
                        <span aria-hidden>{c.emoji}</span>
                        {c.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {accounts.length > 0 && fileable.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button size="sm" variant="outline" className="bg-card" />
                  }
                >
                  Account…
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-80 min-w-52">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>File under account</DropdownMenuLabel>
                    {accounts.map((a) => (
                      <DropdownMenuItem
                        key={a.id}
                        onClick={() => void fileSelected(a)}
                      >
                        <span
                          aria-hidden
                          className="size-2.5 rounded-full"
                          style={{ background: swatch(a.color) }}
                        />
                        {a.name}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuItem onClick={() => void fileSelected(null)}>
                      <span aria-hidden className="size-2.5" />
                      {NO_ACCOUNT}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button
              size="sm"
              variant="outline"
              className="bg-card"
              onClick={() => void deleteSelected()}
            >
              <Trash2Icon />
              Delete
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Clear selection"
              onClick={() => table.resetRowSelection()}
            >
              <XIcon />
            </Button>
          </div>
        ) : (
          <>
            <div className="relative w-full md:mr-auto md:w-auto">
              <SearchIcon
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <label htmlFor="txn-search" className="sr-only">
                Search transactions
              </label>
              <Input
                id="txn-search"
                value={search}
                onChange={(e) => table.setGlobalFilter(e.target.value)}
                placeholder="Search"
                className="h-9 w-full pl-9 md:w-60"
              />
            </div>
            <Select
              value={category}
              onValueChange={(value) => setCategory(String(value ?? "all"))}
              items={[
                { value: "all", label: "All categories" },
                ...usedCategories.map((c) => ({ value: c, label: c })),
              ]}
            >
              <SelectTrigger className="h-9 w-44" aria-label="Category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {usedCategories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {accounts.length > 0 && (
              <Select
                value={account}
                onValueChange={(value) => setAccount(String(value ?? "all"))}
                items={[
                  { value: "all", label: "All accounts" },
                  ...accounts.map((a) => ({ value: a.id, label: a.name })),
                  ...(hasUnfiled ? [{ value: "none", label: NO_ACCOUNT }] : []),
                ]}
              >
                <SelectTrigger className="h-9 w-40" aria-label="Account">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All accounts</SelectItem>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                  {hasUnfiled && (
                    <SelectItem value="none">{NO_ACCOUNT}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            )}
            <ToggleGroup
              value={[kind]}
              onValueChange={(value) => {
                const next = value[0] as Kind | undefined
                if (next) setKind(next)
              }}
              variant="outline"
              size="sm"
              aria-label="Type"
            >
              {KINDS.map((k) => (
                <ToggleGroupItem key={k.value} value={k.value}>
                  {k.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <Button
              size="sm"
              variant="outline"
              disabled={!filtered}
              onClick={() =>
                exportCsv(
                  filteredRows.map((r) => r.original),
                  exportName
                )
              }
            >
              <DownloadIcon />
              Export
            </Button>
          </>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border bg-card">
        <Table className="table-fixed">
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id} className="hover:bg-transparent">
                {group.headers.map((header) => {
                  const sorted = header.column.getIsSorted()
                  const sortable =
                    header.column.getCanSort() && header.column.id !== "select"
                  return (
                    <TableHead
                      key={header.id}
                      aria-sort={
                        sorted === "asc"
                          ? "ascending"
                          : sorted === "desc"
                            ? "descending"
                            : undefined
                      }
                      className={cn(
                        "h-10 px-4 text-xs",
                        header.column.id === "select" &&
                          "hidden w-11 pr-0 md:table-cell",
                        header.column.id === "date" &&
                          "w-[5.5rem] pr-0 md:w-32 md:pr-4",
                        header.column.id === "category" &&
                          "hidden w-52 md:table-cell",
                        header.column.id === "account" &&
                          "hidden w-64 lg:table-cell",
                        header.column.id === "amount" &&
                          "w-28 text-right md:w-36"
                      )}
                    >
                      {sortable ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-sm transition-colors hover:text-foreground",
                            header.column.id === "amount" && "flex-row-reverse"
                          )}
                        >
                          <table.FlexRender header={header} />
                          {sorted === "asc" && (
                            <ArrowUpIcon className="size-3" />
                          )}
                          {sorted === "desc" && (
                            <ArrowDownIcon className="size-3" />
                          )}
                        </button>
                      ) : (
                        <table.FlexRender header={header} />
                      )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.length ? (
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  tabIndex={0}
                  data-state={row.getIsSelected() ? "selected" : undefined}
                  onClick={() => onSelect(row.original.txn)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      onSelect(row.original.txn)
                    }
                  }}
                  className="cursor-pointer focus-visible:bg-muted focus-visible:outline-none"
                >
                  {row.getAllCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cn(
                        "max-w-0 px-4 py-2.5",
                        cell.column.id === "select" &&
                          "hidden pr-0 md:table-cell",
                        cell.column.id === "category" && "hidden md:table-cell",
                        cell.column.id === "account" && "hidden lg:table-cell"
                      )}
                    >
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={6}
                  className="h-24 text-center text-muted-foreground"
                >
                  {transactions.length ? "Nothing matches." : empty}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="figure">
          {filtered
            ? `${pageIndex * pageSize + 1}–${Math.min((pageIndex + 1) * pageSize, filtered)} of ${filtered}`
            : "0 results"}
          {counted.length > 0 && ` · net ${formatPeso(net, { sign: net > 0 })}`}
        </span>
        <span className="ml-auto flex gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
          >
            Next
          </Button>
        </span>
      </div>
    </section>
  )
}
