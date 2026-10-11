import { and, eq, isNull } from "drizzle-orm"
import { beforeEach, describe, expect, it } from "vitest"
import { addDays } from "@workspace/core/dates"
import type { StatementRow } from "@workspace/core/statement"
import { schema } from "@workspace/db"
import { log, resetDb, row } from "../../test/helpers"
import { accountBalances, createAccount } from "./accounts.server"
import {
  type ImportDecision,
  type StatementInput,
  ImportError,
  commitImport,
  previewImport,
  undoImport,
} from "./imports.server"
import { today } from "./ledger.server"
import { getDb } from "./services"

const t = schema.transactions

/** A bank statement whose running balances and totals add up. */
function bankStatement(
  accountId: string,
  lines: [date: string, details: string, amount: number][],
  { opening = 100_000, fileHash = "a".repeat(64) } = {}
): StatementInput {
  let balance = opening
  const rows: StatementRow[] = lines.map(([localDate, details, amount], i) => {
    balance += amount
    return { localDate, details, amount, balance, page: 1, y: 700 - i * 14 }
  })
  return {
    accountId,
    fileHash,
    rows,
    summary: { opening, closing: balance },
    period: null,
  }
}

/** A card statement: no running balance, totals and what's owed. */
function cardStatement(
  accountId: string,
  lines: [date: string, details: string, amount: number][],
  { opening = 0 } = {}
): StatementInput {
  const rows = lines.map(([localDate, details, amount], i) => ({
    localDate,
    details,
    amount,
    page: 1,
    y: 700 - i * 18,
  }))
  const totalIn = rows.reduce((s, r) => s + Math.max(0, r.amount), 0)
  const totalOut = rows.reduce((s, r) => s + Math.max(0, -r.amount), 0)
  return {
    accountId,
    fileHash: "c".repeat(64),
    rows,
    summary: {
      opening,
      closing: opening + totalOut - totalIn,
      ...(totalIn && { totalIn }),
      ...(totalOut && { totalOut }),
    },
    period: null,
  }
}

const decide = (
  input: StatementInput,
  decisions: ImportDecision[],
  importId: string = crypto.randomUUID()
) => commitImport(getDb(), { ...input, importId, decisions })

/** Takes what the preview suggests for every row. */
async function importAsSuggested(input: StatementInput, importId?: string) {
  const preview = await previewImport(getDb(), input)
  const decisions = preview.rows.map((r): ImportDecision => {
    if (r.status === "imported") return { action: "skip" }
    if (r.status === "logged") return { action: "link" }
    if (r.status === "transfer" && r.transfer)
      return { action: "transfer", accountId: r.transfer.accountId }
    return { action: "new" }
  })
  return { preview, result: await decide(input, decisions, importId) }
}

const live = () =>
  getDb().select().from(t).where(isNull(t.deletedAt)).orderBy(t.localDate)

async function balanceOf(id: string) {
  return (await accountBalances(getDb())).find((a) => a.id === id)?.balance
}

describe("statement imports", () => {
  let day: string
  beforeEach(async () => {
    await resetDb()
    day = await today(getDb())
  })

  it("refuses rows that don't add up", async () => {
    const bank = await createAccount({ name: "GoTyme", kind: "bank" })
    const input = bankStatement(bank.id, [[day, "Qr Payment", -18_000]])
    input.rows[0]!.balance = 50_000
    await expect(previewImport(getDb(), input)).rejects.toThrow(ImportError)
  })

  it("saves new rows on the statement's account, with no people", async () => {
    const bank = await createAccount({
      name: "GoTyme",
      kind: "bank",
      balance: 100_000,
    })
    const input = bankStatement(bank.id, [
      [addDays(day, -2), "Transfer to Nini Santos, Sample Bank", -50_000],
      [addDays(day, -1), "Transfer from Daniel Reyes", 25_050],
    ])
    const { preview, result } = await importAsSuggested(input)
    expect(preview.rows.map((r) => r.status)).toEqual(["new", "new"])
    expect(result).toMatchObject({ added: 2, linked: 0, transfers: 0 })

    const rows = await live()
    expect(rows).toHaveLength(2)
    expect(
      rows.map((r) => [r.kind, r.amount, r.accountId, r.personId])
    ).toEqual([
      ["expense", -50_000, bank.id, null],
      ["income", 25_050, bank.id, null],
    ])
    expect(
      rows.every((r) => r.importRef && r.entryId === result.importId)
    ).toBe(true)
    // A bank's "Transfer to Nini" isn't a loan to Nini.
    expect(await getDb().select().from(schema.people)).toEqual([])
    expect(await balanceOf(bank.id)).toBe(75_050)
    expect(result.statementBalance).toBe(75_050)
  })

  it("links an entry logged by hand instead of adding it again", async () => {
    const bank = await createAccount({ name: "GoTyme", kind: "bank" })
    const typed = await log("180 iced coffee")
    const input = bankStatement(bank.id, [
      [addDays(day, -1), "Card payment at Sample Cafe", -18_000],
      [day, "Qr Payment", -25_000],
    ])
    const { preview, result } = await importAsSuggested(input)
    expect(preview.rows.map((r) => r.status)).toEqual(["logged", "new"])
    expect(preview.rows[0]!.match?.description).toBe("iced coffee")
    expect(result).toMatchObject({ added: 1, linked: 1 })
    const coffee = await row(typed.transactionIds[0]!)
    expect(coffee.importRef).toBe(preview.rows[0]!.fingerprint)
    expect((await live()).length).toBe(2)
  })

  it("files a matched unfiled entry under the statement's account", async () => {
    const typed = await log("180 iced coffee")
    expect((await row(typed.transactionIds[0]!)).accountId).toBeNull()
    const bank = await createAccount({ name: "GoTyme", kind: "bank" })
    const input = bankStatement(bank.id, [[day, "Qr Payment", -18_000]])
    const { preview } = await importAsSuggested(input)
    expect(preview.rows[0]!.match?.unfiled).toBe(true)
    expect((await row(typed.transactionIds[0]!)).accountId).toBe(bank.id)
  })

  it("matches a split bill by the whole amount charged", async () => {
    const card = await createAccount({
      name: "Sample Card",
      kind: "credit_card",
    })
    const db = getDb()
    const entryId = crypto.randomUUID()
    await db.insert(schema.entries).values({
      id: entryId,
      rawText: "900 dinner split 3",
      mode: "log",
    })
    const nini = crypto.randomUUID()
    await db.insert(schema.people).values({ id: nini, name: "Nini" })
    const base = {
      entryId,
      localDate: day,
      description: "dinner",
      accountId: card.id,
      status: "parsed" as const,
    }
    await db.insert(t).values([
      { ...base, kind: "expense", amount: -30_000, split: 3 },
      { ...base, kind: "lend", amount: -60_000, personId: nini },
    ])
    const input = cardStatement(card.id, [
      [day, "SAMPLE RESTO CITY PH", -90_000],
    ])
    const { preview, result } = await importAsSuggested(input)
    expect(preview.rows[0]!.status).toBe("logged")
    expect(preview.rows[0]!.match?.ids).toHaveLength(2)
    expect(result).toMatchObject({ added: 0, linked: 1 })
    // A card's statement balance is what's owed.
    expect(result.statementBalance).toBe(-90_000)
    expect(await balanceOf(card.id)).toBe(-90_000)
  })

  it("adds nothing when the same statement comes twice", async () => {
    const bank = await createAccount({ name: "GoTyme", kind: "bank" })
    const input = bankStatement(bank.id, [
      [addDays(day, -1), "Qr Payment", -18_000],
      [day, "Qr Payment", -18_000],
    ])
    await importAsSuggested(input)
    const again = await previewImport(getDb(), input)
    expect(again.importedBefore).toBeInstanceOf(Date)
    expect(again.rows.map((r) => r.status)).toEqual(["imported", "imported"])
    const result = await decide(input, [{ action: "new" }, { action: "new" }])
    expect(result).toMatchObject({ importId: null, added: 0 })
    expect((await live()).length).toBe(2)
  })

  it("adds only the new rows of an overlapping statement", async () => {
    const bank = await createAccount({ name: "GoTyme", kind: "bank" })
    const first = bankStatement(bank.id, [
      [addDays(day, -3), "Qr Payment", -18_000],
      [addDays(day, -2), "Outbound interbank transfer", -20_000],
    ])
    await importAsSuggested(first)
    const second = bankStatement(
      bank.id,
      [
        [addDays(day, -2), "Outbound interbank transfer", -20_000],
        [day, "ATM withdrawal fee", -1_800],
      ],
      { opening: 82_000, fileHash: "b".repeat(64) }
    )
    const { preview, result } = await importAsSuggested(second)
    expect(preview.importedBefore).toBeNull()
    expect(preview.rows.map((r) => r.status)).toEqual(["imported", "new"])
    expect(result.added).toBe(1)
    expect((await live()).length).toBe(3)
  })

  it("turns a bank-side entry and a card payment into one transfer", async () => {
    const bank = await createAccount({
      name: "GoTyme",
      kind: "bank",
      balance: 100_000,
    })
    const card = await createAccount({
      name: "Sample Card",
      kind: "credit_card",
      balance: -50_000,
    })
    // The bank statement first: the payment looks like any transfer out.
    const bankSide = bankStatement(bank.id, [
      [addDays(day, -2), "Outbound interbank transfer", -50_000],
    ])
    await importAsSuggested(bankSide)
    const [spent] = await live()
    expect(spent).toMatchObject({ kind: "expense", accountId: bank.id })

    // Then the card's: its payment is the same money arriving.
    const cardSide = cardStatement(
      card.id,
      [[addDays(day, -1), "BILL PAYMENT", 50_000]],
      { opening: 50_000 }
    )
    const { preview, result } = await importAsSuggested(cardSide)
    expect(preview.rows[0]).toMatchObject({
      status: "transfer",
      transfer: { accountId: bank.id, convert: { id: spent!.id } },
    })
    expect(result).toMatchObject({ added: 0, transfers: 1 })

    const rows = await live()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: spent!.id,
      kind: "transfer",
      amount: -50_000,
      accountId: bank.id,
      toAccountId: card.id,
      categoryId: null,
    })
    expect(await balanceOf(bank.id)).toBe(50_000)
    expect(await balanceOf(card.id)).toBe(0)
  })

  it("adds a transfer for a card payment with nothing logged", async () => {
    const bank = await createAccount({ name: "GoTyme", kind: "bank" })
    const card = await createAccount({
      name: "Sample Card",
      kind: "credit_card",
    })
    const input = cardStatement(
      card.id,
      [
        [addDays(day, -2), "SAMPLE GROCER CITY PH", -30_000],
        [day, "BILL PAYMENT", 30_000],
      ],
      { opening: 0 }
    )
    const { preview, result } = await importAsSuggested(input)
    expect(preview.rows.map((r) => r.status)).toEqual(["new", "transfer"])
    expect(preview.rows[1]!.transfer).toEqual({
      accountId: bank.id,
      convert: null,
    })
    expect(result).toMatchObject({ added: 2, transfers: 1 })
    const transfer = (await live()).find((r) => r.kind === "transfer")
    expect(transfer).toMatchObject({
      amount: -30_000,
      accountId: bank.id,
      toAccountId: card.id,
      entryId: result.importId,
    })
    expect(await balanceOf(card.id)).toBe(0)
  })

  it("doesn't take a friend's repayment for a transfer from your bank", async () => {
    const wallet = await createAccount({ name: "GCash", kind: "ewallet" })
    const bank = await createAccount({ name: "BPI", kind: "bank" })
    await log("+1000 nini paid me back")
    const input = bankStatement(wallet.id, [[day, "Cash in from BPI", 100_000]])
    const preview = await previewImport(getDb(), input)
    expect(preview.rows[0]).toMatchObject({
      status: "transfer",
      transfer: { accountId: bank.id },
    })
  })

  it("suggests cash for an ATM withdrawal, but not for its fee", async () => {
    const bank = await createAccount({ name: "GoTyme", kind: "bank" })
    const cash = await createAccount({ name: "Cash", kind: "cash" })
    const input = bankStatement(bank.id, [
      [day, "Withdrawal via ATM", -200_000],
      [day, "ATM withdrawal fee", -1_800],
    ])
    const preview = await previewImport(getDb(), input)
    expect(preview.rows[0]).toMatchObject({
      status: "transfer",
      transfer: { accountId: cash.id, convert: null },
    })
    expect(preview.rows[1]).toMatchObject({
      status: "new",
      transferish: false,
    })
  })

  it("refuses a choice the preview didn't offer", async () => {
    const bank = await createAccount({ name: "GoTyme", kind: "bank" })
    const input = bankStatement(bank.id, [[day, "Qr Payment", -18_000]])
    await expect(decide(input, [{ action: "link" }])).rejects.toThrow(
      ImportError
    )
    await expect(decide(input, [])).rejects.toThrow(ImportError)
  })

  it("saves once when the same import is sent twice at once", async () => {
    const bank = await createAccount({ name: "GoTyme", kind: "bank" })
    const input = bankStatement(bank.id, [[day, "Qr Payment", -18_000]])
    const id = crypto.randomUUID()
    const results = await Promise.allSettled([
      decide(input, [{ action: "new" }], id),
      decide(input, [{ action: "new" }], id),
    ])
    expect(results.some((r) => r.status === "fulfilled")).toBe(true)
    expect((await live()).length).toBe(1)
  })

  it("undo removes what the import added", async () => {
    const bank = await createAccount({ name: "GoTyme", kind: "bank" })
    const typed = await log("180 iced coffee")
    const input = bankStatement(bank.id, [
      [day, "Qr Payment", -18_000],
      [day, "ATM withdrawal fee", -1_800],
    ])
    const { result } = await importAsSuggested(input)
    expect(await undoImport(getDb(), result.importId!)).toBe(1)
    const rows = await live()
    expect(rows.map((r) => r.id)).toEqual([typed.transactionIds[0]])
    expect(
      await getDb()
        .select()
        .from(schema.imports)
        .where(and(eq(schema.imports.accountId, bank.id)))
    ).toEqual([])
  })
})
