import { beforeEach, describe, expect, it } from "vitest"
import { schema } from "@workspace/db"
import { log, resetDb, row } from "../../test/helpers"
import {
  accountBalances,
  createAccount,
  removeAccount,
  setBalance,
} from "./accounts.server"
import { today } from "./ledger.server"
import { getDb } from "./services"

async function balanceOf(id: string) {
  const all = await accountBalances(getDb())
  return all.find((a) => a.id === id)?.balance
}

describe("accounts", () => {
  beforeEach(resetDb)

  it("makes the first account the default and files entries there", async () => {
    const g = await createAccount({
      name: "GCash",
      kind: "ewallet",
      balance: 100000,
    })
    await log("-250 lunch")
    const balances = await accountBalances(getDb())
    expect(balances.find((a) => a.id === g.id)).toMatchObject({
      name: "GCash",
      balance: 75000,
    })
  })

  it("setBalance keeps entries and moves the opening", async () => {
    const g = await createAccount({
      name: "GCash",
      kind: "ewallet",
      balance: 100000,
    })
    const { transactionIds } = await log("-250 lunch")
    await setBalance(getDb(), g.id, 50000)
    expect(await balanceOf(g.id)).toBe(50000)
    expect((await row(transactionIds[0]!)).accountId).toBe(g.id)
  })

  it("moves money between accounts without changing the total", async () => {
    const gcash = await createAccount({
      name: "GCash",
      kind: "ewallet",
      balance: 100000,
    })
    const bpi = await createAccount({
      name: "BPI",
      kind: "bank",
      balance: 500000,
    })
    await getDb()
      .insert(schema.transactions)
      .values({
        kind: "transfer",
        amount: -20000,
        accountId: bpi.id,
        toAccountId: gcash.id,
        localDate: await today(getDb()),
        status: "confirmed",
      })
    expect(await balanceOf(bpi.id)).toBe(480000)
    expect(await balanceOf(gcash.id)).toBe(120000)
  })
})

describe("reopening an archived account", () => {
  beforeEach(resetDb)

  it("reads the balance typed when it's added again", async () => {
    await createAccount({ name: "GCash", kind: "ewallet", balance: 0 })
    const maya = await createAccount({
      name: "Maya",
      kind: "ewallet",
      balance: 0,
    })
    await log("-500 load via maya")
    const mayaRow = async () =>
      (await accountBalances(getDb())).find((a) => a.id === maya.id)
    expect((await mayaRow())?.balance).toBe(-50000)
    expect(await removeAccount(maya.id)).toEqual({ archived: true })
    const again = await createAccount({
      name: "Maya",
      kind: "ewallet",
      balance: 200000,
    })
    expect(again.id).toBe(maya.id)
    expect(await mayaRow()).toMatchObject({
      balance: 200000,
      archived: false,
    })
  })
})
