/**
 * Reads bank and card statements from the text a PDF (or CSV) gives us:
 * lines of positioned cells. Code finds the columns from what the cells
 * contain, parses every amount, and checks the rows against the balances
 * and totals the statement prints. Nothing here guesses: a statement that
 * can't be checked isn't imported.
 */

import { MAX_CENTAVOS, type Centavos } from "./money"
import { addDays, isValidDate, makeDate, type LocalDate } from "./dates"

export type StatementKind = "bank" | "ewallet" | "credit_card" | "cash"

export interface StatementCell {
  /** Left edge, in PDF points. */
  x: number
  /** Width in points, when known. Amounts line up on their right edge. */
  width?: number
  text: string
}

export interface StatementLine {
  page: number
  /** Baseline in PDF points: larger is higher on the page. */
  y: number
  cells: StatementCell[]
}

export interface StatementRow {
  /** The transaction date (the first date column). */
  localDate: LocalDate
  /** The posting date, on statements that print both. */
  postedDate?: LocalDate
  details: string
  /** Cash flow from the owner's side: money out is negative. */
  amount: Centavos
  /** The running balance as printed, when the statement has one. */
  balance?: Centavos
  page: number
  y: number
}

/**
 * What the statement says about itself. Balances are as printed: on a card
 * that's the amount owed. Totals are positive.
 */
export interface StatementSummary {
  opening?: Centavos
  closing?: Centavos
  totalIn?: Centavos
  totalOut?: Centavos
}

export interface StatementPeriod {
  start: LocalDate
  end: LocalDate
}

export type CheckState = "pass" | "fail" | "skip"

export interface StatementCheck {
  ok: boolean
  running: CheckState
  totals: CheckState
  ends: CheckState
  period: CheckState
  /** The first row (index into `rows`) whose balance or date breaks. */
  firstBreak?: number
  /** Why it isn't ok, in a plain sentence. */
  problem?: string
}

export interface StatementResult {
  ok: boolean
  rows: StatementRow[]
  summary: StatementSummary
  period: StatementPeriod | null
  check: StatementCheck
  problem?: string
}

// ---------------------------------------------------------------------------
// Cell readers

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
}

export interface DateParts {
  year?: number
  month: number
  day: number
}

function fullYear(text: string | undefined): number | undefined {
  if (!text) return undefined
  const n = Number(text)
  return text.length === 2 ? 2000 + n : n
}

/**
 * Reads a statement date: `11 Jul 2026`, `5 September 2026`, `11-Jul-26`,
 * `Jul 11, 2026`, `2026-07-11`, or one without a year (`9 Aug`, `Aug 9`).
 * Numeric dates like `07/11/2026` aren't read: the day and month order
 * differs between banks.
 */
export function readDateParts(text: string): DateParts | null {
  const t = text.trim().replace(/\s+/g, " ").replace(/[.,]$/, "")
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) {
    const parts = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }
    return isValidDate(parts.year, parts.month, parts.day) ? parts : null
  }
  let day: number | undefined
  let month: number | undefined
  let year: number | undefined
  m = t.match(/^(\d{1,2})[ -]([A-Za-z]{3,9})\.?(?:[ ,-]+(\d{4}|\d{2}))?$/)
  if (m) {
    day = Number(m[1])
    month = MONTHS[m[2]!.toLowerCase()]
    year = fullYear(m[3])
  } else {
    m = t.match(/^([A-Za-z]{3,9})\.? (\d{1,2})(?:,? (\d{4}))?$/)
    if (!m) return null
    month = MONTHS[m[1]!.toLowerCase()]
    day = Number(m[2])
    year = fullYear(m[3])
  }
  if (!month) return null
  // Without a year, a leap year lets 29 Feb through.
  if (!isValidDate(year ?? 2024, month, day)) return null
  return year === undefined ? { month, day } : { year, month, day }
}

/** A full date, or null when the text has no year. */
export function readDate(text: string): LocalDate | null {
  const parts = readDateParts(text)
  if (!parts?.year) return null
  return makeDate(parts.year, parts.month, parts.day)
}

/**
 * Reads a printed amount into signed centavos: `1,500.00`, `- 1,037.92`,
 * `(1,037.92)`, `PHP 3,884.33`, `1,037.92 PHP`, `₱250.00`, `0.00`.
 * Statements always print two decimals, so `2026` or `1234` alone isn't an
 * amount (years and card digits stay out).
 */
export function readAmount(text: string): Centavos | null {
  let t = text
    .trim()
    .replace(/^(?:php|₱)\s*/i, "")
    .replace(/\s*(?:php)$/i, "")
  let negative = false
  const parens = t.match(/^\((.*)\)$/)
  if (parens) {
    negative = true
    t = parens[1]!.trim()
  }
  const sign = t.match(/^[-−–]\s*(.*)$/)
  if (sign) {
    if (negative) return null
    negative = true
    t = sign[1]!
  }
  t = t.replace(/^(?:php|₱)\s*/i, "")
  const m = t.match(/^(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})$/)
  if (!m) return null
  const centavos = Number(m[1]!.replaceAll(",", "")) * 100 + Number(m[2])
  if (!Number.isSafeInteger(centavos) || centavos > MAX_CENTAVOS) return null
  return negative && centavos !== 0 ? -centavos : centavos
}

// ---------------------------------------------------------------------------
// Lines from pdf.js text items

export interface TextItem {
  str: string
  x: number
  y: number
  width: number
}

/**
 * Groups one page's text items into lines (baselines within 2 points) and
 * joins items that touch, so `Outbound interbank` + `transfer` is one cell.
 */
export function linesFromItems(
  page: number,
  items: TextItem[]
): StatementLine[] {
  const sorted = items
    .filter((it) => it.str.trim())
    .toSorted((a, b) => b.y - a.y || a.x - b.x)
  const lines: StatementLine[] = []
  for (const it of sorted) {
    const last = lines.at(-1)
    const cell = { x: it.x, width: it.width, text: it.str.trim() }
    if (last && Math.abs(last.y - it.y) <= 2) last.cells.push(cell)
    else lines.push({ page, y: it.y, cells: [cell] })
  }
  for (const line of lines) {
    line.cells.sort((a, b) => a.x - b.x)
    const merged: StatementCell[] = []
    for (const cell of line.cells) {
      const prev = merged.at(-1)
      const gap = prev ? cell.x - (prev.x + (prev.width ?? 0)) : Infinity
      if (prev && prev.width !== undefined && gap < 3) {
        prev.text =
          gap > 0.5 ? `${prev.text} ${cell.text}` : prev.text + cell.text
        prev.width = cell.x + (cell.width ?? 0) - prev.x
      } else merged.push({ ...cell })
    }
    line.cells = merged
  }
  return lines
}

/** Page order, then top to bottom. */
function ordered(lines: StatementLine[]): StatementLine[] {
  return lines.toSorted((a, b) => a.page - b.page || b.y - a.y)
}

const lineText = (line: StatementLine) =>
  line.cells.map((c) => c.text).join(" ")

// ---------------------------------------------------------------------------
// Period

/** `06 Aug 2026 to 05 Sep 2026`, `Period: 11 Jul 2026 - 10 Oct 2026`. */
export function readPeriod(lines: StatementLine[]): StatementPeriod | null {
  for (const line of ordered(lines)) {
    const text = lineText(line).replace(/\s+/g, " ")
    const m = text.match(
      /(\d{1,2}[ -][A-Za-z]{3,9}\.?(?:[ ,-]+\d{4})?|[A-Za-z]{3,9}\.? \d{1,2}(?:,? \d{4})?)\s+(?:to|-|–|—)\s+(\d{1,2}[ -][A-Za-z]{3,9}\.?[ ,-]+\d{4}|[A-Za-z]{3,9}\.? \d{1,2},? \d{4})/
    )
    if (!m) continue
    const first = readDateParts(m[1]!)
    const end = readDate(m[2]!)
    if (!first || !end) continue
    const endYear = Number(end.slice(0, 4))
    const endMonth = Number(end.slice(5, 7))
    const year = first.year ?? (first.month > endMonth ? endYear - 1 : endYear)
    const start = makeDate(year, first.month, first.day)
    if (start <= end) return { start, end }
  }
  return null
}

/**
 * The year for a date printed without one: the year that puts it inside
 * the period (or within a month before it, for late-posted charges).
 */
function resolveYear(
  parts: DateParts,
  period: StatementPeriod | null,
  fallbackYear: number | null
): LocalDate | null {
  if (parts.year) return makeDate(parts.year, parts.month, parts.day)
  if (!period) {
    return fallbackYear ? makeDate(fallbackYear, parts.month, parts.day) : null
  }
  const startYear = Number(period.start.slice(0, 4))
  const endYear = Number(period.end.slice(0, 4))
  const from = addDays(period.start, -31)
  for (let y = endYear; y >= startYear - 1; y--) {
    if (!isValidDate(y, parts.month, parts.day)) continue
    const date = makeDate(y, parts.month, parts.day)
    if (date >= from && date <= period.end) return date
  }
  return null
}

// ---------------------------------------------------------------------------
// Layout

export type AmountRole = "amount" | "credit" | "debit" | "balance"

export interface AmountColumn {
  /** Smallest and largest anchor (right edge) seen in the column. */
  from: number
  to: number
  /** What a header word above it says it is, if anything. */
  hint: AmountRole | null
}

export interface Layout {
  /** Left edge of the transaction date column. */
  dateX: number
  postedDate: boolean
  /** Left edge of the details column. */
  detailsX: number
  /** Left edge of the leftmost amount. Details sit before it. */
  amountsX: number
  columns: AmountColumn[]
  /** The lines that start a row, in reading order. */
  rowLines: StatementLine[]
}

const anchor = (cell: StatementCell) => cell.x + (cell.width ?? 0)

/** A date at the start of a line, possibly split over two or three cells. */
function leadingDate(
  cells: StatementCell[],
  from: number
): { parts: DateParts; used: number } | null {
  for (let n = 1; n <= 3 && from + n <= cells.length; n++) {
    const text = cells
      .slice(from, from + n)
      .map((c) => c.text)
      .join(" ")
    const parts = readDateParts(text)
    if (parts) return { parts, used: n }
  }
  return null
}

interface RowParse {
  line: StatementLine
  date: DateParts
  posted?: DateParts
  details: string[]
  amounts: StatementCell[]
}

function parseRowLine(line: StatementLine): RowParse | null {
  const first = leadingDate(line.cells, 0)
  if (!first) return null
  let at = first.used
  const second = leadingDate(line.cells, at)
  if (second) at += second.used
  const rest = line.cells.slice(at)
  const amounts: StatementCell[] = []
  const details: string[] = []
  // Amounts are the trailing cells that read as money.
  let i = rest.length - 1
  while (i >= 0 && readAmount(rest[i]!.text) !== null)
    amounts.unshift(rest[i--]!)
  for (const cell of rest.slice(0, i + 1)) details.push(cell.text)
  if (!amounts.length) return null
  return {
    line,
    date: first.parts,
    ...(second && { posted: second.parts }),
    details,
    amounts,
  }
}

const ROLE_WORDS: [RegExp, AmountRole][] = [
  [/\b(credits?|deposits?|money in|payments?)\b/i, "credit"],
  [/\b(debits?|withdrawals?|money out|charges?|purchases?)\b/i, "debit"],
  [/\bbalance\b/i, "balance"],
  [/\bamount\b/i, "amount"],
]

/** Single-linkage clusters of sorted numbers, split at gaps over `gap`. */
function clusters(values: number[], gap: number): number[][] {
  const sorted = values.toSorted((a, b) => a - b)
  const out: number[][] = []
  for (const v of sorted) {
    const last = out.at(-1)
    if (last && v - last.at(-1)! <= gap) last.push(v)
    else out.push([v])
  }
  return out
}

/**
 * Finds the rows and their columns from what the cells contain: lines that
 * start with a date and end with amounts, all sharing one date column.
 * Header words, when the text has them, only label the amount columns.
 */
export function detectLayout(lines: StatementLine[]): Layout | null {
  const parsed = ordered(lines)
    .map(parseRowLine)
    .filter((r): r is RowParse => r !== null)
  if (!parsed.length) return null

  // The date column most row-like lines share. A due date next to the
  // amount due, elsewhere on the page, isn't a row.
  const byX = clusters(
    parsed.map((r) => r.line.cells[0]!.x),
    6
  ).toSorted((a, b) => b.length - a.length)
  const dateXs = byX[0]!
  const rows = parsed.filter((r) => {
    const x = r.line.cells[0]!.x
    return x >= dateXs[0]! - 0.5 && x <= dateXs.at(-1)! + 0.5
  })
  // Posting dates have to be on (nearly) every row to count as a column.
  const withPosted = rows.filter((r) => r.posted).length
  const postedDate = withPosted * 2 > rows.length
  if (postedDate && withPosted !== rows.length) return null

  const anchors = rows.flatMap((r) => r.amounts.map(anchor))
  const groups = clusters(anchors, 12)
  if (groups.length > 3) return null
  const columns: AmountColumn[] = groups.map((g) => ({
    from: g[0]!,
    to: g.at(-1)!,
    hint: null,
  }))

  const detailsXs = rows.flatMap((r) => {
    const cells = r.line.cells
    const firstDetail = cells.length - r.amounts.length - r.details.length
    return r.details.length ? [cells[firstDetail]!.x] : []
  })
  const amountsX = Math.min(...rows.flatMap((r) => r.amounts.map((c) => c.x)))
  const detailsX = detailsXs.length ? Math.min(...detailsXs) : amountsX

  // Header hints: a role word above the first row, over a column. Lines
  // with amounts are summaries ("Total Credit PHP …"), not headers.
  const firstRow = rows[0]!.line
  for (const line of ordered(lines)) {
    if (line.page > firstRow.page) break
    if (line.page === firstRow.page && line.y <= firstRow.y) continue
    if (line.cells.some((c) => readAmount(c.text) !== null)) continue
    for (const cell of line.cells) {
      const role = ROLE_WORDS.find(([re]) => re.test(cell.text))?.[1]
      if (!role) continue
      const middle = (cell.x + anchor(cell)) / 2
      const distance = (c: AmountColumn) =>
        middle < c.from - 60 ? Infinity : Math.abs(c.to - anchor(cell))
      const column = columns.toSorted((a, b) => distance(a) - distance(b))[0]
      if (column && distance(column) < 60 && !column.hint) column.hint = role
    }
  }

  return {
    dateX: dateXs[0]!,
    postedDate,
    detailsX,
    amountsX,
    columns,
    rowLines: rows.map((r) => r.line),
  }
}

/** Every way to read the amount columns, most likely first. */
export function columnRoles(layout: Layout): AmountRole[][] {
  const n = layout.columns.length
  let options: AmountRole[][]
  if (n === 1) options = [["amount"]]
  else if (n === 2) {
    options = [
      ["credit", "debit"],
      ["debit", "credit"],
      ["amount", "balance"],
    ]
  } else if (n === 3) {
    options = [
      ["credit", "debit", "balance"],
      ["debit", "credit", "balance"],
      ["balance", "credit", "debit"],
      ["balance", "debit", "credit"],
      ["credit", "balance", "debit"],
      ["debit", "balance", "credit"],
    ]
  } else options = []
  const hints = layout.columns.map((c) => c.hint)
  const fits = (roles: AmountRole[]) =>
    roles.every((r, i) => !hints[i] || hints[i] === r)
  return [...options.filter(fits), ...options.filter((o) => !fits(o))]
}

// ---------------------------------------------------------------------------
// Rows

/** On a card, a positive printed amount is a charge and the balance is owed. */
const owedSign = (kind: StatementKind) => (kind === "credit_card" ? -1 : 1)

export interface ExtractOptions {
  kind: StatementKind
  period: StatementPeriod | null
}

/**
 * Turns the layout's row lines into rows with `roles` as the meaning of
 * each amount column. Lines with only details text attach to the nearest
 * row on the same page: GoTyme centers the date between two lines of
 * details, Maya continues the details on the line below.
 */
export function extractRows(
  lines: StatementLine[],
  layout: Layout,
  roles: AmountRole[],
  { kind, period }: ExtractOptions
): { rows: StatementRow[]; problem?: string } {
  const all = ordered(lines)
  const rowSet = new Set(layout.rowLines)
  const fallbackYear = yearInText(all)

  // Row pitch: the usual gap between row lines on a page.
  const gaps: number[] = []
  for (let i = 1; i < layout.rowLines.length; i++) {
    const a = layout.rowLines[i - 1]!
    const b = layout.rowLines[i]!
    if (a.page === b.page) gaps.push(a.y - b.y)
  }
  const pitch = gaps.length
    ? gaps.toSorted((a, b) => a - b)[gaps.length >> 1]!
    : 20

  // Details-only lines: everything between the details column and the
  // amounts, nothing else on the line.
  const extra = new Map<StatementLine, StatementLine[]>()
  for (const line of all) {
    if (rowSet.has(line)) continue
    const onlyDetails = line.cells.every(
      (c) =>
        c.x >= layout.detailsX - 4 &&
        c.x < layout.amountsX - 4 &&
        readAmount(c.text) === null
    )
    if (!onlyDetails) continue
    let best: StatementLine | null = null
    for (const row of layout.rowLines) {
      if (row.page !== line.page) continue
      const d = Math.abs(row.y - line.y)
      if (d >= pitch) continue
      // On a tie, the row above (details continue downwards).
      if (
        !best ||
        d < Math.abs(best.y - line.y) ||
        (d === Math.abs(best.y - line.y) && row.y > best.y)
      )
        best = row
    }
    if (best) extra.set(best, [...(extra.get(best) ?? []), line])
  }

  const rows: StatementRow[] = []
  for (const line of layout.rowLines) {
    const parsed = parseRowLine(line)!
    const localDate = resolveYear(parsed.date, period, fallbackYear)
    const postedDate = parsed.posted
      ? resolveYear(parsed.posted, period, fallbackYear)
      : undefined
    if (!localDate || postedDate === null) {
      return { rows: [], problem: "Some dates on the statement have no year." }
    }

    const values: Partial<Record<AmountRole, Centavos>> = {}
    for (const cell of parsed.amounts) {
      const at = anchor(cell)
      const index = layout.columns.findIndex(
        (c) => at >= c.from - 12 && at <= c.to + 12
      )
      const role = roles[index]
      const value = readAmount(cell.text)
      if (!role || value === null || values[role] !== undefined) {
        return { rows: [], problem: "Couldn't line up the amount columns." }
      }
      values[role] = value
    }

    let amount: Centavos
    if (values.amount !== undefined) {
      amount = values.amount * owedSign(kind)
    } else {
      // Some banks print debits with a minus; the column says which way.
      amount = Math.abs(values.credit ?? 0) - Math.abs(values.debit ?? 0)
    }

    const parts = [line, ...(extra.get(line) ?? [])].toSorted(
      (a, b) => b.y - a.y
    )
    const details = parts
      .flatMap((l) =>
        l === line ? parsed.details : l.cells.map((c) => c.text)
      )
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()

    rows.push({
      localDate,
      ...(postedDate && { postedDate }),
      details,
      amount,
      ...(values.balance !== undefined && { balance: values.balance }),
      page: line.page,
      y: line.y,
    })
  }
  return { rows }
}

/** The latest four-digit year printed anywhere, for dates without one. */
function yearInText(lines: StatementLine[]): number | null {
  let best: number | null = null
  for (const line of lines) {
    for (const cell of line.cells) {
      const d = readDate(cell.text)
      if (d) best = Math.max(best ?? 0, Number(d.slice(0, 4)))
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// Summary

const SUMMARY_WORDS: [RegExp, keyof StatementSummary][] = [
  [
    /\b(opening|beginning|previous|starting)( statement)? balance\b|\bbalance forward\b/i,
    "opening",
  ],
  [/\b(closing|ending|new|statement) balance\b/i, "closing"],
  [
    /\btotal (credits?|deposits?|money in)\b|\bpayments?( and credits?)?$/i,
    "totalIn",
  ],
  [/\btotal (debits?|withdrawals?|money out)\b|\bpurchases?\b/i, "totalOut"],
]

/**
 * What the statement prints about its own totals. Labeled figures first
 * ("Opening balance PHP 1,234.56"). Some statements draw their labels as
 * part of an image, so the text has only the figures: then a figure counts
 * only when it matches the rows exactly and nothing else does.
 */
export function readSummary(
  lines: StatementLine[],
  rows: StatementRow[],
  layout: Layout | null,
  kind: StatementKind
): StatementSummary {
  const rowSet = new Set(layout?.rowLines ?? [])
  const others = ordered(lines).filter((l) => !rowSet.has(l))
  const summary: StatementSummary = {}

  for (const line of others) {
    const amounts = line.cells.map((c) => readAmount(c.text))
    const value = amounts.findLast((a) => a !== null)
    if (value == null) continue
    const label = line.cells
      .filter((_, i) => amounts[i] === null)
      .map((c) => c.text)
      .join(" ")
      .trim()
    if (/minimum/i.test(label)) continue
    const role = SUMMARY_WORDS.find(([re]) => re.test(label))?.[1]
    if (role && summary[role] === undefined) {
      summary[role] =
        role === "opening" || role === "closing" ? value : Math.abs(value)
    }
  }

  // Unlabeled figures: only when no label was found at all.
  if (Object.keys(summary).length) return summary
  const figures = others.flatMap((l) =>
    l.cells
      .map((c) => readAmount(c.text))
      .filter((a): a is number => a !== null)
  )
  const totalIn = rows.reduce((s, r) => s + Math.max(0, r.amount), 0)
  const totalOut = rows.reduce((s, r) => s + Math.max(0, -r.amount), 0)
  // Both totals or neither: a matching payments figure says nothing about
  // the charges.
  const printed = (total: number) =>
    total === 0 || figures.some((f) => Math.abs(f) === total)
  if (rows.length && printed(totalIn) && printed(totalOut)) {
    if (totalIn) summary.totalIn = totalIn
    if (totalOut) summary.totalOut = totalOut
  }

  const net = (totalIn - totalOut) * owedSign(kind)
  if (net !== 0) {
    const values = [...new Set(figures)]
    const pairs = values.flatMap((a) =>
      values.includes(a + net) ? [[a, a + net] as const] : []
    )
    if (pairs.length === 1) {
      summary.opening = pairs[0]![0]
      summary.closing = pairs[0]![1]
    }
  }
  return summary
}

// ---------------------------------------------------------------------------
// Checks

/**
 * The gate. Every printed running balance must follow from the one before;
 * totals and opening plus rows must match what the statement prints; dates
 * must sit inside the period. At least one balance or total check has to
 * run, or there's nothing to verify the rows against.
 */
export function checkStatement(
  rows: StatementRow[],
  summary: StatementSummary,
  period: StatementPeriod | null,
  kind: StatementKind
): StatementCheck {
  const sign = owedSign(kind)
  const check: StatementCheck = {
    ok: false,
    running: "skip",
    totals: "skip",
    ends: "skip",
    period: "skip",
  }
  if (!rows.length) {
    return { ...check, problem: "No transactions found on the statement." }
  }

  // Running balance.
  let compared = 0
  let previous = summary.opening
  for (const [i, row] of rows.entries()) {
    if (row.balance === undefined) {
      if (previous !== undefined) previous += row.amount * sign
      continue
    }
    if (previous !== undefined) {
      compared++
      if (row.balance !== previous + row.amount * sign) {
        check.running = "fail"
        check.firstBreak = i
        break
      }
    }
    previous = row.balance
  }
  if (check.running === "skip" && compared) check.running = "pass"

  // Totals.
  const totalIn = rows.reduce((s, r) => s + Math.max(0, r.amount), 0)
  const totalOut = rows.reduce((s, r) => s + Math.max(0, -r.amount), 0)
  if (summary.totalIn !== undefined || summary.totalOut !== undefined) {
    const inOk = summary.totalIn === undefined || summary.totalIn === totalIn
    const outOk =
      summary.totalOut === undefined || summary.totalOut === totalOut
    check.totals = inOk && outOk ? "pass" : "fail"
  }

  // Opening plus rows equals closing; and the last running balance.
  if (summary.opening !== undefined && summary.closing !== undefined) {
    const lastBalance = rows.findLast((r) => r.balance !== undefined)?.balance
    const sum = summary.opening + (totalIn - totalOut) * sign
    check.ends =
      sum === summary.closing &&
      (lastBalance === undefined || lastBalance === summary.closing)
        ? "pass"
        : "fail"
  }

  // Dates inside the period. Charges can post a few days after they happen.
  if (period) {
    check.period = "pass"
    for (const [i, row] of rows.entries()) {
      const posted = row.postedDate ?? row.localDate
      const inside =
        posted >= period.start &&
        posted <= period.end &&
        row.localDate >= addDays(period.start, -7) &&
        row.localDate <= period.end
      if (!inside) {
        check.period = "fail"
        check.firstBreak ??= i
        break
      }
    }
  }

  const states = [check.running, check.totals, check.ends, check.period]
  const verified = [check.running, check.totals, check.ends].includes("pass")
  check.ok = verified && !states.includes("fail")
  if (!check.ok) {
    check.problem =
      check.running === "fail"
        ? "A running balance doesn't follow from the row before it."
        : check.totals === "fail"
          ? "The rows don't add up to the totals on the statement."
          : check.ends === "fail"
            ? "The opening balance plus the rows doesn't equal the closing balance."
            : check.period === "fail"
              ? "A row is dated outside the statement period."
              : "There's no running balance or total on the statement that matches the rows, so they can't be checked."
  }
  return check
}

// ---------------------------------------------------------------------------
// Putting it together

/**
 * Reads a whole statement for an account of `kind`. Tries every way the
 * amount columns could be read and keeps the one the checks confirm; when
 * two readings both pass and disagree, it refuses rather than pick.
 */
export function readStatement(
  lines: StatementLine[],
  { kind }: { kind: StatementKind }
): StatementResult {
  const period = readPeriod(lines)
  const layout = detectLayout(lines)
  const empty = { rows: [], summary: {}, period }
  if (!layout) {
    const check = checkStatement([], {}, period, kind)
    return { ok: false, ...empty, check, problem: check.problem }
  }

  let firstFailure: StatementResult | null = null
  const passing: StatementResult[] = []
  for (const roles of columnRoles(layout)) {
    const { rows, problem } = extractRows(lines, layout, roles, {
      kind,
      period,
    })
    if (problem) {
      firstFailure ??= {
        ok: false,
        ...empty,
        check: checkStatement([], {}, period, kind),
        problem,
      }
      continue
    }
    const summary = readSummary(lines, rows, layout, kind)
    const check = checkStatement(rows, summary, period, kind)
    const result = {
      ok: check.ok,
      rows,
      summary,
      period,
      check,
      problem: check.problem,
    }
    if (check.ok) passing.push(result)
    else firstFailure ??= result
  }

  const [best, ...rest] = passing
  if (best) {
    const same = (a: StatementRow[], b: StatementRow[]) =>
      a.every((r, i) => r.amount === b[i]?.amount)
    if (rest.some((r) => !same(r.rows, best.rows))) {
      return {
        ok: false,
        ...empty,
        check: { ...best.check, ok: false },
        problem:
          "Couldn't tell which column is money in and which is money out.",
      }
    }
    return best
  }
  return firstFailure!
}

/**
 * A stable id for a row within an account, so an overlapping statement
 * doesn't import it twice. `occurrence` counts identical rows earlier in
 * the same statement: two 25.00 rides on one day are both real.
 */
export function rowFingerprint(row: StatementRow, occurrence = 0): string {
  const key = [
    row.localDate,
    row.amount,
    row.balance ?? "",
    row.details.toLowerCase(),
    occurrence,
  ].join("|")
  return `s1:${hash53(key)}`
}

/** Fingerprints for every row, counting repeats. */
export function fingerprintRows(rows: StatementRow[]): string[] {
  const seen = new Map<string, number>()
  return rows.map((row) => {
    const base = rowFingerprint(row)
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return rowFingerprint(row, n)
  })
}

/** cyrb53: a small, fast, well-spread string hash. Not for secrets. */
function hash53(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/**
 * Whether the account's last four digits appear outside the rows (in an
 * account or card number, masked or not). Amounts don't count.
 */
export function statementMentions(
  lines: StatementLine[],
  last4: string,
  layout: Layout | null = detectLayout(lines)
): boolean {
  const rowSet = new Set(layout?.rowLines ?? [])
  return lines.some(
    (line) =>
      !rowSet.has(line) &&
      lineText(line)
        .replace(/\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2}/g, " ")
        .match(/\d+/g)
        ?.some((run) => run.endsWith(last4))
  )
}
