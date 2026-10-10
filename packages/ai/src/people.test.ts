import { describe, expect, it } from "vitest"
import { Experimental_DecisionMockModelV4 } from "ai/test"
import type { Experimental_DecisionModelV4CallOptions } from "@ai-sdk/provider"
import { resolveLine } from "./categorize"
import {
  type PeopleSignals,
  type Relation,
  askPeople,
  owedBy,
  planRows,
  resolvePeople,
  shares,
} from "./people"

const relation = (p: Partial<Record<Relation, number>>) => ({
  own: 0,
  lent: 0,
  borrowed: 0,
  repaid_me: 0,
  i_repaid: 0,
  shared: 0,
  ...p,
})

const signals = (p: Partial<Record<Relation, number>>, isPerson = [1]) =>
  ({ isPerson, relation: relation(p) }) satisfies PeopleSignals

const mara = { name: "Mara", personId: "p1", balance: 25000 }
const bgc = { name: "Bgc", personId: null, balance: null }
const ben = { name: "Ben", personId: null, balance: null }

describe("askPeople", () => {
  it("asks about unknown candidates and passes balances", async () => {
    const calls: Experimental_DecisionModelV4CallOptions[] = []
    const model = new Experimental_DecisionMockModelV4({
      doDecide: async (options) => {
        calls.push(options)
        return {
          answers: {
            relation: {
              type: "choice",
              choice: "repaid_me",
              probabilities: { ...relation({ repaid_me: 0.9, own: 0.1 }) },
            },
            person1: { type: "boolean", probability: 0.05 },
          },
          warnings: [],
        }
      },
    })
    const result = await askPeople(model, {
      description: "paid by mara via bgc",
      amount: 25000,
      direction: "in",
      split: null,
      people: [mara, bgc],
    })
    expect(Object.keys(calls[0]?.questions ?? {}).toSorted()).toEqual([
      "person1",
      "relation",
    ])
    expect(JSON.stringify(calls[0]?.state)).toContain("owes the owner ₱250")
    expect(result.isPerson).toEqual([1, 0.05])
    expect(result.relation.repaid_me).toBe(0.9)
  })
})

describe("resolvePeople", () => {
  it("ignores candidates that aren't people", () => {
    const resolved = resolvePeople(
      { direction: "out", split: null },
      signals({ lent: 0.9 }, [0.1]),
      [bgc]
    )
    expect(resolved).toEqual({
      relation: "own",
      people: [],
      ask: [],
      direction: null,
    })
  })

  it("only considers relations that fit the sign", () => {
    // "+250 paid by mara": borrowing and repayment both fit money in.
    const resolved = resolvePeople(
      { direction: "in", split: null },
      signals({ repaid_me: 0.6, lent: 0.3, own: 0.1 }),
      [mara]
    )
    // lent (money out) is dropped and the rest renormalized: 0.6 / 0.7.
    expect(resolved.relation).toBe("repaid_me")
    expect(resolved.ask).toEqual([])
  })

  it("lets a confident relation decide a missing sign", () => {
    const resolved = resolvePeople(
      { direction: null, split: null },
      signals({ lent: 0.85, own: 0.15 }),
      [mara]
    )
    expect(resolved).toMatchObject({ relation: "lent", direction: "out" })
  })

  it("keeps it as own money and asks when unsure", () => {
    const resolved = resolvePeople(
      { direction: "out", split: null },
      signals({ own: 0.45, shared: 0.4, lent: 0.15 }),
      [mara]
    )
    expect(resolved.relation).toBe("own")
    expect(resolved.ask.map((a) => a.value)).toEqual(["own", "shared", "lent"])
  })

  it("always offers the owner's own money when asking", () => {
    const resolved = resolvePeople(
      { direction: "out", split: null },
      signals({ shared: 0.4, i_repaid: 0.3, lent: 0.2, own: 0.1 }),
      [mara]
    )
    expect(resolved.ask.map((a) => a.value)).toEqual([
      "shared",
      "i_repaid",
      "own",
    ])
  })

  it("treats split N with people as shared, without the model", () => {
    expect(
      resolvePeople({ direction: "out", split: 3 }, null, [mara, ben]).relation
    ).toBe("shared")
  })
})

describe("planRows", () => {
  const line = { amount: 120000, share: 120000, split: null }

  it("splits a shared bill into your share and IOUs", () => {
    expect(planRows(line, "out", "shared", [0, 1])).toEqual([
      { kind: "expense", amount: -40000, person: null, split: 3 },
      { kind: "lend", amount: -40000, person: 0, split: null },
      { kind: "lend", amount: -40000, person: 1, split: null },
    ])
  })

  it("honors an explicit split count", () => {
    const rows = planRows(
      { amount: 100000, share: 25000, split: 4 },
      "out",
      "shared",
      [0]
    )
    expect(rows.map((r) => r.amount)).toEqual([-25000, -25000])
    expect(rows[0]?.split).toBe(4)
  })

  it("signs loans and repayments by cash flow", () => {
    expect(planRows(line, "out", "lent", [0])).toEqual([
      { kind: "lend", amount: -120000, person: 0, split: null },
    ])
    expect(planRows(line, "in", "repaid_me", [0])[0]).toMatchObject({
      kind: "settle",
      amount: 120000,
    })
    expect(planRows(line, "in", "borrowed", [0])[0]).toMatchObject({
      kind: "lend",
      amount: 120000,
    })
  })

  it("balances add up: lend then repay is zero", () => {
    const lent = planRows(line, "out", "lent", [0])[0]?.amount ?? 0
    const repaid = planRows(line, "in", "repaid_me", [0])[0]?.amount ?? 0
    expect(owedBy([lent])).toBe(120000)
    expect(owedBy([lent, repaid])).toBe(0)
  })

  it("never loses a centavo when dividing", () => {
    expect(shares(100, 3)).toEqual([34, 33, 33])
    expect(
      planRows(
        { amount: 100, share: 100, split: null },
        "out",
        "lent",
        [0, 1]
      ).map((r) => r.amount)
    ).toEqual([-50, -50])
  })
})

describe("resolveLine with people", () => {
  const unsigned = { description: "lent mara", amount: 50000, direction: null }

  it("files loans without a category or a direction question", () => {
    const resolved = resolveLine(
      unsigned,
      { pIn: 0.5, expense: [{ id: "food", p: 0.9 }] },
      null,
      {
        candidates: [mara],
        signals: { isPerson: [1], relation: relation({ lent: 0.9 }) },
      }
    )
    expect(resolved).toMatchObject({
      direction: "out",
      relation: "lent",
      people: [0],
      categoryId: null,
      questions: [],
    })
  })

  it("asks about the relation before the category", () => {
    const resolved = resolveLine(
      { ...unsigned, direction: "out" },
      { expense: [{ id: "food", p: 0.4 }] },
      null,
      {
        candidates: [mara],
        signals: { isPerson: [1], relation: relation({ own: 0.5, lent: 0.5 }) },
      }
    )
    expect(resolved.relation).toBe("own")
    expect(resolved.categoryId).toBe("food")
    expect(resolved.questions.map((q) => q.kind)).toEqual(["relation"])
  })
})
