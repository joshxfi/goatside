import { useSyncExternalStore } from "react"

/**
 * The service worker (public/sw.js): registered in production builds only,
 * since in development it would serve stale modules over Vite's.
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return
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
        page: location.pathname === "/login" ? undefined : location.href,
      })
    })
    .catch(() => {
      // No worker: the app still works, just not offline.
    })
}

/** Kept pages hold the ledger; signing out shouldn't leave them behind. */
export async function clearOfflineCopies() {
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

function installState(): InstallState {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  if (standalone) return "installed"
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
