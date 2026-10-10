import {
  createMiddleware,
  createServerFn,
  createServerOnlyFn,
} from "@tanstack/react-start"
import {
  deleteCookie,
  getCookie,
  getRequestIP,
  setCookie,
} from "@tanstack/react-start/server"
import { type SQL, and, count, eq, gte, isNull, lt } from "drizzle-orm"
import {
  DEVICE_COOKIE,
  DEVICE_TTL_MS,
  SESSION_COOKIE,
  createDeviceToken,
  createSessionToken,
  verifyCredentials,
  verifyDeviceToken,
  verifySessionToken,
} from "@workspace/auth"
import { schema, seedDefaults } from "@workspace/db"
import { authConfig, getDb } from "./services"

const RENEW_WHEN_LEFT_MS = 15 * 24 * 60 * 60 * 1000
const THROTTLE_WINDOW_MS = 15 * 60 * 1000
/**
 * Failed attempts allowed per window. Unknown browsers share per-IP and
 * global caps; a trusted device (one that has signed in before) only has
 * its own cap, so an attacker filling the global cap can't lock the owner out.
 */
const MAX_FAILURES_PER_IP = 5
const MAX_FAILURES_TOTAL = 25
const MAX_FAILURES_PER_DEVICE = 10

async function writeSessionCookie() {
  const { token, expiresAt } = await createSessionToken(authConfig())
  setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAt),
  })
}

/** Whether this request carries a valid session; renews it when it's past halfway. */
async function hasSession(): Promise<boolean> {
  const session = await verifySessionToken(
    getCookie(SESSION_COOKIE),
    authConfig()
  )
  if (!session) return false
  if (session.expiresAt - Date.now() < RENEW_WHEN_LEFT_MS)
    await writeSessionCookie()
  return true
}

/** The owner's username if signed in, otherwise null. Used by route guards. */
export const getViewer = createServerFn().handler(async () => {
  return (await hasSession()) ? { username: authConfig().username } : null
})

export type Viewer = NonNullable<Awaited<ReturnType<typeof getViewer>>>

/** Rejects calls without a valid session. */
export const authMiddleware = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    if (!(await hasSession())) throw new Error("Unauthorized")
    return next()
  }
)

// Vercel sets X-Forwarded-For at its edge, so it can't be spoofed by clients.
export const clientIp = createServerOnlyFn(
  () => getRequestIP({ xForwardedFor: true }) ?? "unknown"
)

export type SignInError = "invalid" | "throttled"

function serializeCookie(name: string, value: string, expiresAt: number) {
  return [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${new Date(expiresAt).toUTCString()}`,
    process.env.NODE_ENV === "production" ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ")
}

/**
 * Checks credentials with throttling and returns the Set-Cookie values to
 * send on success. Called from the POST handler on /login, which works as a
 * plain HTML form before hydration. Wrapped so the compiler drops it (and
 * its database imports) from client bundles.
 */
export const attemptSignIn = createServerOnlyFn(async function (
  input: { username: string; password: string },
  ip: string
): Promise<
  { ok: true; cookies: string[] } | { ok: false; error: SignInError }
> {
  const { loginAttempts } = schema
  const db = getDb()
  const config = authConfig()
  const deviceId = await verifyDeviceToken(
    getCookie(DEVICE_COOKIE),
    config.secret
  )

  // Record the attempt before counting, so concurrent requests can't all
  // pass the check: the Nth parallel attempt always sees at least N rows.
  const [attempt] = await db
    .insert(loginAttempts)
    .values({ ip, deviceId, succeeded: false })
    .returning({ id: loginAttempts.id })
  if (!attempt) throw new Error("Could not record sign-in attempt")

  const since = new Date(Date.now() - THROTTLE_WINDOW_MS)
  const failures = (where: SQL | undefined) =>
    db
      .select({ n: count() })
      .from(loginAttempts)
      .where(
        and(
          eq(loginAttempts.succeeded, false),
          gte(loginAttempts.createdAt, since),
          where
        )
      )
      .then(([row]) => row?.n ?? 0)

  let throttled: boolean
  if (deviceId) {
    throttled =
      (await failures(eq(loginAttempts.deviceId, deviceId))) >
      MAX_FAILURES_PER_DEVICE
  } else {
    const [byIp, total] = await Promise.all([
      failures(and(eq(loginAttempts.ip, ip), isNull(loginAttempts.deviceId))),
      failures(isNull(loginAttempts.deviceId)),
    ])
    throttled = byIp > MAX_FAILURES_PER_IP || total > MAX_FAILURES_TOTAL
  }

  // Rows only matter within the throttle window; keep a day for context.
  await db
    .delete(loginAttempts)
    .where(
      lt(loginAttempts.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000))
    )

  if (throttled) return { ok: false, error: "throttled" }
  if (!(await verifyCredentials(input, config))) {
    return { ok: false, error: "invalid" }
  }

  await db
    .update(loginAttempts)
    .set({ succeeded: true })
    .where(eq(loginAttempts.id, attempt.id))
  await seedDefaults(db)

  const session = await createSessionToken(config)
  const cookies = [
    serializeCookie(SESSION_COOKIE, session.token, session.expiresAt),
  ]
  if (!deviceId) {
    const device = await createDeviceToken(config.secret)
    cookies.push(
      serializeCookie(DEVICE_COOKIE, device.token, Date.now() + DEVICE_TTL_MS)
    )
  }
  return { ok: true, cookies }
})

export const signOut = createServerFn({ method: "POST" }).handler(async () => {
  deleteCookie(SESSION_COOKIE, { path: "/" })
})
