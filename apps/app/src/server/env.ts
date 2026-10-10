import { z } from "zod"

const schema = z.object({
  GOATSIDE_USERNAME: z
    .string()
    .trim()
    .min(1, "set the username you'll sign in with"),
  GOATSIDE_PASSWORD: z
    .string()
    .min(12, "use at least 12 characters; this app is on a public URL"),
  SESSION_SECRET: z
    .string()
    .min(32, "generate one with `openssl rand -base64 32`"),
  TURSO_DATABASE_URL: z.string().min(1),
  TURSO_AUTH_TOKEN: z.string().optional(),
})

export type ServerEnv = z.infer<typeof schema>

let parsed: ServerEnv | undefined

/** Validated server config. Throws once, loudly, with every problem listed. */
export function serverEnv(): ServerEnv {
  if (parsed) return parsed
  const result = schema.safeParse(process.env)
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n")
    throw new Error(
      `Goatside is misconfigured. Check apps/app/.env.local (or your Vercel project's environment variables):\n${problems}`
    )
  }
  parsed = result.data
  return parsed
}
