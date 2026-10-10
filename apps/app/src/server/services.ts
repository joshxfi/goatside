import { type Auth, createAuth } from "@workspace/auth"
import { type Db, createDb } from "@workspace/db"
import { serverEnv } from "./env"

// Created lazily (env is read on first use) and reused for the server's lifetime.
let db: Db | undefined
let auth: Auth | undefined

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

export function getAuth(): Auth {
  auth ??= createAuth({ db: getDb(), env: serverEnv() })
  return auth
}
