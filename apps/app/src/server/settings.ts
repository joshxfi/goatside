import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { suggestForCategory } from "./agent.server"
import { getDb } from "./services"
import { authMiddleware } from "./session"
import {
  SettingsError,
  categoriesWithStats,
  createCategory,
  mergeCategory,
  refile,
  setTimeZone,
  updateCategory,
} from "./settings.server"

export type { CategoriesView } from "./settings.server"

const NAME = z.string().trim().min(1).max(40)
const EMOJI = z.string().trim().min(1).max(16)

/** Expected failures come back as `{ ok: false, message }` for a toast. */
async function attempt<T>(run: () => Promise<T>) {
  try {
    return { ok: true as const, value: await run() }
  } catch (error) {
    if (error instanceof SettingsError)
      return { ok: false as const, message: error.message }
    throw error
  }
}

export const getCategories = createServerFn()
  .middleware([authMiddleware])
  .handler(() => categoriesWithStats())

export const addCategory = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({ kind: z.enum(["expense", "income"]), name: NAME, emoji: EMOJI })
  )
  .handler(({ data }) => attempt(() => createCategory(data)))

export const editCategory = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      id: z.uuid(),
      name: NAME.optional(),
      emoji: EMOJI.optional(),
      archived: z.boolean().optional(),
    })
  )
  .handler(({ data }) => attempt(() => updateCategory(data)))

export const mergeCategories = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ from: z.uuid(), into: z.uuid() }))
  .handler(({ data }) => attempt(() => mergeCategory(data)))

export const updateTimeZone = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ timeZone: z.string().min(1).max(64) }))
  .handler(({ data }) => attempt(() => setTimeZone(data.timeZone)))

/** Entries the agent thinks belong in a (new) category. */
export const getRefileSuggestions = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ categoryId: z.uuid() }))
  .handler(({ data }) => suggestForCategory(getDb(), data.categoryId))

export const applyRefile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({ ids: z.array(z.uuid()).min(1).max(100), categoryId: z.uuid() })
  )
  .handler(({ data }) => attempt(() => refile(data.ids, data.categoryId)))
