import type { QueryClient } from "@tanstack/react-query"
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from "@tanstack/react-router"
import { Toaster } from "@workspace/ui/components/sonner"
import { useEffect } from "react"
import {
  isNetworkError,
  isStaleBuild,
  listenForInstall,
  registerServiceWorker,
  reloadToRecover,
  triedReloading,
} from "@/lib/offline"
import { useDesktop } from "@/lib/use-desktop"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { THEME_SCRIPT } from "@workspace/ui/lib/theme"

import appCss from "@workspace/ui/globals.css?url"

/**
 * iOS launch screens (public/splash), one per screen size and theme, made
 * from the app icon. CSS width, height and pixel ratio, portrait.
 */
const SPLASH_SIZES = [
  [440, 956, 3],
  [402, 874, 3],
  [430, 932, 3],
  [393, 852, 3],
  [428, 926, 3],
  [390, 844, 3],
  [375, 812, 3],
  [414, 896, 3],
  [414, 896, 2],
  [375, 667, 2],
  [820, 1180, 2],
  [834, 1194, 2],
  [1024, 1366, 2],
] as const
const SPLASH_SCREENS = SPLASH_SIZES.flatMap(([width, height, ratio]) =>
  (["light", "dark"] as const).map((theme) => ({
    href: `/splash/${theme}-${width * ratio}x${height * ratio}.png`,
    media: `(device-width: ${width}px) and (device-height: ${height}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: portrait) and (prefers-color-scheme: ${theme})`,
  }))
)

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    head: () => ({
      meta: [
        { charSet: "utf-8" },
        {
          name: "viewport",
          // resizes-content: on Android the page shrinks above the keyboard,
          // so the composer stays in view instead of behind it.
          content:
            "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content",
        },
        { title: "Goatside" },
        // Someone's own ledger: keep every self-hosted instance out of search.
        { name: "robots", content: "noindex, nofollow" },
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
        // iOS shows these while an installed Goatside starts, instead of white.
        ...SPLASH_SCREENS.map((screen) => ({
          rel: "apple-touch-startup-image",
          ...screen,
        })),
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
    errorComponent: ({ error, reset }) => (
      <RouteError error={error} reset={reset} />
    ),
    component: Outlet,
    shellComponent: RootDocument,
  }
)

/**
 * A page that failed to load. Offline, or running an old build after a
 * deploy, one reload usually fixes it: the worker serves its kept copy, or
 * the new build loads. Otherwise, or if that reload didn't help, say so.
 */
function RouteError({ error, reset }: { error: unknown; reset: () => void }) {
  const offline = typeof navigator !== "undefined" && !navigator.onLine
  // Unreachable, a reload only helps when the worker can answer it.
  const reload =
    typeof window !== "undefined" &&
    (((offline || isNetworkError(error)) &&
      Boolean(navigator.serviceWorker?.controller)) ||
      isStaleBuild(error)) &&
    !triedReloading()
  useEffect(() => {
    if (reload) reloadToRecover()
  }, [reload])
  if (reload) return null
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
}

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
      {/* No link-preview popups on long press: an app, not a web page. */}
      <body className="[-webkit-touch-callout:none]">
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
