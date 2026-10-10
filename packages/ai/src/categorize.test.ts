import { describe, expect, it } from "vitest"
import { Experimental_DecisionMockModelV4 } from "ai/test"
import type { Experimental_DecisionModelV4CallOptions } from "@ai-sdk/provider"
import {
  type CategoryOption,
  type Signals,
  askModel,
  isRecurring,
  needsModel,
  resolveLine,
} from "./categorize"

const categories: CategoryOption[] = [
  { id: "food", name: "Food", kind: "expense", examples: ["lunch at berto's"] },
  { id: "transport", name: "Transport", kind: "expense", examples: [] },
  { id: "pets", name: "Pets", kind: "expense", examples: [] },
  { id: "salary", name: "Salary", kind: "income", examples: [] },
  { id: "other-in", name: "Others", kind: "income", examples: [] },
]

function mockModel(
  answer: (
    options: Experimental_DecisionModelV4CallOptions
  ) => Record<string, unknown>
) {
  const calls: Experimental_DecisionModelV4CallOptions[] = []
  const model = new Experimental_DecisionMockModelV4({
    doDecide: async (options) => {
      calls.push(options)
      return { answers: answer(options) as never, warnings: [] }
    },
  })
  return { model, calls }
}

describe("askModel", () => {
  it("asks only the expense list when the sign is known", async () => {
    const { model, calls } = mockModel(() => ({
      recurring: { type: "boolean", probability: 0.1 },
      expense: {
        type: "choice",
        choice: "c0",
        probabilities: { c0: 0.7, c1: 0.2, c2: 0.1 },
      },
    }))
    const signals = await askModel(
      model,
      { description: "lunch", amount: 50000, direction: "out" },
      categories
    )
    const questions = calls[0]?.questions ?? {}
    expect(Object.keys(questions).toSorted()).toEqual(["expense", "recurring"])
    expect(JSON.stringify(questions.expense)).toContain("Meals, snacks")
    expect(JSON.stringify(questions.expense)).toContain("lunch at berto's")
    expect(signals).toEqual({
      recurring: 0.1,
      expense: [
        { id: "food", p: 0.7 },
        { id: "transport", p: 0.2 },
        { id: "pets", p: 0.1 },
      ],
    })
  })

  it("asks direction and both lists without a sign", async () => {
    const { model, calls } = mockModel(() => ({
      recurring: { type: "boolean", probability: 0.9 },
      direction: {
        type: "choice",
        choice: "in",
        probabilities: { in: 0.92, out: 0.08 },
      },
      expense: { type: "choice", choice: "c2" },
      income: {
        type: "choice",
        choice: "c0",
        probabilities: { c0: 0.8, c1: 0.2 },
      },
    }))
    const signals = await askModel(
      model,
      { description: "payroll", amount: 3_000_000, direction: null },
      categories
    )
    expect(Object.keys(calls[0]?.questions ?? {}).toSorted()).toEqual([
      "direction",
      "expense",
      "income",
      "recurring",
    ])
    expect(calls[0]?.state).toEqual([
      { type: "json", value: { entry: "payroll", amount: "₱30,000" } },
    ])
    expect(signals.pIn).toBe(0.92)
    // A choice without a distribution counts as certain.
    expect(signals.expense).toEqual([{ id: "pets", p: 1 }])
    expect(signals.income?.[0]).toEqual({ id: "salary", p: 0.8 })
  })
})

const expense = (p: number[]): Signals["expense"] =>
  ["food", "transport", "pets"].map((id, i) => ({ id, p: p[i] ?? 0 }))

describe("resolveLine", () => {
  const out = { description: "lunch", amount: 50000, direction: "out" } as const
  const unsigned = { ...out, direction: null }

  it("applies a confident category", () => {
    const resolved = resolveLine(out, { expense: expense([0.9, 0.1]) }, null)
    expect(resolved).toMatchObject({
      direction: "out",
      categoryId: "food",
      confidence: 0.9,
      status: "parsed",
      questions: [],
    })
  })

  it("keeps the best guess and asks when unsure", () => {
    const resolved = resolveLine(
      out,
      { expense: expense([0.45, 0.35, 0.2]) },
      null
    )
    expect(resolved.categoryId).toBe("food")
    expect(resolved.status).toBe("needs_review")
    expect(resolved.questions).toEqual([
      {
        kind: "category",
        guess: "food",
        options: [
          { value: "food", p: 0.45 },
          { value: "transport", p: 0.35 },
          { value: "pets", p: 0.2 },
        ],
      },
    ])
  })

  it("applies a confident direction for a line with no sign", () => {
    const resolved = resolveLine(
      unsigned,
      { pIn: 0.95, income: [{ id: "salary", p: 0.9 }], expense: expense([1]) },
      null
    )
    expect(resolved).toMatchObject({
      direction: "in",
      categoryId: "salary",
      questions: [],
    })
  })

  it("asks money in or out first when the model is torn", () => {
    const resolved = resolveLine(
      unsigned,
      {
        pIn: 0.6,
        income: [{ id: "other-in", p: 0.4 }],
        expense: expense([0.3]),
      },
      null
    )
    expect(resolved.direction).toBe("in")
    expect(resolved.status).toBe("needs_review")
    // No category question yet: it follows the direction answer.
    expect(resolved.questions).toEqual([
      {
        kind: "direction",
        guess: "in",
        options: [
          { value: "out", p: expect.closeTo(0.4) },
          { value: "in", p: 0.6 },
        ],
        rankings: {
          in: [{ id: "other-in", p: 0.4 }],
          out: expense([0.3]),
        },
      },
    ])
  })

  it("still asks direction without a model, guessing money out", () => {
    const resolved = resolveLine(unsigned, null, null)
    expect(resolved.direction).toBe("out")
    expect(resolved.categoryId).toBeNull()
    expect(resolved.questions).toEqual([
      {
        kind: "direction",
        guess: "out",
        options: [
          { value: "out", p: null },
          { value: "in", p: null },
        ],
        rankings: { in: [], out: [] },
      },
    ])
  })

  it("saves a signed line as pending without a model", () => {
    expect(resolveLine(out, null, null)).toMatchObject({
      categoryId: null,
      status: "pending",
      questions: [],
    })
  })

  it("trusts what the owner confirmed before", () => {
    const memory = {
      direction: "in" as const,
      categoryId: "salary",
      recurring: true,
    }
    expect(resolveLine(unsigned, null, memory)).toMatchObject({
      direction: "in",
      categoryId: "salary",
      confidence: 1,
      recurring: true,
      status: "parsed",
      questions: [],
    })
    expect(needsModel(unsigned, memory)).toBe(false)
  })

  it("ignores memory that contradicts an explicit sign", () => {
    const memory = {
      direction: "in" as const,
      categoryId: "salary",
      recurring: false,
    }
    expect(needsModel(out, memory)).toBe(true)
    expect(
      resolveLine(out, { expense: expense([0.8]) }, memory).categoryId
    ).toBe("food")
  })

  it("marks recurring lines", () => {
    expect(resolveLine(out, { recurring: 0.85 }, null).recurring).toBe(true)
    expect(resolveLine(out, { recurring: 0.5 }, null).recurring).toBe(false)
  })
})

describe("isRecurring", () => {
  it("trusts history over the text", () => {
    expect(isRecurring(0.1, 2, null)).toBe(true)
    expect(isRecurring(0.45, 1, null)).toBe(true)
    expect(isRecurring(0.45, 0, null)).toBe(false)
    expect(
      isRecurring(undefined, 0, {
        direction: "out",
        categoryId: null,
        recurring: true,
      })
    ).toBe(true)
  })
})
