/**
 * Ask mode's IOU tools: who owes what, IOU history, and recording loans and
 * repayments. These take structured input, so the chat model's reading of
 * "ben paid for my lunch" is saved as it read it. Written as composer text,
 * the decision model would read the line again and could get it wrong.
 * Server-only.
 */
import { tool } from "ai"
import { and, between, desc, eq, inArray, isNull } from "drizzle-orm"
import { z } from "zod"
import { formatPeso } from "@workspace/core/money"
import { type Db, schema } from "@workspace/db"
import { accountBook, peopleWithBalances } from "./agent.server"
import { today } from "./ledger.server"

const { accounts, people, transactions } = schema

const IOU_KINDS = ["lend", "settle"] as const
const HISTORY = 10
const MAX_ROWS = 25

const DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("YYYY-MM-DD in the owner's timezone")

type Person = Awaited<ReturnType<typeof peopleWithBalances>>[number]

const money = (centavos: number) => ({
  pesos: Math.round(centavos) / 100,
  text: formatPeso(centavos),
})
const centavos = (pesos: number) => Math.round(pesos * 100)

/** "Mara's", "kay Ben", "  JUDE " → the name to look up. */
function nameKey(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/^(kay|kina|si|sina|ni|nina)\s+/, "")
    .replace(/['’]s$/, "")
    .replace(/\s+/g, " ")
}

/**
 * A person by name or nickname: an exact match first, then one whose first
 * name matches ("mara b" finds Mara), but only when that's unambiguous.
 */
export function matchPerson(everyone: Person[], name: string): Person | null {
  const key = nameKey(name)
  if (!key) return null
  const names = (p: Person) =>
    [p.name, ...p.aliases].map((n) => n.trim().toLowerCase())
  const exact = everyone.find((p) => names(p).includes(key))
  if (exact) return exact
  const first = key.split(" ")[0] ?? key
  const loose = everyone.filter((p) =>
    names(p).some((n) => n.split(" ")[0] === first)
  )
  return loose.length === 1 ? (loose[0] ?? null) : null
}

const display = (name: string) =>
  name === name.toLowerCase()
    ? name.replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase())
    : name

/**
 * Where someone stands with the owner, in words: about the owner for the
 * model, or to them ("you") on a confirmation card.
 */
export function standing(p: Pick<Person, "name" | "owed">, toOwner = false) {
  const owner = toOwner ? "you" : "the owner"
  return p.owed > 0
    ? `${p.name} owes ${owner} ${formatPeso(p.owed)}`
    : p.owed < 0
      ? `${owner} ${toOwner ? "owe" : "owes"} ${p.name} ${formatPeso(-p.owed)}`
      : toOwner
        ? `you and ${p.name} are square`
        : `${p.name} and the owner are square`
}

/** One IOU row from the owner's side: what happened, and what it did. */
function iouWhat(kind: string, amount: number, name: string) {
  if (kind === "lend")
    return amount < 0
      ? `the owner lent ${name} money or paid for them`
      : `${name} lent the owner money or paid for them`
  return amount > 0
    ? `${name} paid the owner back`
    : `the owner paid ${name} back`
}

const unknownPerson = (name: string, everyone: Person[]) =>
  `No one called "${name}". People: ${everyone.map((p) => p.name).join(", ") || "none yet"}.`

async function iouRows(
  db: Db,
  where: {
    personId?: string
    from?: string
    to?: string
  },
  limit: number
) {
  return db
    .select({
      date: transactions.localDate,
      kind: transactions.kind,
      amount: transactions.amount,
      description: transactions.description,
      name: people.name,
      account: accounts.name,
    })
    .from(transactions)
    .innerJoin(people, eq(people.id, transactions.personId))
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(
      and(
        isNull(transactions.deletedAt),
        inArray(transactions.kind, [...IOU_KINDS]),
        where.personId ? eq(transactions.personId, where.personId) : undefined,
        where.from && where.to
          ? between(transactions.localDate, where.from, where.to)
          : undefined
      )
    )
    .orderBy(desc(transactions.localDate), desc(transactions.createdAt))
    .limit(limit)
}

type IouRow = Awaited<ReturnType<typeof iouRows>>[number]

const entry = (r: IouRow) => ({
  date: r.date,
  what: iouWhat(r.kind, r.amount, r.name),
  amount: money(Math.abs(r.amount)),
  ...(r.description && { note: r.description }),
  ...(r.account && { account: r.account }),
})

export function peopleTools(db: Db) {
  return {
    balances: tool({
      description:
        "Where the owner stands with people right now: who owes the owner, whom the owner owes, and each person's latest IOUs (loans, repayments, their shares of bills). Use it for 'who owes me', 'how much does X owe me', 'do I owe anyone', 'my history with X'.",
      inputSchema: z.object({
        person: z.string().optional().describe("Only this person, by name"),
      }),
      execute: async ({ person }) => {
        const everyone = await peopleWithBalances(db)
        if (person) {
          const found = matchPerson(everyone, person)
          if (!found)
            return { found: false, message: unknownPerson(person, everyone) }
          const recent = await iouRows(db, { personId: found.id }, HISTORY)
          return {
            name: found.name,
            standing: standing(found),
            owesOwner: money(found.owed),
            history: recent.map(entry),
          }
        }
        const open = everyone.filter((p) => p.owed !== 0)
        return {
          owedToOwner: money(
            open.filter((p) => p.owed > 0).reduce((s, p) => s + p.owed, 0)
          ),
          ownerOwes: money(
            open.filter((p) => p.owed < 0).reduce((s, p) => s - p.owed, 0)
          ),
          people: open.map((p) => ({
            name: p.name,
            standing: standing(p),
          })),
          square: everyone.filter((p) => p.owed === 0).map((p) => p.name),
        }
      },
    }),
    iouActivity: tool({
      description:
        "IOU entries in a date range, with totals: what the owner lent or paid for others, borrowed or had paid for them, and repayments both ways. Use it for 'how much did I lend this month', 'when did X pay me back', 'who did I lend to last week'. Spending totals leave these out.",
      inputSchema: z.object({
        from: DATE,
        to: DATE,
        person: z.string().optional().describe("Only this person, by name"),
      }),
      execute: async ({ from, to, person }) => {
        const everyone = await peopleWithBalances(db)
        const found = person ? matchPerson(everyone, person) : null
        if (person && !found)
          return { found: false, message: unknownPerson(person, everyone) }
        const rows = await iouRows(db, { personId: found?.id, from, to }, 1000)
        const sum = (keep: (r: IouRow) => boolean) =>
          money(rows.filter(keep).reduce((s, r) => s + Math.abs(r.amount), 0))
        return {
          from,
          to,
          entries: rows.length,
          totals: {
            ownerLent: sum((r) => r.kind === "lend" && r.amount < 0),
            ownerBorrowed: sum((r) => r.kind === "lend" && r.amount > 0),
            paidBackToOwner: sum((r) => r.kind === "settle" && r.amount > 0),
            ownerPaidBack: sum((r) => r.kind === "settle" && r.amount < 0),
          },
          ...(found && { standingNow: standing(found) }),
          list: rows.slice(0, MAX_ROWS).map(entry),
        }
      },
    }),
  }
}

/* Write tools. Each plans its change once; the approval card and the
 * write both use the plan, so what the owner approves is what's saved. */

const NEW_IOU = z.object({
  person: z.string().min(1).describe("Their name or nickname"),
  type: z
    .enum(["lent", "borrowed"])
    .describe(
      "lent: the owner lent them money or paid for something of theirs. borrowed: they lent the owner money or paid for something of the owner's"
    ),
  amount: z.number().positive().describe("Pesos"),
  description: z
    .string()
    .max(80)
    .optional()
    .describe("What it was for, in a few words: 'grab', 'concert ticket'"),
  date: DATE.optional().describe("Omit for today"),
  account: z
    .string()
    .optional()
    .describe("The owner's account the money left or landed in, if named"),
})

const SETTLE = z.object({
  person: z.string().min(1).describe("Their name or nickname"),
  paidBy: z
    .enum(["them", "owner"])
    .describe("them: they paid the owner back. owner: the owner paid them"),
  amount: z
    .number()
    .positive()
    .optional()
    .describe(
      "Pesos, as the owner said it. Omit only when they paid all of it"
    ),
  date: DATE.optional().describe("Omit for today"),
  account: z
    .string()
    .optional()
    .describe("The owner's account the money landed in or left, if named"),
})

type Plan<T> = { ok: true; value: T } | { ok: false; reason: string }

async function accountFor(
  db: Db,
  name: string | undefined,
  fallback: "default" | "none"
): Promise<Plan<{ id: string | null; name: string | null }>> {
  const book = await accountBook(db)
  if (name) {
    const key = name.trim().toLowerCase()
    const found = book.known.find(
      (a) =>
        a.name.toLowerCase() === key ||
        a.aliases.some((x) => x.toLowerCase() === key)
    )
    if (!found)
      return {
        ok: false,
        reason: `No account called "${name}". Accounts: ${book.known.map((a) => a.name).join(", ") || "none yet"}.`,
      }
    return { ok: true, value: { id: found.id, name: found.name } }
  }
  const id = fallback === "default" ? book.defaultAccountId : null
  return {
    ok: true,
    value: { id, name: book.known.find((a) => a.id === id)?.name ?? null },
  }
}

const on = (date: string, todayIs: string) =>
  date === todayIs ? "today" : date

async function planIou(db: Db, input: z.infer<typeof NEW_IOU>) {
  const everyone = await peopleWithBalances(db)
  const found = matchPerson(everyone, input.person)
  const name = found?.name ?? display(nameKey(input.person))
  if (!name) return { ok: false, reason: "That needs a name." } as const
  const amount = centavos(input.amount)
  // Lending moves the owner's money; when someone pays for the owner,
  // none of the owner's accounts moved unless the owner named one.
  const account = await accountFor(
    db,
    input.account,
    input.type === "lent" ? "default" : "none"
  )
  if (!account.ok) return account
  const owedNow = found?.owed ?? 0
  const owedAfter = owedNow + (input.type === "lent" ? amount : -amount)
  const todayIs = await today(db)
  const date = input.date ?? todayIs
  if (date > todayIs)
    return { ok: false, reason: "That date is in the future." } as const
  return {
    ok: true,
    value: {
      person: found,
      name,
      row: {
        kind: "lend" as const,
        amount: input.type === "lent" ? -amount : amount,
        localDate: date,
        description: input.description?.trim() ?? "",
        accountId: account.value.id,
        status: "confirmed" as const,
      },
      card: [
        input.type === "lent"
          ? `Lent ${name} ${formatPeso(amount)}`
          : `Borrowed ${formatPeso(amount)} from ${name}`,
        input.description && `for ${input.description.trim()}`,
        `(${on(date, todayIs)}${account.value.name ? `, ${account.value.name}` : ""})`,
      ]
        .filter(Boolean)
        .join(" "),
      after: found
        ? `${owedNow ? "Overall, " : "Then "}${standing({ name, owed: owedAfter }, true)}.`
        : `Goatside will add ${name} to People.`,
    },
  } as const
}

async function planSettle(db: Db, input: z.infer<typeof SETTLE>) {
  const everyone = await peopleWithBalances(db)
  const found = matchPerson(everyone, input.person)
  if (!found)
    return {
      ok: false,
      reason: `${unknownPerson(input.person, everyone)} With no balance there's nothing to pay back. If this is a new loan, use recordIou.`,
    } as const
  const owed = found.owed
  if (owed === 0)
    return {
      ok: false,
      reason: `${found.name} and the owner are already square. If this is a new loan, use recordIou.`,
    } as const
  const theyOwe = owed > 0
  if (theyOwe !== (input.paidBy === "them"))
    return {
      ok: false,
      reason: `${standing(found)}, so ${input.paidBy === "them" ? `${found.name} paying the owner` : `the owner paying ${found.name}`} isn't a repayment. If it's a new loan, use recordIou; otherwise check with the owner.`,
    } as const
  const balance = Math.abs(owed)
  const size = input.amount ? centavos(input.amount) : balance
  if (size > balance)
    return {
      ok: false,
      reason: `That's more than the ${formatPeso(balance)} on record (${standing(found)}). Ask the owner whether the extra is a new loan.`,
    } as const
  const account = await accountFor(db, input.account, "default")
  if (!account.ok) return account
  const todayIs = await today(db)
  const date = input.date ?? todayIs
  if (date > todayIs)
    return { ok: false, reason: "That date is in the future." } as const
  const full = size === balance
  return {
    ok: true,
    value: {
      person: found,
      row: {
        kind: "settle" as const,
        amount: theyOwe ? size : -size,
        localDate: date,
        // The row's IOU label already says who paid whom.
        description: full ? "Settled up" : "Partly paid back",
        accountId: account.value.id,
        status: "confirmed" as const,
      },
      card: `${theyOwe ? `${found.name} paid you ${formatPeso(size)}` : `You paid ${found.name} ${formatPeso(size)}`} (${on(date, todayIs)}${account.value.name ? `, ${account.value.name}` : ""})`,
      after: full
        ? `Then you're square.`
        : `Then ${standing({ name: found.name, owed: owed - (theyOwe ? size : -size) }, true)}.`,
    },
  } as const
}

async function ensurePerson(db: Db, name: string) {
  const [created] = await db
    .insert(people)
    .values({ name })
    .onConflictDoNothing()
    .returning({ id: people.id })
  if (created) return created.id
  const everyone = await peopleWithBalances(db)
  return matchPerson(everyone, name)?.id ?? null
}

export function peopleActionTools(db: Db) {
  return {
    recordIou: tool({
      description:
        "Record a new IOU with one person: the owner lent them money or paid for something of theirs, or they lent the owner money or paid for the owner. New names are added to People. For a bill the owner paid and split with others, use logEntries with 'split N'. The owner confirms first.",
      inputSchema: NEW_IOU,
      execute: async (input) => {
        const plan = await planIou(db, input)
        if (!plan.ok) return { done: false, message: plan.reason }
        const personId =
          plan.value.person?.id ?? (await ensurePerson(db, plan.value.name))
        if (!personId)
          return { done: false, message: "Couldn't add that person." }
        const [row] = await db
          .insert(transactions)
          .values({ ...plan.value.row, personId })
          .returning({ id: transactions.id })
        return {
          done: true,
          message: `${plan.value.card}. ${plan.value.after}`,
          undo: { kind: "delete" as const, ids: row ? [row.id] : [] },
        }
      },
    }),

    settleUp: tool({
      description:
        "Record a repayment on an existing balance: the person paid the owner back, or the owner paid them back. The whole balance, or part of it. Check balances first if unsure who owes whom. The owner confirms first.",
      inputSchema: SETTLE,
      execute: async (input) => {
        const plan = await planSettle(db, input)
        if (!plan.ok) return { done: false, message: plan.reason }
        const [row] = await db
          .insert(transactions)
          .values({ ...plan.value.row, personId: plan.value.person.id })
          .returning({ id: transactions.id })
        return {
          done: true,
          message: `${plan.value.card}. ${plan.value.after}`,
          undo: { kind: "delete" as const, ids: row ? [row.id] : [] },
        }
      },
    }),
  }
}

/** A plan as an approval: the card to confirm, or why it can't be done. */
async function approval(
  plan: Promise<
    | { ok: false; reason: string }
    | { ok: true; value: { card: string; after: string } }
  >
) {
  const result = await plan
  return result.ok
    ? {
        type: "user-approval" as const,
        reason: `${result.value.card}. ${result.value.after}`,
      }
    : { type: "denied" as const, reason: result.reason }
}

export function peopleApprovals(db: Db) {
  return {
    recordIou: (input: z.infer<typeof NEW_IOU>) => approval(planIou(db, input)),
    settleUp: (input: z.infer<typeof SETTLE>) =>
      approval(planSettle(db, input)),
  }
}
