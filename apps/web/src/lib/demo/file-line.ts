/**
 * The landing page's stand-in for Goatside's filing pipeline. Amounts, signs,
 * dates, splits, accounts, transfers and names come from the real code in
 * @workspace/core, exactly as in the app. Only the judgment calls (category,
 * money in or out, who owes whom) are a small word list here; a real
 * instance asks the agent, and asks you when the agent isn't sure.
 */
import {
  type AccountKind,
  type KnownAccount,
  type TransferWord,
  guessTransfer,
  scanAccounts,
  withoutPhrase,
} from "@workspace/core/accounts"
import type { LocalDate } from "@workspace/core/dates"
import { type KnownPerson, nameCandidates } from "@workspace/core/people"
import { type DraftLine, preparse } from "@workspace/core/preparse"

export const DEMO_ACCOUNTS: (KnownAccount & { color: string })[] = [
  { id: "gcash", name: "GCash", kind: "ewallet", aliases: [], color: "blue" },
  {
    id: "bpi",
    name: "BPI",
    kind: "bank",
    aliases: ["bpi savings"],
    color: "rose",
  },
  {
    id: "bpi-card",
    name: "BPI Card",
    kind: "credit_card",
    aliases: [],
    color: "slate",
  },
  { id: "cash", name: "Cash", kind: "cash", aliases: [], color: "emerald" },
]
export const DEFAULT_ACCOUNT = "gcash"

export const DEMO_PEOPLE: KnownPerson[] = [
  { id: "nini", name: "Nini", aliases: [] },
  { id: "daniel", name: "Daniel", aliases: [] },
]

interface Category {
  name: string
  emoji: string
  words: string[]
}

const EXPENSE: Category[] = [
  {
    name: "Food",
    emoji: "🍜",
    words:
      "coffee kape latte tea boba lunch dinner breakfast merienda snack snacks food pizza burger ramen samgyup jollibee mcdo chicken sisig milk cake bread pandesal".split(
        " "
      ),
  },
  {
    name: "Groceries",
    emoji: "🛒",
    words:
      "grocery groceries palengke supermarket puregold rice eggs vegetables fruits".split(
        " "
      ),
  },
  {
    name: "Transport",
    emoji: "🚕",
    words:
      "grab taxi jeep tricycle mrt lrt bus gas fuel parking toll angkas joyride".split(
        " "
      ),
  },
  {
    name: "Bills",
    emoji: "🧾",
    words:
      "meralco electric electricity water rent internet pldt wifi load".split(
        " "
      ),
  },
  {
    name: "Subscriptions",
    emoji: "🔁",
    words: "spotify netflix youtube icloud disney subscription".split(" "),
  },
  {
    name: "Shopping",
    emoji: "🛍️",
    words: "shopee lazada shirt shoes uniqlo clothes bag".split(" "),
  },
  {
    name: "Health",
    emoji: "💊",
    words: "medicine meds doctor dentist vitamins pharmacy checkup".split(" "),
  },
  {
    name: "Fun",
    emoji: "🎟️",
    words: "movie movies cinema concert games steam bar drinks karaoke".split(
      " "
    ),
  },
]

const INCOME: Category[] = [
  { name: "Salary", emoji: "💼", words: "salary sweldo payroll".split(" ") },
  {
    name: "Freelance",
    emoji: "🧑‍💻",
    words: "client freelance project invoice commission".split(" "),
  },
  { name: "Gifts", emoji: "🎁", words: "gift regalo birthday".split(" ") },
]

const TRANSFER_TITLES: Record<TransferWord, string> = {
  transfer: "Transfer",
  cash_in: "Cash in",
  withdraw: "Withdrawal",
  card_payment: "Card payment",
  deposit: "Deposit",
}

const OTHERS_OUT = { name: "Others", emoji: "📦" }
const OTHERS_IN = { name: "Others", emoji: "💵" }

function categoryFor(text: string, list: Category[]) {
  const words = new Set(text.toLowerCase().split(/[^\p{L}]+/u))
  return list.find((c) => c.words.some((w) => words.has(w))) ?? null
}

/** Phrases that make a line an IOU, from your side. */
const RELATIONS: { relation: Relation; pattern: RegExp }[] = [
  {
    relation: "repaid_me",
    pattern: /\b(?:paid me back|paid me|bayad ni|nagbayad)\b/i,
  },
  {
    relation: "i_repaid",
    pattern: /\b(?:paid back|paid \w+ back|binayaran ko)\b/i,
  },
  { relation: "lent", pattern: /\b(?:lent|lend|pinahiram|pautang)\b/i },
  {
    relation: "borrowed",
    pattern: /\b(?:borrowed|utang kay|paid by|\w+ paid|libre ni)\b/i,
  },
]
type Relation = "lent" | "borrowed" | "repaid_me" | "i_repaid"

export interface DemoRow {
  id: string
  title: string
  /** Category, IOU or transfer, then extras: "Food · split 3 ways · GCash". */
  detail: string
  /** An emoji, or "transfer" / "iou" for the app's icons. */
  icon: string
  /** Signed centavos, cash flow from your side. */
  amount: number
  /** IOUs and transfers aren't spending or income, so they stay quiet. */
  tone: "in" | "out" | "quiet"
  date: LocalDate
  check?: boolean
  /** Counts toward the month's spending (your share) or income. */
  counts: number
}

export type DemoQuestion =
  | { kind: "direction"; rowId: string; amount: number; what: string }
  | {
      kind: "account"
      rowId: string
      amount: number
      what: string
      accountName: string
    }

export type Filed =
  | { kind: "log"; rows: DemoRow[]; question: DemoQuestion | null }
  | { kind: "undo" }
  | { kind: "ask"; text: string }
  | { kind: "empty" }

let sequence = 0
const nextId = () => `demo-${++sequence}`

const capitalize = (text: string) =>
  text ? text[0]!.toUpperCase() + text.slice(1) : text

const accountName = (id: string | null | undefined) =>
  DEMO_ACCOUNTS.find((a) => a.id === id)?.name

export function fileText(
  text: string,
  today: LocalDate,
  accounts: KnownAccount[] = DEMO_ACCOUNTS
): Filed {
  const parsed = preparse(text, { today })
  if (parsed.kind !== "log") return parsed

  const rows: DemoRow[] = []
  let question: DemoQuestion | null = null
  for (const line of parsed.lines) {
    const filed = fileLine(line, accounts)
    rows.push(...filed.rows)
    question ??= filed.question
  }
  return { kind: "log", rows, question }
}

function fileLine(
  line: DraftLine,
  accounts: KnownAccount[]
): { rows: DemoRow[]; question: DemoQuestion | null } {
  const scan = scanAccounts(line.description, accounts)
  let description = scan.rest || line.description
  if (scan.unknown)
    description = withoutPhrase(description, scan.unknown.phrase)
  const title = capitalize(description) || "Untitled"
  const base = { date: line.localDate }

  // A transfer between your own accounts: one quiet row, never spending.
  // "atm" alone: from your bank into cash. (The app uses your default account.)
  const transfer =
    scan.transferWord &&
    (guessTransfer(scan, accounts, DEFAULT_ACCOUNT) ??
      (scan.transferWord === "withdraw" && !scan.mentions.length
        ? { from: "bpi", to: "cash" }
        : null))
  if (transfer && scan.transferWord) {
    return {
      rows: [
        {
          ...base,
          id: nextId(),
          title: TRANSFER_TITLES[scan.transferWord],
          detail: `${accountName(transfer.from)} → ${accountName(transfer.to)}`,
          icon: "transfer",
          amount: line.amount,
          tone: "quiet",
          counts: 0,
        },
      ],
      question: null,
    }
  }

  const named = scan.mentions.find((m) => m.role !== "to") ?? scan.mentions[0]
  const account = named
    ? accountName(named.accountId)
    : scan.unknown
      ? null
      : accountName(DEFAULT_ACCOUNT)
  const withAccount = (detail: string) =>
    account ? `${detail} · ${account}` : detail

  const people = nameCandidates(description, DEMO_PEOPLE)
  const relation = RELATIONS.find((r) => r.pattern.test(description))
  // Someone you already know beats a word that only follows a cue ("back").
  const person = people.find((p) => p.personId) ?? people[0]

  // Split bill: your share is spending, each named person owes theirs.
  if (line.split && people.length) {
    const category = categoryFor(description, EXPENSE) ?? OTHERS_OUT
    const shares = people.slice(0, line.split - 1)
    return {
      rows: [
        {
          ...base,
          id: nextId(),
          title,
          detail: withAccount(`${category.name} · split ${line.split} ways`),
          icon: category.emoji,
          amount: -line.share,
          tone: "out",
          counts: -line.share,
        },
        ...shares.map((p): DemoRow => ({
          ...base,
          id: nextId(),
          title,
          detail: `${p.name} owes you`,
          icon: "iou",
          amount: -line.share,
          tone: "quiet",
          counts: 0,
        })),
      ],
      question: null,
    }
  }

  // An IOU with someone: quiet, it moves what's owed, not your spending.
  if (relation && person) {
    const iou = {
      lent: { detail: `${person.name} owes you`, sign: -1 },
      borrowed: { detail: `You owe ${person.name}`, sign: 0 },
      repaid_me: { detail: `${person.name} paid you back`, sign: 1 },
      i_repaid: { detail: `You paid ${person.name} back`, sign: -1 },
    }[relation.relation]
    return {
      rows: [
        {
          ...base,
          id: nextId(),
          title,
          detail: iou.sign === 0 ? iou.detail : withAccount(iou.detail),
          icon: "iou",
          amount: iou.sign === 0 ? -line.amount : iou.sign * line.amount,
          tone: "quiet",
          counts: 0,
        },
      ],
      question: null,
    }
  }

  // Money in or out: the sign if you typed one, else the words, else ask.
  const income = categoryFor(description, INCOME)
  const expense = categoryFor(description, EXPENSE)
  const direction = line.signInferred
    ? income && !expense
      ? "in"
      : expense
        ? "out"
        : null
    : line.direction
  const id = nextId()

  const category =
    direction === "in"
      ? (income ?? OTHERS_IN)
      : (expense ?? (direction ? OTHERS_OUT : null))
  const row: DemoRow = {
    ...base,
    id,
    title,
    detail: withAccount(category?.name ?? "Uncategorized"),
    icon: category?.emoji ?? "coin",
    amount: direction === "in" ? line.amount : -line.amount,
    tone: direction === "in" ? "in" : "out",
    counts: direction === "in" ? line.amount : -line.amount,
    check: !direction || Boolean(scan.unknown),
  }

  // As the app words it: the description capitalized, in quotes.
  const what = description ? `"${capitalize(description)}"` : "this"
  const question: DemoQuestion | null = !direction
    ? { kind: "direction", rowId: id, amount: line.amount, what }
    : scan.unknown
      ? {
          kind: "account",
          rowId: id,
          amount: line.amount,
          what,
          accountName: scan.unknown.name,
        }
      : null
  return { rows: [row], question }
}

/** Re-files a row once you answer its question. */
export function answerRow(
  row: DemoRow,
  question: DemoQuestion,
  answer: "in" | "out" | AccountKind | "none"
): DemoRow {
  if (question.kind === "direction") {
    const list = answer === "in" ? INCOME : EXPENSE
    const category =
      categoryFor(row.title, list) ?? (answer === "in" ? OTHERS_IN : OTHERS_OUT)
    const amount = answer === "in" ? question.amount : -question.amount
    const account = row.detail.split(" · ").at(1)
    return {
      ...row,
      check: false,
      icon: category.emoji,
      detail: account ? `${category.name} · ${account}` : category.name,
      amount,
      tone: answer === "in" ? "in" : "out",
      counts: amount,
    }
  }
  return {
    ...row,
    check: false,
    detail:
      answer === "none"
        ? row.detail
        : `${row.detail} · ${question.accountName}`,
  }
}
