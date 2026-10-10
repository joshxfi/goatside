/**
 * Fills a database with ~3 months of believable sample entries, for
 * screenshots, demos and trying the dashboard. Deterministic (seeded), so
 * runs look the same. Refuses anything but a local database.
 *
 *   TURSO_DATABASE_URL=http://127.0.0.1:8090 pnpm --filter @workspace/db demo
 */
import { eq } from "drizzle-orm"
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
/** Centavos for a whole-peso amount between `min` and `max` pesos, in ₱5 steps. */
const between = (min: number, max: number) =>
  Math.round((min + random() * (max - min)) / 5) * 5 * 100

const categories = await db.select().from(schema.categories)
const categoryId = (kind: "expense" | "income", name: string) =>
  categories.find((c) => c.kind === kind && c.name === name)?.id ?? null

interface Row {
  localDate: string
  description: string
  amount: number
  kind: "expense" | "income" | "lend" | "settle"
  category?: string
  recurring?: boolean
  personId?: string
  split?: number
}

const DAILY: [string, string, number, number][] = [
  ["Food", "kape", 120, 190],
  ["Food", "lunch", 180, 380],
  ["Food", "jollibee", 150, 320],
  ["Food", "grabfood dinner", 350, 650],
  ["Transport", "grab to office", 160, 260],
  ["Transport", "jeep", 13, 26],
  ["Transport", "angkas pauwi", 90, 160],
  ["Groceries", "puregold", 900, 2400],
  ["Shopping", "shopee order", 300, 1500],
  ["Fun", "movie tickets", 500, 800],
  ["Health", "mercury drug", 150, 600],
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
  })
  if (last >= 28 || month !== thisMonth) {
    rows.push({
      localDate: date(Math.min(30, daysInMonth(month))),
      description: "salary",
      amount: 2_250_000,
      kind: "income",
      category: "Salary",
      recurring: true,
    })
  }
  if (random() > 0.4)
    rows.push({
      localDate: date(Math.min(20, last)),
      description: "upwork client payment",
      amount: between(8_000, 18_000),
      kind: "income",
      category: "Freelance",
    })
  rows.push({
    localDate: date(Math.min(5, last)),
    description: "rent",
    amount: -1_200_000,
    kind: "expense",
    category: "Bills",
    recurring: true,
  })
  if (last >= 8)
    rows.push({
      localDate: date(8),
      description: "meralco",
      amount: -between(2_200, 3_400),
      kind: "expense",
      category: "Bills",
      recurring: true,
    })
  if (last >= 12)
    rows.push({
      localDate: date(12),
      description: "pldt fiber",
      amount: -169_900,
      kind: "expense",
      category: "Bills",
      recurring: true,
    })
  if (last >= 3)
    rows.push({
      localDate: date(3),
      description: "netflix",
      amount: -54_900,
      kind: "expense",
      category: "Subscriptions",
      recurring: true,
    })
  if (last >= 9)
    rows.push({
      localDate: date(9),
      description: "spotify",
      amount: -14_900,
      kind: "expense",
      category: "Subscriptions",
      recurring: true,
    })

  // Everyday spending, a few entries a day.
  for (let day = 1; day <= last; day++) {
    const weekend = new Date(`${date(day)}T00:00:00Z`).getUTCDay() % 6 === 0
    const count = 1 + Math.floor(random() * (weekend ? 4 : 3))
    for (let i = 0; i < count; i++) {
      const [category, description, min, max] = pick(DAILY)
      if (category === "Groceries" && random() > 0.25) continue
      if ((category === "Shopping" || category === "Fun") && random() > 0.35)
        continue
      rows.push({
        localDate: date(day),
        description,
        amount: -between(min, max),
        kind: "expense",
        category,
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
    },
    {
      localDate: recent,
      description: "dinner w/ mara and ben",
      amount: -60_000,
      kind: "lend",
      personId: mara,
    },
    {
      localDate: recent,
      description: "dinner w/ mara and ben",
      amount: -60_000,
      kind: "lend",
      personId: ben,
    },
    {
      localDate: addDays(today, -20),
      description: "lent mara",
      amount: -200_000,
      kind: "lend",
      personId: mara,
    },
    {
      localDate: addDays(today, -6),
      description: "mara paid me back",
      amount: 100_000,
      kind: "settle",
      personId: mara,
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
    status: "confirmed" as const,
  }))
)
await db
  .update(schema.settings)
  .set({ timeZone })
  .where(eq(schema.settings.id, 1))
console.log(`Added ${rows.length} demo transactions to ${url}.`)
