/**
 * Goatside's own tables. Money is integer centavos, always PHP.
 * `local_date` ("YYYY-MM-DD" in the owner's timezone) decides which
 * day/month a transaction belongs to; `created_at` orders within a day.
 */

import { sql } from "drizzle-orm"
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"
import { user } from "./auth"

const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`
const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID())
const userId = () =>
  text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" })
const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" }).notNull().default(now)

export const profiles = sqliteTable("profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  timeZone: text("time_zone").notNull().default("Asia/Manila"),
  createdAt: createdAt(),
})

export const categories = sqliteTable(
  "categories",
  {
    id: id(),
    userId: userId(),
    name: text("name").notNull(),
    emoji: text("emoji").notNull(),
    kind: text("kind", { enum: ["expense", "income"] }).notNull(),
    sort: integer("sort").notNull().default(0),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("categories_user_kind_name_idx").on(
      t.userId,
      t.kind,
      sql`lower(${t.name})`
    ),
  ]
)

export const merchants = sqliteTable(
  "merchants",
  {
    id: id(),
    userId: userId(),
    name: text("name").notNull(),
    defaultCategoryId: text("default_category_id").references(
      () => categories.id,
      { onDelete: "set null" }
    ),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("merchants_user_name_idx").on(t.userId, sql`lower(${t.name})`),
  ]
)

export const people = sqliteTable(
  "people",
  {
    id: id(),
    userId: userId(),
    name: text("name").notNull(),
    aliases: text("aliases", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("people_user_name_idx").on(t.userId, sql`lower(${t.name})`),
  ]
)

/** One line typed into the composer. A log line can yield several transactions. */
export const entries = sqliteTable(
  "entries",
  {
    id: id(),
    userId: userId(),
    rawText: text("raw_text").notNull(),
    mode: text("mode", { enum: ["log", "ask"] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("entries_user_created_idx").on(t.userId, t.createdAt)]
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
    userId: userId(),
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
    index("transactions_user_date_idx").on(t.userId, t.localDate),
    index("transactions_user_category_date_idx").on(
      t.userId,
      t.categoryId,
      t.localDate
    ),
    index("transactions_user_person_idx").on(t.userId, t.personId),
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

export type Category = typeof categories.$inferSelect
export type Transaction = typeof transactions.$inferSelect
export type TransactionKind = (typeof TRANSACTION_KINDS)[number]
