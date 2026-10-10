/**
 * Money is always PHP, stored as integer centavos. Never floats.
 */

export type Centavos = number

/** Largest amount we accept from typed input: ₱1 billion. */
export const MAX_CENTAVOS = 100_000_000_000

/**
 * Parses an amount as typed (`500`, `1,250.50`, `1.5k`, `.5k`) into centavos.
 * Returns null for zero, negative, malformed, or absurdly large values.
 */
export function parseAmount(text: string): Centavos | null {
  const match = text
    .trim()
    .match(/^(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d*\.?\d+)(k)?$/i)
  if (!match?.[1]) return null

  const [whole = "0", fraction = ""] = match[1].replaceAll(",", "").split(".")
  const thousands = Boolean(match[2])

  // Without "k", more than 2 decimal places is not a peso amount.
  if (!thousands && fraction.length > 2) return null

  // Integer math: scale the digits instead of multiplying a float.
  const scale = thousands ? 100_000 : 100
  const fractionDigits = fraction.slice(0, thousands ? 5 : 2)
  const centavos =
    Number(whole) * scale +
    (fractionDigits
      ? Math.round(
          Number(fractionDigits) * (scale / 10 ** fractionDigits.length)
        )
      : 0)

  if (
    !Number.isSafeInteger(centavos) ||
    centavos <= 0 ||
    centavos > MAX_CENTAVOS
  ) {
    return null
  }
  return centavos
}

const pesoFormat = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const pesoFormatWhole = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
})

/**
 * Formats centavos as pesos. Whole amounts drop the decimals (₱500),
 * others keep two (₱1,250.50). `sign` adds an explicit +/−.
 */
export function formatPeso(
  centavos: Centavos,
  { sign = false }: { sign?: boolean } = {}
): string {
  const abs = Math.abs(centavos)
  const body =
    abs % 100 === 0
      ? pesoFormatWhole.format(abs / 100)
      : pesoFormat.format(abs / 100)
  if (centavos < 0) return `−${body}`
  if (sign && centavos > 0) return `+${body}`
  return body
}

/** Compact form for chart axes and tight spaces: ₱1.2k, ₱15k, ₱1.5M. */
export function formatPesoCompact(centavos: Centavos): string {
  const pesos = Math.abs(centavos) / 100
  const prefix = centavos < 0 ? "−₱" : "₱"
  if (pesos < 1000) return `${prefix}${Math.round(pesos)}`
  if (pesos < 1_000_000) {
    const k = pesos / 1000
    return `${prefix}${k < 10 ? Number(k.toFixed(1)) : Math.round(k)}k`
  }
  const m = pesos / 1_000_000
  return `${prefix}${m < 10 ? Number(m.toFixed(1)) : Math.round(m)}M`
}
