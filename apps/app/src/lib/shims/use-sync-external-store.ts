/**
 * Stands in for the `use-sync-external-store/shim` package (via the alias in
 * vite.config.ts). React 19 has the hook built in, and the package's
 * CommonJS `require("react")` loads a second React into the server bundle,
 * which broke server rendering of every signed-in page.
 */
export { useSyncExternalStore } from "react"
