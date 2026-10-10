import type { QueryClient } from "@tanstack/react-query"
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from "@tanstack/react-router"
import { Toaster } from "@workspace/ui/components/sonner"
import { THEME_SCRIPT } from "@workspace/ui/lib/theme"

import appCss from "@workspace/ui/globals.css?url"

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    head: () => ({
      meta: [
        { charSet: "utf-8" },
        {
          name: "viewport",
          content: "width=device-width, initial-scale=1, viewport-fit=cover",
        },
        { title: "Goatside" },
        { name: "mobile-web-app-capable", content: "yes" },
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
      <main className="mx-auto max-w-md p-4 pt-16">
        <h1 className="font-display text-4xl">Off the edge.</h1>
        <p className="mt-2 text-muted-foreground">
          That page doesn’t exist. <a href="/">Go home</a>.
        </p>
      </main>
    ),
    component: Outlet,
    shellComponent: RootDocument,
  }
)

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Toaster position="top-center" />
        <Scripts />
      </body>
    </html>
  )
}
