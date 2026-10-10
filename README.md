# Goatside

Goatside is an open-source, personal, agentic finance tracker that you self-host.
Type `-500 lunch at berto's` or `+250 paid by x` and it becomes a categorized
transaction on a mobile-first dashboard.

It's built for one person. There's no hosted service: you deploy your own copy
to Vercel, with your own Turso database and AI Gateway key, and only the emails
you allow can sign in.

> Early development. See [PLAN.md](./PLAN.md) for the roadmap.

## Structure

| Path            | What                                                          |
| --------------- | ------------------------------------------------------------- |
| `apps/app`      | The app you self-host (TanStack Start, deployed to Vercel)    |
| `apps/web`      | The project's landing site (TanStack Start, prerendered)      |
| `packages/core` | Pure TS: the entry parser, money (PHP centavos), dates        |
| `packages/db`   | Drizzle schema and migrations for Turso (libSQL)              |
| `packages/auth` | Better Auth: Google sign-in limited to an email allowlist     |
| `packages/ui`   | shadcn/ui components (Base UI), the coin brand, theme, styles |

## Development

Requires Node 22.12+, pnpm, and the [Turso CLI](https://docs.turso.tech/cli) for the local database.

```sh
pnpm install
cp apps/app/.env.example apps/app/.env.local   # then fill it in
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

## Self-hosting on Vercel

1. Create a Turso database (`turso db create goatside`) and a token
   (`turso db tokens create goatside`), then apply migrations:
   `TURSO_DATABASE_URL=libsql://… TURSO_AUTH_TOKEN=… pnpm db:migrate`
2. Create a Google OAuth client with the redirect URI
   `https://<your-domain>/api/auth/callback/google`.
3. Import this repo in Vercel with **Root Directory** set to `apps/app`. Vercel
   detects TanStack Start and builds it with Nitro.
4. Add the variables from `apps/app/.env.example` in the project's settings.
   On Vercel, AI Gateway authenticates through OIDC, so `AI_GATEWAY_API_KEY`
   is only needed locally.
5. Deploy. Only emails in `ALLOWED_EMAILS` can sign in.
