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

export {
  ACCOUNT_COLORS,
  type AccountColor,
  cardBackground,
  colorName,
  swatch,
} from "@workspace/ui/lib/account-colors"

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
