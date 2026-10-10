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
    recurring: integer("recurring", { mode: "boolean" })
      .notNull()
      .default(false),
    status: text("status", { enum: TRANSACTION_STATUSES })
      .notNull()
      .default("pending"),
    aiConfidence: real("ai_confidence"),
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
  ]
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
