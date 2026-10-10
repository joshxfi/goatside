import { createMiddleware, createServerFn } from "@tanstack/react-start"
import { getRequestHeaders } from "@tanstack/react-start/server"
import { parseAllowlist } from "@workspace/auth"
import { serverEnv } from "./env"
import { getAuth } from "./services"

/**
 * The current session, but only for allowlisted users. The allowlist is
 * also enforced at sign-in; checking here too means removing an email from
 * ALLOWED_EMAILS revokes access immediately, not when the session expires.
 */
async function readSession() {
  const session = await getAuth().api.getSession({
    headers: getRequestHeaders(),
  })
  if (!session) return null
  const allowed = parseAllowlist(serverEnv().ALLOWED_EMAILS)
  return allowed.has(session.user.email.toLowerCase()) ? session : null
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
