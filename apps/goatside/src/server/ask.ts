import { createServerOnlyFn } from "@tanstack/react-start"
import { answerAsk } from "./ask.server"
import { aiEnabled } from "./services"
import { requireSession } from "./session"

const json = (status: number, error: string) =>
  Response.json({ error }, { status })

/** POST /api/ask: streams the agent's answer. Wrapped to stay server-only. */
export const handleAsk = createServerOnlyFn(async (request: Request) => {
  if (!(await requireSession())) return json(401, "Sign in again.")
  if (!aiEnabled()) {
    return json(
      503,
      "Questions need AI Gateway. Add AI_GATEWAY_API_KEY to your environment."
    )
  }
  const body: unknown = await request.json().catch(() => null)
  return answerAsk(body)
})
