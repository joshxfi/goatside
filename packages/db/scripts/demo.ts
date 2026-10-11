/**
 * Fills a database with ~3 months of believable sample entries, for
 * screenshots, demos and trying the dashboard. Deterministic (seeded), so
 * runs look the same. Refuses anything but a local database.
 *
 *   TURSO_DATABASE_URL=http://127.0.0.1:8090 pnpm --filter @workspace/db demo
 */
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm"
import { addDays, addMonths, daysInMonth, todayIn } from "@workspace/core/dates"
import { createDb, schema, seedDefaults } from "../src/index"

const url = process.env.TURSO_DATABASE_URL ?? "http://127.0.0.1:8080"
if (!/^(http:\/\/(127\.0\.0\.1|localhost)|file:)/.test(url)) {
  console.error(`Refusing to write demo data to ${url}: local databases only.`)
  process.exit(1)
}

const db = createDb({ url })
await seedDefaults(db)

const existing = await db
  .select({ id: schema.transactions.id })
  .from(schema.transactions)
  .limit(1)
if (existing.length && !process.argv.includes("--append")) {
  console.error(
    "This database already has transactions. Pass --append to add demo data anyway."
  )
  process.exit(1)
}

// Small seeded PRNG (mulberry32) so every run is identical.
let seed = 20261010
function random() {
  seed = (seed + 0x6d2b79f5) | 0
  let t = seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)] as T
/** Cents for a whole-peso amount between `min` and `max` pesos, in ₱5 steps. */
const between = (min: number, max: number) =>
  Math.round((min + random() * (max - min)) / 5) * 5 * 100

const categories = await db.select().from(schema.categories)
const categoryId = (kind: "expense" | "income", name: string) =>
  categories.find((c) => c.kind === kind && c.name === name)?.id ?? null

// Where the money sits. Balances at the end are set to these figures.
const ACCOUNTS = [
  {
    key: "savings",
    name: "BPI Savings",
    kind: "bank",
    color: "rose",
    last4: "0417",
    target: 8_642_000,
  },
  {
    key: "gcash",
    name: "GCash",
    kind: "ewallet",
    color: "blue",
    target: 438_550,
  },
  {
    key: "maya",
    name: "Maya",
    kind: "ewallet",
    color: "emerald",
    target: 126_000,
  },
  {
    key: "card",
    name: "BPI Card",
    kind: "credit_card",
    color: "indigo",
    last4: "4821",
    creditLimit: 6_000_000,
    target: -1_294_000,
  },
  { key: "cash", name: "Cash", kind: "cash", color: "amber", target: 186_000 },
] as const
type AccountKey = (typeof ACCOUNTS)[number]["key"]

const savedAccounts = await db
  .insert(schema.accounts)
  .values(
    ACCOUNTS.map((a, sort) => ({
      name: a.name,
      kind: a.kind,
      color: a.color,
      last4: "last4" in a ? a.last4 : null,
      creditLimit: "creditLimit" in a ? a.creditLimit : null,
      sort,
    }))
  )
  .onConflictDoNothing()
  .returning({ id: schema.accounts.id, name: schema.accounts.name })
const accountId = (key: AccountKey) =>
  savedAccounts.find(
    (a) => a.name === ACCOUNTS.find((x) => x.key === key)?.name
  )?.id ?? null

interface Row {
  localDate: string
  description: string
  amount: number
  kind: "expense" | "income" | "lend" | "settle" | "transfer"
  category?: string
  recurring?: boolean
  personId?: string
  split?: number
  account?: AccountKey
  to?: AccountKey
}

const DAILY: [string, string, number, number, AccountKey[]][] = [
  ["Food", "kape", 120, 190, ["cash", "gcash"]],
  ["Food", "lunch", 180, 380, ["cash", "gcash", "maya"]],
  ["Food", "jollibee", 150, 320, ["cash", "gcash"]],
  ["Food", "grabfood dinner", 350, 650, ["gcash"]],
  ["Transport", "grab to office", 160, 260, ["gcash"]],
  ["Transport", "jeep", 13, 26, ["cash"]],
  ["Transport", "angkas pauwi", 90, 160, ["cash", "gcash"]],
  ["Groceries", "puregold", 900, 2400, ["card", "maya"]],
  ["Shopping", "shopee order", 300, 1500, ["gcash", "card"]],
  ["Fun", "movie tickets", 500, 800, ["card"]],
  ["Health", "mercury drug", 150, 600, ["cash", "card"]],
]

const timeZone = "Asia/Manila"
const today = todayIn(timeZone)
const thisMonth = today.slice(0, 7)
const rows: Row[] = []

for (const month of [
  addMonths(thisMonth, -2),
  addMonths(thisMonth, -1),
  thisMonth,
]) {
  const last =
    month === thisMonth ? Number(today.slice(8, 10)) : daysInMonth(month)
  const date = (day: number) => `${month}-${String(day).padStart(2, "0")}`

  // Income and fixed bills.
  rows.push({
    localDate: date(Math.min(15, last)),
    description: "salary",
    amount: 2_250_000,
    kind: "income",
    category: "Salary",
    recurring: true,
    account: "savings",
  })
  if (last >= 28 || month !== thisMonth) {
    rows.push({
      localDate: date(Math.min(30, daysInMonth(month))),
      description: "salary",
      amount: 2_250_000,
      kind: "income",
      category: "Salary",
      recurring: true,
      account: "savings",
    })
  }
  if (random() > 0.4)
    rows.push({
      localDate: date(Math.min(20, last)),
      description: "upwork client payment",
      amount: between(8_000, 18_000),
      kind: "income",
      category: "Freelance",
      account: "gcash",
    })
  rows.push({
    localDate: date(Math.min(5, last)),
    description: "rent",
    amount: -1_200_000,
    kind: "expense",
    category: "Bills",
    recurring: true,
    account: "savings",
  })
  if (last >= 8)
    rows.push({
      localDate: date(8),
      description: "meralco",
      amount: -between(2_200, 3_400),
      kind: "expense",
      category: "Bills",
      recurring: true,
      account: "gcash",
    })
  if (last >= 12)
    rows.push({
      localDate: date(12),
      description: "pldt fiber",
      amount: -169_900,
      kind: "expense",
      category: "Bills",
      recurring: true,
      account: "card",
    })
  if (last >= 3)
    rows.push({
      localDate: date(3),
      description: "netflix",
      amount: -54_900,
      kind: "expense",
      category: "Subscriptions",
      recurring: true,
      account: "card",
    })
  if (last >= 9)
    rows.push({
      localDate: date(9),
      description: "spotify",
      amount: -14_900,
      kind: "expense",
      category: "Subscriptions",
      recurring: true,
      account: "card",
    })

  // Money moving between accounts: ATM runs, cashing in, paying the card.
  for (const day of [1, 8, 15, 22]) {
    if (day > last) continue
    rows.push({
      localDate: date(day),
      description: "atm",
      amount: -500_000,
      kind: "transfer",
      account: "savings",
      to: "cash",
    })
  }
  for (const day of [2, 16]) {
    if (day > last) continue
    rows.push({
      localDate: date(day),
      description: "cash in",
      amount: -between(4_000, 7_000),
      kind: "transfer",
      account: "savings",
      to: day === 2 ? "gcash" : "maya",
    })
  }
  if (last >= 24)
    rows.push({
      localDate: date(24),
      description: "card payment",
      amount: -between(9_000, 14_000),
      kind: "transfer",
      account: "savings",
      to: "card",
    })

  // Everyday spending, a few entries a day.
  for (let day = 1; day <= last; day++) {
    const weekend = new Date(`${date(day)}T00:00:00Z`).getUTCDay() % 6 === 0
    const count = 1 + Math.floor(random() * (weekend ? 4 : 3))
    for (let i = 0; i < count; i++) {
      const [category, description, min, max, paidWith] = pick(DAILY)
      if (category === "Groceries" && random() > 0.25) continue
      if ((category === "Shopping" || category === "Fun") && random() > 0.35)
        continue
      rows.push({
        localDate: date(day),
        description,
        amount: -between(min, max),
        kind: "expense",
        category,
        account: pick(paidWith),
      })
    }
  }
}

// A couple of people: a shared dinner and a loan, partly repaid.
const people = await db
  .insert(schema.people)
  .values([{ name: "Mara" }, { name: "Ben" }])
  .onConflictDoNothing()
  .returning({ id: schema.people.id, name: schema.people.name })
const mara = people.find((p) => p.name === "Mara")?.id
const ben = people.find((p) => p.name === "Ben")?.id
const recent = addDays(today, -4)
if (mara && ben) {
  rows.push(
    {
      localDate: recent,
      description: "dinner w/ mara and ben",
      amount: -60_000,
      kind: "expense",
      category: "Food",
      split: 3,
      account: "card",
    },
    {
      localDate: recent,
      description: "dinner w/ mara and ben",
      amount: -60_000,
      kind: "lend",
      personId: mara,
      account: "card",
    },
    {
      localDate: recent,
      description: "dinner w/ mara and ben",
      amount: -60_000,
      kind: "lend",
      personId: ben,
      account: "card",
    },
    {
      localDate: addDays(today, -20),
      description: "lent mara",
      amount: -200_000,
      kind: "lend",
      personId: mara,
      account: "gcash",
    },
    {
      localDate: addDays(today, -6),
      description: "mara paid me back",
      amount: 100_000,
      kind: "settle",
      personId: mara,
      account: "gcash",
    }
  )
}

await db.insert(schema.transactions).values(
  rows.map((r) => ({
    localDate: r.localDate,
    description: r.description,
    amount: r.amount,
    kind: r.kind,
    categoryId: r.category
      ? categoryId(r.kind === "income" ? "income" : "expense", r.category)
      : null,
    recurring: r.recurring ?? false,
    personId: r.personId ?? null,
    split: r.split ?? null,
    accountId: r.account ? accountId(r.account) : null,
    toAccountId: r.to ? accountId(r.to) : null,
    status: "confirmed" as const,
  }))
)

// Openings that land each account on its target balance today.
for (const account of ACCOUNTS) {
  const id = accountId(account.key)
  if (!id) continue
  const [out] = await db
    .select({
      total: sql<number>`coalesce(sum(${schema.transactions.amount}), 0)`,
    })
    .from(schema.transactions)
    .where(
      and(
        isNull(schema.transactions.deletedAt),
        eq(schema.transactions.accountId, id)
      )
    )
  const [into] = await db
    .select({
      total: sql<number>`coalesce(sum(-${schema.transactions.amount}), 0)`,
    })
    .from(schema.transactions)
    .where(
      and(
        isNull(schema.transactions.deletedAt),
        isNotNull(schema.transactions.toAccountId),
        eq(schema.transactions.toAccountId, id)
      )
    )
  const flows = Number(out?.total ?? 0) + Number(into?.total ?? 0)
  await db
    .update(schema.accounts)
    .set({ opening: account.target - flows })
    .where(eq(schema.accounts.id, id))
}
await db
  .update(schema.settings)
  .set({ timeZone, defaultAccountId: accountId("gcash") })
  .where(eq(schema.settings.id, 1))
console.log(`Added ${rows.length} demo transactions to ${url}.`)
