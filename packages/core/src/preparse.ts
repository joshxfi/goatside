/**
 * The deterministic half of the composer. It reads the parts of a line
 * that must never be guessed (sign, amount, date words, split count) and
 * leaves the meaning (category, merchant, people) to the AI.
 */

import { type Centavos, parseAmount } from "./money"
import {
  type LocalDate,
  addDays,
  isValidDate,
  makeDate,
  weekdayOf,
} from "./dates"

export type Direction = "in" | "out"

export interface DraftLine {
  /** The segment as typed, trimmed. */
  raw: string
  direction: Direction
  /** True when the line had no +/− and we assumed money out. */
  signInferred: boolean
  /** The full amount as typed. */
  amount: Centavos
  /** Your share: `amount` divided by `split`, or `amount` when not split. */
  share: Centavos
  split: number | null
  /** What's left after removing the amount, date and split words. */
  description: string
  localDate: LocalDate
  /** True when the date came from words in the text, not the default (today). */
  dateFromText: boolean
}

export type Preparsed =
  | { kind: "log"; lines: DraftLine[] }
  | { kind: "undo" }
  | { kind: "ask"; text: string }
  | { kind: "empty" }

export interface PreparseOptions {
  /** Today's date in the owner's timezone. */
  today: LocalDate
}

const WEEKDAYS = [
  ["sunday", "sun"],
  ["monday", "mon"],
  ["tuesday", "tue", "tues"],
  ["wednesday", "wed"],
  ["thursday", "thu", "thur", "thurs"],
  ["friday", "fri"],
  ["saturday", "sat"],
] as const

const MONTHS = [
  ["january", "jan"],
  ["february", "feb"],
  ["march", "mar"],
  ["april", "apr"],
  ["may"],
  ["june", "jun"],
  ["july", "jul"],
  ["august", "aug"],
  ["september", "sep", "sept"],
  ["october", "oct"],
  ["november", "nov"],
  ["december", "dec"],
] as const

const MONTH_NAMES = MONTHS.flat().join("|")
const WEEKDAY_FULL = WEEKDAYS.map((w) => w[0]).join("|")
const WEEKDAY_ANY = WEEKDAYS.flat().join("|")

function monthNumber(name: string): number {
  const n = name.toLowerCase().replace(".", "")
  return (
    MONTHS.findIndex((names) => (names as readonly string[]).includes(n)) + 1
  )
}

function weekdayNumber(name: string): number {
  const n = name.toLowerCase()
  return WEEKDAYS.findIndex((names) => (names as readonly string[]).includes(n))
}

/** Most recent `weekday` on or before `today` (or strictly before, if `strict`). */
function previousWeekday(
  today: LocalDate,
  weekday: number,
  strict: boolean
): LocalDate {
  let diff = (weekdayOf(today) - weekday + 7) % 7
  if (diff === 0 && strict) diff = 7
  return addDays(today, -diff)
}

/** A month/day without a year means the most recent such date, never the future. */
function pastMonthDay(
  today: LocalDate,
  month: number,
  day: number
): LocalDate | null {
  const year = Number(today.slice(0, 4))
  for (const y of [year, year - 1]) {
    if (!isValidDate(y, month, day)) continue
    const date = makeDate(y, month, day)
    if (date <= today) return date
  }
  return null
}

interface DateRule {
  pattern: RegExp
  resolve: (match: RegExpMatchArray, today: LocalDate) => LocalDate | null
}

// Word boundaries are spelled out because \b treats "'" oddly in names like berto's.
const B = "(?<![\\p{L}\\d])"
const E = "(?![\\p{L}\\d])"

const DATE_RULES: DateRule[] = [
  {
    pattern: new RegExp(`${B}(\\d{4})-(\\d{2})-(\\d{2})${E}`, "iu"),
    resolve: (m, today) => {
      const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
      if (!isValidDate(y, mo, d)) return null
      const date = makeDate(y, mo, d)
      return date <= today ? date : null
    },
  },
  {
    pattern: new RegExp(`${B}(?:today|tdy|kanina|ngayon)${E}`, "iu"),
    resolve: (_, today) => today,
  },
  {
    pattern: new RegExp(`${B}(?:yesterday|yday|yest|kahapon)${E}`, "iu"),
    resolve: (_, today) => addDays(today, -1),
  },
  {
    pattern: new RegExp(`${B}(\\d{1,3})\\s*days?\\s+ago${E}`, "iu"),
    resolve: (m, today) => addDays(today, -Number(m[1])),
  },
  {
    pattern: new RegExp(`${B}last\\s+(${WEEKDAY_ANY})\\.?${E}`, "iu"),
    resolve: (m, today) =>
      previousWeekday(today, weekdayNumber(m[1] ?? ""), true),
  },
  {
    // "on mon", "on tuesday". Abbreviations need "on" so "sun load" stays a description.
    pattern: new RegExp(`${B}on\\s+(${WEEKDAY_ANY})\\.?${E}`, "iu"),
    resolve: (m, today) =>
      previousWeekday(today, weekdayNumber(m[1] ?? ""), false),
  },
  {
    pattern: new RegExp(`${B}(${WEEKDAY_FULL})${E}`, "iu"),
    resolve: (m, today) =>
      previousWeekday(today, weekdayNumber(m[1] ?? ""), false),
  },
  {
    // "oct 3", "october 3rd", "on oct. 3"
    pattern: new RegExp(
      `${B}(?:on\\s+)?(${MONTH_NAMES})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?${E}`,
      "iu"
    ),
    resolve: (m, today) =>
      pastMonthDay(today, monthNumber(m[1] ?? ""), Number(m[2])),
  },
  {
    // "3 oct", "3rd of october"
    pattern: new RegExp(
      `${B}(?:on\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_NAMES})\\.?${E}`,
      "iu"
    ),
    resolve: (m, today) =>
      pastMonthDay(today, monthNumber(m[2] ?? ""), Number(m[1])),
  },
]

const SPLIT_PATTERN = new RegExp(
  `${B}split\\s*(?:by|in|into|between)?\\s*(\\d{1,2})(?:\\s*ways?)?${E}`,
  "iu"
)

// Sign, optional currency, then the amount. "p" only counts when glued to digits.
const LEADING_AMOUNT =
  /^([+-])?\s*(?:₱|php\s*|p(?=[\d.]))?\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d*\.?\d+)(k)?(?=$|[\s,;:!)])/i

// Further entries on the same line must start with a sign: "-500 lunch, -120 coffee".
const SEGMENT_BREAK =
  /\s*(?:[,;\n]|\band\b)\s*(?=[+-]\s*(?:₱|php\s*|p)?\s*[\d.])/i

function normalize(text: string): string {
  return text
    .replace(/[−‒–—]/g, "-") // minus and dashes typed on phones
    .replace(/＋/g, "+")
    .replace(/[ \t]/g, " ")
    .trim()
}

function cleanDescription(text: string): string {
  return text
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,;:\-–]+|[\s,;:\-–]+$/g, "")
    .replace(/^(?:for|on|sa)\s+/i, "")
    .trim()
}

function parseSegment(segment: string, today: LocalDate): DraftLine | null {
  const match = segment.match(LEADING_AMOUNT)
  if (!match?.[2]) return null

  // Groups: 1 = sign, 2 = digits, 3 = "k".
  const amount = parseAmount(match[2] + (match[3] ?? ""))
  if (amount === null) return null

  let rest = segment.slice(match[0].length)

  let localDate = today
  let dateFromText = false
  for (const rule of DATE_RULES) {
    const dateMatch = rest.match(rule.pattern)
    if (!dateMatch) continue
    const resolved = rule.resolve(dateMatch, today)
    if (!resolved) continue
    localDate = resolved
    dateFromText = true
    rest = rest.replace(dateMatch[0], " ")
    break
  }

  let split: number | null = null
  const splitMatch = rest.match(SPLIT_PATTERN)
  const splitCount = Number(splitMatch?.[1])
  if (splitMatch && splitCount >= 2) {
    split = splitCount
    rest = rest.replace(splitMatch[0], " ")
  }

  return {
    raw: segment,
    direction: match[1] === "+" ? "in" : "out",
    signInferred: !match[1],
    amount,
    share: split ? Math.round(amount / split) : amount,
    split,
    description: cleanDescription(rest),
    localDate,
    dateFromText,
  }
}

/**
 * Classifies a composer line and extracts its fixed facts.
 *
 * - `-500 lunch at berto's` → log, money out ₱500
 * - `+250 paid by x` → log, money in ₱250
 * - `-500 lunch, -120 coffee` → log, two lines
 * - `500 lunch` → log, money out, `signInferred`
 * - `undo` → undo
 * - anything else (or ending in "?") → ask
 */
export function preparse(input: string, { today }: PreparseOptions): Preparsed {
  const text = normalize(input)
  if (!text) return { kind: "empty" }
  if (/^undo$/i.test(text)) return { kind: "undo" }

  const looksLikeEntry = LEADING_AMOUNT.test(text) && !text.endsWith("?")
  if (!looksLikeEntry) return { kind: "ask", text }

  const segments = text.split(SEGMENT_BREAK).filter(Boolean)
  const lines: DraftLine[] = []
  for (const segment of segments) {
    const line = parseSegment(segment.trim(), today)
    // A segment that won't parse belongs to the previous line's description.
    if (!line) {
      const previous = lines.at(-1)
      if (!previous) return { kind: "ask", text }
      previous.raw += `, ${segment.trim()}`
      previous.description = cleanDescription(
        `${previous.description}, ${segment}`
      )
      continue
    }
    lines.push(line)
  }

  return lines.length ? { kind: "log", lines } : { kind: "ask", text }
}
