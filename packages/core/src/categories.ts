export type CategoryKind = "expense" | "income"

export interface CategorySeed {
  name: string
  emoji: string
  kind: CategoryKind
}

/** Seeded for every new user. Renaming, merging and adding are up to them. */
export const DEFAULT_CATEGORIES: CategorySeed[] = [
  { name: "Food", emoji: "🍜", kind: "expense" },
  { name: "Groceries", emoji: "🛒", kind: "expense" },
  { name: "Transport", emoji: "🚕", kind: "expense" },
  { name: "Bills", emoji: "🧾", kind: "expense" },
  { name: "Subscriptions", emoji: "🔁", kind: "expense" },
  { name: "Shopping", emoji: "🛍️", kind: "expense" },
  { name: "Health", emoji: "💊", kind: "expense" },
  { name: "Fun", emoji: "🎟️", kind: "expense" },
  { name: "Others", emoji: "📦", kind: "expense" },
  { name: "Salary", emoji: "💼", kind: "income" },
  { name: "Freelance", emoji: "🧑‍💻", kind: "income" },
  { name: "Gifts", emoji: "🎁", kind: "income" },
  { name: "Others", emoji: "💵", kind: "income" },
]
