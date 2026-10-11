# apps/web

The project's landing page and docs: TanStack Start with Fumadocs, built with Nitro. Only
the canonical project deploys it; self-hosters deploy `apps/app`. See the root `AGENTS.md`
for repo-wide rules, including the copy and design rules, which matter most here.

## Commands

```sh
pnpm --filter web dev         # :3001 (root `pnpm dev` starts it too)
pnpm --filter web typecheck   # tsr generate + tsc; restore routeTree.gen.ts afterwards
pnpm --filter web build
```

## Layout

- `src/routes/index.tsx`: the landing page. Its live demos are in
  `src/components/landing/`.
- `src/lib/demo/`: the demos' stand-in for the filing pipeline. Amounts, signs, dates,
  splits, accounts and transfers come from the real `@workspace/core`, and only the
  judgment calls (category, direction, who owes whom) are a small word list.
  `sample-months.ts` is the demo dashboard data. Keep the demo honest: don't show features
  the app doesn't have.
- `content/docs/`: the docs, in MDX. Sidebar order and sections come from `meta.json` in
  each folder; add new pages there. `self-hosting/` is the guide self-hosters follow, so it
  must match `apps/app/.env.example`, `apps/app/src/server/env.ts` and the root
  `package.json` scripts.
- `src/lib/source.ts`: the Fumadocs source. `routes/docs/` renders pages,
  `routes/docs/{$}[.]md.ts` serves raw Markdown, and `routes/llms[.]txt.ts` /
  `llms-full[.]txt.ts` serve the docs to LLMs.
- `src/lib/site.ts`: repo URL, author, the site's title and description, and `SITE_URL`
  for canonical links, share cards and the sitemap. It's https://goatside.joshxfi.com unless
  the `SITE_URL` env var is set at build time (`vite.config.ts`).
- SEO: the root route sets site-wide tags and the share image (`public/og.png`); the
  landing and docs routes add their own title, description and canonical link.
  `sitemap.xml` and `robots.txt` are server routes, prerendered.

## Rules

- **Docs change with the code.** When a feature, command, env var or migration step
  changes, update the matching page in `content/docs` in the same commit.
- **Copy**: plain, short sentences, straight quotes. Example entries are neutral ("180
  iced coffee", "+18000 client payment"), example people are Nini and Daniel, and nothing
  tells people to type `+` or `-`.
- **Design**: Instrument Serif headlines and figures, Geist body, sentence-case labels
  (never uppercase and letter-spaced). Green in, red out; gold and silver only on the coin.
  The coin flip stays.
- `fumadocs-core` and `fumadocs-ui` (aliased to `@fumadocs/base-ui`) are pinned to the
  same exact version. Bump them together.
