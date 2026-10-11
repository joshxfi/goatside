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
  isNotNull,
  isNull,
  ne,
  sql,
} from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"
import {
  type AccountSignals,
  askAccounts,
  couldBeTransfer,
  needsAccountModel,
  resolveAccounts,
  unknownToAsk,
} from "@workspace/ai/accounts"
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
import { suggestRefiles } from "@workspace/ai/refile"
import { type KnownAccount, scanAccounts } from "@workspace/core/accounts"
import { addDays, todayIn } from "@workspace/core/dates"
import { nameCandidates } from "@workspace/core/people"
import type { Direction, DraftLine } from "@workspace/core/preparse"
import { type Db, schema } from "@workspace/db"
import { serverEnv } from "./env"
import { aiEnabled } from "./services"

const {
  accounts,
  categories,
  entries,
  people,
  questions,
  settings,
  transactions,
} = schema

const MODEL_TIMEOUT_MS = 6000
const EXAMPLE_POOL = 400
const EXAMPLES_PER_CATEGORY = 6
/** Earlier entries this recent can be duplicates of a new one. */
const DUPLICATE_LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000
const REPEAT_LOOKBACK_DAYS = 100
/** Lines decided at once; a statement import has dozens. */
const DECIDE_CHUNK = 10

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
  /** A "transfer" question: both sides, and the account if it's spending. */
  transfer?: { from: string; to: string; own: string | null }
  /** An "account" question: the name, and the words to drop once it's added. */
  newAccount?: { name: string; phrase: string }
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
export async function categoryOptions(db: Db): Promise<CategoryOption[]> {
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

/** Open accounts, and the one that unnamed entries go to. */
export async function accountBook(db: Db) {
  const [list, prefs] = await Promise.all([
    db
      .select({
        id: accounts.id,
        name: accounts.name,
        kind: accounts.kind,
        aliases: accounts.aliases,
      })
      .from(accounts)
      .where(eq(accounts.archived, false))
      .orderBy(accounts.sort, accounts.name),
    db.query.settings.findFirst({
      where: eq(settings.id, 1),
      columns: { defaultAccountId: true },
    }),
  ])
  const defaultId = prefs?.defaultAccountId ?? null
  return {
    known: list as KnownAccount[],
    defaultAccountId: list.some((a) => a.id === defaultId) ? defaultId : null,
  }
}

/** The account the last entry with this description was filed under. */
async function accountMemory(db: Db, description: string) {
  if (!description) return null
  const [row] = await db
    .select({ accountId: transactions.accountId })
    .from(transactions)
    .where(
      and(
        isNull(transactions.deletedAt),
        inArray(transactions.kind, ["expense", "income"]),
        isNotNull(transactions.accountId),
        sameDescription(description)
      )
    )
    .orderBy(desc(transactions.createdAt))
    .limit(1)
  return row?.accountId ?? null
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
  /** The description to save: account phrases removed, unless a transfer. */
  description: string
  account: {
    accountId: string | null
    toAccountId: string | null
    transfer: boolean
  }
}

/** `run` over `items`, `size` at a time, keeping the order. */
async function inChunks<T, R>(
  items: T[],
  size: number,
  run: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(run))))
  }
  return out
}

/**
 * Decides each line. Model calls for category, people and duplicates run in
 * parallel; any of them failing just means a less certain result.
 *
 * `accountId` is for statement rows: the statement already says which
 * account, so names in the details aren't read as accounts or people (a
 * bank's "Transfer to Nini Santos" isn't a loan to Nini).
 */
async function decide(
  db: Db,
  lines: DraftLine[],
  {
    checkDuplicates,
    accountId,
  }: { checkDuplicates: boolean; accountId?: string }
): Promise<Decision[]> {
  const [options, known, book] = await Promise.all([
    categoryOptions(db),
    peopleWithBalances(db),
    accountBook(db),
  ])
  const model = aiEnabled() ? serverEnv().DECISION_MODEL : null
  const imported = accountId !== undefined
  // A statement repeats itself ("Outbound interbank transfer" 35 times):
  // one category call per description and direction, not one per row.
  const asked = new Map<string, ReturnType<typeof askModel>>()
  const categorize = (
    m: NonNullable<typeof model>,
    line: Parameters<typeof askModel>[1],
    abortSignal: AbortSignal
  ) => {
    if (!imported) return askModel(m, line, options, { abortSignal })
    const key = `${line.direction}|${normalize(line.description)}`
    let pending = asked.get(key)
    if (!pending) {
      pending = askModel(m, line, options, { abortSignal })
      asked.set(key, pending)
    }
    return pending
  }

  return inChunks(lines, DECIDE_CHUNK, async (original): Promise<Decision> => {
    // Accounts first: "using gcash" says how it was paid, not what for,
    // so the category, people and memory only see the rest.
    const scan = imported
      ? null
      : scanAccounts(original.description, book.known)
    const draft = scan ? { ...original, description: scan.rest } : original
    const transferable =
      scan !== null && couldBeTransfer(scan, book.known, book.defaultAccountId)
    const line = {
      description: draft.description,
      amount: draft.share,
      direction: draft.signInferred ? null : draft.direction,
      split: draft.split,
    }
    const candidates: PersonInput[] = imported
      ? []
      : nameCandidates(draft.description, known).map((c) => ({
          ...c,
          balance: known.find((k) => k.id === c.personId)?.owed ?? null,
        }))
    const [memory, months, earlier, lastAccount] = await Promise.all([
      memoryFor(db, draft.description),
      priorMonths(db, draft),
      checkDuplicates ? earlierSameAmount(db, draft) : null,
      imported ? null : accountMemory(db, draft.description),
    ])
    // Duplicates compare like with like: the earlier row's signed amount.
    const asEarlier = earlier && { ...draft, amount: earlier.amount }
    const obvious = Boolean(
      earlier && asEarlier && obviousDuplicate(asEarlier, earlier)
    )

    const [signals, peopleSignals, pDuplicate, accountSignals] =
      await Promise.all([
        model && needsModel(line, memory)
          ? withTimeout("categorization", (abortSignal) =>
              categorize(model, line, abortSignal)
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
        model && scan && needsAccountModel(scan, transferable)
          ? withTimeout("accounts", (abortSignal) =>
              askAccounts(
                model,
                {
                  description: original.description,
                  amount: draft.amount,
                  direction: line.direction,
                  accounts: book.known,
                  unknown: unknownToAsk(scan),
                  transfer: transferable,
                },
                { abortSignal }
              )
            )
          : (null as AccountSignals | null),
      ])

    const resolved = resolveLine(
      { ...line, priorMonths: months },
      signals,
      memory,
      { candidates, signals: peopleSignals }
    )
    const filed = scan
      ? resolveAccounts(scan, book.known, {
          defaultAccountId: book.defaultAccountId,
          // Bills and subscriptions go on the same card each time.
          memoryAccountId: resolved.recurring ? lastAccount : null,
          borrowed: resolved.relation === "borrowed",
          signals: accountSignals,
        })
      : {
          accountId: accountId ?? null,
          toAccountId: null,
          transfer: false,
          questions: [],
        }
    if (filed.transfer) {
      // Moving money between accounts isn't spending: no category or IOUs.
      Object.assign(resolved, {
        categoryId: null,
        confidence: null,
        recurring: false,
        relation: "own",
        people: [],
        questions: filed.questions,
        status: filed.questions.length ? "needs_review" : "parsed",
      })
    } else if (filed.questions.length) {
      resolved.questions.push(...filed.questions)
      resolved.status = "needs_review"
    }

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
      description: filed.transfer ? original.description : draft.description,
      account: filed,
    }
  })
}

const findPerson = (db: Db, name: string) =>
  db.query.people.findFirst({
    where: sql`lower(${people.name}) = ${name.toLowerCase()}`,
    columns: { id: true },
  })

/**
 * `personId` if that person still exists. If they were merged away since,
 * whoever now goes by `name` (a merge keeps the old name as a nickname).
 */
async function stillThere(db: Db, personId: string, name: string) {
  const exists = await db.query.people.findFirst({
    where: eq(people.id, personId),
    columns: { id: true },
  })
  if (exists) return exists.id
  const key = name.trim().toLowerCase()
  const everyone = await db.query.people.findMany({
    columns: { id: true, name: true, aliases: true },
  })
  return everyone.find((p) =>
    [p.name, ...p.aliases].some((n) => n.trim().toLowerCase() === key)
  )?.id
}

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
    let id = candidate.personId
      ? await stillThere(db, candidate.personId, candidate.name)
      : (await findPerson(db, candidate.name))?.id
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
  base: {
    entryId: string | null
    localDate: string
    description: string
    accountId: string | null
    importRef?: string | null
  },
  personIds: Map<number, string>,
  primary?: Primary
) {
  const own = row.kind === "expense" || row.kind === "income"
  return {
    ...base,
    kind: row.kind,
    amount: row.amount,
    split: row.split,
    toAccountId: null,
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
        : draft.kind === "transfer"
          ? { ...context, transfer: { ...draft.transfer, own: draft.own } }
          : draft.kind === "account"
            ? {
                ...context,
                newAccount: { name: draft.name, phrase: draft.phrase },
              }
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
  /** Account names: where it was filed, or both sides of a transfer. */
  account: string | null
  transfer: { from: string; to: string } | null
  /** What the owner is asked about it, if anything (question kinds). */
  questions: QuestionDraft["kind"][]
}

/** Statement rows: where they go and what else lands in the same batch. */
export interface ImportedLines {
  /** The statement's account. Every line is filed there. */
  accountId: string
  /** Each line's statement fingerprint (`transactions.import_ref`). */
  refs: string[]
  /** More writes for the same batch (matched rows, transfers, the import). */
  extra: BatchItem<"sqlite">[]
}

/** Decides and saves every line of an entry, with any questions. */
export async function saveLines(
  db: Db,
  /** The entry to create; its rows and questions are written with it. */
  entry: { id: string; rawText: string },
  lines: DraftLine[],
  {
    checkDuplicates = true,
    imported,
  }: {
    /** False for a deliberate repeat (a quick pick): don't ask "again?". */
    checkDuplicates?: boolean
    imported?: ImportedLines
  } = {}
) {
  const [decisions, book] = await Promise.all([
    decide(db, lines, {
      checkDuplicates: checkDuplicates && !imported,
      accountId: imported?.accountId,
    }),
    accountBook(db),
  ])
  const entryId = entry.id
  const saved: SavedLine[] = []
  const transactionIds: string[] = []
  const rowsToInsert: (typeof transactions.$inferInsert)[] = []
  const questionsToInsert: (typeof questions.$inferInsert)[] = []
  let asked = false
  // Statement rows ask once per description and direction; answering it
  // files the rest of them too (`answer` in questions.server.ts).
  const askedAbout = new Set<string>()

  for (const [i, draft] of lines.entries()) {
    const decision = decisions[i]
    if (!decision) continue
    const { resolved, candidates, account } = decision
    const rows = account.transfer
      ? []
      : planRows(draft, resolved.direction, resolved.relation, resolved.people)
    const personIds = await ensurePeople(
      db,
      candidates,
      rows.flatMap((r) => (r.person === null ? [] : [r.person]))
    )
    const base = {
      entryId,
      localDate: draft.localDate,
      description: decision.description,
      accountId: account.accountId,
      importRef: imported?.refs[i] ?? null,
    }
    const values: (typeof transactions.$inferInsert)[] = account.transfer
      ? [
          {
            ...base,
            kind: "transfer" as const,
            // Always out of `accountId`, whatever sign was typed.
            amount: -draft.amount,
            toAccountId: account.toAccountId,
            status: resolved.status,
          },
        ]
      : rows.map((row, j) =>
          rowValues(row, base, personIds, j === 0 ? resolved : undefined)
        )
    // Ids chosen here, so questions can point at rows not yet written.
    if (imported && resolved.questions.length) {
      const key = `${resolved.direction}|${normalize(decision.description)}`
      if (askedAbout.has(key)) {
        resolved.questions = []
        if (values[0]) values[0].status = "parsed"
      }
      askedAbout.add(key)
    }
    const ids = values.map(() => crypto.randomUUID())
    rowsToInsert.push(...values.map((value, j) => ({ ...value, id: ids[j] })))
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
      questionsToInsert.push(
        ...resolved.questions.map((q) => questionRow(primary, q, context))
      )
    }
    const nameOf = (id: string | null) =>
      book.known.find((a) => a.id === id)?.name ?? null
    const from = nameOf(account.accountId)
    const to = nameOf(account.toAccountId)
    saved.push({
      amount: account.transfer ? -draft.amount : (rows[0]?.amount ?? 0),
      description: decision.description,
      categoryId: resolved.categoryId,
      relation: resolved.relation,
      people: resolved.people.flatMap((p) => candidates[p]?.name ?? []),
      account: from,
      transfer: account.transfer && from && to ? { from, to } : null,
      questions: resolved.questions.map((q) => q.kind),
    })
  }
  // One batch, so the entry, its rows and its questions land together or not
  // at all. The entry goes first: a second save of the same id fails on it.
  await db.batch([
    db.insert(entries).values({
      id: entry.id,
      rawText: entry.rawText,
      mode: "log",
    }),
    ...(rowsToInsert.length
      ? [db.insert(transactions).values(rowsToInsert)]
      : []),
    ...(questionsToInsert.length
      ? [db.insert(questions).values(questionsToInsert)]
      : []),
    ...(imported?.extra ?? []),
  ])
  return { saved, transactionIds, asked }
}

const REFILE_LOOKBACK_DAYS = 120
const REFILE_MAX_ENTRIES = 80

/**
 * Recent entries that now fit `categoryId` better than where they are, per
 * the decision model. Used right after a category is created.
 */
export async function suggestForCategory(db: Db, categoryId: string) {
  if (!aiEnabled()) return []
  const target = await db.query.categories.findFirst({
    where: eq(categories.id, categoryId),
  })
  if (!target) return []
  const prefs = await db.query.settings.findFirst({
    columns: { timeZone: true },
  })
  const since = addDays(
    todayIn(prefs?.timeZone ?? "Asia/Manila"),
    -REFILE_LOOKBACK_DAYS
  )

  const [options, recent] = await Promise.all([
    categoryOptions(db),
    db
      .select({
        id: transactions.id,
        description: transactions.description,
        amount: transactions.amount,
        localDate: transactions.localDate,
        categoryName: categories.name,
        categoryEmoji: categories.emoji,
      })
      .from(transactions)
      .leftJoin(categories, eq(categories.id, transactions.categoryId))
      .where(
        and(
          isNull(transactions.deletedAt),
          eq(transactions.kind, target.kind),
          ne(transactions.description, ""),
          gte(transactions.localDate, since),
          sql`${transactions.categoryId} is not ${target.id}`
        )
      )
      .orderBy(desc(transactions.localDate))
      .limit(REFILE_MAX_ENTRIES),
  ])

  const suggestions = await suggestRefiles(
    serverEnv().DECISION_MODEL,
    recent.map((r) => ({
      id: r.id,
      description: r.description,
      amount: Math.abs(r.amount),
      kind: target.kind,
    })),
    options,
    target.id,
    { abortSignal: AbortSignal.timeout(20_000) }
  )
  const byId = new Map(recent.map((r) => [r.id, r]))
  const found = suggestions.flatMap((s) => {
    const row = byId.get(s.id)
    return row
      ? [
          {
            id: row.id,
            description: row.description,
            amount: row.amount,
            localDate: row.localDate,
            from: row.categoryName
              ? `${row.categoryEmoji} ${row.categoryName}`
              : "Uncategorized",
            p: s.p,
          },
        ]
      : []
  })
  return found.toSorted((a, b) => b.localDate.localeCompare(a.localDate))
}
