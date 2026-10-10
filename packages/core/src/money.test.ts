import { describe, expect, it } from "vitest"
import { formatPeso, formatPesoCompact, parseAmount } from "./money"
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
  ])("%s → %d", (input, centavos) => {
    expect(parseAmount(input)).toBe(centavos)
  })

  it.each(["0", "0.00", "abc", "1.234", "12,34", "", "1e5", "-5"])(
    "rejects %j",
    (input) => {
      expect(parseAmount(input)).toBeNull()
    }
  )
})

describe("formatPeso", () => {
  it("drops decimals for whole amounts", () => {
    expect(formatPeso(50_000)).toBe("₱500")
    expect(formatPeso(125_050)).toBe("₱1,250.50")
  })

  it("signs", () => {
    expect(formatPeso(-50_000)).toBe("−₱500")
    expect(formatPeso(50_000, { sign: true })).toBe("+₱500")
    expect(formatPeso(0, { sign: true })).toBe("₱0")
  })

  it("compacts", () => {
    expect(formatPesoCompact(50_000)).toBe("₱500")
    expect(formatPesoCompact(1_234_500)).toBe("₱12k")
    expect(formatPesoCompact(123_400)).toBe("₱1.2k")
    expect(formatPesoCompact(150_000_000)).toBe("₱1.5M")
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
