import { describe, expect, it } from "vitest"
import {
  currencyName,
  currencySymbol,
  formatMoney,
  formatMoneyCompact,
  isCurrency,
  parseAmount,
} from "./money"
import { addMonths, daysInMonth, monthRange, todayIn } from "./dates"

describe("parseAmount", () => {
  it.each([
    ["500", 50_000],
    ["1,250.50", 125_050],
    ["1,250", 125_000],
    ["0.5", 50],
    [".75", 75],
    ["1.5k", 150_000],
    ["2K", 200_000],
    ["1.2345k", 123_450],
  ])("%s → %d", (input, cents) => {
    expect(parseAmount(input)).toBe(cents)
  })

  it.each(["0", "0.00", "abc", "1.234", "12,34", "", "1e5", "-5"])(
    "rejects %j",
    (input) => {
      expect(parseAmount(input)).toBeNull()
    }
  )
})

describe("formatMoney", () => {
  it("drops decimals for whole amounts", () => {
    expect(formatMoney(50_000)).toBe("₱500")
    expect(formatMoney(125_050)).toBe("₱1,250.50")
  })

  it("signs", () => {
    expect(formatMoney(-50_000)).toBe("−₱500")
    expect(formatMoney(50_000, { sign: true })).toBe("+₱500")
    expect(formatMoney(0, { sign: true })).toBe("₱0")
  })

  it("compacts", () => {
    expect(formatMoneyCompact(50_000)).toBe("₱500")
    expect(formatMoneyCompact(1_234_500)).toBe("₱12k")
    expect(formatMoneyCompact(123_400)).toBe("₱1.2k")
    expect(formatMoneyCompact(150_000_000)).toBe("₱1.5M")
  })

  it("follows the currency", () => {
    expect(formatMoney(125_050, { currency: "USD" })).toBe("$1,250.50")
    expect(formatMoney(-50_000, { currency: "EUR" })).toBe("−€500")
    expect(formatMoney(50_000, { currency: "CHF" })).toBe("CHF\u00a0500")
    expect(formatMoneyCompact(123_400, { currency: "GBP" })).toBe("£1.2k")
    expect(formatMoneyCompact(-123_400, { currency: "CHF" })).toBe(
      "−CHF\u00a01.2k"
    )
  })

  it("rounds currencies without decimals", () => {
    expect(formatMoney(125_050, { currency: "JPY" })).toBe("¥1,251")
  })

  it("names currencies", () => {
    expect(currencySymbol("PHP")).toBe("₱")
    expect(currencySymbol("CHF")).toBe("CHF")
    expect(currencyName("PHP")).toBe("Philippine peso")
    expect(currencyName("USD")).toBe("US dollar")
    expect(isCurrency("EUR")).toBe(true)
    expect(isCurrency("eur")).toBe(false)
    expect(isCurrency("XYZ")).toBe(false)
  })
})

describe("dates", () => {
  it("resolves today in a timezone", () => {
    // 2026-10-10 17:30 UTC is already Oct 11 in Manila (UTC+8).
    const now = new Date("2026-10-10T17:30:00Z")
    expect(todayIn("Asia/Manila", now)).toBe("2026-10-11")
    expect(todayIn("UTC", now)).toBe("2026-10-10")
  })

  it("does month math", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12")
    expect(addMonths("2026-12", 1)).toBe("2027-01")
    expect(daysInMonth("2028-02")).toBe(29)
    expect(monthRange("2026-02")).toEqual({
      start: "2026-02-01",
      end: "2026-02-28",
    })
  })
})
