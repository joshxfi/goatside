import { useSyncExternalStore } from "react"

/** The tab bar's pages, kept for offline from the first launch. */
const TAB_PAGES = ["/", "/transactions", "/accounts", "/people"]
/** An installed app can stay open for days; look for a new build this often. */
const UPDATE_CHECK_MS = 15 * 60 * 1000
/** Back after this long in the background, a pending update reloads. */
const RELOAD_AFTER_HIDDEN_MS = 30 * 1000

/**
 * The service worker (public/sw.js): registered in production builds only,
 * since in development it would serve stale modules over Vite's.
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return
  const signedIn = location.pathname !== "/login"
  void navigator.serviceWorker
    .register("/sw.js")
    .then(() => navigator.serviceWorker.ready)
    .then((registration) => {
      // This first load came before the worker; hand it what to keep.
      const assets = performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((url) => new URL(url).pathname.startsWith("/assets/"))
      registration.active?.postMessage({
        type: "keep",
        assets,
        pages: signedIn
          ? [location.href, ...TAB_PAGES.map((path) => location.origin + path)]
          : [],
      })
      watchForUpdates(registration)
    })
    .catch(() => {
      // No worker: the app still works, just not offline.
    })
  // Installed apps keep their storage (the outbox, kept pages) when the
  // phone runs low on space. Browsers that ask, or say no, are fine too.
  if (signedIn && isStandalone()) void navigator.storage?.persist?.()
}

/**
 * A new build's worker takes over as soon as it installs, but this page
 * still runs the old code, and its lazy chunks may be gone from the server.
 * So: check for a build whenever the app comes back to the foreground, and
 * reload into the new one when the owner returns after a while away, never
 * mid-task.
 */
function watchForUpdates(registration: ServiceWorkerRegistration) {
  let checkedAt = Date.now()
  let hiddenAt = 0
  let updated = false
  const hadController = Boolean(navigator.serviceWorker.controller)
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // The very first worker taking over isn't an update.
    if (hadController) updated = true
  })
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now()
      return
    }
    if (updated && Date.now() - hiddenAt > RELOAD_AFTER_HIDDEN_MS) {
      location.reload()
      return
    }
    if (Date.now() - checkedAt > UPDATE_CHECK_MS) {
      checkedAt = Date.now()
      void registration.update().catch(() => null)
    }
  })
}

const RELOAD_KEY = "goatside:recovered"

/** Whether this page already reloaded to recover in the last minute. */
export function triedReloading(): boolean {
  try {
    const last = JSON.parse(sessionStorage.getItem(RELOAD_KEY) ?? "null") as {
      href: string
      at: number
    } | null
    return last?.href === location.href && Date.now() - last.at < 60_000
  } catch {
    return true
  }
}

/**
 * Reloads to get past a page that failed because the network is gone (the
 * worker then serves its kept copy) or because a deploy removed this build's
 * code. Once a minute per page at most, so it can't loop.
 */
export function reloadToRecover() {
  try {
    sessionStorage.setItem(
      RELOAD_KEY,
      JSON.stringify({ href: location.href, at: Date.now() })
    )
  } catch {
    return
  }
  location.reload()
}

/**
 * A request that never reached the server: no signal, or a weak one that the
 * phone still counts as online. Each browser words it differently.
 */
export function isNetworkError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /failed to fetch|load failed|networkerror|network request failed/i.test(
    message
  )
}

/** A lazy chunk that didn't load: usually an old build after a deploy. */
export function isStaleBuild(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /dynamically imported module|importing a module script failed|error loading dynamically imported/i.test(
    message
  )
}

/** Kept pages hold the ledger; signing out shouldn't leave them behind. */
export async function clearOfflineCopies() {
  // The worker also drops pages it's still fetching for the old session.
  navigator.serviceWorker?.controller?.postMessage({ type: "forget" })
  if (!("caches" in window)) return
  const names = await caches.keys()
  await Promise.all(
    names
      .filter((name) => name.startsWith("goatside-pages"))
      .map((name) => caches.delete(name))
  )
}

interface InstallPrompt extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

let installPrompt: InstallPrompt | null = null
const installListeners = new Set<() => void>()
const emitInstall = () => {
  for (const listener of installListeners) listener()
}

/**
 * Chrome and Edge offer to install once, early in the page's life, so the
 * offer is kept from the start for Settings to use later. The browser's own
 * prompt still shows; this only adds a button.
 */
export function listenForInstall() {
  window.addEventListener("beforeinstallprompt", (event) => {
    installPrompt = event as InstallPrompt
    emitInstall()
  })
  window.addEventListener("appinstalled", () => {
    installPrompt = null
    emitInstall()
  })
}

function subscribeInstall(listener: () => void) {
  installListeners.add(listener)
  const media = window.matchMedia("(display-mode: standalone)")
  media.addEventListener("change", listener)
  return () => {
    installListeners.delete(listener)
    media.removeEventListener("change", listener)
  }
}

type InstallState =
  | "installed"
  /** The browser can show its install dialog. */
  | "prompt"
  /** iPhone or iPad: Share, then Add to Home Screen. */
  | "ios"
  | "manual"

/** Whether Goatside runs installed, from its home-screen icon. */
export function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

function installState(): InstallState {
  if (isStandalone()) return "installed"
  if (installPrompt) return "prompt"
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  return ios ? "ios" : "manual"
}

/** Whether Goatside runs installed, and how to install it if not. */
export function useInstall() {
  const state = useSyncExternalStore(
    subscribeInstall,
    installState,
    () => "manual" as const
  )
  return { state, install }
}

/** Shows the browser's install dialog; true if the owner accepted. */
async function install() {
  if (!installPrompt) return false
  await installPrompt.prompt()
  const { outcome } = await installPrompt.userChoice
  installPrompt = null
  emitInstall()
  return outcome === "accepted"
}
