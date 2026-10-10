/**
 * Live eval: runs the fixtures through the real decision model and reports
 * accuracy at the thresholds in categorize.ts. Needs AI Gateway credentials.
 *
 *   pnpm --filter @workspace/ai eval
 */
import { DEFAULT_CATEGORIES } from "@workspace/core/categories"
import {
  AUTO_CATEGORY,
  AUTO_DIRECTION,
  type CategoryOption,
  DEFAULT_DECISION_MODEL,
  askModel,
} from "../src/categorize"
import { FIXTURES, type Fixture } from "./fixtures"

const model = process.env.DECISION_MODEL ?? DEFAULT_DECISION_MODEL
const categories: CategoryOption[] = DEFAULT_CATEGORIES.map((c) => ({
  id: `${c.kind}:${c.name}`,
  name: c.name,
  kind: c.kind,
  examples: [],
}))

async function pool<T, R>(
  items: T[],
  size: number,
  run: (item: T) => Promise<R>
) {
  const results: R[] = []
  let next = 0
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const i = next++
        results[i] = await run(items[i] as T)
      }
    })
  )
  return results
}

interface Row {
  fixture: Fixture
  top: string
  p: number
  pIn: number
}

const rows = await pool(FIXTURES, 6, async (fixture): Promise<Row> => {
  const line = { description: fixture.entry, amount: fixture.amount * 100 }
  const [signed, unsigned] = await Promise.all([
    askModel(
      model,
      { ...line, direction: fixture.kind === "income" ? "in" : "out" },
      categories
    ),
    askModel(model, { ...line, direction: null }, categories),
  ])
  const [top] =
    (fixture.kind === "income" ? signed.income : signed.expense) ?? []
  return {
    fixture,
    top: top?.id.split(":")[1] ?? "?",
    p: top?.p ?? 0,
    pIn: unsigned.pIn ?? 0.5,
  }
})

const pct = (n: number, d: number) =>
  d ? `${Math.round((n / d) * 100)}%` : "–"
const ok = (r: Row) =>
  r.top === r.fixture.category || (r.fixture.also ?? []).includes(r.top)

// Category: applied automatically at ≥ AUTO_CATEGORY, otherwise asked.
const auto = rows.filter((r) => r.p >= AUTO_CATEGORY)
console.log(`\nCategory (${rows.length} entries, auto at ≥ ${AUTO_CATEGORY})`)
console.log(
  `  top-1 accuracy        ${pct(rows.filter(ok).length, rows.length)}`
)
console.log(
  `  applied without asking ${pct(auto.length, rows.length)}, of which right ${pct(auto.filter(ok).length, auto.length)}`
)
for (const t of [0.5, 0.6, 0.7, 0.8, 0.9]) {
  const a = rows.filter((r) => r.p >= t)
  console.log(
    `  at ≥ ${t}: auto ${pct(a.length, rows.length)}, wrong-but-auto ${a.filter((r) => !ok(r)).length}`
  )
}

// Direction: unsigned lines, applied at ≥ AUTO_DIRECTION either way.
const dir = rows.map((r) => {
  const want = r.fixture.kind === "income" ? "in" : "out"
  const got = r.pIn >= 0.5 ? "in" : "out"
  return { ...r, want, got, sure: Math.max(r.pIn, 1 - r.pIn) }
})
const dirAuto = dir.filter((d) => d.sure >= AUTO_DIRECTION)
console.log(`\nDirection without a sign (auto at ≥ ${AUTO_DIRECTION})`)
console.log(
  `  accuracy               ${pct(dir.filter((d) => d.got === d.want).length, dir.length)}`
)
console.log(
  `  applied without asking ${pct(dirAuto.length, dir.length)}, of which right ${pct(dirAuto.filter((d) => d.got === d.want).length, dirAuto.length)}`
)
for (const t of [0.7, 0.8, 0.85, 0.9, 0.95]) {
  const a = dir.filter((d) => d.sure >= t)
  console.log(
    `  at ≥ ${t}: auto ${pct(a.length, dir.length)}, wrong-but-auto ${a.filter((d) => d.got !== d.want).length}`
  )
}

console.log("\nMisses")
for (const r of rows.filter((row) => !ok(row))) {
  console.log(
    `  category  "${r.fixture.entry}" → ${r.top} (${r.p}), want ${r.fixture.category}`
  )
}
for (const d of dir.filter((x) => x.got !== x.want)) {
  console.log(
    `  direction "${d.fixture.entry}" → ${d.got} (p_in ${d.pIn}), want ${d.want}`
  )
}
