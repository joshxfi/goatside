import { describe, expect, it } from "vitest"
import { type KnownAccount, scanAccounts } from "@workspace/core/accounts"
import { resolveAccounts } from "./accounts"

const bpi: KnownAccount = { id: "bpi", name: "BPI", kind: "bank", aliases: [] }
const card: KnownAccount = {
  id: "card",
  name: "BPI Card",
  kind: "credit_card",
  aliases: [],
}
const gcash: KnownAccount = {
  id: "gcash",
  name: "GCash",
  kind: "ewallet",
  aliases: [],
}
const known = [bpi, card, gcash]

const resolve = (
  description: string,
  opts: Partial<Parameters<typeof resolveAccounts>[2]> = {}
) =>
  resolveAccounts(scanAccounts(description, known), known, {
    defaultAccountId: null,
    memoryAccountId: null,
    borrowed: false,
    signals: null,
    ...opts,
  })

describe("resolveAccounts", () => {
  it("files a line under the account it names", () => {
    expect(resolve("iced coffee using gcash")).toMatchObject({
      accountId: "gcash",
      transfer: false,
      questions: [],
    })
  })

  it("falls back to the repeat's account, then the default", () => {
    expect(resolve("spotify", { memoryAccountId: "card" }).accountId).toBe(
      "card"
    )
    expect(resolve("iced coffee", { defaultAccountId: "bpi" }).accountId).toBe(
      "bpi"
    )
    expect(
      resolve("lunch", { defaultAccountId: "bpi", borrowed: true }).accountId
    ).toBeNull()
    // An archived (unknown) default is ignored.
    expect(resolve("lunch", { defaultAccountId: "gone" }).accountId).toBeNull()
  })

  it("files transfers from the words when the model isn't there", () => {
    expect(resolve("cash in gcash from bpi")).toMatchObject({
      accountId: "bpi",
      toAccountId: "gcash",
      transfer: true,
      questions: [],
    })
    expect(resolve("pay bpi card", { defaultAccountId: "bpi" })).toMatchObject({
      accountId: "bpi",
      toAccountId: "card",
      transfer: true,
    })
  })

  it("lets the model overrule, and asks in between", () => {
    expect(
      resolve("cash in gcash from bpi", { signals: { pTransfer: 0.1 } })
    ).toMatchObject({ transfer: false, accountId: "gcash" })

    const unsure = resolve("gcash bpi", { signals: { pTransfer: 0.55 } })
    expect(unsure.transfer).toBe(true)
    expect(unsure.questions[0]).toMatchObject({
      kind: "transfer",
      guess: "transfer",
      transfer: { from: "gcash", to: "bpi" },
    })
  })

  it("asks about a name it doesn't know", () => {
    const result = resolve("lunch using unionbank", { defaultAccountId: "bpi" })
    expect(result.accountId).toBeNull()
    expect(result.questions[0]).toMatchObject({
      kind: "account",
      guess: "none",
      name: "UnionBank",
      phrase: "using unionbank",
    })
    expect(result.questions[0]?.options.map((o) => o.value)).toEqual([
      "bank",
      "ewallet",
      "credit_card",
      "none",
    ])
  })

  it("skips the question when the model says it isn't an account", () => {
    const result = resolve("dinner using tala", {
      defaultAccountId: "bpi",
      signals: {
        unknown: {
          bank: 0.02,
          ewallet: 0.1,
          credit_card: 0.01,
          cash: 0.01,
          none: 0.86,
        },
      },
    })
    expect(result).toMatchObject({ accountId: "bpi", questions: [] })
  })
})
