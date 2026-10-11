/**
 * Stands in for the `use-sync-external-store/shim` package, which Base UI
 * uses (via the alias in apps/app and apps/web vite.config.ts). React 19 has
 * the hook built in, and the package's CommonJS `require("react")` either
 * loads a second React into the server bundle (it broke server rendering of
 * every signed-in page) or, on Vercel, where React is bundled and not on
 * disk, fails with "Cannot find module 'react'".
 */
export { useSyncExternalStore } from "react"
