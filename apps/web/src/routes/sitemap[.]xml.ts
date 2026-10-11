import { createFileRoute } from "@tanstack/react-router"
import { absolute } from "@/lib/site"
import { source } from "@/lib/source"

/** Every page search engines should know about: the landing page and the docs. */
export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: () => {
        const urls = ["/", ...source.getPages().map((page) => page.url)]
        const body = urls
          .map((path) => `  <url><loc>${absolute(path)}</loc></url>`)
          .join("\n")
        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`,
          { headers: { "Content-Type": "application/xml; charset=utf-8" } }
        )
      },
    },
  },
})
