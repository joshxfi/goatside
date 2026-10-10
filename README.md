# Goatside

An open-source, self-hostable, agentic personal finance tracker. Type `-500 lunch at berto's`
or `+250 paid by x` and it becomes a categorized transaction on a mobile-first dashboard.

> Early development. See [PLAN.md](./PLAN.md) for the roadmap.

## Structure

| Path          | What                                                |
| ------------- | --------------------------------------------------- |
| `apps/app`    | The core app (TanStack Start on Cloudflare Workers) |
| `apps/web`    | Landing site (TanStack Start, prerendered)          |
| `packages/ui` | Shared shadcn/ui components (Base UI) and styles    |

## Development

Requires Node 22.12+ and pnpm.

```sh
pnpm install
pnpm dev          # app on :3000, landing on :3001
pnpm typecheck
pnpm lint         # oxlint
pnpm format       # oxfmt
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
