import { useMemo, useState } from "react"
import {
  columnFilteringFeature,
  createColumnHelper,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_includesString,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  tableFeatures,
  useTable,
} from "@tanstack/react-table"
import { ArrowDownIcon, ArrowUpIcon, SearchIcon } from "lucide-react"
import { formatPeso } from "@workspace/core/money"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
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
import { capitalize, iouLabel, shortDate } from "@/lib/format"
import type { LedgerTxn, MonthView } from "@/server/ledger"

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
})

/** A row as the table sees it: plain values to sort and search on. */
interface Row {
  txn: LedgerTxn
  date: string
  description: string
  category: string
  amount: number
}

const helper = createColumnHelper<typeof features, Row>()

type Kind = "all" | "out" | "in" | "iou"
const KINDS: { value: Kind; label: string }[] = [
  { value: "all", label: "All" },
  { value: "out", label: "Out" },
  { value: "in", label: "In" },
  { value: "iou", label: "IOUs" },
]

const isIou = (t: LedgerTxn) => t.kind === "lend" || t.kind === "settle"

function categoryOf(t: LedgerTxn) {
  if (t.person) return iouLabel(t.kind, t.amount, t.person.name) ?? ""
  return t.category?.name ?? "Uncategorized"
}

/** Defined once: cells read only their row, so nothing here depends on render. */
const columns = helper.columns([
  helper.accessor("date", {
    header: "Date",
    sortFn: "alphanumeric",
    cell: (info) => (
      <span className="text-muted-foreground">
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
            <span className="shrink-0 text-xs text-muted-foreground">
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
            {txn.person ? "🤝" : (txn.category?.emoji ?? "·")}
          </span>
          {info.getValue()}
          {txn.split ? ` · ⅟${txn.split}` : ""}
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
            amount > 0 && !isIou(txn) && "text-gold-foreground",
            isIou(txn) && "text-muted-foreground"
          )}
        >
          {formatPeso(amount, { sign: amount > 0 })}
        </span>
      )
    },
  }),
])

/** Every transaction in the month: searchable, sortable, filterable. */
export function TransactionsTable({
  view,
  onSelect,
}: {
  view: MonthView
  onSelect: (txn: LedgerTxn) => void
}) {
  const [kind, setKind] = useState<Kind>("all")
  const [category, setCategory] = useState<string>("all")
  const [search, setSearch] = useState("")

  const usedCategories = useMemo(() => {
    const names = new Set(
      view.transactions.filter((t) => !isIou(t)).map(categoryOf)
    )
    return [...names].toSorted()
  }, [view.transactions])

  // Kind and category are app-level slices; search, sort and paging are the table's.
  const data = useMemo<Row[]>(
    () =>
      view.transactions
        .filter((t) => !t.id.startsWith("optimistic:"))
        .filter((t) =>
          kind === "all"
            ? true
            : kind === "iou"
              ? isIou(t)
              : !isIou(t) && (kind === "in" ? t.amount > 0 : t.amount < 0)
        )
        .filter((t) => category === "all" || categoryOf(t) === category)
        .map((t) => ({
          txn: t,
          date: t.localDate,
          description: t.description,
          category: categoryOf(t),
          amount: t.amount,
        })),
    [view.transactions, kind, category]
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
    initialState: {
      sorting: [{ id: "date", desc: true }],
      pagination: { pageIndex: 0, pageSize: 15 },
    },
  })

  const rows = table.getRowModel().rows
  const filtered = table.getFilteredRowModel().rows.length
  const { pageIndex, pageSize } = table.state.pagination
  const net = table
    .getFilteredRowModel()
    .rows.filter((r) => !isIou(r.original.txn))
    .reduce((sum, r) => sum + r.original.amount, 0)

  return (
    <section aria-labelledby="table-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2
          id="table-heading"
          className="mr-auto text-sm font-medium text-muted-foreground"
        >
          Transactions
        </h2>
        <div className="relative">
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
            className="h-9 w-52 pl-9"
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
      </div>

      <div className="overflow-hidden rounded-2xl border bg-card">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id} className="hover:bg-transparent">
                {group.headers.map((header) => {
                  const sorted = header.column.getIsSorted()
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
                        header.column.id === "amount" && "text-right",
                        header.column.id === "date" && "w-32"
                      )}
                    >
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-sm transition-colors hover:text-foreground",
                          header.column.id === "amount" && "flex-row-reverse"
                        )}
                      >
                        <table.FlexRender header={header} />
                        {sorted === "asc" && <ArrowUpIcon className="size-3" />}
                        {sorted === "desc" && (
                          <ArrowDownIcon className="size-3" />
                        )}
                      </button>
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
                    <TableCell key={cell.id} className="max-w-0 px-4 py-2.5">
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={4}
                  className="h-24 text-center text-muted-foreground"
                >
                  {view.transactions.length
                    ? "Nothing matches."
                    : "No activity this month."}
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
          {filtered > 0 && ` · net ${formatPeso(net, { sign: net > 0 })}`}
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
