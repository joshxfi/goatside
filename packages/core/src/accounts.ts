/**
 * Finds the owner's accounts in a description ("lunch using gcash", "from
 * bpi to maya"), names that look like an account not set up yet, and
 * transfer words (cash in, top up, ATM, card payment). Deterministic; the
 * decision model only weighs in when a line could be a transfer.
 */

export const ACCOUNT_KIND_LABELS = {
  bank: "Bank",
  ewallet: "E-wallet",
  credit_card: "Credit card",
  cash: "Cash",
} as const

export type AccountKind = keyof typeof ACCOUNT_KIND_LABELS

export interface KnownAccount {
  id: string
  name: string
  kind: AccountKind
  aliases: string[]
}

/** "from bpi" is where money left; "to gcash" / "into gcash" where it went. */
export type Role = "from" | "to" | null

export interface AccountMention {
  accountId: string
  role: Role
  /** Introduced by "using", "via"…: the account that paid or received. */
  cued: boolean
}

export type TransferWord =
  | "transfer"
  | "cash_in"
  | "withdraw"
  | "card_payment"
  | "deposit"

export interface UnknownAccount {
  /** Display form, e.g. "UnionBank". */
  name: string
  /** The words to drop from the description once it's an account. */
  phrase: string
  kind: AccountKind | null
}

export interface AccountScan {
  /** Each account once, in the order mentioned. */
  mentions: AccountMention[]
  /** A name after "using", "via"…, or a known provider, that isn't set up. */
  unknown: UnknownAccount | null
  transferWord: TransferWord | null
  /** The description without the account phrases. */
  rest: string
}

const B = "(?<![\\p{L}\\d])"
const E = "(?![\\p{L}\\d])"
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Words before an account. "from" and "to" also say which side it's on. */
const CUE =
  "using|use|used|via|thru|through|with|gamit|sa|on|in|from|to|into|paid with|paid via|pay with|charged to|charge to"
/** Strict cues: what follows is almost always a way to pay. */
const STRICT_CUE =
  "using|via|thru|through|gamit|paid with|paid via|pay with|charged to|charge to"
const SUFFIX = "credit card|card|account|acct|app|wallet|debit|credit|savings"

/** Well-known Philippine banks and e-wallets, to suggest a kind. */
const PROVIDERS: Record<string, AccountKind> = Object.fromEntries([
  ...[
    "gcash",
    "maya",
    "paymaya",
    "grabpay",
    "shopeepay",
    "coins",
    "coins.ph",
    "paypal",
    "lazwallet",
  ].map((name) => [name, "ewallet" as const]),
  ...[
    "bpi",
    "bdo",
    "metrobank",
    "unionbank",
    "security bank",
    "securitybank",
    "rcbc",
    "landbank",
    "pnb",
    "chinabank",
    "china bank",
    "eastwest",
    "psbank",
    "aub",
    "maybank",
    "gotyme",
    "cimb",
    "tonik",
    "seabank",
    "maribank",
    "komo",
    "ownbank",
    "uno",
    "hsbc",
    "citibank",
    "ing",
  ].map((name) => [name, "bank" as const]),
])

/** Providers that are also first names: they need "via"/"using" or "app". */
const DOUBLES_AS_NAME = new Set(["maya", "coins", "uno", "ing", "komo"])

/** Display names for providers whose spelling isn't just capitalized. */
const PROVIDER_NAMES: Record<string, string> = {
  gcash: "GCash",
  paymaya: "PayMaya",
  grabpay: "GrabPay",
  shopeepay: "ShopeePay",
  "coins.ph": "Coins.ph",
  paypal: "PayPal",
  lazwallet: "LazWallet",
  bpi: "BPI",
  bdo: "BDO",
  rcbc: "RCBC",
  pnb: "PNB",
  psbank: "PSBank",
  aub: "AUB",
  cimb: "CIMB",
  hsbc: "HSBC",
  ing: "ING",
  unionbank: "UnionBank",
  gotyme: "GoTyme",
  seabank: "SeaBank",
  maribank: "MariBank",
  ownbank: "OwnBank",
  eastwest: "EastWest",
  maybank: "Maybank",
}

/** Words for "my one account of this kind", used when there's just one. */
const GENERIC: { pattern: string; kind: AccountKind; cuedOnly: boolean }[] = [
  { pattern: "cash", kind: "cash", cuedOnly: false },
  { pattern: "credit\\s*card", kind: "credit_card", cuedOnly: false },
  { pattern: "cc|card", kind: "credit_card", cuedOnly: true },
  { pattern: "e-?wallet", kind: "ewallet", cuedOnly: true },
]

const TRANSFER_WORDS: [TransferWord, RegExp][] = [
  [
    "cash_in",
    new RegExp(`${B}(?:cash[\\s-]?in|top[\\s-]?up|reload)${E}`, "iu"),
  ],
  [
    "withdraw",
    new RegExp(`${B}(?:withdr[ae]w\\w*|atm|cash[\\s-]?out)${E}`, "iu"),
  ],
  [
    "card_payment",
    new RegExp(
      `${B}(?:(?:pay|paid|payment|bayad)\\s+(?:(?:for|to|off|my|the)\\s+)*(?:(?!using|via|with|thru)[\\p{L}\\d]+\\s+){0,2}(?:credit\\s*card|card|cc)|(?:card|cc)\\s+(?:payment|bill))${E}`,
      "iu"
    ),
  ],
  [
    "transfer",
    new RegExp(
      `${B}(?:transfer\\w*|xfer|instapay|pesonet|send\\s+to|sent\\s+to|moved?\\s+to)${E}`,
      "iu"
    ),
  ],
  ["deposit", new RegExp(`${B}deposit\\w*${E}`, "iu")],
]

const FEE = new RegExp(`${B}(?:fees?|charges?|interest|penalty|tax)${E}`, "iu")

const roleOf = (cue: string | undefined): Role => {
  const c = cue?.toLowerCase()
  if (c === "from") return "from"
  if (c === "to" || c === "into") return "to"
  return null
}

const display = (name: string) =>
  PROVIDER_NAMES[name] ??
  name.replace(
    /(^|\s)(\p{L})/gu,
    (_, s: string, l: string) => s + l.toUpperCase()
  )

interface Hit {
  start: number
  end: number
  accountId: string
  role: Role
  cued: boolean
}

/** "cash in", "cash out", "cashback" aren't the cash account. */
const NOT_CASH = "(?![\\s-]*(?:in|out|back)(?![\\p{L}\\d]))"

function phrasePattern(name: string) {
  const guard = /^cash$/i.test(name) ? NOT_CASH : ""
  return new RegExp(
    `${B}(?:(${CUE})\\s+)?(?:my\\s+)?(${name})${guard}(?:\\s+(?:${SUFFIX}))?(?:['’]s)?${E}`,
    "giu"
  )
}

/** Scans a description for accounts. `known` should exclude archived ones. */
export function scanAccounts(
  description: string,
  known: KnownAccount[]
): AccountScan {
  const text = description
  const taken: [number, number][] = []
  const free = (start: number, end: number) =>
    taken.every(([s, e]) => end <= s || start >= e)
  const hits: Hit[] = []

  // Longest names first, so "bpi card" beats "bpi".
  const names = known
    .flatMap((account) =>
      [account.name, ...account.aliases]
        .map((n) => n.trim().toLowerCase())
        .filter(Boolean)
        .map((n) => ({ name: n, account }))
    )
    .toSorted((a, b) => b.name.length - a.name.length)
  for (const { name, account } of names) {
    for (const m of text.matchAll(
      phrasePattern(escape(name).replace(/\s+/g, "\\s+"))
    )) {
      const start = m.index ?? 0
      const end = start + m[0].length
      if (!free(start, end)) continue
      taken.push([start, end])
      hits.push({
        start,
        end,
        accountId: account.id,
        role: roleOf(m[1]),
        cued: Boolean(m[1]),
      })
    }
  }

  // "cash", "credit card": the only account of that kind, if there's one.
  for (const generic of GENERIC) {
    const ofKind = known.filter((a) => a.kind === generic.kind)
    if (ofKind.length !== 1 || !ofKind[0]) continue
    for (const m of text.matchAll(phrasePattern(generic.pattern))) {
      if (generic.cuedOnly && !m[1]) continue
      const start = m.index ?? 0
      const end = start + m[0].length
      if (!free(start, end)) continue
      taken.push([start, end])
      hits.push({
        start,
        end,
        accountId: ofKind[0].id,
        role: roleOf(m[1]),
        cued: Boolean(m[1]),
      })
    }
  }

  hits.sort((a, b) => a.start - b.start)
  const mentions: AccountMention[] = []
  for (const hit of hits) {
    const existing = mentions.find((m) => m.accountId === hit.accountId)
    if (existing) {
      existing.role ??= hit.role
      existing.cued ||= hit.cued
    } else {
      mentions.push({
        accountId: hit.accountId,
        role: hit.role,
        cued: hit.cued,
      })
    }
  }

  const unknown = findUnknown(text, free)

  let transferWord: TransferWord | null = null
  // "atm fee", "cash in fee": the fee is spending, whatever it's for.
  if (!FEE.test(text)) {
    for (const [word, pattern] of TRANSFER_WORDS) {
      if (pattern.test(text)) {
        transferWord = word
        break
      }
    }
  }

  let rest = text
  for (const hit of hits.toSorted((a, b) => b.start - a.start)) {
    rest = `${rest.slice(0, hit.start)} ${rest.slice(hit.end)}`
  }
  rest = tidy(rest)

  return { mentions, unknown, transferWord, rest }
}

/** Collapses spaces and drops dangling joiners left by a removed phrase. */
function tidy(text: string) {
  return text
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.!?)])/g, "$1")
    .replace(/^[\s,;:\-–]+|[\s,;:\-–]+$/g, "")
    .replace(/(?:^|\s)(?:and|&|,)$/iu, "")
    .trim()
}

const STOP = new Set(
  "for at to from and with on the a an my sa kasi kay ni yesterday today kahapon".split(
    " "
  )
)
const NAME_WORD = /^[\p{L}][\p{L}\d.'’-]*$/u
const SUFFIX_WORD = /^(?:card|account|acct|app|wallet|debit|credit|savings)$/u
/** "using cash", "via card": a way to pay, not a new account. */
const GENERIC_WORD =
  /^(?:cash|card|cc|credit|debit|e-?wallet|bank|it|that|this|them|him|her)$/u

/** A provider anywhere, or a name after a strict cue ("using unionbank"). */
function findUnknown(
  text: string,
  free: (start: number, end: number) => boolean
): UnknownAccount | null {
  const lower = text.toLowerCase()
  const providers = Object.keys(PROVIDERS).toSorted(
    (a, b) => b.length - a.length
  )
  for (const provider of providers) {
    const m = new RegExp(
      `${B}(?:(${STRICT_CUE})\\s+)?(?:my\\s+)?${escape(provider)}(?:\\s+(${SUFFIX}))?${E}`,
      "iu"
    ).exec(lower)
    if (!m) continue
    // "dinner with maya" is a person; "via maya" or "maya app" isn't.
    if (DOUBLES_AS_NAME.has(provider) && !m[1] && !m[2]) continue
    const start = m.index
    if (!free(start, start + m[0].length)) continue
    const suffix = m[2]?.toLowerCase()
    return {
      name: display(provider),
      phrase: text.slice(start, start + m[0].length),
      kind: suffix?.includes("credit") ? "credit_card" : PROVIDERS[provider]!,
    }
  }

  const cue = new RegExp(`${B}(?:${STRICT_CUE})\\s+(?:my\\s+)?`, "giu")
  for (const m of text.matchAll(cue)) {
    const start = m.index ?? 0
    const offset = start + m[0].length
    const words: string[] = []
    let suffix: string | null = null
    let end = offset
    for (const token of text.slice(offset).matchAll(/\S+/g)) {
      const word = token[0].replace(/[,.;:!?)]+$/, "")
      const lowerWord = word.toLowerCase()
      if (!NAME_WORD.test(word) || STOP.has(lowerWord)) break
      const tokenEnd = offset + (token.index ?? 0) + word.length
      if (SUFFIX_WORD.test(lowerWord)) {
        if (words.length) {
          suffix = lowerWord
          end = tokenEnd
        }
        break
      }
      words.push(word)
      end = tokenEnd
      // Two words at most ("security bank"); punctuation ends the name.
      if (words.length === 2 || token[0] !== word) break
    }
    const name = words.join(" ").toLowerCase()
    if (!name || GENERIC_WORD.test(name)) continue
    if (!free(start, end)) continue
    return {
      name: display(name),
      phrase: text.slice(start, end),
      kind: PROVIDERS[name] ?? (suffix === "credit" ? "credit_card" : null),
    }
  }
  return null
}

export interface TransferGuess {
  from: string
  to: string
}

/**
 * Which way a transfer goes, from the words alone. Null when the line names
 * fewer than two sides (the default account can stand in for one).
 */
export function guessTransfer(
  scan: AccountScan,
  known: KnownAccount[],
  defaultAccountId: string | null
): TransferGuess | null {
  const kindOf = (id: string) => known.find((a) => a.id === id)?.kind
  const cash = known.filter((a) => a.kind === "cash")
  const ids = scan.mentions.map((m) => m.accountId)
  const word = scan.transferWord

  if (ids.length >= 2) {
    const from = scan.mentions.find((m) => m.role === "from")?.accountId
    const to = scan.mentions.find((m) => m.role === "to")?.accountId
    if (from && to && from !== to) return { from, to }
    // Whichever side the words don't say: the destination is the card being
    // paid, the wallet being topped up, or the cash withdrawn.
    const destination =
      to ??
      ids.find((id) =>
        word === "card_payment"
          ? kindOf(id) === "credit_card"
          : word === "cash_in"
            ? kindOf(id) === "ewallet"
            : word === "withdraw"
              ? kindOf(id) === "cash"
              : false
      )
    if (destination) {
      const source = from ?? ids.find((id) => id !== destination)
      if (source) return { from: source, to: destination }
    }
    const source = from ?? ids[0]
    const target = ids.find((id) => id !== source)
    return source && target ? { from: source, to: target } : null
  }

  const [only] = scan.mentions
  if (!only || !word) return null
  const other = (id: string | undefined) =>
    id && id !== only.accountId ? id : null
  if (word === "withdraw") {
    const into = other(cash[0]?.id)
    return into ? { from: only.accountId, to: into } : null
  }
  if (only.role === "from") {
    const into = other(defaultAccountId ?? undefined)
    return into ? { from: only.accountId, to: into } : null
  }
  const source = other(defaultAccountId ?? undefined)
  return source ? { from: source, to: only.accountId } : null
}

/** Strips a phrase (e.g. "using unionbank") from a description. */
export function withoutPhrase(description: string, phrase: string) {
  const at = description.toLowerCase().indexOf(phrase.toLowerCase())
  if (at < 0) return description
  return tidy(
    `${description.slice(0, at)} ${description.slice(at + phrase.length)}`
  )
}
