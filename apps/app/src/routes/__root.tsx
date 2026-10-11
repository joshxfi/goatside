import type { QueryClient } from "@tanstack/react-query"
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from "@tanstack/react-router"
import { Toaster } from "@workspace/ui/components/sonner"
import { useEffect } from "react"
import { listenForInstall, registerServiceWorker } from "@/lib/offline"
import { useDesktop } from "@/lib/use-desktop"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
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
        // iOS home screen: full screen, with the page's own colors up top.
        { name: "apple-mobile-web-app-capable", content: "yes" },
        { name: "apple-mobile-web-app-title", content: "Goatside" },
        { name: "apple-mobile-web-app-status-bar-style", content: "default" },
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
        { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      ],
    }),
    notFoundComponent: () => (
      <main className="mx-auto max-w-md p-4 pt-16">
        <h1 className="font-display text-4xl">Page not found.</h1>
        <p className="mt-2 text-muted-foreground">
          That page doesn't exist. <a href="/">Go home</a>.
        </p>
      </main>
    ),
    errorComponent: ({ error, reset }) => {
      // Offline, a page that needs fresh data can't load; say so plainly.
      const offline = typeof navigator !== "undefined" && !navigator.onLine
      return (
        <main className="mx-auto flex max-w-md flex-col gap-3 p-4 pt-16">
          <h1 className="font-display text-4xl">
            {offline ? "You're offline." : "Something went wrong."}
          </h1>
          <p className="text-muted-foreground">
            {offline
              ? "This page needs a connection. The overview still opens, and entries you log there sync when you're back."
              : error instanceof Error
                ? error.message
                : "Goatside couldn't load this page."}
          </p>
          <button
            type="button"
            onClick={reset}
            className="self-start rounded-full border px-4 py-2 text-sm active:scale-[0.97]"
          >
            Try again
          </button>
        </main>
      )
    },
    component: Outlet,
    shellComponent: RootDocument,
  }
)

function RootDocument({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    listenForInstall()
    registerServiceWorker()
  }, [])
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <HeadContent />
      </head>
      <body>
        <TooltipProvider>{children}</TooltipProvider>
        <AppToaster />
        <Scripts />
      </body>
    </html>
  )
}

/** Top of the screen on phones (clear of the composer); bottom right on desktop. */
function AppToaster() {
  const desktop = useDesktop()
  return <Toaster position={desktop ? "bottom-right" : "top-center"} />
}
