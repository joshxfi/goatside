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
import { type SQL, and, count, eq, gte, lt } from "drizzle-orm"
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
import { aiEnabled, authConfig, getDb } from "./services"
import { loadCurrency } from "./settings.server"

const RENEW_WHEN_LEFT_MS = 15 * 24 * 60 * 60 * 1000
const THROTTLE_WINDOW_MS = 15 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
/**
 * Failed attempts allowed per 15-minute window, per IP and overall. These
 * count every failure, trusted device or not.
 */
const MAX_FAILURES_PER_IP = 5
const MAX_FAILURES_TOTAL = 25
/**
 * A trusted device (one that signed in under the current credentials)
 * bypasses the caps above, so an attacker filling them can't lock the owner
 * out. That privilege only lasts while the device has at most this many
 * failures in 24 hours; past it, the device is treated like any browser.
 * A stolen device cookie is therefore worth 10 extra guesses a day, at most.
 */
const MAX_TRUSTED_DEVICE_FAILURES_PER_DAY = 10

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
  return (await hasSession())
    ? {
        username: authConfig().username,
        ai: aiEnabled(),
        currency: await loadCurrency(getDb()),
        // shadcn's sidebar remembers open/collapsed in this cookie.
        sidebarOpen: getCookie("sidebar_state") !== "false",
      }
    : null
})

export type Viewer = NonNullable<Awaited<ReturnType<typeof getViewer>>>

/** For server routes: whether the request is signed in. */
export const requireSession = createServerOnlyFn(hasSession)

/** Rejects calls without a valid session. */
export const authMiddleware = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    if (!(await hasSession())) throw new Error("Unauthorized")
    await loadCurrency(getDb())
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
  const deviceId = await verifyDeviceToken(getCookie(DEVICE_COOKIE), config)

  // Record the attempt before counting, so concurrent requests can't all
  // pass the check: the Nth parallel attempt always sees at least N rows.
  const [attempt] = await db
    .insert(loginAttempts)
    .values({ ip, deviceId, succeeded: false })
    .returning({ id: loginAttempts.id })
  if (!attempt) throw new Error("Could not record sign-in attempt")

  const failures = (where: SQL | undefined, windowMs = THROTTLE_WINDOW_MS) =>
    db
      .select({ n: count() })
      .from(loginAttempts)
      .where(
        and(
          eq(loginAttempts.succeeded, false),
          gte(loginAttempts.createdAt, new Date(Date.now() - windowMs)),
          where
        )
      )
      .then(([row]) => row?.n ?? 0)

  const trusted =
    deviceId !== null &&
    (await failures(eq(loginAttempts.deviceId, deviceId), DAY_MS)) <=
      MAX_TRUSTED_DEVICE_FAILURES_PER_DAY

  let throttled = false
  if (!trusted) {
    const [byIp, total] = await Promise.all([
      failures(eq(loginAttempts.ip, ip)),
      failures(undefined),
    ])
    throttled = byIp > MAX_FAILURES_PER_IP || total > MAX_FAILURES_TOTAL
  }

  // The longest window is a day (trusted-device failures); older rows are dead.
  await db
    .delete(loginAttempts)
    .where(lt(loginAttempts.createdAt, new Date(Date.now() - DAY_MS)))

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
    const device = await createDeviceToken(config)
    cookies.push(
      serializeCookie(DEVICE_COOKIE, device.token, Date.now() + DEVICE_TTL_MS)
    )
  }
  return { ok: true, cookies }
})

export const signOut = createServerFn({ method: "POST" }).handler(async () => {
  deleteCookie(SESSION_COOKIE, { path: "/" })
})
