import { beforeEach, describe, expect, it } from "vitest"
import type { z } from "zod"
import { schema } from "@workspace/db"
import { addPersonRow, log, resetDb, row } from "../../test/helpers"
import { accountBalances, createAccount } from "./accounts.server"
import { actionApprovals } from "./ask-actions.server"
import { restoreEdits } from "./ask-edit.server"
import { matchAccount } from "./ask-search.server"
import { askTools } from "./ask.server"
import { getDb } from "./services"

type Tools = ReturnType<typeof askTools>
type Approvals = ReturnType<typeof actionApprovals>

/** Runs a tool the way the agent does: input through its schema first. */
async function run<K extends keyof Tools>(name: K, input: unknown) {
  const tool = askTools(getDb())[name]
  const parsed = (tool.inputSchema as z.ZodType).parse(input)
  // oxlint-disable-next-line typescript/no-explicit-any
  return (tool.execute as any)(parsed, { toolCallId: "t", messages: [] })
}

async function approve<K extends keyof Approvals>(name: K, input: unknown) {
  const tool = askTools(getDb())[name as keyof Tools]
  const parsed = (tool.inputSchema as z.ZodType).parse(input)
  // oxlint-disable-next-line typescript/no-explicit-any
  return (actionApprovals(getDb())[name] as any)(parsed)
}

async function balanceOf(id: string) {
  return (await accountBalances(getDb())).find((a) => a.id === id)?.balance
}

/** A row straight into the ledger, the way a statement import leaves it. */
async function addRow(
  values: Partial<typeof schema.transactions.$inferInsert>
) {
  const [created] = await getDb()
    .insert(schema.transactions)
    .values({
      kind: "expense",
      amount: -100,
      localDate: "2026-08-12",
      status: "confirmed",
      ...values,
    })
    .returning({ id: schema.transactions.id })
  if (!created) throw new Error("row not created")
  return created.id
}

describe("matchAccount", () => {
  const list = [
    { name: "BPI", kind: "bank" as const, aliases: [], last4: null },
    {
      name: "BPI Credit Card",
      kind: "credit_card" as const,
      aliases: ["bpi cc"],
      last4: "4821",
    },
    { name: "GCash", kind: "ewallet" as const, aliases: ["gc"], last4: null },
  ]
  const name = (key: string) => {
    const fit = matchAccount(list, key)
    return fit && "found" in fit ? fit.found.name : fit
  }

  it("finds an account by name, nickname, digits, words or kind", () => {
    expect(name("bpi")).toBe("BPI")
    expect(name("BPI CC")).toBe("BPI Credit Card")
    expect(name("card ending 4821")).toBe("BPI Credit Card")
    expect(name("bpi card")).toBe("BPI Credit Card")
    expect(name("my credit card")).toBe("BPI Credit Card")
    expect(name("gcash wallet")).toBe("GCash")
    expect(name("Metrobank")).toBeNull()
  })

  it("says when a name fits more than one", () => {
    const two = [
      ...list,
      {
        name: "BDO Card",
        kind: "credit_card" as const,
        aliases: [],
        last4: null,
      },
    ]
    expect(matchAccount(two, "my card")).toMatchObject({
      ambiguous: [{ name: "BPI Credit Card" }, { name: "BDO Card" }],
    })
  })
})

describe("findTransactions", () => {
  beforeEach(resetDb)

  it("finds every kind of entry on a card, by nickname, without dates", async () => {
    const bank = await createAccount({ name: "BPI", kind: "bank" })
    const card = await createAccount({
      name: "BPI Credit Card",
      kind: "credit_card",
      aliases: ["bpi cc"],
    })
    await addRow({
      description: "SHOPEE*PH",
      amount: -129950,
      accountId: card.id,
      localDate: "2026-05-03",
    })
    await addRow({
      kind: "transfer",
      description: "card payment",
      amount: -500000,
      accountId: bank.id,
      toAccountId: card.id,
      localDate: "2026-05-20",
    })
    await addRow({ description: "groceries", accountId: bank.id })

    const found = await run("findTransactions", { account: "bpi cc" })
    expect(found.matches).toBe(2)
    expect(found.transactions).toMatchObject([
      {
        type: "transfer",
        description: "card payment",
        from: "BPI",
        to: "BPI Credit Card",
      },
      {
        type: "spending",
        description: "SHOPEE*PH",
        account: "BPI Credit Card",
      },
    ])
    // A payment into the card is money in, from the card's side.
    expect(found.net.value).toBe(5000 - 1299.5)

    const payments = await run("findTransactions", {
      account: "my card",
      direction: "in",
    })
    expect(payments.transactions).toMatchObject([{ type: "transfer" }])
  })

  it("matches every word, then falls back to some, and finds amounts", async () => {
    await addRow({ description: "NETFLIX.COM", amount: -54900 })
    await addRow({ description: "grab ride", amount: -18000 })

    const exact = await run("findTransactions", { text: "netflix" })
    expect(exact.transactions).toMatchObject([{ description: "NETFLIX.COM" }])

    const loose = await run("findTransactions", {
      text: "netflix subscription",
    })
    expect(loose).toMatchObject({
      matches: 1,
      note: expect.stringContaining("some of them"),
    })

    const byAmount = await run("findTransactions", { amount: 180 })
    expect(byAmount.transactions).toMatchObject([{ description: "grab ride" }])
  })

  it("names the accounts when one doesn't fit", async () => {
    await createAccount({ name: "GCash", kind: "ewallet" })
    expect(await run("findTransactions", { account: "Maya" })).toMatchObject({
      matches: 0,
      problem: expect.stringContaining("GCash"),
    })
  })
})

/** A card payment that a statement import read as income. */
async function cardPaymentAsIncome() {
  const bank = await createAccount({ name: "BPI", kind: "bank" })
  const card = await createAccount({
    name: "BPI Credit Card",
    kind: "credit_card",
  })
  const id = await addRow({
    kind: "income",
    description: "PAYMENT - THANK YOU",
    amount: 500000,
    accountId: card.id,
  })
  return { bank: bank.id, card: card.id, id }
}

describe("editEntries", () => {
  beforeEach(resetDb)

  it("turns a card payment logged as income into a transfer, and undoes it", async () => {
    const { bank, card, id } = await cardPaymentAsIncome()
    const input = { ids: [id], type: "transfer", fromAccount: "BPI" }

    const confirm = await approve("editEntries", input)
    expect(confirm).toMatchObject({
      type: "user-approval",
      reason: expect.stringContaining(
        "now a transfer from BPI to BPI Credit Card"
      ),
    })

    const result = await run("editEntries", input)
    expect(result).toMatchObject({
      done: true,
      entries: [{ type: "transfer", from: "BPI", to: "BPI Credit Card" }],
    })
    expect(await row(id)).toMatchObject({
      kind: "transfer",
      amount: -500000,
      accountId: bank,
      toAccountId: card,
      categoryId: null,
    })
    expect(await balanceOf(card)).toBe(500000)
    expect(await balanceOf(bank)).toBe(-500000)

    await restoreEdits(result.undo.changes)
    expect(await row(id)).toMatchObject({
      kind: "income",
      amount: 500000,
      accountId: card,
      toAccountId: null,
    })
  })

  it("infers the other end from the entry's own account", async () => {
    const bank = await createAccount({ name: "BPI", kind: "bank" })
    const card = await createAccount({
      name: "BPI Credit Card",
      kind: "credit_card",
    })
    const id = await addRow({
      description: "pay card",
      amount: -300000,
      accountId: bank.id,
    })
    const result = await run("editEntries", {
      ids: [id],
      type: "transfer",
      toAccount: "bpi credit",
    })
    expect(result.done).toBe(true)
    expect(await row(id)).toMatchObject({
      kind: "transfer",
      accountId: bank.id,
      toAccountId: card.id,
      amount: -300000,
    })
  })

  it("refuses before the card when an edit doesn't fit", async () => {
    const { id } = await cardPaymentAsIncome()
    expect(
      await approve("editEntries", { ids: [id], type: "transfer" })
    ).toMatchObject({
      type: "denied",
      reason: expect.stringContaining("came from"),
    })
    expect(
      await approve("editEntries", {
        ids: [id],
        type: "transfer",
        fromAccount: "BPI",
        category: "Food",
      })
    ).toMatchObject({
      type: "denied",
      reason: expect.stringContaining("Only spending and income"),
    })
    expect(await approve("editEntries", { ids: [id] })).toMatchObject({
      type: "denied",
      reason: expect.stringContaining("Say what to change"),
    })
  })

  it("re-types spending as a loan, and leaves split bills alone", async () => {
    await addPersonRow("Nini")
    const lunch = await log("-500 lunch")
    const lunchId = lunch.transactionIds[0] as string
    const lent = await run("editEntries", {
      ids: [lunchId],
      type: "lent",
      person: "nini",
    })
    expect(lent.done).toBe(true)
    expect(await row(lunchId)).toMatchObject({ kind: "lend", amount: -50000 })

    await addPersonRow("Daniel")
    const dinner = await log("-1200 dinner w/ Daniel split 2")
    const own = (
      await Promise.all(dinner.transactionIds.map((id) => row(id)))
    ).find((r) => r.kind === "expense")
    expect(
      await approve("editEntries", { ids: [own?.id], type: "income" })
    ).toMatchObject({
      type: "denied",
      reason: expect.stringContaining("split bill"),
    })
  })
})

describe("write filters", () => {
  beforeEach(resetDb)

  it("change entries by id without a date range", async () => {
    const id = await addRow({ description: "grab", localDate: "2025-01-04" })
    const result = await run("moveToCategory", {
      ids: [id],
      newCategory: "Transport",
    })
    expect(result.done).toBe(true)
  })

  it("refuse a filter with neither ids nor dates", async () => {
    await addRow({ description: "grab" })
    expect(await approve("deleteEntries", { text: "grab" })).toMatchObject({
      type: "denied",
      reason: expect.stringContaining("ids"),
    })
  })
})
