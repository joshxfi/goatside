export const REPO_URL = "https://github.com/joshxfi/goatside"
export const REPO_BRANCH = "main"

/**
 * Where the landing page and docs live, for canonical links, share cards and
 * the sitemap: https://goatside.joshxfi.com unless `SITE_URL` is set at build
 * time (vite.config.ts).
 */
export const SITE_URL: string = import.meta.env.SITE_URL

export const AUTHOR = {
  name: "Josh Daniel",
  handle: "@joshxfi",
  url: "https://github.com/joshxfi",
}

export const SITE_NAME = "Goatside"
export const SITE_TITLE =
  "Goatside · Open-source, self-hosted AI finance tracker"
export const SITE_DESCRIPTION =
  "Goatside is a personal finance tracker you host yourself. Type what you spent in plain words and its agent files it: category, account and who owes whom. MIT licensed."

/** An absolute URL on the site, for links that leave the page (share cards, sitemap). */
export const absolute = (path: string) => new URL(path, SITE_URL).href
