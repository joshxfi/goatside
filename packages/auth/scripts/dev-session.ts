/**
 * Local development only: signs in the first ALLOWED_EMAILS user without
 * Google, for testing the app before OAuth credentials exist and for e2e.
 *
 *   pnpm --filter @workspace/auth dev-session
 *
 * Prints the session cookie as JSON. Reads apps/app/.env.local and refuses
 * to run against anything but a local database.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { type TestHelpers, testUtils } from "better-auth/plugins"
import { createDb, schema } from "@workspace/db"
import {
  type AuthEnv,
  createAuth,
  parseAllowlist,
  seedUser,
} from "../src/index"

const varsPath = resolve(import.meta.dirname, "../../../apps/app/.env.local")
const vars = Object.fromEntries(
  readFileSync(varsPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const i = line.indexOf("=")
      const value = line
        .slice(i + 1)
        .trim()
        .replace(/^(["'])(.*)\1$/, "$2")
      return [line.slice(0, i).trim(), value]
    })
) as Record<string, string>

const url = vars.TURSO_DATABASE_URL ?? ""
if (!/^(http:\/\/(127\.0\.0\.1|localhost)|file:)/.test(url)) {
  console.error(`Refusing to create a dev session against ${url || "(unset)"}.`)
  process.exit(1)
}

const [email] = parseAllowlist(vars.ALLOWED_EMAILS ?? "")
if (!email) {
  console.error("Set ALLOWED_EMAILS in apps/app/.env.local first.")
  process.exit(1)
}

const db = createDb({ url })
const auth = createAuth({
  db,
  env: vars as unknown as AuthEnv,
  plugins: [testUtils()],
})
// createAuth types plugins loosely, so name the helper type explicitly.
const { test } = (await auth.$context) as unknown as { test: TestHelpers }

const existing = await db.query.user.findFirst({
  where: (user, { eq }) => eq(user.email, email),
})
// Insert directly: the allowlist hook only runs inside real auth requests.
let userId = existing?.id
if (!userId) {
  userId = crypto.randomUUID()
  await db.insert(schema.user).values({
    id: userId,
    email,
    name: email.split("@")[0] ?? email,
    emailVerified: true,
  })
}
await seedUser(db, userId)

const cookies = await test.getCookies({ userId, domain: "localhost" })
console.log(JSON.stringify(cookies))
