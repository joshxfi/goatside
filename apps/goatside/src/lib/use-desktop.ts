import { useSyncExternalStore } from "react"

const QUERY = "(min-width: 1024px)"

function subscribe(onChange: () => void) {
  const media = window.matchMedia(QUERY)
  media.addEventListener("change", onChange)
  return () => media.removeEventListener("change", onChange)
}

/**
 * True on wide screens (Tailwind's `lg`). Layout uses CSS breakpoints so the
 * server renders it right; this is only for behavior, like which side a
 * drawer opens from. The server snapshot is the phone.
 */
export function useDesktop(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false
  )
}
