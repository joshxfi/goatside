import { z } from "zod"

const schema = z.object({
  GOATSIDE_USERNAME: z.string().trim().min(1, "is empty"),
  GOATSIDE_PASSWORD: z
    .string()
    // The app is on a public URL.
    .min(12, "is shorter than 12 characters"),
  SESSION_SECRET: z.string().min(32, "is shorter than 32 characters"),
  TURSO_DATABASE_URL: z.string().min(1, "is empty"),
  TURSO_AUTH_TOKEN: z.string().optional(),
  // AI Gateway. On Vercel it authenticates through OIDC, so the key is only
  // needed elsewhere. Without either, Goatside works without AI.
  AI_GATEWAY_API_KEY: z.string().optional(),
  DECISION_MODEL: z.string().trim().min(1).default("typesafe-ai/jev"),
  CHAT_MODEL: z.string().trim().min(1).default("deepseek/deepseek-v4.1-flash"),
})

export type ServerEnv = z.infer<typeof schema>

export interface EnvProblem {
  name: string
  problem: string
}

/** Every missing or invalid variable, one each. Empty when the env is fine. */
export function envProblems(): EnvProblem[] {
  const result = schema.safeParse(process.env)
  if (result.success) return []
  return result.error.issues.map((issue) => {
    const name = issue.path.join(".")
    return {
      name,
      problem: process.env[name] ? issue.message : "isn't set",
    }
  })
}

let parsed: ServerEnv | undefined

/** Validated server config. Throws once, loudly, with every problem listed. */
export function serverEnv(): ServerEnv {
  if (parsed) return parsed
  const problems = envProblems()
  if (problems.length > 0) {
    const list = problems
      .map(({ name, problem }) => `  - ${name}: ${problem}`)
      .join("\n")
    throw new Error(
      `Goatside is misconfigured. Check apps/goatside/.env.local (or your Vercel project's environment variables):\n${list}`
    )
  }
  parsed = schema.parse(process.env)
  return parsed
}
