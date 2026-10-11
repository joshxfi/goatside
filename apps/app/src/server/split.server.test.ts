import { beforeEach, describe, expect, it } from "vitest"
import { schema } from "@workspace/db"
import { addPersonRow, liveRows, log, resetDb } from "../../test/helpers"
import { editTransaction, setDeleted, splitOf } from "./ledger.server"
import { answer } from "./questions.server"
import { getDb } from "./services"

/** ₱900 dinner split three ways with Ben and Cara. */
async function splitDinner() {
  const ben = await addPersonRow("Ben")
  const cara = await addPersonRow("Cara")
  const entry = await log("-900 dinner")
  const own = entry.transactionIds[0]!
  await editTransaction({
    id: own,
    type: "expense",
    people: [ben, cara],
    ways: 3,
  })
  return { ben, cara, entry, own }
}

describe("split bills", () => {
  beforeEach(resetDb)

  it("deleting your share deletes the others' shares, and undo restores all", async () => {
    const { entry, own } = await splitDinner()
    const result = await setDeleted([own], true)
    expect(result.ids).toHaveLength(3)
    expect(await liveRows(entry.entryId)).toHaveLength(0)
    await setDeleted(result.ids, false)
    expect(await liveRows(entry.entryId)).toHaveLength(3)
  })

  it("deleting only someone's share leaves the rest", async () => {
    const { entry, ben } = await splitDinner()
    const share = (await liveRows(entry.entryId)).find(
      (r) => r.personId === ben
    )!
    const result = await setDeleted([share.id], true)
    expect(result.ids).toEqual([share.id])
    expect(await liveRows(entry.entryId)).toHaveLength(2)
  })

  it("removing a duplicate removes shares added after it was saved", async () => {
    const ben = await addPersonRow("Ben")
    const entry = await log("-600 lunch")
    const own = entry.transactionIds[0]!
    const [question] = await getDb()
      .insert(schema.questions)
      .values({
        transactionId: own,
        kind: "duplicate",
        guess: "keep",
        options: [],
        context: {
          line: { amount: 60000, share: 60000, split: null },
          candidates: [],
          people: [],
          rankings: { in: [], out: [] },
          transactionIds: [own],
        },
      })
      .returning()
    await editTransaction({ id: own, type: "expense", people: [ben], ways: 2 })
    await answer(getDb(), question!.id, "remove")
    expect(await liveRows(entry.entryId)).toHaveLength(0)
  })

  it("refuses to change the description or date of someone's share", async () => {
    const { entry, ben, own } = await splitDinner()
    const share = (await liveRows(entry.entryId)).find(
      (r) => r.personId === ben
    )!
    await expect(
      editTransaction({ id: share.id, description: "dinner at Berto's" })
    ).rejects.toThrow("Open your share")
    await expect(
      editTransaction({ id: share.id, localDate: "2026-01-01" })
    ).rejects.toThrow("Open your share")
    expect((await splitOf(own))!.ids).toHaveLength(2)
  })

  it("still lets you resend a share's unchanged description", async () => {
    const { entry, ben } = await splitDinner()
    const share = (await liveRows(entry.entryId)).find(
      (r) => r.personId === ben
    )!
    await editTransaction({ id: share.id, description: share.description })
  })

  it("changing your share's description carries the others' shares along", async () => {
    const { entry, own } = await splitDinner()
    await editTransaction({ id: own, description: "dinner out" })
    const rows = await liveRows(entry.entryId)
    expect(rows.every((r) => r.description === "dinner out")).toBe(true)
    expect((await splitOf(own))!.ids).toHaveLength(2)
  })
})
