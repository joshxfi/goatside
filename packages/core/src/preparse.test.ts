import { describe, expect, it } from "vitest"
import { type DraftLine, preparse } from "./preparse"

// A Saturday.
const today = "2026-10-10"

function lines(input: string): DraftLine[] {
  const result = preparse(input, { today })
  if (result.kind !== "log") throw new Error(`expected log, got ${result.kind}`)
  return result.lines
}

function line(input: string): DraftLine {
  const [first, ...others] = lines(input)
  expect(others).toHaveLength(0)
  if (!first) throw new Error("no line")
  return first
}

describe("preparse: amounts and sign", () => {
  it.each([
    ["-500 lunch at berto's", "out", 50_000, "lunch at berto's"],
    ["+250 paid by x", "in", 25_000, "paid by x"],
    ["-1.5k groceries", "out", 150_000, "groceries"],
    ["-1,250.50 meralco", "out", 125_050, "meralco"],
    ["-₱89 spotify", "out", 8_900, "spotify"],
    ["-php 89 spotify", "out", 8_900, "spotify"],
    ["-p89 spotify", "out", 8_900, "spotify"],
    ["− 500 lunch", "out", 50_000, "lunch"],
    ["+ 20k salary", "in", 2_000_000, "salary"],
    ["-500", "out", 50_000, ""],
  ] as const)("%s", (input, direction, amount, description) => {
    expect(line(input)).toMatchObject({
      direction,
      amount,
      share: amount,
      description,
      signInferred: false,
      localDate: today,
      dateFromText: false,
    })
  })

  it("assumes money out when the sign is missing, and says so", () => {
    expect(line("500 lunch")).toMatchObject({
      direction: "out",
      amount: 50_000,
      signInferred: true,
    })
  })

  it("never changes the typed amount", () => {
    for (const [input, amount] of [
      ["-0.01 test", 1],
      ["-999,999.99 big", 99_999_999],
      ["-.5k half", 50_000],
      ["-1.25k x", 125_000],
    ] as const) {
      expect(line(input).amount).toBe(amount)
    }
  })
})

describe("preparse: several entries in one line", () => {
  it("splits on commas when the next part starts with a sign", () => {
    const [a, b] = lines("-500 lunch, -120 coffee")
    expect(a).toMatchObject({ amount: 50_000, description: "lunch" })
    expect(b).toMatchObject({ amount: 12_000, description: "coffee" })
  })

  it("splits on 'and' and newlines too", () => {
    expect(lines("-500 lunch and +100 change")).toHaveLength(2)
    expect(lines("-500 lunch\n-50 parking")).toHaveLength(2)
  })

  it("keeps commas inside a description", () => {
    expect(line("-500 lunch at berto's, jollibee").description).toBe(
      "lunch at berto's, jollibee"
    )
  })
})

describe("preparse: dates", () => {
  it.each([
    ["-150 grab yesterday", "2026-10-09", "grab"],
    ["-150 grab kahapon", "2026-10-09", "grab"],
    ["-150 grab yday", "2026-10-09", "grab"],
    ["-50 taxi 2 days ago", "2026-10-08", "taxi"],
    ["-200 dinner last fri", "2026-10-09", "dinner"],
    ["-200 dinner last saturday", "2026-10-03", "dinner"],
    ["-200 dinner friday", "2026-10-09", "dinner"],
    ["-200 movie saturday", "2026-10-10", "movie"],
    ["-200 lunch on mon", "2026-10-05", "lunch"],
    ["-1000 rent oct 1", "2026-10-01", "rent"],
    ["-1000 rent on Oct. 1st", "2026-10-01", "rent"],
    ["-100 cake 3 oct", "2026-10-03", "cake"],
    ["-1000 gift dec 25", "2025-12-25", "gift"],
    ["-100 thing 2026-09-30", "2026-09-30", "thing"],
  ])("%s → %s", (input, localDate, description) => {
    expect(line(input)).toMatchObject({
      localDate,
      description,
      dateFromText: true,
    })
  })

  it("leaves abbreviations alone without 'last' or 'on'", () => {
    expect(line("-300 sun load")).toMatchObject({
      localDate: today,
      description: "sun load",
      dateFromText: false,
    })
  })

  it("ignores dates in the future", () => {
    expect(line("-100 thing 2026-10-20")).toMatchObject({
      localDate: today,
      dateFromText: false,
    })
  })

  it("doesn't read 'may' as a month without a day", () => {
    expect(line("-500 may utang si x").localDate).toBe(today)
  })
})

describe("preparse: splits", () => {
  it("records your share", () => {
    expect(line("-1200 dinner w/ x and y split 3")).toMatchObject({
      amount: 120_000,
      share: 40_000,
      split: 3,
      description: "dinner w/ x and y",
    })
  })

  it("rounds the share to the centavo", () => {
    expect(line("-100 snacks split 3 ways")).toMatchObject({
      share: 3_333,
      split: 3,
      description: "snacks",
    })
  })
})

describe("preparse: other kinds", () => {
  it.each([
    ["undo", "undo"],
    [" UNDO ", "undo"],
    ["", "empty"],
    ["   ", "empty"],
    ["how much on food this month?", "ask"],
    ["500?", "ask"],
    ["-pizza 300", "ask"],
    ["-0 nothing", "ask"],
  ])("%j → %s", (input, kind) => {
    expect(preparse(input, { today }).kind).toBe(kind)
  })
})
