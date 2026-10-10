/**
 * How accounts look: card colors, kind labels and icons. The colors are
 * identity only (which card is which), deep enough for white text in both
 * themes; money in and out keeps its own green and red.
 */
import {
  BanknoteIcon,
  CreditCardIcon,
  LandmarkIcon,
  type LucideIcon,
  SmartphoneIcon,
} from "lucide-react"
import { ACCOUNT_KIND_LABELS, type AccountKind } from "@workspace/core/accounts"

export { ACCOUNT_KIND_LABELS }
export type { AccountKind }

export const ACCOUNT_COLORS = [
  "slate",
  "blue",
  "indigo",
  "violet",
  "rose",
  "orange",
  "amber",
  "emerald",
  "teal",
] as const
export type AccountColor = (typeof ACCOUNT_COLORS)[number]

/** [lighter, deeper] stops of each card's gradient. */
const STOPS: Record<AccountColor, [string, string]> = {
  slate: ["oklch(0.42 0.03 260)", "oklch(0.27 0.025 262)"],
  blue: ["oklch(0.5 0.16 258)", "oklch(0.34 0.13 264)"],
  indigo: ["oklch(0.46 0.17 282)", "oklch(0.31 0.14 286)"],
  violet: ["oklch(0.48 0.18 305)", "oklch(0.33 0.14 310)"],
  rose: ["oklch(0.52 0.17 12)", "oklch(0.36 0.13 15)"],
  orange: ["oklch(0.56 0.15 45)", "oklch(0.4 0.12 38)"],
  amber: ["oklch(0.55 0.12 75)", "oklch(0.39 0.09 62)"],
  emerald: ["oklch(0.5 0.11 162)", "oklch(0.34 0.08 168)"],
  teal: ["oklch(0.5 0.08 205)", "oklch(0.34 0.06 212)"],
}

const COLOR_NAMES: Record<AccountColor, string> = {
  slate: "Slate",
  blue: "Blue",
  indigo: "Indigo",
  violet: "Violet",
  rose: "Rose",
  orange: "Orange",
  amber: "Amber",
  emerald: "Emerald",
  teal: "Teal",
}

const known = (color: string): AccountColor =>
  (ACCOUNT_COLORS as readonly string[]).includes(color)
    ? (color as AccountColor)
    : "slate"

export const colorName = (color: string) => COLOR_NAMES[known(color)]

/** The card face. */
export const cardBackground = (color: string) => {
  const [from, to] = STOPS[known(color)]
  return `radial-gradient(120% 90% at 100% 0%, color-mix(in oklab, white 14%, transparent), transparent 55%), linear-gradient(135deg, ${from}, ${to})`
}

/** A flat swatch for small marks (dots, chips). */
export const swatch = (color: string) => STOPS[known(color)][0]

export const KIND_ICONS: Record<AccountKind, LucideIcon> = {
  bank: LandmarkIcon,
  ewallet: SmartphoneIcon,
  credit_card: CreditCardIcon,
  cash: BanknoteIcon,
}

/** Section order on the Accounts page, with plural headings. */
export const KIND_SECTIONS: { kind: AccountKind; title: string }[] = [
  { kind: "bank", title: "Banks" },
  { kind: "ewallet", title: "E-wallets" },
  { kind: "credit_card", title: "Credit cards" },
  { kind: "cash", title: "Cash" },
]

/** What's owed on a card: its negative balance, as a positive number. */
export const owedOn = (balance: number) => Math.max(0, -balance)
