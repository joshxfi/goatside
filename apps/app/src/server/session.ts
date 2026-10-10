import { createMiddleware, createServerFn } from "@tanstack/react-start"
import { getRequestHeaders } from "@tanstack/react-start/server"
import { getAuth } from "./services"

async function readSession() {
  return getAuth().api.getSession({ headers: getRequestHeaders() })
}

/** The signed-in user, or null. Used by route guards. */
export const getViewer = createServerFn().handler(async () => {
  const session = await readSession()
  if (!session) return null
  const { id, name, email, image } = session.user
  return { id, name, email, image: image ?? null }
})

export type Viewer = NonNullable<Awaited<ReturnType<typeof getViewer>>>

/** Rejects unauthenticated calls and exposes `userId` to the handler. */
export const authMiddleware = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const session = await readSession()
    if (!session) throw new Error("Unauthorized")
    return next({ context: { userId: session.user.id } })
  }
)
