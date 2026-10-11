import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router"
import { RootProvider } from "fumadocs-ui/provider/tanstack"
import { THEME_SCRIPT } from "@workspace/ui/lib/theme"
import { DocsSearchDialog } from "@/components/search"
import {
  AUTHOR,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TITLE,
  absolute,
} from "@/lib/site"

import appCss from "@/styles/app.css?url"

const OG_ALT =
  "Goatside: type what you spent, it files itself. An open-source, self-hosted finance tracker."

export const Route = createRootRoute({
  // Defaults for every page; the landing page and docs pages add their own
  // title, description and canonical link.
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: SITE_TITLE },
      { name: "description", content: SITE_DESCRIPTION },
      { name: "author", content: AUTHOR.name },
      { property: "og:site_name", content: SITE_NAME },
      { property: "og:type", content: "website" },
      { property: "og:locale", content: "en_US" },
      { property: "og:title", content: SITE_TITLE },
      { property: "og:description", content: SITE_DESCRIPTION },
      { property: "og:image", content: absolute("/og.png") },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: OG_ALT },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: SITE_TITLE },
      { name: "twitter:description", content: SITE_DESCRIPTION },
      { name: "twitter:image", content: absolute("/og.png") },
      { name: "twitter:image:alt", content: OG_ALT },
      {
        name: "theme-color",
        content: "#f7f5f0",
        media: "(prefers-color-scheme: light)",
      },
      {
        name: "theme-color",
        content: "#0f0e0c",
        media: "(prefers-color-scheme: dark)",
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/manifest.json" },
    ],
  }),
  notFoundComponent: () => (
    <main className="mx-auto max-w-xl p-4 pt-16">
      <h1 className="font-display text-4xl">Page not found.</h1>
      <p className="mt-2 text-muted-foreground">
        That page doesn't exist. <a href="/">Go to the home page</a>.
      </p>
    </main>
  ),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <HeadContent />
      </head>
      <body>
        {/* Light or dark follows the system (THEME_SCRIPT), as in the app. */}
        <RootProvider
          theme={{ enabled: false }}
          search={{ SearchDialog: DocsSearchDialog }}
        >
          {children}
        </RootProvider>
        <Scripts />
      </body>
    </html>
  )
}
