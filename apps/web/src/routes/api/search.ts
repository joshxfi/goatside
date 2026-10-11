import { createFileRoute } from "@tanstack/react-router"
import { createFromSource } from "fumadocs-core/search/server"
import { source } from "@/lib/source"

const server = createFromSource(source, { language: "english" })

// Prerendered to a static index that the search dialog downloads and queries
// in the browser (src/components/search.tsx).
export const Route = createFileRoute("/api/search")({
  server: { handlers: { GET: async () => server.staticGET() } },
})
