/**
 * Which of the owner's accounts a line moves money in or out of, and whether
 * it's a transfer between two of them (cash in, ATM, paying off a card).
 * Mentions and transfer direction come from `@workspace/core/accounts`; the
 * decision model only says whether a line is a transfer at all, and what an
 * unrecognized name ("using tala") is.
 */
import {
  type Experimental_DecisionModel,
  type Experimental_DecisionQuestion,
  experimental_decide,
} from "ai"
import {
  ACCOUNT_KIND_LABELS,
  type AccountKind,
  type AccountScan,
  type KnownAccount,
  type TransferGuess,
  guessTransfer,
} from "@workspace/core/accounts"
import { formatMoney } from "@workspace/core/money"
import type { Direction } from "@workspace/core/preparse"

/** At or above this, a line that names both sides is filed as a transfer. */
export const AUTO_TRANSFER = 0.75
/** Below AUTO_TRANSFER but at or above this, the owner is asked. */
export const MAYBE_TRANSFER = 0.3
/** At or above this, an unknown name is taken as "not an account" silently. */
export const NOT_ACCOUNT = 0.7

export const NEW_ACCOUNT_ANSWERS = [
  "bank",
  "ewallet",
  "credit_card",
  "cash",
  "none",
] as const
export type NewAccountAnswer = (typeof NEW_ACCOUNT_ANSWERS)[number]

export interface AccountSignals {
  /** P(transfer between the owner's own accounts). */
  pTransfer?: number
  /** What an unrecognized name is, when there was one. */
  unknown?: Record<NewAccountAnswer, number>
}

/** Whether the model has anything to add for this line. */
export function needsAccountModel(scan: AccountScan, transfer: boolean) {
  return transfer || unknownToAsk(scan) !== null
}

/** The unknown name the model should judge: not one the provider list knows. */
export function unknownToAsk(scan: AccountScan) {
  return scan.unknown && !scan.unknown.kind && !scan.mentions.length
    ? scan.unknown.name
    : null
}

/** One decide call: transfer or not, and what an unknown name is. */
export async function askAccounts(
  model: Experimental_DecisionModel,
  line: {
    description: string
    amount: number
    direction: Direction | null
    accounts: { name: string; kind: AccountKind }[]
    unknown: string | null
    transfer: boolean
  },
  { abortSignal }: { abortSignal?: AbortSignal } = {}
): Promise<AccountSignals> {
  const questions: Record<string, Experimental_DecisionQuestion> = {}
  if (line.transfer) {
    questions.transfer = {
      type: "boolean",
      instructions:
        "Is the owner moving their own money between two of their own accounts (cash in or top up an e-wallet, ATM withdrawal, paying off their credit card, moving savings), rather than spending it or receiving it?",
    }
  }
  if (line.unknown) {
    questions.unknown = {
      type: "choice",
      instructions: `In this entry, what is "${line.unknown}"?`,
      criteria: {
        bank: {
          what: "A bank or a bank account (savings, checking, debit card)",
          examples: ["bpi", "unionbank", "gotyme"],
        },
        ewallet: {
          what: "An e-wallet or payment app that holds a balance",
          examples: ["gcash", "maya", "shopeepay"],
        },
        credit_card: {
          what: "A credit card",
          examples: ["eastwest credit", "rcbc visa", "amex"],
        },
        cash: { what: "Physical cash, a coin purse or a piggy bank" },
        none: {
          what: "Not a place money is kept: a shop, an app for ordering, a person or a thing",
          examples: ["grab", "lalamove", "jollibee"],
        },
      },
    }
  }
  if (!Object.keys(questions).length) return {}

  const { answers } = await experimental_decide({
    model,
    state: {
      entry: line.description || "(no description)",
      amount: formatMoney(line.amount),
      sign:
        line.direction === "in"
          ? "money in"
          : line.direction === "out"
            ? "money out"
            : "not given",
      owner_accounts: line.accounts.map(
        (a) => `${a.name} (${ACCOUNT_KIND_LABELS[a.kind].toLowerCase()})`
      ),
    },
    questions,
    abortSignal,
    maxRetries: 1,
  })

  const signals: AccountSignals = {}
  const transfer = answers.transfer
  if (transfer?.type === "boolean") signals.pTransfer = transfer.probability
  const unknown = answers.unknown
  if (unknown?.type === "choice") {
    signals.unknown = Object.fromEntries(
      NEW_ACCOUNT_ANSWERS.map((k) => [
        k,
        unknown.probabilities?.[k] ?? (unknown.choice === k ? 1 : 0),
      ])
    ) as Record<NewAccountAnswer, number>
  }
  return signals
}

export type AccountQuestionDraft =
  | {
      kind: "transfer"
      guess: "transfer" | "spend"
      options: { value: "transfer" | "spend"; p: number | null }[]
      transfer: TransferGuess
      /** The account to file it under if it's spending or income. */
      own: string | null
    }
  | {
      kind: "account"
      /** Saved without an account until the owner says what it is. */
      guess: "none"
      options: { value: NewAccountAnswer; p: number | null }[]
      name: string
      phrase: string
    }

export interface ResolvedAccounts {
  accountId: string | null
  /** Set for a transfer: `accountId` is where it left, this where it went. */
  toAccountId: string | null
  transfer: boolean
  questions: AccountQuestionDraft[]
}

/** True when the words alone could make this a transfer. */
export function couldBeTransfer(
  scan: AccountScan,
  known: KnownAccount[],
  defaultAccountId: string | null
) {
  return guessTransfer(scan, known, defaultAccountId) !== null
}

/**
 * Files a line. Order of trust: a transfer the words and model agree on,
 * then the account the line names, then the account this repeat charge
 * used last time, then the default account. `relation` "borrowed" skips
 * the default: when someone paid for the owner, no account of theirs moved.
 */
export function resolveAccounts(
  scan: AccountScan,
  known: KnownAccount[],
  {
    defaultAccountId,
    memoryAccountId,
    borrowed,
    signals,
  }: {
    defaultAccountId: string | null
    memoryAccountId: string | null
    borrowed: boolean
    signals: AccountSignals | null
  }
): ResolvedAccounts {
  const live = (id: string | null) =>
    id && known.some((a) => a.id === id) ? id : null
  const named =
    scan.mentions.find((m) => m.cued)?.accountId ??
    scan.mentions[0]?.accountId ??
    null
  const own =
    named ?? live(memoryAccountId) ?? (borrowed ? null : live(defaultAccountId))
  const plain: ResolvedAccounts = {
    accountId: own,
    toAccountId: null,
    transfer: false,
    questions: [],
  }

  const guess = guessTransfer(scan, known, live(defaultAccountId))
  if (guess) {
    const bothNamed =
      scan.mentions.some((m) => m.role === "from") &&
      scan.mentions.some((m) => m.role === "to")
    const p =
      signals?.pTransfer ?? (scan.transferWord ? 0.9 : bothNamed ? 0.8 : 0.5)
    if (p >= AUTO_TRANSFER) {
      return {
        accountId: guess.from,
        toAccountId: guess.to,
        transfer: true,
        questions: [],
      }
    }
    if (p >= MAYBE_TRANSFER) {
      const likely = p >= 0.5
      return {
        ...(likely
          ? { accountId: guess.from, toAccountId: guess.to, transfer: true }
          : plain),
        questions: [
          {
            kind: "transfer",
            guess: likely ? "transfer" : "spend",
            options: [
              { value: "transfer", p },
              { value: "spend", p: 1 - p },
            ].toSorted((a, b) => b.p - a.p) as {
              value: "transfer" | "spend"
              p: number
            }[],
            transfer: guess,
            own: named ?? guess.from,
          },
        ],
      }
    }
    return plain
  }

  const unknown = scan.unknown
  if (unknown && !scan.mentions.length) {
    const ranked = signals?.unknown
    // A known bank or e-wallet is always worth asking about; the model
    // doesn't know every local bank ("gotyme" read as a shop).
    if (!unknown.kind && (ranked?.none ?? 0) >= NOT_ACCOUNT) return plain
    // The three account kinds, likeliest first, then "not an account".
    // Cash is left out: a named cash account is rare, and it's one tap in
    // the Accounts page.
    const kinds = (["bank", "ewallet", "credit_card"] as const)
      .map((value, i) => ({
        value,
        p: ranked ? ranked[value] : null,
        hinted: value === unknown.kind,
        i,
      }))
      .toSorted(
        (a, b) =>
          (b.p ?? 0) - (a.p ?? 0) ||
          Number(b.hinted) - Number(a.hinted) ||
          a.i - b.i
      )
      .map(({ value, p }) => ({ value, p }))
    const options = [
      ...kinds,
      { value: "none" as const, p: ranked?.none ?? null },
    ]
    return {
      ...plain,
      // Not the default either: the owner said which account, just not one we know.
      accountId: live(memoryAccountId),
      questions: [
        {
          kind: "account",
          guess: "none",
          options,
          name: unknown.name,
          phrase: unknown.phrase,
        },
      ],
    }
  }
  return plain
}
