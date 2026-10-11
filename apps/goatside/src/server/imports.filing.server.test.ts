import { and, eq, isNull } from "drizzle-orm"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { CategoryOption } from "@workspace/ai/categorize"
import { schema } from "@workspace/db"
import { resetDb } from "../../test/helpers"
import { createAccount } from "./accounts.server"
import { commitImport } from "./imports.server"
import { today } from "./ledger.server"
import { answer } from "./questions.server"
import { getDb } from "./services"

// A pretend decision model: unsure between the first two categories, so
// every line it sees would get a category question.
const model = vi.hoisted(() => ({ calls: 0 }))
vi.mock("@workspace/ai/categorize", async (load) => {
  const actual = await load<typeof import("@workspace/ai/categorize")>()
  return {
    ...actual,
    askModel: async (
      _model: unknown,
      line: { direction: string | null },
      categories: CategoryOption[]
    ) => {
      model.calls++
      const kind = line.direction === "in" ? "income" : "expense"
      const [a, b] = categories.filter((c) => c.kind === kind)
      const ranked = [
        { id: a!.id, p: 0.45 },
        { id: b!.id, p: 0.35 },
      ]
      return kind === "income" ? { income: ranked } : { expense: ranked }
    },
  }
})
vi.mock("./services", async (load) => ({
  ...(await load<typeof import("./services")>()),
  aiEnabled: () => true,
}))

const t = schema.transactions

describe("filing imported rows", () => {
  beforeEach(async () => {
    await resetDb()
    model.calls = 0
  })

  it("asks once for rows that read the same, and the answer files them all", async () => {
    const bank = await createAccount({ name: "GoTyme", kind: "bank" })
    const day = await today(getDb())
    let balance = 100_000
    const rows = [
      ...Array.from({ length: 5 }, (_, i) => ({
        details: "Outbound interbank transfer",
        amount: -(1_000 + i * 100),
      })),
      { details: "Qr Payment", amount: -18_000 },
    ].map((r, i) => {
      balance += r.amount
      return { ...r, localDate: day, balance, page: 1, y: 700 - i * 14 }
    })
    const result = await commitImport(getDb(), {
      accountId: bank.id,
      fileHash: "f".repeat(64),
      rows,
      summary: { opening: 100_000, closing: balance },
      period: null,
      importId: crypto.randomUUID(),
      decisions: rows.map(() => ({ action: "new" as const })),
    })
    expect(result.added).toBe(6)
    // Two descriptions, two model calls, two questions.
    expect(model.calls).toBe(2)
    const db = getDb()
    const open = await db
      .select({ id: schema.questions.id, txn: schema.questions.transactionId })
      .from(schema.questions)
      .where(isNull(schema.questions.resolvedAt))
    expect(open).toHaveLength(2)

    // Answering the transfer row's question files the other four.
    const saved = await db
      .select()
      .from(t)
      .where(and(eq(t.entryId, result.importId!), isNull(t.deletedAt)))
    const transfers = saved.filter(
      (r) => r.description === "Outbound interbank transfer"
    )
    const asked = open.find((q) => transfers.some((r) => r.id === q.txn))!
    const other = await db.query.categories.findFirst({
      where: and(
        eq(schema.categories.kind, "expense"),
        eq(schema.categories.name, "Transport")
      ),
    })
    await answer(db, asked.id, other!.id)
    const after = await db
      .select({ categoryId: t.categoryId, status: t.status })
      .from(t)
      .where(
        and(
          eq(t.entryId, result.importId!),
          eq(t.description, "Outbound interbank transfer")
        )
      )
    expect(after.every((r) => r.categoryId === other!.id)).toBe(true)
    expect(after.every((r) => r.status === "confirmed")).toBe(true)
    // The other description keeps its own question.
    const stillOpen = await db
      .select()
      .from(schema.questions)
      .where(isNull(schema.questions.resolvedAt))
    expect(stillOpen).toHaveLength(1)
  })
})
