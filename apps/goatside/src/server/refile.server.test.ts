import { beforeEach, describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"
import { schema } from "@workspace/db"
import { addPersonRow, liveRows, log, resetDb, row } from "../../test/helpers"
import { createAccount, setDefaultAccount } from "./accounts.server"
import { logText } from "./ledger.server"
import { mergePeople } from "./people.server"
import { answer } from "./questions.server"
import { getDb } from "./services"

/** A relation question on a one-row line, as saveLines would have asked it. */
async function relationQuestion(
  transactionId: string,
  amount: number,
  candidate: { name: string; personId: string | null },
  { guess = "own", transactionIds = [transactionId] } = {}
) {
  const [question] = await getDb()
    .insert(schema.questions)
    .values({
      transactionId,
      kind: "relation",
      guess,
      options: [],
      context: {
        line: { amount, share: amount, split: null },
        candidates: [candidate],
        people: [0],
        rankings: { in: [], out: [] },
        transactionIds,
      },
    })
    .returning()
  return question!.id
}

describe("answering a relation question", () => {
  beforeEach(resetDb)

  it("files 'borrowed' to no account", async () => {
    const gcash = await createAccount({
      name: "GCash",
      kind: "ewallet",
      balance: 0,
    })
    await setDefaultAccount(gcash.id)
    const entry = await log("-350 lunch")
    const own = entry.transactionIds[0]!
    expect((await row(own)).accountId).not.toBeNull()
    const q = await relationQuestion(own, 35000, {
      name: "Ben",
      personId: null,
    })
    await answer(getDb(), q, "borrowed")
    expect(await row(own)).toMatchObject({
      kind: "lend",
      amount: 35000,
      accountId: null,
    })
  })

  it("keeps the account for 'lent'", async () => {
    const gcash = await createAccount({
      name: "GCash",
      kind: "ewallet",
      balance: 0,
    })
    await setDefaultAccount(gcash.id)
    const entry = await log("-350 lunch")
    const own = entry.transactionIds[0]!
    const q = await relationQuestion(own, 35000, {
      name: "Ben",
      personId: null,
    })
    await answer(getDb(), q, "lent")
    expect(await row(own)).toMatchObject({
      kind: "lend",
      amount: -35000,
      accountId: gcash.id,
    })
  })

  it("leaves 'undo' on the newest entry after splitting an older one", async () => {
    const older = await log("-1000 groceries")
    const own = older.transactionIds[0]!
    await getDb()
      .update(schema.transactions)
      .set({ createdAt: new Date(Date.now() - 3_600_000) })
      .where(eq(schema.transactions.id, own))
    const newer = await log("-50 candy")
    const q = await relationQuestion(own, 100000, {
      name: "Ben",
      personId: null,
    })
    await answer(getDb(), q, "shared")
    expect(await liveRows(older.entryId)).toHaveLength(2)
    await logText("undo")
    expect(await liveRows(newer.entryId)).toHaveLength(0)
    expect(await liveRows(older.entryId)).toHaveLength(2)
  })

  it("soft-deletes IOU rows a new answer replaces", async () => {
    const entry = await log("-1000 groceries")
    const own = entry.transactionIds[0]!
    await answer(
      getDb(),
      await relationQuestion(own, 100000, { name: "Ben", personId: null }),
      "shared"
    )
    const [iou] = (await liveRows(entry.entryId)).filter(
      (r) => r.kind === "lend"
    )
    expect(iou).toBeDefined()
    const again = await relationQuestion(
      own,
      100000,
      { name: "Ben", personId: iou!.personId },
      { guess: "shared", transactionIds: [own, iou!.id] }
    )
    await answer(getDb(), again, "own")
    expect((await row(iou!.id)).deletedAt).not.toBeNull()
    expect(await liveRows(entry.entryId)).toHaveLength(1)
  })

  it("finds the merged person when the asked-about one was merged away", async () => {
    const zed = await addPersonRow("Zed")
    const zedd = await addPersonRow("Zedd")
    const entry = await log("-200 snacks")
    const own = entry.transactionIds[0]!
    const q = await relationQuestion(own, 20000, {
      name: "Zedd",
      personId: zedd,
    })
    await mergePeople({ from: zedd, into: zed })
    await answer(getDb(), q, "lent")
    expect(await row(own)).toMatchObject({
      kind: "lend",
      amount: -20000,
      personId: zed,
    })
    const names = (await getDb().select().from(schema.people)).map(
      (p) => p.name
    )
    expect(names).toEqual(["Zed"])
  })
})
