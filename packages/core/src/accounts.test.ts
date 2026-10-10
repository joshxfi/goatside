import { describe, expect, it } from "vitest"
import {
  type KnownAccount,
  guessTransfer,
  scanAccounts,
  withoutPhrase,
} from "./accounts"

const bpi: KnownAccount = { id: "bpi", name: "BPI", kind: "bank", aliases: [] }
const bpiCard: KnownAccount = {
  id: "bpi-card",
  name: "BPI Card",
  kind: "credit_card",
  aliases: ["bpi cc"],
}
const gcash: KnownAccount = {
  id: "gcash",
  name: "GCash",
  kind: "ewallet",
  aliases: ["gc"],
}
const security: KnownAccount = {
  id: "sb",
  name: "Security Bank",
  kind: "bank",
  aliases: ["sb"],
}
const wallet: KnownAccount = {
  id: "cash",
  name: "Pocket",
  kind: "cash",
  aliases: [],
}
const all = [bpi, bpiCard, gcash, security, wallet]

const word = (d: string) => scanAccounts(d, all).transferWord
const guess = (d: string, defaultId: string | null = null) =>
  guessTransfer(scanAccounts(d, all), all, defaultId)

const ids = (description: string, known = all) =>
  scanAccounts(description, known).mentions.map((m) => m.accountId)

describe("scanAccounts", () => {
  it("finds accounts after cues and on their own", () => {
    expect(ids("iced coffee using gcash")).toEqual(["gcash"])
    expect(ids("gcash, from a client")).toEqual(["gcash"])
    expect(ids("groceries via security bank")).toEqual(["sb"])
    expect(ids("taxi thru gc")).toEqual(["gcash"])
  })

  it("prefers the longer name", () => {
    expect(ids("dinner using bpi card")).toEqual(["bpi-card"])
    expect(ids("dinner using bpi cc")).toEqual(["bpi-card"])
    expect(ids("dinner using bpi")).toEqual(["bpi"])
  })

  it("strips the account from the description", () => {
    expect(scanAccounts("iced coffee using gcash", all).rest).toBe(
      "iced coffee"
    )
    expect(scanAccounts("gcash, client payment", all).rest).toBe(
      "client payment"
    )
    expect(scanAccounts("lunch with nini via my bpi card", all).rest).toBe(
      "lunch with nini"
    )
  })

  it("reads from and to", () => {
    const scan = scanAccounts("transfer from bpi to gcash", all)
    expect(scan.mentions).toEqual([
      { accountId: "bpi", role: "from", cued: true },
      { accountId: "gcash", role: "to", cued: true },
    ])
    expect(scan.transferWord).toBe("transfer")
  })

  it("maps generic words to the only account of that kind", () => {
    expect(ids("taxi cash")).toEqual(["cash"])
    expect(ids("shoes using credit card")).toEqual(["bpi-card"])
    expect(ids("shoes via card")).toEqual(["bpi-card"])
    // Not a cue: "card" alone could be anything.
    expect(ids("birthday card")).toEqual([])
    // Two cards: "credit card" is ambiguous.
    const second = { ...bpiCard, id: "other", name: "Other Card", aliases: [] }
    expect(ids("shoes using credit card", [...all, second])).toEqual([])
  })

  it("doesn't read cash in or cashback as cash", () => {
    expect(ids("cash in gcash")).toEqual(["gcash"])
    expect(ids("cashback from shopee")).toEqual([])
    // Also when the cash account is literally named "Cash".
    const named = all.map((a) => (a.id === "cash" ? { ...a, name: "Cash" } : a))
    expect(ids("cash in fee gcash", named)).toEqual(["gcash"])
    expect(ids("cash-out to bpi", named)).toEqual(["bpi"])
    expect(ids("taxi cash", named)).toEqual(["cash"])
  })

  it("spots accounts that aren't set up yet", () => {
    expect(scanAccounts("lunch using unionbank", all).unknown).toEqual({
      name: "UnionBank",
      phrase: "using unionbank",
      kind: "bank",
    })
    expect(scanAccounts("bdo, paid back", all).unknown).toMatchObject({
      name: "BDO",
      phrase: "bdo",
      kind: "bank",
    })
    expect(scanAccounts("taxi via maya", all).unknown).toMatchObject({
      name: "Maya",
      phrase: "via maya",
      kind: "ewallet",
    })
    expect(scanAccounts("dinner with maya", all).unknown).toBeNull()
    expect(
      scanAccounts("plane tickets via eastwest credit", all).unknown
    ).toMatchObject({ name: "EastWest", kind: "credit_card" })
    expect(scanAccounts("books using tala wallet", all).unknown).toEqual({
      name: "Tala",
      phrase: "using tala wallet",
      kind: null,
    })
    expect(scanAccounts("taxi using cash", all).unknown).toBeNull()
    expect(scanAccounts("lunch with nini", all).unknown).toBeNull()
  })

  it("names transfer words", () => {
    expect(word("cash in gcash from bpi")).toBe("cash_in")
    expect(word("top up gcash")).toBe("cash_in")
    expect(word("atm bpi")).toBe("withdraw")
    expect(word("pay bpi card")).toBe("card_payment")
    expect(word("paid my cc")).toBe("card_payment")
    expect(word("meralco paid using bpi card")).toBeNull()
    expect(word("iced coffee")).toBeNull()
    // A fee is spending, even on a cash in or at the ATM.
    expect(word("atm fee bpi")).toBeNull()
    expect(word("cash in fee gcash")).toBeNull()
  })
})

describe("guessTransfer", () => {
  it("follows from and to", () => {
    expect(guess("transfer from bpi to gcash")).toEqual({
      from: "bpi",
      to: "gcash",
    })
    expect(guess("cash in gcash from bpi")).toEqual({
      from: "bpi",
      to: "gcash",
    })
  })

  it("knows which side cards, wallets and cash are on", () => {
    expect(guess("pay bpi card security bank")).toEqual({
      from: "sb",
      to: "bpi-card",
    })
    expect(guess("top up gcash bpi")).toEqual({ from: "bpi", to: "gcash" })
  })

  it("fills one side with cash or the default account", () => {
    expect(guess("atm bpi")).toEqual({ from: "bpi", to: "cash" })
    expect(guess("pay bpi card", "bpi")).toEqual({
      from: "bpi",
      to: "bpi-card",
    })
    expect(guess("pay bpi card")).toBeNull()
    expect(guess("iced coffee using gcash", "bpi")).toBeNull()
  })
})

describe("withoutPhrase", () => {
  it("removes the words and tidies up", () => {
    expect(withoutPhrase("lunch using unionbank", "using unionbank")).toBe(
      "lunch"
    )
    expect(withoutPhrase("maya, paid back", "maya")).toBe("paid back")
  })
})
