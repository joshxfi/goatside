import { describe, expect, it } from "vitest"
import {
  checkStatement,
  fingerprintRows,
  linesFromCsv,
  linesFromItems,
  readAmount,
  readDate,
  readDateParts,
  readPeriod,
  readStatement,
  rowFingerprint,
  statementMentions,
  type StatementLine,
} from "./statement"

// Fixtures are made up. They copy the shape of real statements (where
// cells sit, how rows wrap, what the summary prints), never their data.

const W = 4.5 // points per character, close enough for layout
const text = (x: number, t: string) => ({ x, width: t.length * W, text: t })
/** A right-aligned amount ending at `right`. */
const num = (right: number, t: string) => ({
  x: right - t.length * W,
  width: t.length * W,
  text: t,
})
const line = (
  page: number,
  y: number,
  ...cells: StatementLine["cells"]
): StatementLine => ({ page, y, cells })

// A deposit account: header row, labeled summary, credit, debit and
// running balance columns with 0.00 in the unused one.
function depositStatement(
  rowAmounts = {
    wrappedCredit: "5,000.00",
    lastDebit: "250.00",
  }
): StatementLine[] {
  const row = (
    page: number,
    y: number,
    date: string,
    details: string | null,
    credit: string,
    debit: string,
    balance: string
  ) =>
    line(
      page,
      y,
      text(19, date),
      ...(details ? [text(71, details)] : []),
      num(352, credit),
      num(392, debit),
      num(445, balance)
    )
  return [
    line(1, 800, text(274, "Summary")),
    line(1, 780, text(274, "Opening balance"), num(445, "PHP 1,000.00")),
    line(1, 765, text(274, "Total Credit"), num(445, "PHP 5,250.50")),
    line(1, 750, text(274, "Total Debit"), num(445, "PHP 2,180.00")),
    line(1, 735, text(274, "Closing balance"), num(445, "PHP 4,070.50")),
    line(1, 720, text(15, "Period:"), text(42, "01 Jul 2026 - 30 Sep 2026")),
    line(1, 690, text(417, "Running")),
    line(
      1,
      680,
      text(19, "Date"),
      text(71, "Details"),
      text(329, "Credits"),
      text(369, "Debits")
    ),
    line(1, 670, text(418, "Balance")),
    row(
      1,
      650,
      "02 Jul 2026",
      "Outbound interbank transfer",
      "0.00",
      "250.00",
      "750.00"
    ),
    row(1, 636, "03 Jul 2026", "Qr Payment", "0.00", "180.00", "570.00"),
    // Wrapped details: the date line sits between the two halves.
    line(1, 622, text(71, "Transfer from Nini Santos, Sample Bank,")),
    row(
      1,
      618,
      "05 Jul 2026",
      null,
      rowAmounts.wrappedCredit,
      "0.00",
      "5,570.00"
    ),
    line(1, 614, text(71, "Account No. ••••1234")),
    row(
      1,
      600,
      "10 Jul 2026",
      "Card payment at Sample Cafe, Card •••• 9876",
      "0.00",
      "1,500.00",
      "4,070.00"
    ),
    line(1, 27, text(512, "Page 1 of 2")),
    // Page break.
    row(
      2,
      800,
      "12 Aug 2026",
      "Transfer from Daniel Reyes",
      "250.50",
      "0.00",
      "4,320.50"
    ),
    row(
      2,
      786,
      "20 Sep 2026",
      "ATM withdrawal fee",
      "0.00",
      rowAmounts.lastDebit,
      "4,070.50"
    ),
    line(2, 27, text(512, "Page 2 of 2")),
  ]
}

// A credit card: no header row and no summary labels in the text (they're
// drawn in an image), two dates without a year, one signed amount column,
// details continuing on the line below.
function cardStatement({
  coffee = "160.00",
  period = "06 Aug 2026 to 05 Sep 2026",
} = {}): StatementLine[] {
  const row = (
    page: number,
    y: number,
    date: string,
    posted: string,
    details: string,
    amount: string
  ) =>
    line(
      page,
      y,
      text(34, date),
      text(125, posted),
      text(215, details),
      num(540, amount)
    )
  return [
    line(1, 783, text(339, "Statement of Account")),
    line(1, 759, text(382, "Billing date: 5 September 2026")),
    line(1, 686, num(510, "1,200.00 PHP")),
    line(1, 662, num(510, "- 9,200.00 PHP")),
    line(1, 638, num(510, "0.00 PHP")),
    line(1, 614, num(510, "10,450.50 PHP")),
    line(1, 585, text(111, "1234")),
    line(1, 543, text(51, "50,000.00 PHP")),
    // The due date next to the amount due: a date and an amount, not a row.
    line(1, 433, text(216, "25 Sep 2026"), num(510, "2,450.50 PHP")),
    line(1, 406, num(510, "500.00 PHP")),
    line(1, 323, text(34, "Transactions")),
    line(1, 309, text(34, period)),
    row(1, 262, "9 Aug", "10 Aug", "SAMPLE GROCER CITY PH", "1,000.00"),
    row(1, 244, "12 Aug", "13 Aug", "GRAB SAMPLE CITY PH", "25.00"),
    row(1, 226, "12 Aug", "13 Aug", "GRAB SAMPLE CITY PH", "25.00"),
    row(1, 208, "19 Aug", "19 Aug", "BILL PAYMENT", "- 1,200.00"),
    line(1, 27, text(512, "Page 1 of 3")),
    line(
      2,
      759,
      text(34, "Sample Cashback Credit Card (1234)"),
      text(382, "Billing date: 5 September 2026")
    ),
    line(2, 703, text(34, "Transactions")),
    line(2, 689, text(34, period)),
    row(2, 642, "26 Aug", "27 Aug", "SAMPLE COFFEE AND P NEGROS", coffee),
    line(2, 630, text(215, "OCCIDE PH")),
    // Posting-date order: this one happened a day earlier.
    row(2, 612, "25 Aug", "27 Aug", "SAMPLE CAFE CITY PH", "9,240.50"),
    row(2, 594, "4 Sep", "4 Sep", "BILL PAYMENT", "- 8,000.00"),
    line(2, 27, text(512, "Page 2 of 3")),
    // Terms and conditions, drawn as an image.
    line(3, 51, text(512, "Page 3 of 3")),
  ]
}

describe("readAmount", () => {
  it.each([
    ["1,500.00", 150_000],
    ["0.00", 0],
    ["250.50", 25_050],
    ["1500.00", 150_000],
    ["- 1,037.25", -103_725],
    ["-1,037.25", -103_725],
    ["−12.00", -1_200],
    ["(1,037.25)", -103_725],
    ["PHP 3,884.33", 388_433],
    ["1,037.92 PHP", 103_792],
    ["- 14,037.92 PHP", -1_403_792],
    ["₱250.00", 25_000],
    ["$12.00", 1_200],
    ["-€8.50", -850],
    ["USD 1,234.00", 123_400],
    ["99.99 EUR", 9_999],
  ])("%s → %d", (input, cents) => {
    expect(readAmount(input)).toBe(cents)
  })

  it.each([
    "2026",
    "1234",
    "1,234",
    "1.5",
    "12,34.00",
    "abc",
    "--1.00",
    "",
    "ABC 1.00",
  ])("rejects %j", (input) => {
    expect(readAmount(input)).toBeNull()
  })
})

describe("readDate", () => {
  it.each([
    ["11 Jul 2026", "2026-07-11"],
    ["5 September 2026", "2026-09-05"],
    ["11-Jul-26", "2026-07-11"],
    ["Jul 11, 2026", "2026-07-11"],
    ["2026-07-11", "2026-07-11"],
    ["2026-07-11 14:30", "2026-07-11"],
  ])("%s → %s", (input, date) => {
    expect(readDate(input)).toBe(date)
  })

  it("reads dates without a year as parts", () => {
    expect(readDateParts("9 Aug")).toEqual({ month: 8, day: 9 })
    expect(readDateParts("Aug 9")).toEqual({ month: 8, day: 9 })
    expect(readDate("9 Aug")).toBeNull()
  })

  it("drops a time after the date", () => {
    expect(readDateParts("1 Sep, 02:51 AM")).toEqual({ month: 9, day: 1 })
    expect(readDateParts("Sep 30, 3:53 pm")).toEqual({ month: 9, day: 30 })
    // The hour isn't a two-digit year.
    expect(readDate("1 Sep, 02:51 AM")).toBeNull()
  })

  it.each(["31 Feb 2026", "07/11/2026", "Outbound", "12 Foo 2026"])(
    "rejects %j",
    (input) => {
      expect(readDateParts(input)).toBeNull()
    }
  )
})

describe("readPeriod", () => {
  it.each([
    ["06 Aug 2026 to 05 Sep 2026", "2026-08-06", "2026-09-05"],
    ["Period: 11 Jul 2026 - 10 Oct 2026", "2026-07-11", "2026-10-10"],
    ["15 Dec 2026 to 14 Jan 2027", "2026-12-15", "2027-01-14"],
    ["Dec 15 to Jan 14, 2027", "2026-12-15", "2027-01-14"],
    ["1-30 Sep 2026", "2026-09-01", "2026-09-30"],
    ["Sep 1 - 30, 2026", "2026-09-01", "2026-09-30"],
  ])("%s", (input, start, end) => {
    expect(readPeriod([line(1, 100, text(10, input))])).toEqual({ start, end })
  })
})

describe("linesFromItems", () => {
  it("groups items by baseline and joins pieces that touch", () => {
    const lines = linesFromItems(1, [
      { str: "Outbound", x: 71, y: 650.2, width: 36 },
      { str: " ", x: 107, y: 650.2, width: 2.5 },
      { str: "interbank transfer", x: 109.5, y: 650, width: 70 },
      { str: "02 Jul 2026", x: 19, y: 649.6, width: 45 },
      { str: "250.00", x: 365, y: 650, width: 25 },
      { str: "Page 1 of 2", x: 512, y: 27, width: 45 },
    ])
    expect(lines).toHaveLength(2)
    expect(lines[0]!.cells.map((c) => c.text)).toEqual([
      "02 Jul 2026",
      "Outbound interbank transfer",
      "250.00",
    ])
    expect(lines[1]!.cells.map((c) => c.text)).toEqual(["Page 1 of 2"])
  })
})

describe("readStatement: deposit account", () => {
  it("reads every row, including a wrapped one and a page break", () => {
    const result = readStatement(depositStatement(), { kind: "bank" })
    expect(result.problem).toBeUndefined()
    expect(result.ok).toBe(true)
    expect(result.period).toEqual({ start: "2026-07-01", end: "2026-09-30" })
    expect(result.summary).toEqual({
      opening: 100_000,
      closing: 407_050,
      totalIn: 525_050,
      totalOut: 218_000,
    })
    expect(
      result.rows.map((r) => [r.localDate, r.amount, r.balance, r.details])
    ).toEqual([
      ["2026-07-02", -25_000, 75_000, "Outbound interbank transfer"],
      ["2026-07-03", -18_000, 57_000, "Qr Payment"],
      [
        "2026-07-05",
        500_000,
        557_000,
        "Transfer from Nini Santos, Sample Bank, Account No. ••••1234",
      ],
      [
        "2026-07-10",
        -150_000,
        407_000,
        "Card payment at Sample Cafe, Card •••• 9876",
      ],
      ["2026-08-12", 25_050, 432_050, "Transfer from Daniel Reyes"],
      ["2026-09-20", -25_000, 407_050, "ATM withdrawal fee"],
    ])
    expect(result.check).toMatchObject({
      running: "pass",
      totals: "pass",
      ends: "pass",
      period: "pass",
    })
  })

  it("fails on a changed amount and points at the row", () => {
    const result = readStatement(
      depositStatement({ wrappedCredit: "5,000.00", lastDebit: "205.00" }),
      { kind: "bank" }
    )
    expect(result.ok).toBe(false)
    expect(result.problem).toMatch(/running balance/)
    expect(result.check.firstBreak).toBe(5)
  })

  it("fails when a row goes missing", () => {
    const lines = depositStatement().filter(
      (l) => !l.cells.some((c) => c.text === "Qr Payment")
    )
    const result = readStatement(lines, { kind: "bank" })
    expect(result.ok).toBe(false)
    expect(result.check.running).toBe("fail")
  })
})

describe("readStatement: credit card", () => {
  it("reads a card statement with no header and unlabeled totals", () => {
    const result = readStatement(cardStatement(), { kind: "credit_card" })
    expect(result.problem).toBeUndefined()
    expect(result.ok).toBe(true)
    expect(result.period).toEqual({ start: "2026-08-06", end: "2026-09-05" })
    // Printed balances are what's owed; totals are positive.
    expect(result.summary).toEqual({
      opening: 120_000,
      closing: 245_050,
      totalIn: 920_000,
      totalOut: 1_045_050,
    })
    expect(
      result.rows.map((r) => [r.localDate, r.postedDate, r.amount, r.details])
    ).toEqual([
      ["2026-08-09", "2026-08-10", -100_000, "SAMPLE GROCER CITY PH"],
      ["2026-08-12", "2026-08-13", -2_500, "GRAB SAMPLE CITY PH"],
      ["2026-08-12", "2026-08-13", -2_500, "GRAB SAMPLE CITY PH"],
      ["2026-08-19", "2026-08-19", 120_000, "BILL PAYMENT"],
      [
        "2026-08-26",
        "2026-08-27",
        -16_000,
        "SAMPLE COFFEE AND P NEGROS OCCIDE PH",
      ],
      ["2026-08-25", "2026-08-27", -924_050, "SAMPLE CAFE CITY PH"],
      ["2026-09-04", "2026-09-04", 800_000, "BILL PAYMENT"],
    ])
    expect(result.rows.every((r) => r.balance === undefined)).toBe(true)
    expect(result.check).toMatchObject({
      running: "skip",
      totals: "pass",
      ends: "pass",
      period: "pass",
    })
  })

  it("can't verify a changed amount, so it doesn't pass", () => {
    const result = readStatement(cardStatement({ coffee: "106.00" }), {
      kind: "credit_card",
    })
    expect(result.ok).toBe(false)
    expect(result.problem).toMatch(/can't be checked/)
  })

  it("gives dates the right year across a year end", () => {
    const lines = cardStatement({ period: "06 Dec 2026 to 05 Jan 2027" }).map(
      (l) => ({
        ...l,
        cells: l.cells.map((c) => ({
          ...c,
          text: c.text
            .replace(/(\d+) Aug$/, "$1 Dec")
            .replace(/^(\d) Sep$/, "$1 Jan"),
        })),
      })
    )
    const result = readStatement(lines, { kind: "credit_card" })
    expect(result.ok).toBe(true)
    expect(result.rows[0]!.localDate).toBe("2026-12-09")
    expect(result.rows.at(-1)!.localDate).toBe("2027-01-04")
  })

  it("finds the card's last four digits outside the rows", () => {
    expect(statementMentions(cardStatement(), "1234")).toBe(true)
    expect(statementMentions(cardStatement(), "5678")).toBe(false)
    // Amounts aren't digits of an account number.
    expect(statementMentions(cardStatement(), "0.50")).toBe(false)
  })
})

// One signed amount column with a running balance, as some banks print.
const signed = (thirdAmount: string) => [
  line(
    1,
    700,
    text(20, "Date"),
    text(90, "Description"),
    text(330, "Amount"),
    text(400, "Balance")
  ),
  line(1, 680, text(20, "Opening balance"), num(440, "2,000.00")),
  line(
    1,
    660,
    text(20, "Jul 2, 2026"),
    text(90, "Payroll"),
    num(380, "10,000.00"),
    num(440, "12,000.00")
  ),
  line(
    1,
    645,
    text(20, "Jul 3, 2026"),
    text(90, "Rent"),
    num(380, "-8,000.00"),
    num(440, "4,000.00")
  ),
  line(
    1,
    630,
    text(20, "Jul 4, 2026"),
    text(90, "180 iced coffee"),
    num(380, thirdAmount),
    num(440, "3,820.00")
  ),
]

// A savings account: summary figures without labels, a date and time on
// each row, one signed amount column and a running balance, and up to four
// lines of details below a row, the last ones nearer the next row.
function savingsStatement(): StatementLine[] {
  const row = (
    page: number,
    y: number,
    when: string,
    details: string,
    amount: string,
    balance: string,
    ...below: string[]
  ) => [
    line(
      page,
      y,
      text(40, when),
      text(130, details),
      num(468, amount),
      num(550, balance)
    ),
    ...below.map((t, i) =>
      line(page, y - (i ? 15.7 + i * 9.4 : 14), text(130, t))
    ),
  ]
  const header = (page: number) => [
    line(page, 783, text(341, "Statement of Account")),
    line(
      page,
      759,
      text(41, "Sample Savings (9012)"),
      text(375, "Statement date: 2 October 2026")
    ),
    line(page, 728, text(40, "Transactions")),
    line(page, 715, text(40, "1-30 Sep 2026")),
  ]
  return [
    line(1, 783, text(341, "Statement of Account")),
    line(1, 759, text(375, "Statement date: 2 October 2026")),
    line(1, 674, num(553, "10,000.00 PHP")),
    line(1, 653, text(41, "1234 5678 9012")),
    line(1, 649, num(553, "7,000.00 PHP")),
    line(1, 626, num(553, "- 1,680.00 PHP")),
    line(1, 604, num(553, "0.82 PHP")),
    line(1, 579, num(553, "- 0.16 PHP")),
    line(1, 548, num(553, "15,320.66 PHP")),
    line(1, 524, num(553, "20,000.00 PHP")),
    line(1, 486, text(40, "Transactions")),
    line(1, 473, text(40, "1-30 Sep 2026")),
    ...row(
      1,
      425,
      "1 Sep, 02:51 AM",
      "Interest Applied (at 3.0% p.a.)",
      "0.82",
      "10,000.82",
      "Reference ID: 1000000001"
    ),
    ...row(
      1,
      379,
      "1 Sep, 02:51 AM",
      "Base Interest Withholding Tax",
      "- 0.16",
      "10,000.66",
      "Reference ID: 1000000002"
    ),
    ...row(
      1,
      333,
      "1 Sep, 04:15 AM",
      "Wallet Transfer",
      "5,000.00",
      "15,000.66",
      "Reference ID: a1b2c3d4e5f6",
      "SAMPLEBANKXXX",
      "NINI SANTOS",
      "XXXXXXXX1234"
    ),
    ...row(
      1,
      269,
      "1 Sep, 04:18 AM",
      "Wallet Transfer",
      "2,000.00",
      "17,000.66",
      "Reference ID: b2c3d4e5f6a1",
      "SAMPLEBANKXXX",
      "DANIEL REYES",
      "XXXXXXXX5678"
    ),
    ...row(
      1,
      205,
      "2 Sep, 12:36 PM",
      "Auto Cash-In",
      "- 1,500.00",
      "15,500.66",
      "Reference ID: c3d4e5f6a1b2"
    ),
    line(1, 27, text(512, "Page 1 of 2")),
    ...header(2),
    ...row(
      2,
      677,
      "30 Sep, 03:53 PM",
      "Auto Cash-In",
      "- 180.00",
      "15,320.66",
      "Reference ID: d4e5f6a1b2c3"
    ),
    line(2, 513, text(40, "Fees and charges")),
    line(2, 499, text(40, "as of 6 Jul 2026")),
    line(
      2,
      441,
      text(40, "Transfer fee"),
      text(429, "10.00 PHP per transaction")
    ),
    line(2, 426, text(40, "For transfers to other banks")),
    line(2, 27, text(512, "Page 2 of 2")),
  ]
}

describe("readStatement: other layouts", () => {
  it("reads a single signed amount column", () => {
    const result = readStatement(signed("-180.00"), { kind: "bank" })
    expect(result.ok).toBe(true)
    expect(result.rows.map((r) => r.amount)).toEqual([
      1_000_000, -800_000, -18_000,
    ])
  })

  it("fails a signed column whose balance doesn't follow", () => {
    const result = readStatement(signed("-108.00"), { kind: "bank" })
    expect(result.ok).toBe(false)
    expect(result.check.firstBreak).toBe(2)
  })

  it("won't import rows with nothing to check them against", () => {
    const lines = [
      line(
        1,
        660,
        text(20, "02 Jul 2026"),
        text(90, "Payroll"),
        num(380, "10,000.00")
      ),
      line(
        1,
        645,
        text(20, "03 Jul 2026"),
        text(90, "Rent"),
        num(380, "-8,000.00")
      ),
    ]
    const result = readStatement(lines, { kind: "bank" })
    expect(result.ok).toBe(false)
    expect(result.problem).toMatch(/can't be checked/)
  })

  it("refuses when money in and money out could be either column", () => {
    const lines = [
      line(1, 800, num(440, "1,500.00")),
      line(1, 785, num(440, "300.00")),
      line(
        1,
        660,
        text(20, "02 Jul 2026"),
        text(90, "Transfer"),
        num(330, "1,500.00"),
        num(400, "0.00")
      ),
      line(
        1,
        645,
        text(20, "03 Jul 2026"),
        text(90, "Groceries"),
        num(330, "0.00"),
        num(400, "300.00")
      ),
    ]
    const result = readStatement(lines, { kind: "bank" })
    expect(result.ok).toBe(false)
    expect(result.problem).toMatch(/which column/)
  })

  it("reads a savings statement with times and details below the rows", () => {
    const result = readStatement(savingsStatement(), { kind: "bank" })
    expect(result.problem).toBeUndefined()
    expect(result.ok).toBe(true)
    expect(result.period).toEqual({ start: "2026-09-01", end: "2026-09-30" })
    expect(result.summary).toEqual({ opening: 1_000_000, closing: 1_532_066 })
    expect(
      result.rows.map((r) => [r.localDate, r.amount, r.balance, r.details])
    ).toEqual([
      [
        "2026-09-01",
        82,
        1_000_082,
        "Interest Applied (at 3.0% p.a.) Reference ID: 1000000001",
      ],
      [
        "2026-09-01",
        -16,
        1_000_066,
        "Base Interest Withholding Tax Reference ID: 1000000002",
      ],
      [
        "2026-09-01",
        500_000,
        1_500_066,
        "Wallet Transfer Reference ID: a1b2c3d4e5f6 SAMPLEBANKXXX NINI SANTOS XXXXXXXX1234",
      ],
      [
        "2026-09-01",
        200_000,
        1_700_066,
        "Wallet Transfer Reference ID: b2c3d4e5f6a1 SAMPLEBANKXXX DANIEL REYES XXXXXXXX5678",
      ],
      [
        "2026-09-02",
        -150_000,
        1_550_066,
        "Auto Cash-In Reference ID: c3d4e5f6a1b2",
      ],
      [
        "2026-09-30",
        -18_000,
        1_532_066,
        "Auto Cash-In Reference ID: d4e5f6a1b2c3",
      ],
    ])
    expect(result.check).toMatchObject({
      running: "pass",
      ends: "pass",
      period: "pass",
    })
  })

  it("says so when there are no rows at all", () => {
    const result = readStatement([line(1, 51, text(512, "Page 1 of 1"))], {
      kind: "bank",
    })
    expect(result.ok).toBe(false)
    expect(result.problem).toMatch(/No transactions/)
  })
})

describe("findings from review", () => {
  it("dates rows without a year before a due date in the next year", () => {
    const lines = [
      line(1, 800, text(20, "Statement date"), text(200, "20 Dec 2026")),
      line(1, 785, text(20, "Payment due date"), text(200, "08 Jan 2027")),
      line(1, 770, text(20, "Previous balance"), num(440, "1,000.00")),
      line(1, 755, text(20, "New balance"), num(440, "1,350.00")),
      line(
        1,
        660,
        text(20, "05 Dec"),
        text(90, "SAMPLE SHOP"),
        num(440, "150.00")
      ),
      line(
        1,
        645,
        text(20, "10 Dec"),
        text(90, "SAMPLE CAFE"),
        num(440, "200.00")
      ),
    ]
    const result = readStatement(lines, { kind: "credit_card" })
    expect(result.ok).toBe(true)
    expect(result.rows.map((r) => r.localDate)).toEqual([
      "2026-12-05",
      "2026-12-10",
    ])
  })

  it("doesn't pass a statement on one printed total", () => {
    const rows = [
      {
        localDate: "2026-09-01",
        details: "Refund",
        amount: 5_000,
        page: 1,
        y: 2,
      },
      {
        localDate: "2026-09-02",
        details: "Shop",
        amount: -999_999,
        page: 1,
        y: 1,
      },
    ]
    const check = checkStatement(rows, { totalIn: 5_000 }, null, "credit_card")
    expect(check.ok).toBe(false)
    expect(check.totals).toBe("skip")
  })

  it("reads early-month day-first CSV dates as one month", () => {
    const csv = [
      "Date,Details,Amount,Balance",
      "01/10/2026,Groceries,-100.00,900.00",
      "05/10/2026,Coffee,-50.00,850.00",
      "12/10/2026,Lunch,-50.00,800.00",
    ].join("\n")
    const result = readStatement(linesFromCsv(csv), { kind: "bank" })
    expect(result.rows.map((r) => r.localDate)).toEqual([
      "2026-10-01",
      "2026-10-05",
      "2026-10-12",
    ])
  })
})

describe("other currencies", () => {
  it("reads a CSV with dollar signs and a code column", () => {
    const csv = [
      "Date,Details,Amount,Balance,Currency",
      "2026-10-01,Groceries,-$100.00,$900.00,USD",
      "2026-10-05,Coffee,-$4.50,$895.50,USD",
      "2026-10-06,Refund,$20.00,$915.50,USD",
    ].join("\n")
    const result = readStatement(linesFromCsv(csv), { kind: "bank" })
    expect(result.rows.map((r) => r.amount)).toEqual([-10_000, -450, 2_000])
    expect(result.check.ok).toBe(true)
  })
})

describe("rowFingerprint", () => {
  it("is stable and tells identical rows apart by occurrence", () => {
    const { rows } = readStatement(cardStatement(), { kind: "credit_card" })
    const prints = fingerprintRows(rows)
    expect(new Set(prints).size).toBe(rows.length)
    expect(prints[1]).toBe(rowFingerprint(rows[1]!, 0))
    expect(prints[2]).toBe(rowFingerprint(rows[2]!, 1))
    expect(fingerprintRows(rows)).toEqual(prints)
  })
})

describe("linesFromCsv", () => {
  it("reads a newest-first export with blank columns and quotes", () => {
    const csv = [
      "No.,Date,Description,Debit,Credit,Balance,Reference",
      '3,09/14/2026,"Payroll, September",,"10,000.00","11,820.00",R3',
      "2,09/13/2026,180 iced coffee,180.00,,1820.00,R2",
      "1,09/12/2026,Transfer to Nini,500,,2000.00,R1",
      "",
    ].join("\r\n")
    const result = readStatement(linesFromCsv(csv), { kind: "bank" })
    expect(result.problem).toBeUndefined()
    expect(
      result.rows.map((r) => [r.localDate, r.details, r.amount, r.balance])
    ).toEqual([
      ["2026-09-12", "Transfer to Nini", -50_000, 200_000],
      ["2026-09-13", "180 iced coffee", -18_000, 182_000],
      ["2026-09-14", "Payroll, September", 1_000_000, 1_182_000],
    ])
  })

  it("reads semicolons, a signed amount and day-first dates", () => {
    const csv = [
      "Date;Details;Amount;Balance",
      "13/09/2026;Groceries;-1500;8500.00",
      "14/09/2026;Refund;250.5;8750.50",
    ].join("\n")
    const result = readStatement(linesFromCsv(csv), { kind: "bank" })
    expect(result.ok).toBe(true)
    expect(result.rows.map((r) => [r.localDate, r.amount])).toEqual([
      ["2026-09-13", -150_000],
      ["2026-09-14", 25_050],
    ])
  })

  it("reads a month with only spending, so the credit column is empty", () => {
    const csv = [
      "Date,Description,Debit,Credit,Balance",
      "2026-09-12,Groceries,1500.00,,8500.00",
      "2026-09-13,180 iced coffee,180.00,,8320.00",
    ].join("\n")
    const result = readStatement(linesFromCsv(csv), { kind: "bank" })
    expect(result.problem).toBeUndefined()
    expect(result.rows.map((r) => r.amount)).toEqual([-150_000, -18_000])
  })

  it("reads a PDF month with only deposits and no header", () => {
    const lines = [
      line(
        1,
        660,
        text(20, "02 Jul 2026"),
        text(90, "Payroll"),
        num(380, "10,000.00"),
        num(440, "12,000.00")
      ),
      line(
        1,
        645,
        text(20, "15 Jul 2026"),
        text(90, "Payroll"),
        num(380, "10,000.00"),
        num(440, "22,000.00")
      ),
    ]
    const result = readStatement(lines, { kind: "bank" })
    expect(result.ok).toBe(true)
    expect(result.rows.map((r) => r.amount)).toEqual([1_000_000, 1_000_000])
  })

  it("still needs balances or totals to check against", () => {
    const csv = "Date,Details,Amount\n2026-09-13,Groceries,-15.00\n"
    const result = readStatement(linesFromCsv(csv), { kind: "bank" })
    expect(result.ok).toBe(false)
    expect(result.problem).toMatch(/can't be checked/)
  })
})
