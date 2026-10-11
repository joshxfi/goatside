import { beforeEach, describe, expect, it } from "vitest"
import { schema } from "@workspace/db"
import { addPersonRow, liveRows, log, resetDb, row } from "../../test/helpers"
import {
  EditError,
  editTransaction,
  logText,
  settleWith,
  splitOf,
  today,
} from "./ledger.server"
import { addIou } from "./people.server"
import { getDb } from "./services"

async function splitThree() {
  const ben = await addPersonRow("Ben")
  const cara = await addPersonRow("Cara")
  const e = await log("-900 dinner")
  const ownId = e.transactionIds[0]!
  await editTransaction({
    id: ownId,
    type: "expense",
    people: [ben, cara],
    ways: 3,
  })
  return { ben, cara, e, ownId }
}

async function lend(personId: string, amount: number) {
  await addIou({
    personId,
    type: "lent",
    amount,
    description: "loan",
    localDate: await today(getDb()),
    accountId: null,
  })
}

describe("logText", () => {
  beforeEach(resetDb)

  it("logs a plain expense", async () => {
    const result = await log("-900 dinner")
    expect(result.transactionIds).toHaveLength(1)
    expect(await row(result.transactionIds[0]!)).toMatchObject({
      kind: "expense",
      amount: -90000,
      description: "dinner",
      split: null,
      deletedAt: null,
    })
  })

  it("logs two lines from one entry", async () => {
    const { entryId } = await log("-100 coffee, -200 lunch")
    const amounts = (await liveRows(entryId))
      .map((r) => r.amount)
      .toSorted((x, y) => x - y)
    expect(amounts).toEqual([-20000, -10000])
  })

  it("returns the saved rows when the same id is resent after a save", async () => {
    const id = crypto.randomUUID()
    const a = await log("-200 taxi", { id })
    const b = await log("-200 taxi", { id })
    expect(b.transactionIds).toEqual(a.transactionIds)
    expect(b.saved).toEqual([])
    expect(await liveRows(id)).toHaveLength(1)
  })

  it("undo removes the newest entry", async () => {
    const a = await log("-100 a")
    const b = await log("-200 b")
    expect(await logText("undo")).toEqual({ kind: "undo", undone: 1 })
    expect(await liveRows(b.entryId)).toHaveLength(0)
    expect(await liveRows(a.entryId)).toHaveLength(1)
  })
})

describe("editTransaction splits", () => {
  beforeEach(resetDb)

  it("creates the others' IOUs when edited into a split", async () => {
    const { ben, cara, e, ownId } = await splitThree()
    const rows = await liveRows(e.entryId)
    expect(rows).toHaveLength(3)
    const own = rows.find((r) => r.id === ownId)
    expect(own).toMatchObject({ kind: "expense", amount: -30000, split: 3 })
    const lends = rows.filter((r) => r.kind === "lend")
    expect(lends).toHaveLength(2)
    for (const r of lends) expect(r.amount).toBe(-30000)
    expect(lends.map((r) => r.personId).toSorted()).toEqual(
      [ben, cara].toSorted()
    )
  })

  it("describes the bill from your share", async () => {
    const { ownId } = await splitThree()
    const view = await splitOf(ownId)
    expect(view).toMatchObject({ role: "own", bill: 90000, ways: 3 })
    expect(view?.ids).toHaveLength(2)
  })

  it("removes the IOUs when the split goes back to just you", async () => {
    const { e, ownId } = await splitThree()
    await editTransaction({ id: ownId, people: [], ways: 1 })
    const rows = await liveRows(e.entryId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ amount: -90000, split: null })
  })
})

describe("editTransaction history", () => {
  beforeEach(resetDb)

  it("records a correction", async () => {
    const e = await log("-900 dinner")
    await editTransaction({
      id: e.transactionIds[0]!,
      description: "dinner out",
    })
    const corrections = await getDb().select().from(schema.corrections)
    expect(corrections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "description",
          fromValue: "dinner",
          toValue: "dinner out",
        }),
      ])
    )
  })
})

describe("settling", () => {
  beforeEach(resetDb)

  it("can't repay more than was owed", async () => {
    const ben = await addPersonRow("Ben")
    await lend(ben, 50000)
    const s = await settleWith(ben, 20000)
    expect(s.amount).toBe(20000)
    const error = await editTransaction({ id: s.id!, amount: 60000 }).catch(
      (e: unknown) => e
    )
    expect(error).toBeInstanceOf(EditError)
    expect((error as Error).message).toContain("more than Ben owed you")
  })

  it("settles the whole balance by default", async () => {
    const ben = await addPersonRow("Ben")
    await lend(ben, 50000)
    expect(await settleWith(ben)).toMatchObject({ amount: 50000 })
    expect(await settleWith(ben)).toEqual({ amount: 0, id: null })
  })
})

describe("resending an entry id", () => {
  beforeEach(resetDb)

  it("saves once when two sends of the same id race", async () => {
    const id = crypto.randomUUID()
    const [a, b] = await Promise.all([
      log("-200 taxi", { id }),
      log("-200 taxi", { id }),
    ])
    expect(a.transactionIds).toEqual(b.transactionIds)
    expect(await liveRows(id)).toHaveLength(1)
  })

  it("saves once over an entry an older version left without rows", async () => {
    const id = crypto.randomUUID()
    await getDb()
      .insert(schema.entries)
      .values({ id, rawText: "-200 taxi", mode: "log" })
    await Promise.all([
      log("-200 taxi", { id }),
      log("-200 taxi", { id }),
      log("-200 taxi", { id }),
    ])
    expect(await liveRows(id)).toHaveLength(1)
    // No row was cut loose from its entry by a late cleanup.
    const all = await getDb().select().from(schema.transactions)
    expect(all.every((r) => r.entryId === id)).toBe(true)
  })

  it("still saves every line of a multi-line entry", async () => {
    const id = crypto.randomUUID()
    const result = await log("-100 coffee, -200 lunch", { id })
    expect(result.transactionIds).toHaveLength(2)
    expect(await liveRows(id)).toHaveLength(2)
  })
})
