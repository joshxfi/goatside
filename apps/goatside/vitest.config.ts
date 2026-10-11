import { defineConfig } from "vitest/config"

// Separate from vite.config.ts: tests run server modules directly, without
// the TanStack Start and Nitro plugins.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
  },
})
