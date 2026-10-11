import { Suspense, use } from "react"
import { createFileRoute, notFound } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { useFumadocsLoader } from "fumadocs-core/source/client"
import { DocsLayout } from "fumadocs-ui/layouts/docs"
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from "fumadocs-ui/layouts/docs/page"
import { useMDXComponents } from "@/components/mdx"
import { baseOptions } from "@/lib/layout"
import { REPO_BRANCH, REPO_URL, absolute } from "@/lib/site"
import { docs, source, toMarkdownUrl } from "@/lib/source"

export const Route = createFileRoute("/docs/$")({
  component: Page,
  loader: async ({ params }) => {
    const data = await loadPage({ data: params._splat?.split("/") ?? [] })
    await docs.getPage(data.path)?.preload()
    return data
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {}
    const title = `${loaderData.title} · Goatside docs`
    const url = absolute(loaderData.url)
    return {
      meta: [
        { title },
        { name: "description", content: loaderData.description },
        { property: "og:type", content: "article" },
        { property: "og:url", content: url },
        { property: "og:title", content: title },
        { property: "og:description", content: loaderData.description },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: loaderData.description },
      ],
      links: [
        { rel: "canonical", href: url },
        // The same page as Markdown, for LLMs and tools.
        {
          rel: "alternate",
          type: "text/markdown",
          href: loaderData.markdownUrl,
        },
      ],
    }
  },
})

const loadPage = createServerFn({ method: "GET" })
  .validator((slugs: string[]) => slugs)
  .handler(async ({ data: slugs }) => {
    const page = source.getPage(slugs)
    if (!page) throw notFound()

    return {
      path: page.path,
      url: page.url,
      title: page.data.title,
      description: page.data.description ?? "",
      markdownUrl: toMarkdownUrl(page.slugs),
      pageTree: await source.serializePageTree(source.getPageTree()),
    }
  })

function Page() {
  const { path, pageTree, markdownUrl } = useFumadocsLoader(
    Route.useLoaderData()
  )

  return (
    <DocsLayout {...baseOptions()} tree={pageTree}>
      <Suspense>
        <Content path={path} markdownUrl={markdownUrl} />
      </Suspense>
    </DocsLayout>
  )
}

function Content({ path, markdownUrl }: { path: string; markdownUrl: string }) {
  const page = docs.getPage(path)
  if (!page) throw new Error(`Unknown docs page: ${path}`)

  const { toc } = use(page.load())
  const MDX = page.body

  return (
    <DocsPage toc={toc}>
      <DocsTitle className="font-display text-4xl font-normal tracking-tight md:text-5xl">
        {page.title}
      </DocsTitle>
      <DocsDescription>{page.description}</DocsDescription>
      <div className="-mt-4 flex items-center gap-2 border-b pb-6">
        <MarkdownCopyButton markdownUrl={markdownUrl} />
        <ViewOptionsPopover
          markdownUrl={markdownUrl}
          githubUrl={`${REPO_URL}/blob/${REPO_BRANCH}/apps/web/content/docs/${path}`}
        />
      </div>
      <DocsBody>
        <MDX components={useMDXComponents()} />
      </DocsBody>
    </DocsPage>
  )
}
