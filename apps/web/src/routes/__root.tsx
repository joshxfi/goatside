import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router"
import { THEME_SCRIPT } from "@workspace/ui/lib/theme"

import appCss from "@workspace/ui/globals.css?url"

const DESCRIPTION =
  "An open-source, self-hostable finance tracker you talk to. Type “-500 lunch at berto's” and it files itself."

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Goatside · Which side of the coin are you on?" },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "Goatside" },
      { property: "og:description", content: DESCRIPTION },
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
      { rel: "manifest", href: "/manifest.json" },
    ],
  }),
  notFoundComponent: () => (
    <main className="mx-auto max-w-xl p-4 pt-16">
      <h1 className="font-display text-4xl">Off the edge.</h1>
      <p className="mt-2 text-muted-foreground">
        That page doesn’t exist. <a href="/">Head back home</a>.
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
        {children}
        <Scripts />
      </body>
    </html>
  )
}
