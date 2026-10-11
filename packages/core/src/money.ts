/**
 * Money is stored as integer cents: hundredths of the owner's currency, which
 * they pick in Settings (PHP unless they change it). Never floats.
 */

export type Cents = number

/** Largest amount we accept from typed input: 1 billion. */
export const MAX_CENTS = 100_000_000_000

/** ISO 4217 code used until the owner picks one. */
export const DEFAULT_CURRENCY = "PHP"

/** Offered in Settings and accepted in front of typed amounts ("usd 20"). */
export const COMMON_CURRENCIES = [
  "PHP",
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "CNY",
  "KRW",
  "INR",
  "IDR",
  "SGD",
  "MYR",
  "THB",
  "VND",
  "HKD",
  "TWD",
  "AUD",
  "NZD",
  "CAD",
  "MXN",
  "BRL",
  "CHF",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "AED",
  "SAR",
  "ZAR",
  "NGN",
  "KES",
] as const

/** Whether `code` is an ISO 4217 currency this runtime can format. */
export function isCurrency(code: string): boolean {
  if (!/^[A-Z]{3}$/.test(code)) return false
  try {
    return Intl.supportedValuesOf("currency").includes(code)
  } catch {
    return (COMMON_CURRENCIES as readonly string[]).includes(code)
  }
}

let current = DEFAULT_CURRENCY

/**
 * Sets the currency `formatMoney` uses when none is passed. The app calls it
 * with the owner's setting before rendering; server code passes the currency
 * explicitly instead.
 */
export function setCurrency(code: string) {
  if (isCurrency(code)) current = code
}

export function getCurrency(): string {
  return current
}

/**
 * A regex source for a currency mark in front of an amount: any currency
 * symbol, or a common code ("php", "usd") followed by the number.
 */
export const CURRENCY_MARK = `(?:\\p{Sc}|(?:${COMMON_CURRENCIES.join("|")})(?=\\s*[\\d.(]))`

/**
 * Parses an amount as typed (`500`, `1,250.50`, `1.5k`, `.5k`) into cents.
 * Returns null for zero, negative, malformed, or absurdly large values.
 */
export function parseAmount(text: string): Cents | null {
  const match = text
    .trim()
    .match(/^(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d*\.?\d+)(k)?$/i)
  if (!match?.[1]) return null

  const [whole = "0", fraction = ""] = match[1].replaceAll(",", "").split(".")
  const thousands = Boolean(match[2])

  // Without "k", more than 2 decimal places isn't an amount we can store.
  if (!thousands && fraction.length > 2) return null

  // Integer math: scale the digits instead of multiplying a float.
  const scale = thousands ? 100_000 : 100
  const fractionDigits = fraction.slice(0, thousands ? 5 : 2)
  const cents =
    Number(whole) * scale +
    (fractionDigits
      ? Math.round(
          Number(fractionDigits) * (scale / 10 ** fractionDigits.length)
        )
      : 0)

  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_CENTS) {
    return null
  }
  return cents
}

interface Formats {
  exact: Intl.NumberFormat
  whole: Intl.NumberFormat
  /** What goes before the number: "₱", "$", "CHF ". */
  prefix: string
  /** Decimals the currency uses, capped at the two we store. */
  digits: number
}

const formats = new Map<string, Formats>()

function formatsFor(currency: string): Formats {
  const cached = formats.get(currency)
  if (cached) return cached
  const options = {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
  } as const
  const digits = Math.min(
    2,
    new Intl.NumberFormat("en", options).resolvedOptions()
      .maximumFractionDigits ?? 2
  )
  const whole = new Intl.NumberFormat("en", {
    ...options,
    maximumFractionDigits: 0,
  })
  const parts = whole.formatToParts(0)
  const prefix = parts
    .slice(
      0,
      parts.findIndex((p) => p.type === "integer")
    )
    .map((p) => p.value)
    .join("")
  const made: Formats = {
    exact: new Intl.NumberFormat("en", {
      ...options,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }),
    whole,
    prefix,
    digits,
  }
  formats.set(currency, made)
  return made
}

/** The mark in front of amounts in this currency: "₱", "$", "CHF". */
export function currencySymbol(currency = current): string {
  return formatsFor(currency).prefix.trim()
}

/** "Philippine peso", "US dollar". */
export function currencyName(currency = current): string {
  const name =
    new Intl.DisplayNames(["en"], { type: "currency" }).of(currency) ?? currency
  // "Philippine Peso" → "Philippine peso"; keep the first word as written.
  return name.replace(
    / (\p{Lu})(\p{Ll})/gu,
    (_, a: string, b: string) => ` ${a.toLowerCase()}${b}`
  )
}

/**
 * Formats cents in the owner's currency. Whole amounts drop the decimals
 * (₱500), others keep two (₱1,250.50). `sign` adds an explicit +/−.
 */
export function formatMoney(
  cents: Cents,
  {
    sign = false,
    currency = current,
  }: { sign?: boolean; currency?: string } = {}
): string {
  const { exact, whole, digits } = formatsFor(currency)
  const abs = Math.abs(cents)
  const body =
    abs % 100 === 0 || digits === 0
      ? whole.format(Math.round(abs / 100))
      : exact.format(abs / 100)
  if (cents < 0) return `−${body}`
  if (sign && cents > 0) return `+${body}`
  return body
}

/** Compact form for chart axes and tight spaces: ₱1.2k, ₱15k, ₱1.5M. */
export function formatMoneyCompact(
  cents: Cents,
  { currency = current }: { currency?: string } = {}
): string {
  const units = Math.abs(cents) / 100
  const { prefix: mark } = formatsFor(currency)
  const prefix = cents < 0 ? `−${mark}` : mark
  if (units < 1000) return `${prefix}${Math.round(units)}`
  if (units < 1_000_000) {
    const k = units / 1000
    return `${prefix}${k < 10 ? Number(k.toFixed(1)) : Math.round(k)}k`
  }
  const m = units / 1_000_000
  return `${prefix}${m < 10 ? Number(m.toFixed(1)) : Math.round(m)}M`
}
