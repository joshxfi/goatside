/**
 * Goatside's tables. One deploy belongs to one person, so there are no
 * user ids. Money is integer centavos, always PHP. `local_date`
 * ("YYYY-MM-DD" in the owner's timezone) decides which day/month a
 * transaction belongs to; `created_at` orders within a day.
 */

import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`
const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID())
const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" }).notNull().default(now)

/** Single row (id = 1) of owner preferences. */
export const settings = sqliteTable(
  "settings",
  {
    id: integer("id").primaryKey().default(1),
    timeZone: text("time_zone").notNull().default("Asia/Manila"),
    /** Where entries that name no account are filed; null leaves them unfiled. */
    defaultAccountId: text("default_account_id"),
    createdAt: createdAt(),
  },
  (t) => [check("settings_single_row", sql`${t.id} = 1`)]
)

export const categories = sqliteTable(
  "categories",
  {
    id: id(),
    name: text("name").notNull(),
    emoji: text("emoji").notNull(),
    kind: text("kind", { enum: ["expense", "income"] }).notNull(),
    sort: integer("sort").notNull().default(0),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("categories_kind_name_idx").on(t.kind, sql`lower(${t.name})`),
  ]
)

export const merchants = sqliteTable(
  "merchants",
  {
    id: id(),
    name: text("name").notNull(),
    defaultCategoryId: text("default_category_id").references(
      () => categories.id,
      { onDelete: "set null" }
    ),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("merchants_name_idx").on(sql`lower(${t.name})`)]
)

export const people = sqliteTable(
  "people",
  {
    id: id(),
    name: text("name").notNull(),
    aliases: text("aliases", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("people_name_idx").on(sql`lower(${t.name})`)]
)

export const ACCOUNT_KINDS = ["bank", "ewallet", "credit_card", "cash"] as const

export const ACCOUNT_COLORS = [
  "slate",
  "blue",
  "indigo",
  "violet",
  "rose",
  "orange",
  "amber",
  "emerald",
  "teal",
] as const

/**
 * Where money sits: banks, e-wallets, credit cards, cash. A balance is
 * `opening` plus every transaction filed to the account (transfers count on
 * both ends). Setting a balance by hand moves `opening`, so history stays.
 * Credit cards hold a negative balance while there's something owed.
 */
export const accounts = sqliteTable(
  "accounts",
  {
    id: id(),
    name: text("name").notNull(),
    kind: text("kind", { enum: ACCOUNT_KINDS }).notNull(),
    color: text("color", { enum: ACCOUNT_COLORS }).notNull().default("slate"),
    /** Other names it goes by in entries: "mb" for Metrobank. */
    aliases: text("aliases", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    /** Last four digits, shown on the card. */
    last4: text("last4"),
    /** Credit cards only, centavos. */
    creditLimit: integer("credit_limit"),
    opening: integer("opening").notNull().default(0),
    sort: integer("sort").notNull().default(0),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("accounts_name_idx").on(sql`lower(${t.name})`)]
)

/** One line typed into the composer. A log line can yield several transactions. */
export const entries = sqliteTable(
  "entries",
  {
    id: id(),
    rawText: text("raw_text").notNull(),
    mode: text("mode", { enum: ["log", "ask"] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("entries_created_idx").on(t.createdAt)]
)

export const TRANSACTION_KINDS = [
  "expense",
  "income",
  "lend",
  "settle",
  /** Money moving between two of the owner's accounts: not spending. */
  "transfer",
] as const
export const TRANSACTION_STATUSES = [
  "pending",
  "parsed",
  "needs_review",
  "confirmed",
] as const

export const transactions = sqliteTable(
  "transactions",
  {
    id: id(),
    entryId: text("entry_id").references(() => entries.id, {
      onDelete: "set null",
    }),
    kind: text("kind", { enum: TRANSACTION_KINDS }).notNull(),
    /** Signed centavos: negative is money out. For splits, this is your share. */
    amount: integer("amount").notNull(),
    localDate: text("local_date").notNull(),
    description: text("description").notNull().default(""),
    note: text("note"),
    categoryId: text("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    merchantId: text("merchant_id").references(() => merchants.id, {
      onDelete: "set null",
    }),
    personId: text("person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    split: integer("split"),
    /** The account the money left (amount < 0) or arrived in (amount > 0). */
    accountId: text("account_id").references(() => accounts.id, {
      onDelete: "set null",
    }),
    /** Transfers only: where the money went. `amount` is negative (it left `accountId`). */
    toAccountId: text("to_account_id").references(() => accounts.id, {
      onDelete: "set null",
    }),
    recurring: integer("recurring", { mode: "boolean" })
      .notNull()
      .default(false),
    status: text("status", { enum: TRANSACTION_STATUSES })
      .notNull()
      .default("pending"),
    aiConfidence: real("ai_confidence"),
    /**
     * Set when a bank or card statement row was imported as (or matched to)
     * this transaction: the row's fingerprint, so an overlapping statement
     * doesn't add it twice.
     */
    importRef: text("import_ref"),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(now)
      .$onUpdate(() => new Date()),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("transactions_date_idx").on(t.localDate),
    index("transactions_category_date_idx").on(t.categoryId, t.localDate),
    index("transactions_person_idx").on(t.personId),
    index("transactions_account_idx").on(t.accountId),
    index("transactions_to_account_idx").on(t.toAccountId),
    index("transactions_import_idx").on(t.accountId, t.importRef),
  ]
)

/** What an import changed on entries it didn't add, as they were before. */
export interface ImportUndoFields {
  kind: (typeof TRANSACTION_KINDS)[number]
  amount: number
  accountId: string | null
  toAccountId: string | null
  categoryId: string | null
  aiConfidence: number | null
  recurring: boolean
  status: (typeof TRANSACTION_STATUSES)[number]
  importRef: string | null
  split: number | null
  personId: string | null
  localDate: string
  description: string
}

export interface ImportUndo {
  rows: {
    id: string
    /** The entry before the import, and as the import left it. */
    before: ImportUndoFields
    after: ImportUndoFields
  }[]
  /** Questions it closed (a transfer has no category to ask about). */
  questionIds: string[]
}

/**
 * Statements imported into an account. The file itself is never stored or
 * uploaded: only its SHA-256, the period and the balances it printed.
 */
export const imports = sqliteTable(
  "imports",
  {
    id: id(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** The entry its new rows were saved under; undo removes them together. */
    entryId: text("entry_id").references(() => entries.id, {
      onDelete: "set null",
    }),
    fileHash: text("file_hash").notNull(),
    periodStart: text("period_start"),
    periodEnd: text("period_end"),
    /** As printed. On a card, what was owed. */
    opening: integer("opening"),
    closing: integer("closing"),
    /** Rows on the statement, and how many were new. */
    rowCount: integer("row_count").notNull(),
    addedCount: integer("added_count").notNull(),
    /**
     * Entries the import changed rather than added (linked, moved, turned
     * into a transfer), as they were before, so undo can put them back.
     */
    undo: text("undo", { mode: "json" }).$type<ImportUndo>(),
    createdAt: createdAt(),
  },
  (t) => [index("imports_account_idx").on(t.accountId, t.fileHash)]
)

/** Every manual fix to an AI guess; future parses learn from these. */
export const corrections = sqliteTable(
  "corrections",
  {
    id: id(),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    field: text("field").notNull(),
    fromValue: text("from_value"),
    toValue: text("to_value"),
    createdAt: createdAt(),
  },
  (t) => [index("corrections_transaction_idx").on(t.transactionId)]
)

export const QUESTION_KINDS = [
  "direction",
  "category",
  "relation",
  "duplicate",
  /** A name after "using", "via"… that isn't one of the owner's accounts yet. */
  "account",
  /** Two accounts named: a transfer between them, or spending from one? */
  "transfer",
] as const

/**
 * Things the agent wasn't sure about and asked the owner. The transaction is
 * saved with the best guess either way; answering confirms or fixes it.
 */
export const questions = sqliteTable(
  "questions",
  {
    id: id(),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: QUESTION_KINDS }).notNull(),
    /** The value saved on the transaction while the question is open. */
    guess: text("guess").notNull(),
    /** Answers offered, best first, with the model's probability when known. */
    options: text("options", { mode: "json" })
      .$type<{ value: string; p: number | null }[]>()
      .notNull(),
    /** Kind-specific data, e.g. category rankings for each direction. */
    context: text("context", { mode: "json" }).$type<unknown>(),
    answer: text("answer"),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("questions_open_idx").on(t.resolvedAt, t.createdAt),
    index("questions_transaction_idx").on(t.transactionId),
  ]
)

/** Sign-in attempts, for throttling password guessing on a public URL. */
export const loginAttempts = sqliteTable(
  "login_attempts",
  {
    id: id(),
    ip: text("ip").notNull(),
    /** Set when the browser carried a valid trusted-device cookie. */
    deviceId: text("device_id"),
    succeeded: integer("succeeded", { mode: "boolean" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("login_attempts_created_idx").on(t.createdAt, t.ip),
    index("login_attempts_device_idx").on(t.deviceId, t.createdAt),
  ]
)

export type Category = typeof categories.$inferSelect
export type Transaction = typeof transactions.$inferSelect
export type TransactionKind = (typeof TRANSACTION_KINDS)[number]
export type Question = typeof questions.$inferSelect
export type Import = typeof imports.$inferSelect
export type Account = typeof accounts.$inferSelect
export type AccountKind = (typeof ACCOUNT_KINDS)[number]
export type AccountColor = (typeof ACCOUNT_COLORS)[number]
