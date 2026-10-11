import { llms, loader } from "fumadocs-core/source"
import { lucideIconsPlugin } from "fumadocs-core/source/lucide-icons"
import { defineDocs } from "fumadocs-mdx/macro"

export const docsRoute = "/docs"

export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    async: true,
    postprocess: { includeProcessedMarkdown: true },
  },
})

export const source = loader({
  source: docs.toFumadocsSource(),
  baseUrl: docsRoute,
  plugins: [lucideIconsPlugin()],
})

/** Plain-text docs for /llms.txt, /llms-full.txt and each page's .md. */
export const docsLlms = llms(source, {
  renderPage: async (page) =>
    `# ${page.data.title} (${page.url})\n\n${await page.data.getText("processed")}`,
})

/** `/docs/self-hosting` → `/docs/self-hosting.md`; the index is `/docs/index.md`. */
export function toMarkdownUrl(slugs: string[]) {
  const segments = slugs.length ? [...slugs] : ["index"]
  segments[segments.length - 1] += ".md"
  return `${docsRoute}/${segments.join("/")}`
}

/** The reverse of `markdownUrl`, from the path segments after /docs. */
export function slugsFromMarkdownUrl(segments: string[]) {
  const slugs = [...segments]
  slugs[slugs.length - 1] = slugs[slugs.length - 1].replace(/\.md$/, "")
  return slugs.length === 1 && slugs[0] === "index" ? [] : slugs
}
