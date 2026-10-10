import { betterAuth, type BetterAuthPlugin } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { tanstackStartCookies } from "better-auth/tanstack-start"
import { DEFAULT_CATEGORIES } from "@workspace/core/categories"
import { type Db, schema } from "@workspace/db"

export interface AuthEnv {
  BETTER_AUTH_SECRET: string
  BETTER_AUTH_URL: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  /** Comma-separated emails allowed to sign in. */
  ALLOWED_EMAILS: string
}

export function parseAllowlist(value: string): Set<string> {
  return new Set(
    value
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  )
}

/** Creates the user's profile and starter categories. Safe to run twice. */
export async function seedUser(db: Db, userId: string) {
  await db.insert(schema.profiles).values({ userId }).onConflictDoNothing()
  await db
    .insert(schema.categories)
    .values(
      DEFAULT_CATEGORIES.map((category, sort) => ({
        ...category,
        userId,
        sort,
      }))
    )
    .onConflictDoNothing()
}

/**
 * Better Auth for one self-hosted instance: Google sign-in only, limited
 * to `ALLOWED_EMAILS`. Built per request because Workers env isn't global.
 */
export function createAuth({
  db,
  env,
  plugins = [],
}: {
  db: Db
  env: AuthEnv
  /** Extra plugins (e.g. test utilities in scripts). */
  plugins?: BetterAuthPlugin[]
}) {
  const allowed = parseAllowlist(env.ALLOWED_EMAILS)

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        prompt: "select_account",
      },
    },
    user: {
      // Runs on account creation and on every Google sign-in, so removing
      // an email from the allowlist locks that person out too.
      validateUserInfo: ({ user }) => {
        const email = user.email?.toLowerCase()
        if (!email || !allowed.has(email)) {
          return {
            error: "not_allowed",
            errorDescription: "This Goatside is private.",
          }
        }
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await seedUser(db, user.id)
          },
        },
      },
    },
    // OAuth failures (e.g. not on the allowlist) land on our sign-in page as ?error=…
    onAPIError: { errorURL: "/login" },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    // Must stay last: forwards Set-Cookie through TanStack Start.
    plugins: [...plugins, tanstackStartCookies()],
  })
}

export type Auth = ReturnType<typeof createAuth>
export type Session = Auth["$Infer"]["Session"]
