# Goatside

An open-source, self-hostable, agentic personal finance tracker. Type `-500 lunch at berto's`
or `+250 paid by x` and it becomes a categorized transaction on a mobile-first dashboard.

> Early development. See [PLAN.md](./PLAN.md) for the roadmap.

## Structure

| Path            | What                                                          |
| --------------- | ------------------------------------------------------------- |
| `apps/app`      | The core app (TanStack Start on Cloudflare Workers)           |
| `apps/web`      | Landing site (TanStack Start, prerendered)                    |
| `packages/core` | Pure TS: the entry parser, money (PHP centavos), dates        |
| `packages/db`   | Drizzle schema and migrations for Turso (libSQL)              |
| `packages/auth` | Better Auth: Google sign-in limited to an email allowlist     |
| `packages/ui`   | shadcn/ui components (Base UI), the coin brand, theme, styles |

## Development

Requires Node 22.12+, pnpm, and the [Turso CLI](https://docs.turso.tech/cli) for the local database.

```sh
pnpm install
cp apps/app/.dev.vars.example apps/app/.dev.vars   # then fill it in
pnpm dev          # local DB on :8080, app on :3000, landing on :3001
pnpm db:migrate   # first run, and after schema changes
```

Signing in needs a Google OAuth client (redirect URI `http://localhost:3000/api/auth/callback/google`)
and your email in `ALLOWED_EMAILS`. To try the app before setting that up:

```sh
pnpm dev:session  # prints a session cookie for the first allowlisted email (local DB only)
```

Set it as a `better-auth.session_token` cookie on `localhost`.

Other commands:

```sh
pnpm typecheck
pnpm test         # vitest
pnpm lint         # oxlint
pnpm format       # oxfmt
pnpm db:generate  # new migration after editing packages/db/src/schema
pnpm db:studio    # browse the local DB
```

Add shadcn components from an app directory. They're installed into `packages/ui`:

```sh
pnpm dlx shadcn@latest add drawer -c apps/app
```

## Deploy

Each app deploys as its own Cloudflare Worker:

```sh
pnpm dlx wrangler login
pnpm --filter app build && pnpm --filter app deploy
pnpm --filter web build && pnpm --filter web deploy
```

The app needs its secrets set first (`wrangler secret put NAME` for each key in
`apps/app/.dev.vars.example`) and migrations applied to your Turso database
(`TURSO_DATABASE_URL=… TURSO_AUTH_TOKEN=… pnpm db:migrate`).
