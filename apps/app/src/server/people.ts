import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { authMiddleware } from "./session"
import { MAX_CENTS } from "@workspace/core/money"
import {
  PeopleError,
  addIou,
  addPerson,
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

export const createPerson = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ name: z.string().trim().min(1).max(60) }))
  .handler(({ data }) => attempt(() => addPerson(data)))

/** A new IOU, typed by hand. */
export const recordIou = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      personId: z.uuid(),
      type: z.enum(["lent", "borrowed"]),
      amount: z.number().int().positive().max(MAX_CENTS),
      description: z.string().max(200),
      localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      accountId: z.uuid().nullable(),
    })
  )
  .handler(({ data }) => attempt(() => addIou(data)))
