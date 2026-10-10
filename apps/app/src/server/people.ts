import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { authMiddleware } from "./session"
import {
  PeopleError,
  draftReminder,
  mergePeople,
  peopleOverview,
  personDetail,
  updatePerson,
} from "./people.server"

export type { PeopleOverview, PersonDetail } from "./people.server"

async function attempt<T>(run: () => Promise<T>) {
  try {
    return { ok: true as const, value: await run() }
  } catch (error) {
    if (error instanceof PeopleError)
      return { ok: false as const, message: error.message }
    throw error
  }
}

export const getPeople = createServerFn()
  .middleware([authMiddleware])
  .handler(() => peopleOverview())

export const getPerson = createServerFn()
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid() }))
  .handler(({ data }) => personDetail(data.id))

export const editPerson = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      id: z.uuid(),
      name: z.string().trim().min(1).max(60).optional(),
      aliases: z.array(z.string().max(40)).max(12).optional(),
    })
  )
  .handler(({ data }) => attempt(() => updatePerson(data)))

export const mergePerson = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ from: z.uuid(), into: z.uuid() }))
  .handler(({ data }) => attempt(() => mergePeople(data)))

export const remindPerson = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid() }))
  .handler(({ data }) => attempt(() => draftReminder(data.id)))
