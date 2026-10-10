/**
 * Live eval for duplicate detection.
 *
 *   pnpm --filter @workspace/ai eval:duplicates
 */
import { DEFAULT_DECISION_MODEL } from "../src/categorize"
import { LIKELY_DUPLICATE, askDuplicate } from "../src/duplicates"

const model = process.env.DECISION_MODEL ?? DEFAULT_DECISION_MODEL
const today = "2026-10-10"
const yesterday = "2026-10-09"

const CASES: {
  a: string
  b: string
  date: string
  minutesAgo: number
  same: boolean
}[] = [
  {
    a: "lunch berto",
    b: "lunch at berto's",
    date: today,
    minutesAgo: 20,
    same: true,
  },
  { a: "grab pauwi", b: "grab home", date: today, minutesAgo: 6, same: true },
  { a: "meralco bill", b: "meralco", date: today, minutesAgo: 120, same: true },
  {
    a: "netflix",
    b: "netflix subscription",
    date: today,
    minutesAgo: 1500,
    same: true,
  },
  { a: "coffee", b: "coffee", date: yesterday, minutesAgo: 1440, same: false },
  {
    a: "grab to office",
    b: "grab home",
    date: today,
    minutesAgo: 540,
    same: false,
  },
  { a: "jeep", b: "jeep", date: today, minutesAgo: 480, same: false },
  { a: "lunch", b: "dinner", date: today, minutesAgo: 400, same: false },
  { a: "7-eleven", b: "7-eleven", date: today, minutesAgo: 300, same: false },
  // Held out: no wording shared with the question's criteria.
  { a: "mcdo", b: "mcdo", date: today, minutesAgo: 360, same: false },
  { a: "parking", b: "parking", date: today, minutesAgo: 240, same: false },
  {
    a: "milk tea",
    b: "milktea",
    date: yesterday,
    minutesAgo: 1300,
    same: false,
  },
  { a: "globe load", b: "load", date: today, minutesAgo: 3, same: true },
  { a: "shopee", b: "shopee order", date: today, minutesAgo: 10, same: true },
  { a: "pldt", b: "pldt fiber", date: today, minutesAgo: 900, same: true },
]

let wrong = 0
for (const c of CASES) {
  const p = await askDuplicate(
    model,
    { description: c.a, amount: -15000, localDate: today },
    {
      description: c.b,
      amount: -15000,
      localDate: c.date,
      minutesAgo: c.minutesAgo,
    }
  )
  const flagged = p >= LIKELY_DUPLICATE
  if (flagged !== c.same) wrong++
  console.log(
    `${flagged === c.same ? "  ok " : "  MISS"} ${p.toFixed(2)}  "${c.a}" vs "${c.b}" (${c.minutesAgo} min) want ${c.same ? "same" : "different"}`
  )
}
console.log(
  `\n${CASES.length - wrong}/${CASES.length} right at ≥ ${LIKELY_DUPLICATE}`
)
