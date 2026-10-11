import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { fumadocsMdx } from "fumadocs-mdx/vite"
import { nitro } from "nitro/vite"

// Canonical links and share cards need the site's own address. Every build,
// previews included, points at production; SITE_URL overrides it.
const siteUrl = process.env.SITE_URL ?? "https://goatside.joshxfi.com"

const shim = (name: string) =>
  fileURLToPath(
    new URL(`../../packages/ui/src/shims/${name}.ts`, import.meta.url)
  )

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    // Base UI's use-sync-external-store shims, swapped for React's built-in
    // hook: their require("react") fails on Vercel, where React is bundled
    // and not on disk ("Cannot find module 'react'"). Same as apps/goatside.
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
  define: { "import.meta.env.SITE_URL": JSON.stringify(siteUrl) },
  plugins: [
    devtools(),
    // Compiles the docs in content/docs (see src/lib/source.ts).
    fumadocsMdx(),
    tailwindcss(),
    tanstackStart({
      // The site is static: every route is rendered to HTML at build time.
      // Links reach the docs pages; the search index, sitemap, robots.txt and
      // llms.txt files aren't linked from a page, so they're listed.
      prerender: { enabled: true, crawlLinks: true },
      pages: [
        { path: "/api/search" },
        { path: "/sitemap.xml" },
        { path: "/robots.txt" },
        { path: "/llms.txt" },
        { path: "/llms-full.txt" },
      ],
    }),
    // Builds a Vercel function on Vercel, a Node server elsewhere.
    nitro(),
    viteReact(),
  ],
})
