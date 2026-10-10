/**
 * Categorization with a decision model (TypeSafe's Jev by default, through
 * AI Gateway). A decision model doesn't write text: it answers typed
 * questions (choice / boolean) with probabilities, which is exactly what
 * "which category is this?" and "is this money in or out?" are.
 *
 * Two steps, so the policy is testable without a model:
 * - `askModel` sends one decide call per line and returns raw probabilities.
 * - `resolveLine` turns those (plus what the owner taught us before) into
 *   the saved values and, when unsure, questions for the owner.
 */
import {
  type Experimental_DecisionModel,
  type Experimental_DecisionQuestion,
  experimental_decide,
} from "ai"
import type { Direction } from "@workspace/core/preparse"

export const DEFAULT_DECISION_MODEL = "typesafe-ai/jev"

/** At or above this, a sign-less line's direction is applied without asking. */
export const AUTO_DIRECTION = 0.85
/** At or above this, the top category is applied without asking. */
export const AUTO_CATEGORY = 0.6
/** At or above this, a line is marked recurring. */
export const RECURRING = 0.8

export type CategoryKind = "expense" | "income"

export interface CategoryOption {
  id: string
  name: string
  kind: CategoryKind
  /** Past descriptions the owner filed here, newest first. */
  examples: string[]
}

export interface LineInput {
  description: string
  /** Absolute amount in centavos. */
  amount: number
  /** From an explicit + or −; null when the owner didn't say. */
  direction: Direction | null
}

export interface Ranked {
  id: string
  p: number
}

/** What the model said about one line. Any field can be missing. */
export interface Signals {
  /** P(money in), only asked when the line had no sign. */
  pIn?: number
  /** Categories by probability, highest first. */
  expense?: Ranked[]
  income?: Ranked[]
  /** P(recurring charge or income). */
  recurring?: number
}

/** A past transaction with the same description that the owner confirmed. */
export interface Memory {
  direction: Direction
  categoryId: string | null
  recurring: boolean
}

/** Built-in hints for the default categories; custom ones go by name. */
const HINTS: Record<string, string> = {
  "expense:food": "Meals, snacks, coffee, drinks, restaurants, food delivery",
  "expense:groceries": "Supermarket, market, household supplies, toiletries",
  "expense:transport":
    "Grab, taxi, jeep, bus, train, fuel, parking, tolls, flights",
  "expense:bills":
    "Electricity, water, internet, phone load and plans, rent, utilities",
  "expense:subscriptions":
    "Streaming, apps, software, memberships billed regularly",
  "expense:shopping": "Clothes, gadgets, online orders, things for the home",
  "expense:health": "Medicine, doctor, dentist, hospital, gym, wellness",
  "expense:fun": "Movies, games, concerts, hobbies, trips, nights out",
  "expense:others": "Anything that fits no other spending category",
  "income:salary": "Pay from an employer, payroll, 13th month, bonus",
  "income:freelance": "Client work, gigs, commissions, side projects",
  "income:gifts": "Money given as a gift, allowance, ang pao, birthday money",
  "income:others":
    "Refunds, reimbursements, money paid back, sales, anything else",
}

const MAX_EXAMPLES = 6

function criteriaFor(categories: CategoryOption[]) {
  const keys = new Map<string, string>()
  const criteria: Record<string, { what: string; examples?: string[] }> = {}
  categories.forEach((category, i) => {
    const key = `c${i}`
    keys.set(key, category.id)
    const hint = HINTS[`${category.kind}:${category.name.trim().toLowerCase()}`]
    criteria[key] = {
      what: hint ? `${category.name}: ${hint}` : category.name,
      ...(category.examples.length && {
        examples: category.examples.slice(0, MAX_EXAMPLES),
      }),
    }
  })
  return { keys, criteria }
}

function ranked(
  probabilities: Record<string, number> | undefined,
  choice: string,
  keys: Map<string, string>
): Ranked[] {
  const entries = probabilities
    ? Object.entries(probabilities)
    : [[choice, 1] as [string, number]]
  return entries
    .flatMap(([key, p]) => {
      const id = keys.get(key)
      return id ? [{ id, p }] : []
    })
    .toSorted((a, b) => b.p - a.p)
}

export function peso(centavos: number) {
  return `₱${(centavos / 100).toLocaleString("en-PH", { maximumFractionDigits: 2 })}`
}

/**
 * One decide call for one line. Only asks what the line needs: direction
 * when there's no sign, and the category list(s) for the possible kinds.
 */
export async function askModel(
  model: Experimental_DecisionModel,
  line: LineInput,
  categories: CategoryOption[],
  { abortSignal }: { abortSignal?: AbortSignal } = {}
): Promise<Signals> {
  const kinds: CategoryKind[] =
    line.direction === "in"
      ? ["income"]
      : line.direction === "out"
        ? ["expense"]
        : ["expense", "income"]

  const questions: Record<string, Experimental_DecisionQuestion> = {
    recurring: {
      type: "boolean",
      instructions:
        "Does this repeat on a schedule, like a subscription, rent, a monthly bill or a salary?",
    },
  }
  if (!line.direction) {
    questions.direction = {
      type: "choice",
      instructions:
        "Did the owner of this personal ledger spend money or receive money?",
      criteria: {
        out: {
          what: "Money the owner paid, spent, gave or lent",
          examples: ["lunch", "grab home", "meralco bill", "gave mom 1k"],
        },
        in: {
          what: "Money the owner received or was paid back",
          examples: ["salary", "paid by x", "refund from shopee", "sold bike"],
        },
      },
    }
  }
  const keyMaps: Partial<Record<CategoryKind, Map<string, string>>> = {}
  for (const kind of kinds) {
    const options = categories.filter((c) => c.kind === kind)
    if (!options.length) continue
    const { keys, criteria } = criteriaFor(options)
    keyMaps[kind] = keys
    questions[kind] = {
      type: "choice",
      instructions:
        kind === "expense"
          ? "Which spending category fits this expense best?"
          : "Which income category fits this money received best?",
      criteria,
    }
  }

  const { answers } = await experimental_decide({
    model,
    state: {
      entry: line.description || "(no description)",
      amount: peso(line.amount),
    },
    questions,
    abortSignal,
    maxRetries: 1,
  })

  const signals: Signals = {}
  const recurring = answers.recurring
  if (recurring?.type === "boolean") signals.recurring = recurring.probability
  const direction = answers.direction
  if (direction?.type === "choice") {
    signals.pIn =
      direction.probabilities?.in ?? (direction.choice === "in" ? 1 : 0)
  }
  for (const kind of kinds) {
    const answer = answers[kind]
    const keys = keyMaps[kind]
    if (answer?.type === "choice" && keys) {
      signals[kind] = ranked(answer.probabilities, answer.choice, keys)
    }
  }
  return signals
}

export type QuestionDraft =
  | {
      kind: "direction"
      guess: Direction
      options: { value: Direction; p: number | null }[]
      /** Category rankings for each answer, so answering can file it too. */
      rankings: { in: Ranked[]; out: Ranked[] }
    }
  | {
      kind: "category"
      guess: string
      options: { value: string; p: number }[]
    }

export interface Resolved {
  direction: Direction
  categoryId: string | null
  /** Probability of the applied category, or 1 when it came from memory. */
  confidence: number | null
  recurring: boolean
  status: "pending" | "parsed" | "needs_review"
  questions: QuestionDraft[]
}

export const kindOf = (direction: Direction): CategoryKind =>
  direction === "in" ? "income" : "expense"

/** The category question to ask when the top guess is below the bar. */
export function categoryQuestion(ranking: Ranked[]): QuestionDraft | null {
  const [top] = ranking
  if (!top || top.p >= AUTO_CATEGORY) return null
  return {
    kind: "category",
    guess: top.id,
    options: ranking.slice(0, 3).map((r) => ({ value: r.id, p: r.p })),
  }
}

/**
 * Decides what to save for a line. Order of trust: the owner's explicit
 * sign, then what they confirmed for the same description before, then the
 * model. Whatever stays uncertain becomes a question; the line is still
 * saved with the best guess so logging never blocks.
 */
export function resolveLine(
  line: LineInput,
  signals: Signals | null,
  memory: Memory | null
): Resolved {
  const questions: QuestionDraft[] = []
  const rankings = { in: signals?.income ?? [], out: signals?.expense ?? [] }

  let direction: Direction
  let directionSure = true
  if (line.direction) {
    direction = line.direction
  } else if (memory) {
    direction = memory.direction
  } else if (signals?.pIn !== undefined) {
    direction = signals.pIn >= 0.5 ? "in" : "out"
    directionSure = Math.max(signals.pIn, 1 - signals.pIn) >= AUTO_DIRECTION
  } else {
    direction = "out"
    directionSure = false
  }

  if (!directionSure) {
    const pIn = signals?.pIn ?? null
    questions.push({
      kind: "direction",
      guess: direction,
      options: [
        { value: "out", p: pIn === null ? null : 1 - pIn },
        { value: "in", p: pIn },
      ],
      rankings,
    })
  }

  let categoryId: string | null = null
  let confidence: number | null = null
  const useMemory = memory && memory.direction === direction
  if (useMemory && memory.categoryId) {
    categoryId = memory.categoryId
    confidence = 1
  } else {
    const [top] = rankings[direction]
    if (top) {
      categoryId = top.id
      confidence = top.p
      // One question at a time: the category follows a direction answer.
      if (directionSure) {
        const question = categoryQuestion(rankings[direction])
        if (question) questions.push(question)
      }
    }
  }

  return {
    direction,
    categoryId,
    confidence,
    recurring:
      signals?.recurring !== undefined
        ? signals.recurring >= RECURRING
        : (memory?.recurring ?? false),
    status: questions.length
      ? "needs_review"
      : signals || useMemory
        ? "parsed"
        : "pending",
    questions,
  }
}

/** False when the sign and the owner's past answer already settle the line. */
export function needsModel(line: LineInput, memory: Memory | null): boolean {
  if (!memory?.categoryId) return true
  return line.direction !== null && line.direction !== memory.direction
}
