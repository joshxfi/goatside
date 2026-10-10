/**
 * Calendar dates as "YYYY-MM-DD" strings in the owner's timezone.
 * Grouping by month is then just a string prefix, and there are no
 * timezone surprises at midnight.
 */

export type LocalDate = string

export const DEFAULT_TIME_ZONE = "Asia/Manila"

/** Today's date in `timeZone`. */
export function todayIn(timeZone: string, now: Date = new Date()): LocalDate {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)
}

function toUtc(date: LocalDate): Date {
  return new Date(`${date}T00:00:00Z`)
}

function fromUtc(date: Date): LocalDate {
  return date.toISOString().slice(0, 10)
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const d = toUtc(date)
  d.setUTCDate(d.getUTCDate() + days)
  return fromUtc(d)
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(date: LocalDate): number {
  return toUtc(date).getUTCDay()
}

export function isValidDate(year: number, month: number, day: number): boolean {
  const d = new Date(Date.UTC(year, month - 1, day))
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  )
}

export function makeDate(year: number, month: number, day: number): LocalDate {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

/** "2026-10" for a date. */
export function monthOf(date: LocalDate): string {
  return date.slice(0, 7)
}

/** Shifts a "YYYY-MM" month by `delta` months. */
export function addMonths(month: string, delta: number): string {
  const [y = 0, m = 1] = month.split("-").map(Number)
  const index = y * 12 + (m - 1) + delta
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`
}

/** Number of days in a "YYYY-MM" month. */
export function daysInMonth(month: string): number {
  const [y = 0, m = 1] = month.split("-").map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** First and last day of a "YYYY-MM" month. */
export function monthRange(month: string): {
  start: LocalDate
  end: LocalDate
} {
  return {
    start: `${month}-01`,
    end: `${month}-${String(daysInMonth(month)).padStart(2, "0")}`,
  }
}
