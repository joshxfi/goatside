import { createCsrfMiddleware } from "@tanstack/react-start"
import { createFileRoute } from "@tanstack/react-router"
import { handleAsk } from "@/server/ask"

export const Route = createFileRoute("/api/ask")({
  server: {
    middleware: [createCsrfMiddleware()],
    handlers: {
      POST: ({ request }) => handleAsk(request),
    },
  },
})
