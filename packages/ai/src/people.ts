/**
 * People in an entry: who's involved, and what the money is between you.
 * Candidates come from `@workspace/core/people` (cheap, over-inclusive);
 * the decision model judges them, in a call separate from categorizing so
 * the extra context doesn't sway the category.
 */
import {
  type Experimental_DecisionModel,
  type Experimental_DecisionQuestion,
  experimental_decide,
} from "ai"
import { formatMoney as peso } from "@workspace/core/money"
import type { Direction } from "@workspace/core/preparse"

export const RELATIONS = [
  "own",
  "lent",
  "borrowed",
  "repaid_me",
  "i_repaid",
  "shared",
] as const
export type Relation = (typeof RELATIONS)[number]

/** Which way the owner's money moves; null for "own" (the sign decides). */
export const RELATION_DIRECTION: Record<Relation, Direction | null> = {
  own: null,
  lent: "out",
  borrowed: "in",
  repaid_me: "in",
  i_repaid: "out",
  shared: "out",
}

/** A candidate counts as a person at or above this (known people always do). */
export const AUTO_PERSON = 0.6
/** At or above this, the top relation is applied without asking. */
export const AUTO_RELATION = 0.7

export interface PersonInput {
  name: string
  personId: string | null
  /** Cents they owe the owner (negative: the owner owes them). */
  balance: number | null
}

export interface PeopleSignals {
  /** P(person) per candidate, same order as the input; 1 for known people. */
  isPerson: number[]
  relation: Record<Relation, number>
}

const CRITERIA: Record<Relation, { what: string; examples: string[] }> = {
  own: {
    what: "The owner's own spending or income. Anyone named was just there, or is the employer, client or giver",
    examples: [
      "dinner with mara",
      "salary from acme",
      "birthday money from tita",
    ],
  },
  lent: {
    what: "The owner lent money to the person, or paid for something of theirs, and expects it back",
    examples: ["lent ben 500", "paid for joy's ticket", "pinahiram si carlo"],
  },
  borrowed: {
    what: "The person lent the owner money, or paid for the owner, and the owner should pay it back",
    examples: ["borrowed from mara", "ben paid for my lunch", "utang kay ana"],
  },
  repaid_me: {
    what: "The person paid the owner back money they owed",
    examples: ["paid by ben", "mara paid me back", "bayad ni ana"],
  },
  i_repaid: {
    what: "The owner paid the person back money the owner owed them",
    examples: ["paid mara back", "bayad kay ben", "settled with joy"],
  },
  shared: {
    what: "The owner paid a shared bill for themselves and others, who each owe their share",
    examples: [
      "dinner w/ mara and ben, i paid",
      "airbnb split 4",
      "pizza for the team, hatian",
    ],
  },
}

/**
 * A balance is only shown when it could explain this line as a repayment:
 * money in from someone who owes the owner, or out to someone the owner
 * owes. Shown otherwise, open balances bias the model toward IOUs (a group
 * dinner with friends who owe you reads as "shared" at 0.98).
 */
function balanceFor(person: PersonInput, direction: Direction | null) {
  const owed = person.balance ?? 0
  if (owed > 0 && direction !== "out") return `owes the owner ${peso(owed)}`
  if (owed < 0 && direction !== "in")
    return `the owner owes them ${peso(-owed)}`
  return null
}

/** One decide call: which candidates are people, and the relation. */
export async function askPeople(
  model: Experimental_DecisionModel,
  line: {
    description: string
    amount: number
    direction: Direction | null
    split: number | null
    people: PersonInput[]
  },
  { abortSignal }: { abortSignal?: AbortSignal } = {}
): Promise<PeopleSignals> {
  const questions: Record<string, Experimental_DecisionQuestion> = {
    relation: {
      type: "choice",
      instructions:
        "Between the owner of this ledger and the people named, what is this money?",
      criteria: CRITERIA,
    },
  }
  line.people.forEach((person, i) => {
    if (person.personId) return
    questions[`person${i}`] = {
      type: "boolean",
      instructions: `In this entry, is "${person.name}" a person (friend, family member, coworker) rather than a place, shop, app or thing?`,
    }
  })

  const { answers } = await experimental_decide({
    model,
    state: {
      entry: line.description,
      amount: peso(line.amount),
      sign:
        line.direction === "in"
          ? "money in"
          : line.direction === "out"
            ? "money out"
            : "not given",
      ...(line.split && { split: `${line.split} ways` }),
      people: line.people.map((p) => {
        const balance = balanceFor(p, line.direction)
        return balance ? { name: p.name, balance } : { name: p.name }
      }),
    },
    questions,
    abortSignal,
    maxRetries: 1,
  })

  const relation = Object.fromEntries(RELATIONS.map((r) => [r, 0])) as Record<
    Relation,
    number
  >
  const answer = answers.relation
  if (answer?.type === "choice") {
    for (const r of RELATIONS) {
      relation[r] = answer.probabilities?.[r] ?? (answer.choice === r ? 1 : 0)
    }
  }
  return {
    isPerson: line.people.map((person, i) => {
      if (person.personId) return 1
      const a = answers[`person${i}`]
      return a?.type === "boolean" ? a.probability : 0
    }),
    relation,
  }
}

export interface ResolvedPeople {
  relation: Relation
  /** Indexes into the input candidates that are people. */
  people: number[]
  /** Relation probabilities to offer when unsure, best first; empty when sure. */
  ask: { value: Relation; p: number }[]
  /** Set when the relation settled a direction the line didn't give. */
  direction: Direction | null
}

/**
 * Picks the relation. With a known direction, only relations that move
 * money that way are considered. Without one, a confident relation also
 * decides the direction. "split N" with people named is always shared.
 */
export function resolvePeople(
  line: { direction: Direction | null; split: number | null },
  signals: PeopleSignals | null,
  candidates: PersonInput[]
): ResolvedPeople {
  const people = candidates.flatMap((c, i) =>
    c.personId || (signals?.isPerson[i] ?? 0) >= AUTO_PERSON ? [i] : []
  )
  const none = { relation: "own" as const, people, ask: [], direction: null }
  if (!people.length) return { ...none, people: [] }
  if (line.split && line.split > 1 && line.direction !== "in") {
    return { relation: "shared", people, ask: [], direction: "out" }
  }
  if (!signals) return none

  const fits = (r: Relation) =>
    !line.direction ||
    RELATION_DIRECTION[r] === null ||
    RELATION_DIRECTION[r] === line.direction
  const total = RELATIONS.filter(fits).reduce(
    (s, r) => s + signals.relation[r],
    0
  )
  const ranked = RELATIONS.filter(fits)
    .map((r) => ({ value: r, p: total ? signals.relation[r] / total : 0 }))
    .toSorted((a, b) => b.p - a.p)
  const [top] = ranked
  if (!top) return none

  if (top.p >= AUTO_RELATION) {
    return {
      relation: top.value,
      people,
      ask: [],
      direction: line.direction ? null : RELATION_DIRECTION[top.value],
    }
  }
  // Unsure: keep it as the owner's own money and ask, always offering that.
  const others = ranked.filter((r) => r.value !== "own").slice(0, 2)
  const own = ranked.find((r) => r.value === "own") ?? {
    value: "own" as const,
    p: 0,
  }
  return { ...none, ask: [own, ...others].toSorted((a, b) => b.p - a.p) }
}

export interface PlannedRow {
  kind: "expense" | "income" | "lend" | "settle"
  /** Signed cents. */
  amount: number
  /** Index into the resolved people, or null for the owner's own row. */
  person: number | null
  split: number | null
}

/** Splits `total` into `n` parts that add up exactly; remainder goes first. */
export function shares(total: number, n: number): number[] {
  const base = Math.floor(total / n)
  return Array.from(
    { length: n },
    (_, i) => base + (i < total - base * n ? 1 : 0)
  )
}

/**
 * The transactions a line becomes. The first row is the primary one (it
 * carries the category and the questions); the rest are IOUs.
 */
export function planRows(
  /** `amount` is the full amount; `share` the owner's part when split. */
  line: { amount: number; share: number; split: number | null },
  direction: Direction,
  relation: Relation,
  people: number[]
): PlannedRow[] {
  const sign = direction === "in" ? 1 : -1
  if (relation === "own" || !people.length) {
    return [
      {
        kind: direction === "in" ? "income" : "expense",
        amount: sign * line.share,
        person: null,
        split: line.split,
      },
    ]
  }
  if (relation === "shared") {
    const n = line.split && line.split > 1 ? line.split : people.length + 1
    const parts = shares(line.amount, n)
    return [
      { kind: "expense", amount: -(parts[0] ?? 0), person: null, split: n },
      ...people.slice(0, n - 1).map((person, i) => ({
        kind: "lend" as const,
        amount: -(parts[i + 1] ?? 0),
        person,
        split: null,
      })),
    ]
  }
  const kind =
    relation === "lent" || relation === "borrowed" ? "lend" : "settle"
  const parts = shares(line.amount, people.length)
  return people.map((person, i) => ({
    kind,
    amount: sign * (parts[i] ?? 0),
    person,
    split: null,
  }))
}

/** What a person owes the owner, from their lend/settle rows. */
export const owedBy = (amounts: number[]) =>
  0 - amounts.reduce((s, a) => s + a, 0)
