/**
 * Live eval for people: which candidates are people, and the relation.
 *
 *   pnpm --filter @workspace/ai eval:people
 */
import { nameCandidates } from "@workspace/core/people"
import type { Direction } from "@workspace/core/preparse"
import { DEFAULT_DECISION_MODEL } from "../src/categorize"
import {
  AUTO_RELATION,
  type Relation,
  askPeople,
  resolvePeople,
} from "../src/people"

const model = process.env.DECISION_MODEL ?? DEFAULT_DECISION_MODEL

/** The owner's people, with what each owes them (cents). */
const KNOWN = [
  { id: "mara", name: "Mara", aliases: [], balance: 0 },
  { id: "ben", name: "Ben", aliases: [], balance: -100000 },
  { id: "x", name: "X", aliases: [], balance: 25000 },
]

interface Case {
  entry: string
  amount: number
  direction: Direction | null
  split?: number
  /** Acceptable relations; the first is the ideal. */
  want: Relation[]
  /** Names that should count as people. */
  people: string[]
}

const CASES: Case[] = [
  {
    entry: "lent mara",
    amount: 500,
    direction: "out",
    want: ["lent"],
    people: ["Mara"],
  },
  {
    entry: "lent ben for rent",
    amount: 3000,
    direction: "out",
    want: ["lent"],
    people: ["Ben"],
  },
  {
    entry: "pinahiram si carlo",
    amount: 1000,
    direction: "out",
    want: ["lent"],
    people: ["Carlo"],
  },
  {
    entry: "paid by x",
    amount: 250,
    direction: "in",
    want: ["repaid_me"],
    people: ["X"],
  },
  {
    entry: "mara paid me back",
    amount: 500,
    direction: "in",
    want: ["repaid_me"],
    people: ["Mara"],
  },
  {
    entry: "bayad ni ana",
    amount: 300,
    direction: "in",
    want: ["repaid_me"],
    people: ["Ana"],
  },
  {
    entry: "borrowed from mara",
    amount: 2000,
    direction: "in",
    want: ["borrowed"],
    people: ["Mara"],
  },
  {
    entry: "utang kay kuya jun",
    amount: 1500,
    direction: "in",
    want: ["borrowed"],
    people: ["Kuya Jun"],
  },
  {
    entry: "paid ben back",
    amount: 1000,
    direction: "out",
    want: ["i_repaid"],
    people: ["Ben"],
  },
  {
    entry: "dinner w/ mara and ben, i paid for all",
    amount: 3600,
    direction: "out",
    want: ["shared"],
    people: ["Mara", "Ben"],
  },
  {
    entry: "pizza with jo and sam, hatian",
    amount: 900,
    direction: "out",
    want: ["shared"],
    people: ["Jo", "Sam"],
  },
  {
    entry: "dinner w/ mara and ben",
    amount: 1200,
    direction: "out",
    want: ["own", "shared"],
    people: ["Mara", "Ben"],
  },
  {
    entry: "lunch with mara",
    amount: 350,
    direction: "out",
    want: ["own"],
    people: ["Mara"],
  },
  {
    entry: "salary from acme",
    amount: 45000,
    direction: "in",
    want: ["own"],
    people: [],
  },
  {
    entry: "birthday money from tita mel",
    amount: 1000,
    direction: "in",
    want: ["own"],
    people: ["Tita Mel"],
  },
  {
    entry: "grab to bgc",
    amount: 180,
    direction: "out",
    want: ["own"],
    people: [],
  },
  {
    entry: "allowance for mom",
    amount: 3000,
    direction: "out",
    want: ["own"],
    people: ["Mom"],
  },
  {
    entry: "airbnb with jo, sam and lee",
    amount: 8000,
    direction: "out",
    split: 4,
    want: ["shared"],
    people: ["Jo", "Sam", "Lee"],
  },
  // X owes the owner: that mustn't make a meal together look shared.
  {
    entry: "lunch with x",
    amount: 400,
    direction: "out",
    want: ["own"],
    people: ["X"],
  },
  // No sign: the relation should settle the direction.
  {
    entry: "lent mara",
    amount: 500,
    direction: null,
    want: ["lent"],
    people: ["Mara"],
  },
  {
    entry: "mara paid me back",
    amount: 500,
    direction: null,
    want: ["repaid_me"],
    people: ["Mara"],
  },
  {
    entry: "borrowed from ben",
    amount: 2000,
    direction: null,
    want: ["borrowed"],
    people: ["Ben"],
  },
]

let right = 0
let asked = 0
let wrongAuto = 0
let peopleRight = 0
const misses: string[] = []

await Promise.all(
  CASES.map(async (c) => {
    const candidates = nameCandidates(c.entry, KNOWN).map((n) => ({
      ...n,
      balance: KNOWN.find((k) => k.id === n.personId)?.balance ?? null,
    }))
    const line = { direction: c.direction, split: c.split ?? null }
    const signals = candidates.length
      ? await askPeople(model, {
          ...line,
          description: c.entry,
          amount: c.amount * 100,
          people: candidates,
        })
      : null
    const resolved = resolvePeople(line, signals, candidates)
    const found = resolved.people.map((i) => candidates[i]?.name).toSorted()
    if (JSON.stringify(found) === JSON.stringify(c.people.toSorted()))
      peopleRight++
    else
      misses.push(
        `  people   "${c.entry}" → [${found}] want [${c.people}] (p ${signals?.isPerson.map((p) => p.toFixed(2))})`
      )

    const ok = c.want.includes(resolved.relation)
    const top = signals
      ? Object.entries(signals.relation)
          .toSorted((a, b) => b[1] - a[1])
          .slice(0, 2)
          .map(([r, p]) => `${r} ${p}`)
          .join(", ")
      : "no model call"
    if (resolved.ask.length) {
      asked++
      if (!c.want.includes(resolved.ask[0]?.value ?? "own"))
        misses.push(
          `  ask      "${c.entry}" offers ${resolved.ask.map((a) => a.value)} want ${c.want} (${top})`
        )
    } else if (ok) right++
    else {
      wrongAuto++
      misses.push(
        `  relation "${c.entry}" ${c.direction ?? "unsigned"} → ${resolved.relation} want ${c.want} (${top})`
      )
    }
  })
)

const pct = (n: number) => `${Math.round((n / CASES.length) * 100)}%`
console.log(
  `\nPeople (${CASES.length} cases, relation auto at ≥ ${AUTO_RELATION})`
)
console.log(`  people found correctly   ${pct(peopleRight)}`)
console.log(`  relation right, no ask   ${pct(right)}`)
console.log(`  asked the owner          ${pct(asked)}`)
console.log(`  wrong without asking     ${wrongAuto}`)
console.log(misses.length ? `\nMisses\n${misses.join("\n")}` : "\nNo misses")
