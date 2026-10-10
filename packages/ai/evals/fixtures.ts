/**
 * Labeled entries for the live categorization eval. Each is run twice:
 * signed (to grade the category) and unsigned (to grade money in/out).
 * `also` lists other categories a reasonable person might pick.
 */
export interface Fixture {
  entry: string
  /** Pesos. */
  amount: number
  kind: "expense" | "income"
  category: string
  also?: string[]
}

export const FIXTURES: Fixture[] = [
  { entry: "lunch at berto's", amount: 250, kind: "expense", category: "Food" },
  { entry: "jollibee", amount: 189, kind: "expense", category: "Food" },
  { entry: "starbucks", amount: 220, kind: "expense", category: "Food" },
  { entry: "grabfood dinner", amount: 450, kind: "expense", category: "Food" },
  { entry: "kape", amount: 120, kind: "expense", category: "Food" },
  { entry: "puregold", amount: 2300, kind: "expense", category: "Groceries" },
  {
    entry: "sm supermarket",
    amount: 3100,
    kind: "expense",
    category: "Groceries",
  },
  { entry: "palengke", amount: 600, kind: "expense", category: "Groceries" },
  { entry: "grab to bgc", amount: 180, kind: "expense", category: "Transport" },
  { entry: "jeep", amount: 13, kind: "expense", category: "Transport" },
  { entry: "angkas pauwi", amount: 95, kind: "expense", category: "Transport" },
  { entry: "gas shell", amount: 1500, kind: "expense", category: "Transport" },
  {
    entry: "beep card load",
    amount: 200,
    kind: "expense",
    category: "Transport",
  },
  { entry: "meralco", amount: 2800, kind: "expense", category: "Bills" },
  { entry: "pldt fiber", amount: 1699, kind: "expense", category: "Bills" },
  { entry: "globe load", amount: 99, kind: "expense", category: "Bills" },
  { entry: "rent", amount: 12000, kind: "expense", category: "Bills" },
  { entry: "maynilad", amount: 450, kind: "expense", category: "Bills" },
  { entry: "netflix", amount: 549, kind: "expense", category: "Subscriptions" },
  { entry: "spotify", amount: 149, kind: "expense", category: "Subscriptions" },
  {
    entry: "chatgpt plus",
    amount: 1100,
    kind: "expense",
    category: "Subscriptions",
  },
  {
    entry: "icloud 200gb",
    amount: 149,
    kind: "expense",
    category: "Subscriptions",
  },
  { entry: "shopee order", amount: 799, kind: "expense", category: "Shopping" },
  { entry: "uniqlo shirt", amount: 990, kind: "expense", category: "Shopping" },
  {
    entry: "lazada earphones",
    amount: 1299,
    kind: "expense",
    category: "Shopping",
  },
  { entry: "mercury drug", amount: 340, kind: "expense", category: "Health" },
  { entry: "dentist", amount: 1500, kind: "expense", category: "Health" },
  {
    entry: "gym membership",
    amount: 2500,
    kind: "expense",
    category: "Health",
    also: ["Subscriptions"],
  },
  { entry: "movie tickets", amount: 700, kind: "expense", category: "Fun" },
  { entry: "concert ticket", amount: 4500, kind: "expense", category: "Fun" },
  {
    entry: "steam game",
    amount: 899,
    kind: "expense",
    category: "Fun",
    also: ["Shopping"],
  },
  {
    entry: "haircut",
    amount: 250,
    kind: "expense",
    category: "Others",
    also: ["Health"],
  },
  {
    entry: "gave mom allowance",
    amount: 3000,
    kind: "expense",
    category: "Others",
  },
  { entry: "salary", amount: 45000, kind: "income", category: "Salary" },
  {
    entry: "payroll oct 15",
    amount: 22500,
    kind: "income",
    category: "Salary",
  },
  { entry: "13th month", amount: 45000, kind: "income", category: "Salary" },
  {
    entry: "upwork client payment",
    amount: 18000,
    kind: "income",
    category: "Freelance",
  },
  {
    entry: "commission logo design",
    amount: 5000,
    kind: "income",
    category: "Freelance",
  },
  {
    entry: "birthday money from tita",
    amount: 1000,
    kind: "income",
    category: "Gifts",
  },
  { entry: "ang pao", amount: 500, kind: "income", category: "Gifts" },
  {
    entry: "refund from shopee",
    amount: 799,
    kind: "income",
    category: "Others",
  },
  { entry: "sold old phone", amount: 8000, kind: "income", category: "Others" },
  { entry: "paid by x", amount: 250, kind: "income", category: "Others" },
]
