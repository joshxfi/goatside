import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { nitro } from "nitro/vite"

const shim = (name: string) =>
  fileURLToPath(
    new URL(`../../packages/ui/src/shims/${name}.ts`, import.meta.url)
  )

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    // Base UI's use-sync-external-store shims, swapped for React's built-in
    // hook: their require("react") put a second React in the server bundle.
    alias: [
      {
        find: /^use-sync-external-store\/shim\/with-selector(\.js)?$/,
        replacement: shim("use-sync-external-store-with-selector"),
      },
      {
        find: /^use-sync-external-store\/shim(\/index\.js)?$/,
        replacement: shim("use-sync-external-store"),
      },
    ],
  },
  plugins: [
    devtools(),
    tailwindcss(),
    tanstackStart(),
    // Builds a Vercel function on Vercel, a Node server elsewhere.
    nitro(),
    viteReact(),
  ],
})
