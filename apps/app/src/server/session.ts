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
import { and, count, eq, gte, lt } from "drizzle-orm"
import {
  SESSION_COOKIE,
  createSessionToken,
  verifyCredentials,
  verifySessionToken,
} from "@workspace/auth"
import { schema, seedDefaults } from "@workspace/db"
import { authConfig, getDb } from "./services"

const RENEW_WHEN_LEFT_MS = 15 * 24 * 60 * 60 * 1000
const THROTTLE_WINDOW_MS = 15 * 60 * 1000
/** Failed attempts allowed per IP, and across all IPs, per window. */
const MAX_FAILURES_PER_IP = 5
const MAX_FAILURES_TOTAL = 25

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

/**
 * Checks credentials with throttling. Called from the POST handler on
 * /login, which works as a plain HTML form before hydration. Wrapped so the
 * compiler drops it (and its database imports) from client bundles.
 */
export const attemptSignIn = createServerOnlyFn(async function (
  input: { username: string; password: string },
  ip: string
): Promise<{ ok: true } | { ok: false; error: SignInError }> {
  const { loginAttempts } = schema
  const db = getDb()
  const since = new Date(Date.now() - THROTTLE_WINDOW_MS)
  const failures = (where?: ReturnType<typeof eq>) =>
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

  const [byIp, total] = await Promise.all([
    failures(eq(loginAttempts.ip, ip)),
    failures(),
  ])
  if (byIp >= MAX_FAILURES_PER_IP || total >= MAX_FAILURES_TOTAL) {
    return { ok: false, error: "throttled" }
  }

  const ok = await verifyCredentials(input, authConfig())
  await db.insert(loginAttempts).values({ ip, succeeded: ok })
  // Rows only matter within the throttle window; keep a day for context.
  await db
    .delete(loginAttempts)
    .where(
      lt(loginAttempts.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000))
    )

  if (!ok) return { ok: false, error: "invalid" }
  await seedDefaults(db)
  return { ok: true }
})

/** A Set-Cookie header value for a fresh session. */
export const sessionCookieHeader = createServerOnlyFn(async () => {
  const { token, expiresAt } = await createSessionToken(authConfig())
  return [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${new Date(expiresAt).toUTCString()}`,
    process.env.NODE_ENV === "production" ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ")
})

export const signOut = createServerFn({ method: "POST" }).handler(async () => {
  deleteCookie(SESSION_COOKIE, { path: "/" })
})
