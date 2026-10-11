# apps/app

The app people self-host: TanStack Start (React 19, TanStack Router and Query), built with
Nitro for Vercel. One owner per deploy, signed in with env credentials. See the root
`AGENTS.md` for repo-wide rules and known issues, and `apps/web/content/docs/guide` for how
features behave from the owner's side.

## Commands

```sh
pnpm --filter app dev         # :3000 (root `pnpm dev` also starts the DB on :8080)
pnpm --filter app test        # vitest against a temp SQLite file
pnpm --filter app typecheck   # tsr generate + tsc; restore routeTree.gen.ts afterwards
TURSO_DATABASE_URL=http://127.0.0.1:8090 pnpm --filter app eval:ask
                              # live agent scenarios; writes to a local demo DB only
```

## Layout

- `src/routes/`: file routes. `_app.tsx` guards everything signed-in; `login.tsx` is a
  plain form POST; `api/ask.ts` streams the chat agent.
- `src/server/*.server.ts`: the logic (ledger, agent, questions, accounts, people, ask
  tools). Server-only, kept out of client bundles by the `.server` suffix.
- `src/server/*.ts` (no suffix): thin `createServerFn` wrappers. Each one uses
  `authMiddleware`, validates input with Zod, and calls a `*.server.ts` function.
- `src/components/`: UI. `src/lib/`: client helpers (query keys, outbox, offline, format).
- `public/sw.js`: the service worker (production builds only).
- `test/`: vitest setup and helpers; tests sit next to the code as `*.server.test.ts`.

## Rules

- **Every server function needs `authMiddleware`** and a Zod validator with bounded money
  (`MAX_CENTAVOS`). An expected refusal throws a typed error (`EditError`,
  `AccountError`, …) that the wrapper turns into `{ ok: false, message }`; anything else
  throws.
- **Keep request-scoped APIs (cookies, headers) in the wrappers**, never in
  `*.server.ts`, or the tests can't import them.
- **Logging goes through `saveLines`**, which writes the entry, its rows and its questions
  in one `db.batch`. The phone picks the entry id, so a resend returns what was saved.
  Don't insert `entries` rows for logged lines anywhere else.
- **Split bills** are your `expense` row (`split` = ways) plus one `lend` row per person,
  linked only by `entry_id` + `description` + `local_date`. Anything that changes one of
  those must move all the rows together (`splitRows` in `ledger.server.ts`).
- **Rows added to an existing line copy its `created_at`**, so the composer's "undo" still
  removes the newest entry.
- **Repayments can't exceed what's owed**: `owedWith`, `planSettle`, `settleWith`. It's
  still inconsistent in places (root `AGENTS.md`, Known issues).
- **Multi-row writes** should be one `db.batch` (see `saveLines`); several older paths
  aren't yet (root `AGENTS.md`, Known issues).
- **Query keys**: anything derived from entries lives under `"ledger"` (month,
  transactions, accounts, people), so one `invalidateQueries({ queryKey: ["ledger"] })`
  refreshes it all. Don't add a separate top-level key for ledger-derived data.
- **Agent write tools** need a server-side approval that lists the exact rows. Read tools
  are fixed queries; the model never writes SQL.
- **Offline**: logs go through the outbox in `lib/outbox.ts` first. Kept pages in
  `sw.js` must be cleared whenever the session ends (`clearOfflineCopies`).

## Tests

`test/setup.ts` gives each test file a fresh SQLite file with every migration and the
default categories, and no AI credentials, so the logging pipeline makes no model calls.
Use the helpers in `test/helpers.ts` (`resetDb`, `log`, `addPersonRow`, `liveRows`, `row`)
and call `resetDb` in `beforeEach`. Write a failing test before fixing a ledger bug.

## UI

Components come from `@workspace/ui/components/*`; add new shadcn ones with
`pnpm dlx shadcn@latest add <name> -c apps/app` (they land in `packages/ui`). Motion only
explains a change: new entries grow in, deleted ones fold out, figures count to new values.
The coin flip is for rare moments (sign-in, loading); the composer gets no decorative motion;
nothing animates on first paint, month switches or navigation; reduced motion is respected.

Phone and desktop render from one tree, split by CSS breakpoints (`lg` = desktop).

The ask sheet's conversation uses `MessageScroller`, `Message` and `Bubble`. Let the
scroller handle following a stream and anchoring new turns; don't add `scrollIntoView`
calls. Sideways rows that show a scrollbar use `ScrollArea` (see `accounts-strip.tsx`).
