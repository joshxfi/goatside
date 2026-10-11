import { defineConfig } from "vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { fumadocsMdx } from "fumadocs-mdx/vite"
import { nitro } from "nitro/vite"

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools(),
    // Compiles the docs in content/docs (see src/lib/source.ts).
    fumadocsMdx(),
    tailwindcss(),
    tanstackStart({
      // The site is static: every route is rendered to HTML at build time.
      // Links reach the docs pages; the search index and llms.txt files aren't
      // linked from a page, so they're listed.
      prerender: { enabled: true, crawlLinks: true },
      pages: [
        { path: "/api/search" },
        { path: "/llms.txt" },
        { path: "/llms-full.txt" },
      ],
    }),
    // Builds a Vercel function on Vercel, a Node server elsewhere.
    nitro(),
    viteReact(),
  ],
})
