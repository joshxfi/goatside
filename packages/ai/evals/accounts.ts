/**
 * Live eval for accounts: is a line a transfer between the owner's own
 * accounts, and what is a name after "using"/"via" that isn't set up yet.
 *
 *   pnpm --filter @workspace/ai eval:accounts
 */
import { type KnownAccount, scanAccounts } from "@workspace/core/accounts"
import {
  AUTO_TRANSFER,
  MAYBE_TRANSFER,
  NOT_ACCOUNT,
  type NewAccountAnswer,
  askAccounts,
  couldBeTransfer,
} from "../src/accounts"
import { DEFAULT_DECISION_MODEL } from "../src/categorize"

const model = process.env.DECISION_MODEL ?? DEFAULT_DECISION_MODEL

const ACCOUNTS: KnownAccount[] = [
  { id: "savings", name: "BPI Savings", kind: "bank", aliases: ["bpi"] },
  { id: "gcash", name: "GCash", kind: "ewallet", aliases: [] },
  { id: "maya", name: "Maya", kind: "ewallet", aliases: [] },
  { id: "card", name: "BPI Card", kind: "credit_card", aliases: [] },
  { id: "cash", name: "Cash", kind: "cash", aliases: [] },
]
const DEFAULT = "gcash"

const TRANSFERS: { entry: string; transfer: boolean }[] = [
  { entry: "cash in gcash from bpi", transfer: true },
  { entry: "pay bpi card from bpi", transfer: true },
  { entry: "atm bpi", transfer: true },
  { entry: "top up maya using gcash", transfer: true },
  { entry: "transfer from bpi to gcash", transfer: true },
  { entry: "withdrew from bpi", transfer: true },
  // Words that sound like moving money, but the money left the owner.
  { entry: "sent to mama via gcash", transfer: false },
  { entry: "atm fee bpi", transfer: false },
  { entry: "deposit for the apartment via bpi", transfer: false },
  { entry: "cash in fee 7-eleven gcash", transfer: false },
  { entry: "bills payment card bpi", transfer: false },
]

const UNKNOWN: { entry: string; kind: NewAccountAnswer }[] = [
  { entry: "dinner using unionbank", kind: "bank" },
  { entry: "groceries via gotyme", kind: "bank" },
  { entry: "shoes using shopeepay", kind: "ewallet" },
  { entry: "flight via rcbc credit", kind: "credit_card" },
  { entry: "hotel using amex", kind: "credit_card" },
  { entry: "dinner via grab", kind: "none" },
  { entry: "couch using lalamove", kind: "none" },
  { entry: "burger via jollibee app", kind: "none" },
]

let wrong = 0
let asked = 0
console.log("Transfers")
for (const c of TRANSFERS) {
  const scan = scanAccounts(c.entry, ACCOUNTS)
  if (!couldBeTransfer(scan, ACCOUNTS, DEFAULT)) {
    // The words alone rule it out: right only if it isn't one.
    if (c.transfer) wrong++
    console.log(
      `  ${c.transfer ? "MISS" : " ok "} words  "${c.entry}" want ${c.transfer ? "transfer" : "spending"}`
    )
    continue
  }
  const signals = await askAccounts(model, {
    description: c.entry,
    amount: 300_000,
    direction: "out",
    accounts: ACCOUNTS,
    unknown: null,
    transfer: true,
  })
  const p = signals.pTransfer ?? 0
  const verdict =
    p >= AUTO_TRANSFER ? "transfer" : p >= MAYBE_TRANSFER ? "ask" : "spend"
  const ok = verdict === "ask" ? true : (verdict === "transfer") === c.transfer
  if (verdict === "ask") asked++
  else if (!ok) wrong++
  console.log(
    `  ${verdict === "ask" ? "ask " : ok ? " ok " : "MISS"} ${p.toFixed(2)}  "${c.entry}" want ${c.transfer ? "transfer" : "spending"}`
  )
}

console.log("New account names")
for (const c of UNKNOWN) {
  const scan = scanAccounts(c.entry, ACCOUNTS)
  if (!scan.unknown) {
    console.log(`  MISS      "${c.entry}" (no name found)`)
    wrong++
    continue
  }
  // Known banks and e-wallets come from the provider list, not the model.
  if (scan.unknown.kind) {
    const ok = scan.unknown.kind === c.kind
    if (!ok) wrong++
    console.log(
      `  ${ok ? " ok " : "MISS"} list ${scan.unknown.kind}  "${c.entry}" (${scan.unknown.name}) want ${c.kind}`
    )
    continue
  }
  const signals = await askAccounts(model, {
    description: c.entry,
    amount: 150_000,
    direction: "out",
    accounts: ACCOUNTS,
    unknown: scan.unknown.name,
    transfer: false,
  })
  const ranked = Object.entries(signals.unknown ?? {}).toSorted(
    (a, b) => b[1] - a[1]
  )
  const [top] = ranked
  // "none" only skips the question when sure; otherwise the owner picks.
  const silent = (signals.unknown?.none ?? 0) >= NOT_ACCOUNT
  const ok =
    c.kind === "none" ? silent || top?.[0] === "none" : top?.[0] === c.kind
  if (!ok) wrong++
  console.log(
    `  ${ok ? " ok " : "MISS"} ${top ? `${top[0]} ${top[1].toFixed(2)}` : "-"}  "${c.entry}" (${scan.unknown.name}) want ${c.kind}${silent ? ", not asked" : ""}`
  )
}
console.log(
  `\n${TRANSFERS.length + UNKNOWN.length - wrong - asked} right, ${asked} asked, ${wrong} wrong without asking.`
)
