# Goatside: plan

> Status: **planning**. Nothing is built yet.

Goatside is an open-source, self-hostable, agentic personal finance tracker. You type a line
like `-500 lunch at berto's` or `+250 paid by x`, and it becomes a categorized transaction.
A mobile-first dashboard shows where the month's money went.

---

## 0. Decisions

| Topic | Decision |
|---|---|
| Audience | **Open source + self-hostable**, built for a single owner's use case. Each deploy is one person's instance, so there are no public sign-ups |
| Currency | **PHP (₱) only.** No multi-currency in v1 |
| Scope of money | **Money in and out only.** No wallets, no account balances, no transfers |
| Auth | **Google OAuth only**, restricted to an email allowlist set by whoever deploys it |
| LLM | **DeepSeek V4.1 Flash** (`deepseek-flash`) through **Cloudflare AI Gateway** |
| Name | **Goatside** |

---

## 1. Product principles

1. **The input box is the app.** Logging takes one line and about 2 seconds. Forms are only for corrections.
2. **Deterministic first, AI second.** Code parses the amount and sign, never the LLM. The model adds meaning (category, merchant, person, date) but cannot change the number you typed.
3. **Instant, then smart.** A row appears as soon as you hit enter, and AI enrichment fills it in about a second later. You never wait on a spinner to log.
4. **It learns from you.** Every correction becomes an example for next time, through retrieval rather than fine-tuning.
5. **Useful without AI.** If the model is down, entries still save with amount and description and get categorized later.
6. **Easy to self-host.** One Cloudflare account, one Turso database, a handful of secrets. No other infrastructure.

---

## 2. UX

### 2.1 Layout (mobile)

```
┌─────────────────────────────┐
│  October 2026        ‹  ›   │  ← swipe left/right to change month
│                             │
│  Spent      ₱18,420         │
│  In         ₱25,000         │
│  Net       +₱6,580  ▲12%    │  ← vs last month, same day-of-month
│                             │
│  ▁▃▂▇▁▁▄▂▃▁▅ (daily bars)   │
│                             │
│  Food ████████░░  ₱7,200    │  ← tap category → filtered list
│  Transport ███░░  ₱2,100    │
│  ...                        │
│                             │
│  Today                      │
│  🍜 Berto's        -₱500    │
│  👤 from X        +₱250     │
│  Yesterday                  │
│  ...                        │
├─────────────────────────────┤
│ ☕-180  🚕-150  🍜-500       │  ← quick-repeat chips (your frequent entries)
│ [ -500 lunch at berto's  ⏎] │  ← composer, always pinned in the thumb zone
├─────────────────────────────┤
│  Home   Activity  People  ⚙ │
└─────────────────────────────┘
```

On desktop the same layout becomes two columns: dashboard on the left, activity and chat on the right.

### 2.2 Composer grammar

The composer accepts free text. A leading `+` or `-` means **log mode**. Anything else, especially text ending in `?`, means **ask mode**.

| Input | Result |
|---|---|
| `-500 lunch at berto's` | Expense ₱500 · Food · merchant "Berto's" · today |
| `+250 paid by x` | If X owes you, it **settles that IOU**. Otherwise it's income from X |
| `-1200 dinner w/ x and y split 3` | Expense ₱400 (your share), plus ₱400 owed by X and ₱400 owed by Y |
| `-150 grab yesterday` | Transport, dated yesterday |
| `-89 spotify monthly` | Subscriptions, marked recurring |
| `-500 lunch, -120 coffee` | Two transactions from one line |
| `how much on food this month?` | Ask mode: a text answer with an inline mini chart |
| `undo` | Reverts the last entry |

Amounts accept `500`, `1.5k`, `1,250.50` and an optional `₱` or `php` prefix. Everything is stored as PHP.

### 2.3 Entry lifecycle (what you see)

1. Press enter. The row appears **immediately** with amount and raw text, plus a subtle shimmer on the category chip.
2. Within about a second, the chip resolves to `Food · Berto's` and a **toast with Undo** shows for 5 seconds.
3. If confidence is low (unknown merchant, ambiguous person), the row gets a small **"Check"** dot. Tapping it opens a bottom-sheet drawer with the AI's guess preselected, so a fix takes one tap.
4. Edits made in the drawer are stored as **corrections** and feed future parses.

### 2.4 Screens

- **Home**: month summary, daily spend bars, category breakdown, recent feed. Month switcher by swipe.
- **Activity**: full list grouped by day, with search (semantic as well as text) and filters for category, person and type. Desktop shows a data table; mobile shows a virtualized card list.
- **Insights**: month-over-month trend (stacked by category), top merchants, a calendar heatmap of daily spend, and "biggest changes vs last month".
- **People**: running balance per person ("X owes you ₱800"), settle-up history, and one-tap settle.
- **Settings**: categories (emoji, color, rename, merge), timezone, CSV export, account.

### 2.5 Small touches

- **Quick-repeat chips** above the composer show your top 3–5 most frequent entries for the current time of day.
- **Monthly recap card** on the 1st of the month: total, top category, biggest single expense, and the change vs the prior month.
- **Pace line** on the daily chart (once budgets exist): "at this pace you'll spend ₱24k this month".
- Money colors: expense neutral, income green. Avoid red for normal spending so the app doesn't feel guilt-inducing.
- **PWA**: installable, with an offline queue. Entries typed offline save locally and get parsed when you're back online.
- Haptic tick on save (`navigator.vibrate` where supported).

### 2.6 Brand

From the founder's sketch: "goat side" means *which side of the coin are you on?*

- **Mark:** a coin whose "g" is a goat's head. The spiral horn is the bowl of the "g", and the neck is its descender. Components live in `packages/ui/src/components/brand.tsx` (`CoinMark`, `Coin`, `CoinFlip`, `Wordmark`).
- **Metals:** gold is the save side (money in), silver is the spend side (money out), bronze is an accent. They're theme tokens (`text-gold-foreground`, `bg-silver`, …) on a warm paper/ink palette, light and dark.
- **Type:** Instrument Serif for display figures, Geist for UI, tabular numerals (`.figure`) for money.
- **Motion:** the coin toss and flip are reserved for rare moments (landing, sign-in, loading). The composer is used constantly, so it gets no decorative motion. Reduced motion is respected.
- **Voice:** steady climbing, resilience, abundance, stability. "GOAT" also means greatest of all time, so personal records ("lowest-spend week of all time") are part of the brand.

---

## 3. Stack

| Concern | Choice | Notes |
|---|---|---|
| Monorepo | **Turborepo + pnpm** (workspaces + catalogs) | |
| Apps | **TanStack Start** × 2 (`apps/web` landing, `apps/app` core) | Both deploy to Cloudflare Workers via `@cloudflare/vite-plugin` |
| UI | **shadcn/ui on Base UI** + Tailwind v4 | Base UI has been shadcn's default since July 2026. Scaffold with `shadcn init --monorepo -t start -b base` |
| Data fetching | **TanStack Query** + Start server functions | Optimistic inserts for the composer |
| Tables | **TanStack Table** + **TanStack Virtual** | Table drives sort and filter state; mobile renders cards |
| Forms | **TanStack Form** + Zod | Edit drawer, settings |
| Charts | **TanStack Charts** (`@tanstack/react-charts`) | Just reached 1.0. Fallback is shadcn charts (Recharts) if the React adapter turns out rough. Theme either through our CSS variables |
| DB | **Turso** (libSQL) + **Drizzle ORM** | `@libsql/client/web` over HTTP from Workers. Native vectors via `F32_BLOB` |
| Auth | **Better Auth** (Google only) | See §6 |
| LLM | **AI SDK** + `@ai-sdk/deepseek` → `deepseek-flash` | Routed through Cloudflare AI Gateway (§5.6) |
| Embeddings | **AI SDK** + `@ai-sdk/openai` → `text-embedding-3-small` @ 512 dims | Also through AI Gateway |
| Hosting | **Cloudflare Workers** (static assets + SSR) | |
| Lint/format | **oxlint + oxfmt** | No ESLint or Prettier. oxfmt sorts Tailwind classes natively |
| Tests | Vitest (unit + AI evals); Playwright later | |

**About the model ID:** DeepSeek shipped V4.1 Flash on 2026-09-10 under the ID `deepseek-flash`. The older `deepseek-v4-flash` ID is now routed to it. Model IDs live in env (`LLM_MODEL`, `EMBEDDING_MODEL`) so self-hosters can swap them.

---

## 4. Repo layout

```
goatside/
├─ apps/
│  ├─ web/                 # landing / project site: TanStack Start, prerendered
│  └─ app/                 # core app: TanStack Start, SSR + server fns
├─ packages/
│  ├─ ui/                  # shadcn components (Base UI), tokens, chart wrappers
│  ├─ db/                  # drizzle schema, migrations, client factory, vector helpers, seed
│  ├─ auth/                # better-auth config factory (takes env)
│  ├─ ai/                  # provider setup, parser pipeline, agent + tools, prompts, evals
│  └─ core/                # pure TS: money (PHP), deterministic parser, date words, domain types
├─ docs/
│  └─ self-hosting.md
├─ turbo.json
├─ pnpm-workspace.yaml     # workspaces + version catalog
├─ .oxlintrc.json          # one lint config for the whole repo
├─ LICENSE
└─ PLAN.md
```

`packages/core` has no runtime dependencies, which makes it trivially testable. It holds the most important logic: the amount and sign parser.

---

## 5. AI design

### 5.1 Two modes

- **Log mode** (`+`/`-` prefix): a single structured-output call. It is not an agent loop, which keeps it fast, cheap and predictable.
- **Ask mode** (questions, commands): a tool-calling agent loop, streamed to the UI with `useChat`.

### 5.2 Log pipeline

```
raw text
  │
  ├─ 1. core.preparse()      deterministic: split on commas, extract sign, amount,
  │                          date words ("yesterday", "last fri"), "split N"
  │                          → if no amount: route to ask mode
  │
  ├─ 2. insert pending row   (optimistic, amount locked, status = 'pending')
  │
  ├─ 3. retrieve context     embed raw text → top-5 similar past txns
  │                          (with their FINAL category/merchant after corrections)
  │                          + categories, people, open IOUs
  │
  ├─ 4. LLM structured out   deepseek-flash, thinking disabled, Zod schema:
  │                          { kind, category, merchant, person,
  │                            date, note, recurring, confidence } per line
  │
  ├─ 5. validate + reconcile amount must equal preparse; unknown category → 'Uncategorized';
  │                          new person/merchant → create; settle IOU if applicable
  │
  └─ 6. update row           status = 'parsed' | 'needs_review'; store embedding
```

- **Prompt-cache friendly ordering:** a static system prompt goes first, then the category and people lists (these rarely change), then the retrieved examples, then the input. DeepSeek charges very little for cache hits.
- **Shortcut (later):** if the top neighbor has cosine similarity ≥ 0.95 and the same merchant tokens, copy its categorization and skip the LLM call.
- **Kinds:** `expense | income | lend | settle`. Only `expense` and `income` count toward the spending totals. `lend` and `settle` drive the People balances.

### 5.3 Ask-mode tools

| Tool | Type |
|---|---|
| `getSummary(range, groupBy)` | read |
| `listTransactions(filters)` | read |
| `searchTransactions(query)` (semantic) | read |
| `compareMonths(a, b)` | read |
| `getPersonBalance(person)` | read |
| `createTransaction / updateTransaction / deleteTransaction` | write, **requires approval** (AI SDK tool approval → confirm card in UI) |

Each tool runs a scoped SQL query for the current user. The model never writes SQL.

### 5.4 Embeddings

I recommend `text-embedding-3-small` with `dimensions: 512`. The reasons:

- Inputs are tiny strings, so cost is effectively zero ($0.02 per 1M tokens).
- Matryoshka truncation to 512 dims keeps rows small with little quality loss for short text.
- It handles mixed-language input (Taglish, slang, shop names) well.
- It is still OpenAI's current small embedding model; no successor has been announced.

Store `embedding_model` on each row so re-embedding stays possible. A `pnpm reembed` script re-embeds everything if the model changes.

**Vector search strategy:** one person has a few thousand rows a year, so we use **brute-force `vector_distance_cos` filtered by `user_id`** with no ANN index. Revisit only if a single instance passes about 50k transactions.

### 5.5 Quality & safety

- **Evals:** about 100 fixture inputs mapped to expected structured output, run with Vitest on every prompt or model change. They track category accuracy, kind accuracy and the amount invariant (which must be 100%).
- **Prompt injection:** transaction text is the owner's own, but notes are still treated as data. Write tools always need approval.
- **Privacy:** transaction text goes to DeepSeek and OpenAI through the owner's own AI Gateway. Self-hosters bring their own keys, so the README should say plainly what data leaves the instance.

### 5.6 Cloudflare AI Gateway

Point each AI SDK provider's `baseURL` at the gateway:

```ts
// packages/ai/src/providers.ts (sketch)
const gw = env.CF_AIG_ACCOUNT_ID && env.CF_AIG_GATEWAY_ID
  ? `https://gateway.ai.cloudflare.com/v1/${env.CF_AIG_ACCOUNT_ID}/${env.CF_AIG_GATEWAY_ID}`
  : null

const deepseek = createDeepSeek({
  apiKey: env.DEEPSEEK_API_KEY,
  baseURL: gw ? `${gw}/deepseek` : undefined,
  headers: env.CF_AIG_TOKEN ? { 'cf-aig-authorization': `Bearer ${env.CF_AIG_TOKEN}` } : undefined,
})
// same pattern for createOpenAI → `${gw}/openai`
```

- **The gateway is optional.** If its env vars are unset, requests go straight to the providers, so a minimal self-host setup still works.
- The gateway gives logs, token and cost analytics, rate limiting, retries, and caching (useful for repeated embeddings) without any code changes.
- Make it an **authenticated gateway** (`cf-aig-authorization`) so nobody else can spend through it.
- If Cloudflare's provider routing ever lags behind a DeepSeek model, the fallback is to drop `baseURL` and call DeepSeek directly.

---

## 6. Auth

**Better Auth, Google only.**

Arctic handles only the OAuth handshake: the authorization URL, PKCE and the code exchange. You would still write:

- the sessions table and session tokens
- cookie handling, expiry and sliding refresh
- state/CSRF validation
- sign-out

Lucia used to cover that layer, but it is now just a guide you follow by hand.

Better Auth with the Drizzle adapter (`provider: "sqlite"`) and its TanStack Start cookie plugin does all of that in about 30 lines of config and generates the schema.

- **Allowlist:** set `ALLOWED_EMAILS` (comma-separated) in env. A Better Auth `databaseHooks.user.create.before` hook rejects any other email. This matters because a self-hosted instance is publicly reachable, and anyone with a Google account could otherwise sign in.
- **Workers caveat:** env isn't global, so build the auth instance from a factory (`createAuth(env)`) per request, or import `env` from `cloudflare:workers`.
- Self-hosters create their own Google OAuth client. `docs/self-hosting.md` walks through it, including the redirect URI `https://<their-domain>/api/auth/callback/google`.

---

## 7. Data model

> As built in `packages/db/src/schema` (migration `0000_init`). Embedding columns arrive with M3.

All money is stored as **integer centavos**, always PHP, and formatted with `Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })`. The day a transaction belongs to is `local_date` (`YYYY-MM-DD` in the owner's timezone), so month grouping is a string prefix with no timezone math. `created_at` orders entries within a day. There's no separate `occurred_at`: a backdated entry only knows its day anyway.

The tables keep a `user_id` even though there's one owner. It costs nothing and allows a partner or household member on the allowlist later.

```
user, session, account, verification   ← Better Auth core tables

profiles       user_id PK, time_zone ('Asia/Manila'), created_at

categories     id, user_id, name, emoji, kind ('expense'|'income'),
               sort, archived            unique (user_id, kind, lower(name))

merchants      id, user_id, name, default_category_id?
people         id, user_id, name, aliases (json)

entries        id, user_id, raw_text, mode ('log'|'ask'), created_at
               -- one line typed; can yield N transactions

transactions   id, user_id, entry_id?, kind ('expense'|'income'|'lend'|'settle'),
               amount (signed; for splits, your share), local_date,
               description, note, category_id?, merchant_id?, person_id?,
               split?, recurring, status ('pending'|'parsed'|'needs_review'|'confirmed'),
               ai_confidence, created_at, updated_at, deleted_at (soft delete → undo)
               + embedding F32_BLOB(512), embedding_model   (M3)

corrections    id, transaction_id, field, from_value, to_value, created_at

budgets (later) id, user_id, category_id?, month?, amount
```

Indexes: `(user_id, local_date)`, `(user_id, category_id, local_date)`, `(user_id, person_id)`.

People balances are derived: `SUM` over `lend` and `settle` transactions per person. There is no stored balance to drift.

Default categories are seeded on first sign-in. Expense: Food, Groceries, Transport, Bills, Subscriptions, Shopping, Health, Fun, Others. Income: Salary, Freelance, Gifts, Others.

Drizzle needs a small `customType` for `F32_BLOB(512)`, and vector queries use `sql` with `vector32()` / `vector_distance_cos()`.

---

## 8. Infra & self-hosting

### 8.1 Deploy shape

- **`goatside-app`** (core Worker): the only thing a self-hoster needs to deploy.
- **`goatside-web`** (landing Worker): the project site with features, screenshots, a self-hosting guide and a GitHub link. Only the canonical project deploys it.
- **Turso:** pick a region close to the owner (Singapore for PH). Workers can't use embedded replicas, so it's HTTP only, which is fine at this scale.

### 8.2 Config (`apps/app/.dev.vars.example`)

```
# required
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=https://goatside.example.com
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
ALLOWED_EMAILS=you@gmail.com
TURSO_DATABASE_URL=
TURSO_AUTH_TOKEN=
DEEPSEEK_API_KEY=
OPENAI_API_KEY=

# optional
LLM_MODEL=deepseek-flash
EMBEDDING_MODEL=text-embedding-3-small
CF_AIG_ACCOUNT_ID=
CF_AIG_GATEWAY_ID=
CF_AIG_TOKEN=
```

Env is validated at startup with Zod, so a missing var fails loudly with a clear message. Secrets go in via `wrangler secret`, and types come from `wrangler types`.

### 8.3 Self-host flow (`docs/self-hosting.md`)

1. Fork or clone, then run `pnpm i`.
2. Run `turso db create goatside` and create a token.
3. Create a Google OAuth client.
4. Optionally, create an AI Gateway.
5. Run `pnpm --filter app db:migrate`.
6. Run `pnpm --filter app secrets:push`, a small script that pipes `.dev.vars` into `wrangler secret put`.
7. Run `pnpm --filter app deploy`.

Later: a "Deploy to Cloudflare" button, if it supports monorepo subpaths.

### 8.4 CI

- GitHub Actions runs lint, typecheck, unit tests, evals (only on `packages/ai` changes, using repo secrets) and deploys the canonical instance and landing.
- Migrations run with `drizzle-kit` against Turso before deploy.

**Cost estimate:** a log parse is about 1.5k input tokens (mostly cached) plus about 150 output tokens, which is a fraction of a cent. Hundreds of entries a month should cost well under $1 in AI. Turso and Workers free tiers should cover one person.

---

## 9. Milestones

| # | Milestone | Done when |
|---|---|---|
| M0 | **Scaffold** | Turborepo + pnpm, shadcn monorepo (`-t start -b base`), both apps build and run on workerd (`vite preview`), first deploy to Workers. **Status: done; first deploy pending `wrangler login`** |
| M1 | **Auth + DB** | Zod env validation; Google sign-in with allowlist works on Workers; Drizzle schema migrated to Turso; default categories seeded. **Status: built and tested locally (`turso dev` + `pnpm dev:session`); real Google sign-in pending OAuth credentials** |
| M2 | **Manual logging (no AI)** | `core.preparse` with tests; composer saves rows; feed grouped by day; month totals. Usable on its own. **Status: done (composer with live preview, optimistic save, undo, edit drawer, month switcher, interim daily bars + category breakdown)** |
| M3 | **AI parsing** | Providers through AI Gateway, structured-output pipeline, embeddings, retrieval of past examples, review drawer, corrections, undo, eval suite |
| M4 | **Dashboard** | Month switcher, daily bars, category breakdown, Insights page, category management |
| M5 | **Ask mode + People** | Tool-calling agent with streamed answers and inline charts; IOUs, splits, settle-up |
| M6 | **Polish + ship** | PWA + offline queue, quick-repeat chips, monthly recap, CSV export, `docs/self-hosting.md`, landing page |
| Later | | "Of all time" records (lowest-spend day/week/month, streaks), budgets and pace line, recurring detection, receipt photo (vision model), bank/e-wallet CSV import, wallets and balances |

---

## 10. Remaining questions (non-blocking)

1. **License.** MIT is the simplest. AGPL stops someone from running a closed hosted fork. MIT is the default unless you prefer otherwise.
2. **Public demo.** A read-only demo instance with seeded data would help the landing page. It's nice to have and can wait until M6.
