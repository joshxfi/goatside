import { env as workerEnv } from "cloudflare:workers"
import { z } from "zod"

const schema = z.object({
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "generate one with `openssl rand -base64 32`"),
  BETTER_AUTH_URL: z.url(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  ALLOWED_EMAILS: z.string().min(3, "add at least one email"),
  TURSO_DATABASE_URL: z.string().min(1),
  TURSO_AUTH_TOKEN: z.string().optional(),
})

export type ServerEnv = z.infer<typeof schema>

let parsed: ServerEnv | undefined

/** Validated server config. Throws once, loudly, with every problem listed. */
export function serverEnv(): ServerEnv {
  if (parsed) return parsed
  const result = schema.safeParse(workerEnv)
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n")
    throw new Error(
      `Goatside is misconfigured. Check .dev.vars or your Worker secrets:\n${problems}`
    )
  }
  parsed = result.data
  return parsed
}
