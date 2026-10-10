/**
 * The logging agent: decides how each line is filed (category, direction,
 * people, repeats, duplicates) and saves it, with questions for whatever
 * it isn't sure of. Server-only.
 */
import {
  and,
  between,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  ne,
  sql,
} from "drizzle-orm"
import {
  type CategoryOption,
  type Memory,
  type QuestionDraft,
  type Ranked,
  type Resolved,
  askModel,
  needsModel,
  resolveLine,
} from "@workspace/ai/categorize"
import {
  type EarlierEntry,
  LIKELY_DUPLICATE,
  askDuplicate,
  obviousDuplicate,
} from "@workspace/ai/duplicates"
import {
  type PersonInput,
  type PlannedRow,
  askPeople,
  owedBy,
  planRows,
} from "@workspace/ai/people"
import { addDays } from "@workspace/core/dates"
import { nameCandidates } from "@workspace/core/people"
import type { Direction, DraftLine } from "@workspace/core/preparse"
import { type Db, schema } from "@workspace/db"
import { serverEnv } from "./env"
import { aiEnabled } from "./services"

const { categories, people, questions, transactions } = schema

const MODEL_TIMEOUT_MS = 6000
const EXAMPLE_POOL = 400
const EXAMPLES_PER_CATEGORY = 6
/** Earlier entries this recent can be duplicates of a new one. */
const DUPLICATE_LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000
const REPEAT_LOOKBACK_DAYS = 100

export const normalize = (description: string) =>
  description.trim().toLowerCase().replace(/\s+/g, " ")

export const directionOf = (amount: number): Direction =>
  amount > 0 ? "in" : "out"

/** Everything a question needs to redo its line, stored with the question. */
export interface LineContext {
  line: { amount: number; share: number; split: number | null }
  candidates: { name: string; personId: string | null }[]
  /** Indexes of candidates that are people. */
  people: number[]
  rankings: Record<Direction, Ranked[]>
  /** The line's rows; the first is the one questions hang off. */
  transactionIds: string[]
  earlier?: EarlierEntry
}

function withTimeout<T>(
  label: string,
  run: (abortSignal: AbortSignal) => Promise<T>
): Promise<T | null> {
  return run(AbortSignal.timeout(MODEL_TIMEOUT_MS)).catch((error: unknown) => {
    console.error(`[goatside] ${label} failed:`, error)
    return null
  })
}

const sameDescription = (description: string) =>
  sql`lower(trim(${transactions.description})) = ${normalize(description)}`

/** Active categories, each with recent descriptions filed under it. */
async function categoryOptions(db: Db): Promise<CategoryOption[]> {
  const [active, recent] = await Promise.all([
    db
      .select({
        id: categories.id,
        name: categories.name,
        kind: categories.kind,
      })
      .from(categories)
      .where(eq(categories.archived, false))
      .orderBy(categories.kind, categories.sort),
    db
      .select({
        categoryId: transactions.categoryId,
        description: transactions.description,
      })
      .from(transactions)
      .where(
        and(
          isNull(transactions.deletedAt),
          ne(transactions.description, ""),
          inArray(transactions.status, ["confirmed", "parsed"])
        )
      )
      // Owner-confirmed rows first: they're the ground truth.
      .orderBy(
        sql`${transactions.status} = 'confirmed' desc`,
        desc(transactions.createdAt)
      )
      .limit(EXAMPLE_POOL),
  ])

  const examples = new Map<string, Set<string>>()
  for (const row of recent) {
    if (!row.categoryId) continue
    const set = examples.get(row.categoryId) ?? new Set()
    if (set.size < EXAMPLES_PER_CATEGORY) set.add(normalize(row.description))
    examples.set(row.categoryId, set)
  }
  return active.map((c) => ({
    ...c,
    examples: [...(examples.get(c.id) ?? [])],
  }))
}

/** Everyone the owner has, with what they owe (centavos; negative: owner owes). */
export async function peopleWithBalances(db: Db) {
  const [rows, sums] = await Promise.all([
    db
      .select({ id: people.id, name: people.name, aliases: people.aliases })
      .from(people)
      .orderBy(people.name),
    db
      .select({
        personId: transactions.personId,
        total: sql<number>`sum(${transactions.amount})`,
      })
      .from(transactions)
      .where(
        and(
          isNull(transactions.deletedAt),
          inArray(transactions.kind, ["lend", "settle"])
        )
      )
      .groupBy(transactions.personId),
  ])
  const totals = new Map(sums.map((s) => [s.personId, Number(s.total)]))
  return rows.map((p) => ({ ...p, owed: owedBy([totals.get(p.id) ?? 0]) }))
}

/** The newest owner-confirmed transaction with the same description. */
async function memoryFor(db: Db, description: string): Promise<Memory | null> {
  if (!description) return null
  const [row] = await db
    .select({
      amount: transactions.amount,
      categoryId: transactions.categoryId,
      recurring: transactions.recurring,
    })
    .from(transactions)
    .where(
      and(
        isNull(transactions.deletedAt),
        eq(transactions.status, "confirmed"),
        inArray(transactions.kind, ["expense", "income"]),
        sameDescription(description)
      )
    )
    .orderBy(desc(transactions.updatedAt))
    .limit(1)
  return row
    ? {
        direction: directionOf(row.amount),
        categoryId: row.categoryId,
        recurring: row.recurring,
      }
    : null
}

/** Earlier months with the same description and an amount within 15%. */
async function priorMonths(db: Db, line: DraftLine): Promise<number> {
  if (!line.description) return 0
  const [row] = await db
    .select({
      months: sql<number>`count(distinct substr(${transactions.localDate}, 1, 7))`,
    })
    .from(transactions)
    .where(
      and(
        isNull(transactions.deletedAt),
        inArray(transactions.kind, ["expense", "income"]),
        sameDescription(line.description),
        // From ~3 months back up to (not including) this line's month.
        between(
          transactions.localDate,
          addDays(line.localDate, -REPEAT_LOOKBACK_DAYS),
          `${line.localDate.slice(0, 7)}-00`
        ),
        sql`abs(${transactions.amount}) between ${Math.floor(line.share * 0.85)} and ${Math.ceil(line.share * 1.15)}`
      )
    )
  return Number(row?.months ?? 0)
}

/** The latest entry with the same amount around the same day, if any. */
async function earlierSameAmount(
  db: Db,
  line: DraftLine
): Promise<EarlierEntry | null> {
  const [row] = await db
    .select({
      description: transactions.description,
      amount: transactions.amount,
      localDate: transactions.localDate,
      createdAt: transactions.createdAt,
    })
    .from(transactions)
    .where(
      and(
        isNull(transactions.deletedAt),
        inArray(transactions.kind, ["expense", "income"]),
        sql`abs(${transactions.amount}) = ${line.share}`,
        between(
          transactions.localDate,
          addDays(line.localDate, -2),
          addDays(line.localDate, 2)
        ),
        gte(
          transactions.createdAt,
          new Date(Date.now() - DUPLICATE_LOOKBACK_MS)
        )
      )
    )
    .orderBy(desc(transactions.createdAt))
    .limit(1)
  return row
    ? {
        description: row.description,
        amount: row.amount,
        localDate: row.localDate,
        minutesAgo: (Date.now() - row.createdAt.getTime()) / 60000,
      }
    : null
}

interface Decision {
  resolved: Resolved
  candidates: PersonInput[]
  rankings: Record<Direction, Ranked[]>
}

/**
 * Decides each line. Model calls for category, people and duplicates run in
 * parallel; any of them failing just means a less certain result.
 */
async function decide(db: Db, lines: DraftLine[]): Promise<Decision[]> {
  const [options, known] = await Promise.all([
    categoryOptions(db),
    peopleWithBalances(db),
  ])
  const model = aiEnabled() ? serverEnv().DECISION_MODEL : null

  return Promise.all(
    lines.map(async (draft): Promise<Decision> => {
      const line = {
        description: draft.description,
        amount: draft.share,
        direction: draft.signInferred ? null : draft.direction,
        split: draft.split,
      }
      const candidates: PersonInput[] = nameCandidates(
        draft.description,
        known
      ).map((c) => ({
        ...c,
        balance: known.find((k) => k.id === c.personId)?.owed ?? null,
      }))
      const [memory, months, earlier] = await Promise.all([
        memoryFor(db, draft.description),
        priorMonths(db, draft),
        earlierSameAmount(db, draft),
      ])
      // Duplicates compare like with like: the earlier row's signed amount.
      const asEarlier = earlier && { ...draft, amount: earlier.amount }
      const obvious = Boolean(
        earlier && asEarlier && obviousDuplicate(asEarlier, earlier)
      )

      const [signals, peopleSignals, pDuplicate] = await Promise.all([
        model && needsModel(line, memory)
          ? withTimeout("categorization", (abortSignal) =>
              askModel(model, line, options, { abortSignal })
            )
          : null,
        model && candidates.length
          ? withTimeout("people", (abortSignal) =>
              askPeople(
                model,
                { ...line, amount: draft.amount, people: candidates },
                { abortSignal }
              )
            )
          : null,
        model && earlier && asEarlier && !obvious
          ? withTimeout("duplicate check", (abortSignal) =>
              askDuplicate(model, asEarlier, earlier, { abortSignal })
            )
          : null,
      ])

      const resolved = resolveLine(
        { ...line, priorMonths: months },
        signals,
        memory,
        { candidates, signals: peopleSignals }
      )

      // A likely repeat in the same direction replaces the other questions:
      // if it's a repeat, the rest doesn't matter.
      const sameSide =
        earlier && directionOf(earlier.amount) === resolved.direction
      if (
        earlier &&
        sameSide &&
        (obvious || (pDuplicate ?? 0) >= LIKELY_DUPLICATE)
      ) {
        resolved.questions = [
          {
            kind: "duplicate",
            guess: "keep",
            options: [
              { value: "keep", p: pDuplicate === null ? null : 1 - pDuplicate },
              { value: "remove", p: pDuplicate },
            ],
            earlier,
          },
        ]
        resolved.status = "needs_review"
      }

      return {
        resolved,
        candidates,
        rankings: { in: signals?.income ?? [], out: signals?.expense ?? [] },
      }
    })
  )
}

const findPerson = (db: Db, name: string) =>
  db.query.people.findFirst({
    where: sql`lower(${people.name}) = ${name.toLowerCase()}`,
    columns: { id: true },
  })

/** Ids for the people rows need, creating anyone new. */
export async function ensurePeople(
  db: Db,
  candidates: { name: string; personId: string | null }[],
  indexes: number[]
): Promise<Map<number, string>> {
  const ids = new Map<number, string>()
  for (const i of new Set(indexes)) {
    const candidate = candidates[i]
    if (!candidate) continue
    let id = candidate.personId ?? (await findPerson(db, candidate.name))?.id
    if (!id) {
      const [created] = await db
        .insert(people)
        .values({ name: candidate.name })
        .onConflictDoNothing()
        .returning({ id: people.id })
      // Lost a race on the unique name: the other insert's row is ours too.
      id = created?.id ?? (await findPerson(db, candidate.name))?.id
    }
    if (id) ids.set(i, id)
  }
  return ids
}

type Primary = Pick<Resolved, "categoryId" | "confidence" | "recurring"> & {
  status: (typeof schema.TRANSACTION_STATUSES)[number]
}

/** Column values for a planned row; the primary row carries the decision. */
export function rowValues(
  row: PlannedRow,
  base: { entryId: string | null; localDate: string; description: string },
  personIds: Map<number, string>,
  primary?: Primary
) {
  const own = row.kind === "expense" || row.kind === "income"
  return {
    ...base,
    kind: row.kind,
    amount: row.amount,
    split: row.split,
    personId: row.person === null ? null : (personIds.get(row.person) ?? null),
    categoryId: own ? (primary?.categoryId ?? null) : null,
    aiConfidence: own ? (primary?.confidence ?? null) : null,
    recurring: own ? (primary?.recurring ?? false) : false,
    status: primary?.status ?? ("parsed" as const),
  }
}

export function questionRow(
  transactionId: string,
  draft: QuestionDraft,
  context: LineContext
) {
  return {
    transactionId,
    kind: draft.kind,
    guess: draft.guess,
    options: draft.options,
    context:
      draft.kind === "duplicate"
        ? { ...context, earlier: draft.earlier }
        : context,
  }
}

export interface SavedLine {
  /** The primary row's signed amount: the owner's own side. */
  amount: number
  description: string
  categoryId: string | null
  relation: Resolved["relation"]
  people: string[]
}

/** Decides and saves every line of an entry, with any questions. */
export async function saveLines(db: Db, entryId: string, lines: DraftLine[]) {
  const decisions = await decide(db, lines)
  const saved: SavedLine[] = []
  const transactionIds: string[] = []
  let asked = false

  for (const [i, draft] of lines.entries()) {
    const decision = decisions[i]
    if (!decision) continue
    const { resolved, candidates } = decision
    const rows = planRows(
      draft,
      resolved.direction,
      resolved.relation,
      resolved.people
    )
    const personIds = await ensurePeople(
      db,
      candidates,
      rows.flatMap((r) => (r.person === null ? [] : [r.person]))
    )
    const base = {
      entryId,
      localDate: draft.localDate,
      description: draft.description,
    }
    const inserted = await db
      .insert(transactions)
      .values(
        rows.map((row, j) =>
          rowValues(row, base, personIds, j === 0 ? resolved : undefined)
        )
      )
      .returning({ id: transactions.id })
    const ids = inserted.map((t) => t.id)
    transactionIds.push(...ids)
    const [primary] = ids
    if (!primary) continue

    if (resolved.questions.length) {
      asked = true
      const context: LineContext = {
        line: { amount: draft.amount, share: draft.share, split: draft.split },
        candidates: candidates.map((c, j) => ({
          name: c.name,
          personId: personIds.get(j) ?? c.personId,
        })),
        people: resolved.people,
        rankings: decision.rankings,
        transactionIds: ids,
      }
      await db
        .insert(questions)
        .values(resolved.questions.map((q) => questionRow(primary, q, context)))
    }
    saved.push({
      amount: rows[0]?.amount ?? 0,
      description: draft.description,
      categoryId: resolved.categoryId,
      relation: resolved.relation,
      people: resolved.people.flatMap((p) => candidates[p]?.name ?? []),
    })
  }
  return { saved, transactionIds, asked }
}
