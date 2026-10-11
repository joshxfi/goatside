import { createFileRoute, notFound } from "@tanstack/react-router"
import { docsLlms, slugsFromMarkdownUrl, source } from "@/lib/source"

// A page as Markdown, for "Copy Markdown" and for agents: /docs/self-hosting.md
export const Route = createFileRoute("/docs/{$}.md")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const page = source.getPage(
          slugsFromMarkdownUrl(params._splat?.split("/") ?? [])
        )
        if (!page) throw notFound()

        return new Response(await docsLlms.page(page), {
          headers: { "Content-Type": "text/markdown; charset=utf-8" },
        })
      },
    },
  },
})
