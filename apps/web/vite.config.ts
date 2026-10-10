import { defineConfig } from "vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { nitro } from "nitro/vite"

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools(),
    tailwindcss(),
    tanstackStart({
      // The landing site is static: every route is rendered to HTML at build time.
      prerender: { enabled: true, crawlLinks: true },
    }),
    // Builds a Vercel function on Vercel, a Node server elsewhere.
    nitro(),
    viteReact(),
  ],
})
