import { drizzle } from "drizzle-orm/libsql/web"
import * as schema from "./schema"

export interface DbConfig {
  url: string
  authToken?: string
}

/**
 * Creates a Drizzle client over libSQL's HTTP protocol, which works on
 * Cloudflare Workers and against a local `turso dev` server alike.
 */
export function createDb({ url, authToken }: DbConfig) {
  return drizzle({ connection: { url, authToken }, schema })
}

export type Db = ReturnType<typeof createDb>

export { schema }
