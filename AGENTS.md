# Goatside

A self-hosted, single-user, agentic finance tracker. Read `README.md` for what it does and
the docs in `apps/web/content/docs` for how it behaves. Each app and package has its own
`AGENTS.md` with the rules for that code.

## Layout

| Path            | What                                                               |
| --------------- | ------------------------------------------------------------------ |
| `apps/app`      | The app people self-host (TanStack Start on Vercel)                |
| `apps/web`      | Landing page and docs (TanStack Start + Fumadocs)                  |
| `packages/core` | Pure TS: money, the entry parser, dates, account and name scanning |
| `packages/ai`   | Jev decisions (category, people, accounts, duplicates), ask prompt |
| `packages/db`   | Drizzle schema, migrations, client, demo seed                      |
| `packages/auth` | Single-account credentials and signed session tokens               |
| `packages/ui`   | shadcn components (Base UI), brand, theme tokens, styles           |

## Commands

Run from the root. pnpm 12, Node 22.12+.

```sh
pnpm dev            # local DB :8080, app :3000, landing :3001
pnpm lint           # oxlint, must stay at zero warnings
pnpm format         # oxfmt (Markdown too); `pnpm format:check` in CI
pnpm typecheck      # turbo; apps run `tsr generate` first (see below)
pnpm test           # vitest in core, ai, auth and apps/app
pnpm db:generate    # new migration after a schema change
```

CI (`.github/workflows/ci.yml`) runs install, lint, format check, typecheck and tests on
every push, and applies migrations on `main` when the repo has database secrets.

## Rules that apply everywhere

- **Money is integer cents** of the owner's currency, set in Settings (PHP by default).
  `₱180` is `18000`. Nothing converts between currencies. Signs are cash flow from the
  owner's side: money out is negative. Never round-trip money through floats.
- **Format money with `formatMoney`.** It follows the owner's currency: the app layout
  sets it, and `authMiddleware` sets it for server functions. Never hardcode `₱`.
- **One owner per deploy.** There are no user ids; don't add multi-tenant code.
- **Soft delete** (`deleted_at`) everywhere. Every ledger query filters it out.
- **The model never changes an amount.** Code parses amounts; the agent adds meaning.
- **Don't commit what typecheck rewrites in `routeTree.gen.ts`.** `tsr generate` drops the
  TanStack Start `Register` block that the Vite plugin writes. Restore with
  `git checkout -- apps/app/src/routeTree.gen.ts apps/web/src/routeTree.gen.ts`.
- **Secrets stay out:** never read or copy `apps/app/.env.local` into code, logs or tool
  input. Evals and the demo seed refuse non-local databases; keep it that way.
- **Commits** are conventional with scopes (`fix(app): …`, `docs(web): …`, `test(app): …`).
  Run format, lint, typecheck and tests first.
- **Before changing Turborepo config**, read the installed Turborepo docs (block below).

## Copy and design

- Plain, short sentences and straight quotes. Example entries are neutral ("180 iced
  coffee", "+18000 client payment"); example people are Nini and Daniel. Never tell people
  to type `+` or `-`.
- Green for money in, red for money out. Gold and silver belong to the coin mark only.
- Instrument Serif (`font-display`) for headlines and big figures, Geist for everything
  else. Labels are sentence case, never uppercase and letter-spaced.

## Known issues

Open findings from the 2026-10-11 audit. Fix them with a failing test first.

- Some multi-row writes aren't atomic: `editTransaction`, `refile`, `mergePeople`,
  `mergeCategory`. Use one `db.batch`, as `saveLines` does.
- Agent write tools re-run their filter or plan when they execute, so the write can differ
  from the approval card (`ask-actions.server.ts`, `ask-people.server.ts`). They also
  accept unbounded amounts.
- Repayments are capped inconsistently: typed or answered ones aren't (`planRows`), the
  Settle button caps, and the drawer and agent refuse. The owner hasn't decided between
  cap, ask, or settle-plus-new-IOU yet.
- Client outbox races (`lib/outbox.ts`): undo during a send, two tabs, endless retries.
- Read and write ask tools match accounts differently (nicknames).
- `monthView` makes 5 sequential DB round trips; there's no index on
  `transactions.entry_id` or `created_at`.
- The demo seed's split bills have no `entry_id`, so split features don't show on demo
  data.
- No LICENSE yet (MIT or AGPL is the owner's call). No security headers.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
