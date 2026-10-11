/*
 * Goatside's service worker: opens the app without a connection.
 *
 * - Built assets (/assets/*, content-hashed) come from the cache once seen.
 * - Pages go to the network first. Each one that loads is kept, so with no
 *   signal the last copy opens instead; a page never seen gets offline.html.
 * - Server functions and the agent API always go to the network. Entries
 *   typed offline wait in the page's outbox (src/lib/outbox.ts), not here.
 *
 * Kept pages hold the owner's own ledger, on the owner's own device. They go
 * when the session does: on sign-out and whenever the sign-in page shows
 * (clearOfflineCopies in src/lib/offline.ts), when a page load is sent to
 * sign in, and once a copy is older than a session can last.
 */
const PAGES = "goatside-pages-v1"
const ASSETS = "goatside-assets-v1"
const SHELL = "goatside-shell-v1"
const SHELL_FILES = [
  "/offline.html",
  "/favicon.svg",
  "/manifest.json",
  "/icon-192.png",
]
/** Long enough for a slow connection, short enough not to stare at white. */
const PAGE_TIMEOUT_MS = 4000
const MAX_ASSETS = 150
/**
 * A kept page older than a session can be (SESSION_TTL_MS in packages/auth)
 * came from a session that has ended, so it isn't shown.
 */
const PAGE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const KEPT_AT = "x-goatside-kept-at"

/** A copy of `response` stamped with when it was kept. */
async function stamped(response) {
  const headers = new Headers(response.headers)
  headers.set(KEPT_AT, String(Date.now()))
  return new Response(await response.blob(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/** Whether a kept page is recent enough to show. Unstamped copies aren't. */
const recent = (kept) =>
  Date.now() - Number(kept.headers.get(KEPT_AT) ?? 0) < PAGE_MAX_AGE_MS

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener("activate", (event) => {
  const keep = new Set([PAGES, ASSETS, SHELL])
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith("goatside-") && !keep.has(name))
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  )
})

/*
 * The first visit loads before this worker is in charge, so the page sends
 * what it loaded: the assets to keep, and itself to fetch and keep.
 */
self.addEventListener("message", (event) => {
  const { type, assets = [], page: href } = event.data ?? {}
  if (type !== "keep") return
  event.waitUntil(
    (async () => {
      const cache = await caches.open(ASSETS)
      for (const url of assets) {
        if (new URL(url).origin !== self.location.origin) continue
        if (!(await cache.match(url))) await cache.add(url).catch(() => null)
      }
      if (href && !(await caches.match(href))) {
        const response = await fetch(href, { credentials: "same-origin" })
        if (response.ok && !response.redirected) {
          await (await caches.open(PAGES)).put(href, await stamped(response))
        }
      }
    })().catch(() => null)
  )
})

self.addEventListener("fetch", (event) => {
  const { request } = event
  if (request.method !== "GET") return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith("/_serverFn") || url.pathname.startsWith("/api/"))
    return

  if (request.mode === "navigate") {
    event.respondWith(page(event, request))
  } else if (url.pathname.startsWith("/assets/")) {
    event.respondWith(asset(request))
  } else if (
    SHELL_FILES.includes(url.pathname) ||
    url.pathname.endsWith(".png")
  ) {
    event.respondWith(fresh(event, request))
  }
})

/** Network first; the kept copy if the network fails or dawdles. */
async function page(event, request) {
  const cache = await caches.open(PAGES)
  const network = fetch(request).then((response) => {
    if (response.redirected && new URL(response.url).pathname === "/login") {
      // Sent to sign in: the session ended, so its kept pages go too.
      event.waitUntil(caches.delete(PAGES))
    } else if (
      // Only real pages: not redirects or errors.
      response.ok &&
      !response.redirected &&
      response.type === "basic"
    ) {
      event.waitUntil(
        stamped(response.clone()).then((copy) => cache.put(request, copy))
      )
    }
    return response
  })
  const match = await cache.match(request, { ignoreVary: true })
  const kept = match && recent(match) ? match : undefined
  if (match && !kept) event.waitUntil(cache.delete(request))
  if (!kept) {
    return network.catch(async () => {
      const offline = await caches.match("/offline.html")
      return offline ?? Response.error()
    })
  }
  // A kept copy exists: wait a little for a fresh one, then show the copy.
  // The fetch carries on and refreshes the copy for next time.
  event.waitUntil(network.catch(() => null))
  const late = new Promise((resolve) =>
    setTimeout(() => resolve(kept), PAGE_TIMEOUT_MS)
  )
  return Promise.race([network.catch(() => kept), late])
}

/** Content-hashed, so a cached copy is always right. */
async function asset(request) {
  const cache = await caches.open(ASSETS)
  const hit = await cache.match(request)
  if (hit) return hit
  const response = await fetch(request)
  if (response.ok) {
    await cache.put(request, response.clone())
    trim(cache)
  }
  return response
}

/** Old builds' assets pile up; keep the newest few. */
async function trim(cache) {
  const keys = await cache.keys()
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) {
    await cache.delete(key)
  }
}

/** Icons and the manifest: the cached copy now, a fresh one for next time. */
async function fresh(event, request) {
  const cache = await caches.open(SHELL)
  const hit = await cache.match(request)
  const network = fetch(request).then((response) => {
    if (response.ok) event.waitUntil(cache.put(request, response.clone()))
    return response
  })
  if (hit) {
    event.waitUntil(network.catch(() => null))
    return hit
  }
  return network
}
