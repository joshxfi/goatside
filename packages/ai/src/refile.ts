/**
 * "Which of my existing entries belong in this new category?" Re-asks the
 * decision model about recent entries with the full category list, and
 * suggests the ones whose best fit is now the target.
 */
import type { Experimental_DecisionModel } from "ai"
import { type CategoryOption, askModel } from "./categorize"

/** A suggestion needs at least this probability for the target category. */
export const SUGGEST_REFILE = 0.7

export interface RefileCandidate {
  id: string
  description: string
  /** Absolute centavos. */
  amount: number
  kind: "expense" | "income"
}

async function pool<T, R>(
  items: T[],
  size: number,
  run: (item: T) => Promise<R>
) {
  const results: R[] = []
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        results[i] = await run(items[i] as T)
      }
    })
  )
  return results
}

export async function suggestRefiles(
  model: Experimental_DecisionModel,
  entries: RefileCandidate[],
  categories: CategoryOption[],
  targetId: string,
  { abortSignal }: { abortSignal?: AbortSignal } = {}
): Promise<{ id: string; p: number }[]> {
  // Judge on names and hints alone: examples come from how entries are filed
  // now, so they'd vote for the status quo ("kape" is a Food example).
  const neutral = categories.map((c) => ({ ...c, examples: [] }))
  const results = await pool(entries, 8, async (entry) => {
    try {
      const signals = await askModel(
        model,
        {
          description: entry.description,
          amount: entry.amount,
          direction: entry.kind === "income" ? "in" : "out",
        },
        neutral,
        { abortSignal }
      )
      const ranking = entry.kind === "income" ? signals.income : signals.expense
      const top = ranking?.[0]
      return top?.id === targetId && top.p >= SUGGEST_REFILE
        ? { id: entry.id, p: top.p }
        : null
    } catch {
      return null
    }
  })
  return results.filter((r) => r !== null).toSorted((a, b) => b.p - a.p)
}
