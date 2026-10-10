import { addDays } from "@workspace/core/dates"

const weekdayDate = new Intl.DateTimeFormat("en-PH", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
})

const monthYear = new Intl.DateTimeFormat("en-PH", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
})

const monthOnly = new Intl.DateTimeFormat("en-PH", {
  month: "long",
  timeZone: "UTC",
})

const utc = (date: string) => new Date(`${date}T00:00:00Z`)

/** "Thu, Oct 8". */
export function shortDate(date: string): string {
  return weekdayDate.format(utc(date))
}

/** "Today", "Yesterday", or "Thu, Oct 8". */
export function dayLabel(date: string, today: string): string {
  if (date === today) return "Today"
  if (date === addDays(today, -1)) return "Yesterday"
  return weekdayDate.format(utc(date))
}

/** "October 2026" for "2026-10". */
export function monthLabel(month: string): string {
  return monthYear.format(utc(`${month}-01`))
}

/** "October" for "2026-10". */
export function monthName(month: string): string {
  return monthOnly.format(utc(`${month}-01`))
}

/** "iced coffee" → "Iced coffee". Display only; stored text is untouched. */
export function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1)
}

/** How an IOU row reads: "Lent to Mara", "Ben paid you back". */
export function iouLabel(
  kind: "expense" | "income" | "lend" | "settle",
  amount: number,
  name: string
): string | null {
  if (kind === "lend")
    return amount < 0 ? `Lent to ${name}` : `Borrowed from ${name}`
  if (kind === "settle")
    return amount > 0 ? `${name} paid you back` : `Paid ${name} back`
  return null
}
