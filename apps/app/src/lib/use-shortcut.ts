import { useSyncExternalStore } from "react"

const noop = () => () => {}

/**
 * "⌘K" on Apple devices, "Ctrl K" elsewhere. The server renders "Ctrl", then
 * the client switches after hydration, so markup never mismatches.
 */
export function useShortcut(key: string): string {
  const mac = useSyncExternalStore(
    noop,
    () => /Mac|iPhone|iPad/.test(navigator.platform),
    () => false
  )
  return mac ? `⌘${key}` : `Ctrl ${key}`
}
