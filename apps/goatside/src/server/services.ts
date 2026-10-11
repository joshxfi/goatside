import type { AuthConfig } from "@workspace/auth"
import { type Db, createDb } from "@workspace/db"
import { serverEnv } from "./env"

// Created lazily (env is read on first use) and reused for the server's lifetime.
let db: Db | undefined

export function getDb(): Db {
  if (!db) {
    const env = serverEnv()
    db = createDb({
      url: env.TURSO_DATABASE_URL,
      authToken: env.TURSO_AUTH_TOKEN || undefined,
    })
  }
  return db
}

export function authConfig(): AuthConfig {
  const env = serverEnv()
  return {
    username: env.GOATSIDE_USERNAME,
    password: env.GOATSIDE_PASSWORD,
    secret: env.SESSION_SECRET,
  }
}

/** Whether AI Gateway is reachable: an API key, or Vercel's OIDC token. */
export function aiEnabled(): boolean {
  return Boolean(serverEnv().AI_GATEWAY_API_KEY || process.env.VERCEL)
}
