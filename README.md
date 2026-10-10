# Goatside

Goatside is an open-source, personal, agentic finance tracker that you self-host.
Type `-500 lunch at berto's` or `+250 paid by x` and it becomes a categorized
transaction on a mobile-first dashboard.

It's built for one person. There's no hosted service: you deploy your own copy
to Vercel, with your own Turso database and AI Gateway key. It has exactly one
account, whose username and password you set in its environment.

> Early development. See [PLAN.md](./PLAN.md) for the roadmap.

## Structure

| Path            | What                                                          |
| --------------- | ------------------------------------------------------------- |
| `apps/app`      | The app you self-host (TanStack Start, deployed to Vercel)    |
| `apps/web`      | The project's landing site (TanStack Start, prerendered)      |
| `packages/core` | Pure TS: the entry parser, money (PHP centavos), dates        |
| `packages/db`   | Drizzle schema and migrations for Turso (libSQL)              |
| `packages/auth` | Single-account auth: env credentials, signed session cookie   |
| `packages/ai`   | The agent: Jev categorization policy, ask-mode instructions   |
| `packages/ui`   | shadcn/ui components (Base UI), the coin brand, theme, styles |

## The agent

- **Filing entries.** Each line goes to TypeSafe's [Jev](https://docs.typesafe.ai/), a
  decision model, through AI Gateway. It picks the category, notices recurring bills,
  and decides money in or out when you leave off the sign. It learns from entries you
  confirmed before.
- **Asking you.** When Jev isn't sure, the entry is saved with its best guess and a
  quick question appears above the composer ("₱500 for 'lunch': money out or in?").
  One tap confirms or fixes it, and the answer teaches the next guess.
- **Answering you.** Type a question instead of an amount ("how much on food this
  month?") and DeepSeek V4.1 Flash answers from your ledger with read-only tools.

**What leaves your instance:** entry text and amounts (to TypeSafe, for categorizing),
and your questions plus the ledger rows needed to answer them (to DeepSeek), both via
your own AI Gateway. Without AI Gateway credentials, Goatside still works: entries
save uncategorized and sign-less ones still get an "in or out?" question.

## Development

Requires Node 22.12+, pnpm, and the [Turso CLI](https://docs.turso.tech/cli) for the local database.

```sh
pnpm install
cp apps/app/.env.example apps/app/.env.local   # then fill it in
pnpm dev          # local DB on :8080, app on :3000, landing on :3001
pnpm db:migrate   # first run, and after schema changes
```

Sign in at http://localhost:3000 with the `GOATSIDE_USERNAME` and `GOATSIDE_PASSWORD`
from your `.env.local`.

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
2. Import this repo in Vercel with **Root Directory** set to `apps/app`. Vercel
   detects TanStack Start and builds it with Nitro.
3. Add the variables from `apps/app/.env.example` in the project's settings:
   your username, a password of 12+ characters, a session secret
   (`openssl rand -base64 32`) and the Turso URL and token. On Vercel, AI
   Gateway authenticates through OIDC, so `AI_GATEWAY_API_KEY` is only needed
   locally. Enable AI Gateway on your Vercel team for the agent to work.
4. Deploy and sign in.

Changing the username, password or session secret signs out every device.
Failed sign-ins are throttled (5 per IP and 25 overall per 15 minutes). Browsers
that have signed in before are trusted and skip those limits, so a flood of bad
attempts can't lock you out of them; a trusted browser that fails more than 10
times in a day loses that status. Changing the password untrusts every browser.
