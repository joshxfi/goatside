# Goatside: plan

> Status: **M0–M2 built** (see §9). Next up: M3, AI parsing.

Goatside is an open-source, personal, agentic finance tracker that you self-host. You type a
line like `-500 lunch at berto's` or `+250 paid by x`, and it becomes a categorized
transaction. A mobile-first dashboard shows where the month's money went.

It's for individual use. There is no hosted Goatside service: each person deploys their own
copy to their own Vercel account, with their own database and AI Gateway key.

---

## 0. Decisions

| Topic | Decision |
|---|---|
| Audience | **Individuals who self-host.** Open source; each deploy is one person's instance. No hosted service, no public sign-ups |
| Hosting | **Vercel** (TanStack Start via Nitro, Node runtime on Fluid Compute). No Cloudflare |
| Currency | **PHP (₱) only.** No multi-currency in v1 |
| Scope of money | **Money in and out only.** No wallets, no account balances, no transfers |
| Auth | **One account per deploy**: username and password from env, signed session cookie. No OAuth, no sign-up |
| LLM | **DeepSeek V4.1 Flash** (`deepseek/deepseek-v4.1-flash`) through **Vercel AI Gateway** with the AI SDK |
| Name | **Goatside** |

---

## 1. Product principles

1. **The input box is the app.** Logging takes one line and about 2 seconds. Forms are only for corrections.
2. **Deterministic first, AI second.** Code parses the amount and sign, never the LLM. The model adds meaning (category, merchant, person, date) but cannot change the number you typed.
3. **Instant, then smart.** A row appears as soon as you hit enter, and AI enrichment fills it in about a second later. You never wait on a spinner to log.
4. **It learns from you.** Every correction becomes an example for next time, through retrieval rather than fine-tuning.
5. **Useful without AI.** If the model is down, entries still save with amount and description and get categorized later.
6. **Easy to self-host.** One Vercel project, one Turso database, a username and password in env. AI Gateway authenticates through Vercel OIDC, so there's no AI key to manage in production.

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
| Apps | **TanStack Start** × 2 (`apps/web` landing, `apps/app` core) | Both build with the `nitro/vite` plugin: Vercel Build Output on Vercel, a Node server elsewhere |
| UI | **shadcn/ui on Base UI** + Tailwind v4 | Base UI has been shadcn's default since July 2026. Scaffold with `shadcn init --monorepo -t start -b base` |
| Data fetching | **TanStack Query** + Start server functions | Optimistic inserts for the composer |
| Tables | **TanStack Table** + **TanStack Virtual** | Table drives sort and filter state; mobile renders cards |
| Forms | **TanStack Form** + Zod | Edit drawer, settings |
| Charts | **TanStack Charts** (`@tanstack/react-charts`) | Just reached 1.0. Fallback is shadcn charts (Recharts) if the React adapter turns out rough. Theme either through our CSS variables |
| DB | **Turso** (libSQL) + **Drizzle ORM** | `drizzle-orm/libsql`. Native vectors via `F32_BLOB`. Local dev uses `turso dev` |
| Auth | **`packages/auth`** (~100 lines, Web Crypto) | Single account from env; see §6 |
| LLM | **AI SDK** with gateway model strings → `deepseek/deepseek-v4.1-flash` | Vercel AI Gateway (§5.6). No provider packages |
| Embeddings | **AI SDK** → `openai/text-embedding-3-small` @ 512 dims | Also through AI Gateway |
| Hosting | **Vercel** | One project per app (Root Directory `apps/app` / `apps/web`) |
| Lint/format | **oxlint + oxfmt** | No ESLint or Prettier. oxfmt sorts Tailwind classes natively |
| Tests | Vitest (unit + AI evals); Playwright later | |

**About the model ID:** DeepSeek shipped V4.1 Flash on 2026-09-10. On AI Gateway it's `deepseek/deepseek-v4.1-flash` (input $0.30, output $1.20 per 1M tokens at the time of writing). Model IDs live in env (`LLM_MODEL`, `EMBEDDING_MODEL`) so self-hosters can swap them for any gateway model.

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
│  ├─ auth/                # single-account credentials + signed session tokens
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
  ├─ 4. LLM structured out   DeepSeek V4.1 Flash via AI Gateway, no thinking, Zod schema:
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

**Vector search strategy:** one person has a few thousand rows a year, so we use **brute-force `vector_distance_cos`** with no ANN index. Revisit only if a single instance passes about 50k transactions.

### 5.5 Quality & safety

- **Evals:** about 100 fixture inputs mapped to expected structured output, run with Vitest on every prompt or model change. They track category accuracy, kind accuracy and the amount invariant (which must be 100%).
- **Prompt injection:** transaction text is the owner's own, but notes are still treated as data. Write tools always need approval.
- **Privacy:** the ledger lives in the owner's Turso database. Entry text is sent through the owner's AI Gateway to the model providers (DeepSeek, OpenAI). The README should say plainly what leaves the instance.

### 5.6 Vercel AI Gateway

The AI SDK talks to AI Gateway with plain `provider/model` strings, so there are no provider packages and one bill:

```ts
// packages/ai (sketch)
import { embed, generateText, Output } from "ai"

const { output } = await generateText({
  model: env.LLM_MODEL ?? "deepseek/deepseek-v4.1-flash",
  output: Output.object({ schema: draftSchema }),
  prompt,
})

const { embedding } = await embed({
  model: env.EMBEDDING_MODEL ?? "openai/text-embedding-3-small",
  value: text,
  providerOptions: { openai: { dimensions: 512 } },
})
```

- **Auth:** on Vercel, the gateway authenticates through the project's OIDC token automatically. Locally (or on another host) set `AI_GATEWAY_API_KEY`.
- The gateway gives logs, token and cost analytics, budgets, retries and provider fallbacks without code changes.
- Check AI SDK APIs against the installed version's docs (`node_modules/ai/docs/`) when building M3; this sketch is from memory of AI SDK 7.

---

## 6. Auth

**One account, defined in env.** A self-hosted Goatside belongs to one person, so there's no sign-up, no user table and no OAuth app to register.

- **Credentials:** `GOATSIDE_USERNAME` and `GOATSIDE_PASSWORD` (12+ characters, since the app sits on a public URL). Compared in constant time via HMAC.
- **Session:** a cookie `<expiresAt>.<HMAC-SHA256(SESSION_SECRET, expiry + username + password)>`, `HttpOnly`, `SameSite=Lax`, `Secure` in production, 30 days, renewed once past halfway. No session table: changing the username, password or secret invalidates every session.
- **Sign-in form:** a plain HTML `POST /login` handled by a server route, so it works before hydration and credentials never land in a URL. It has an origin check (TanStack's CSRF middleware); server functions get Start's built-in CSRF protection.
- **Throttling:** every attempt is recorded in `login_attempts` *before* counting, so parallel bursts can't slip under the limit. Unknown browsers get 5 failures per IP and 25 overall per 15 minutes. A browser that has signed in before carries a signed `goatside_device` cookie (1 year) and only has its own cap of 10, so an attacker filling the global cap can't lock the owner out of their existing devices. A brand-new device can still be blocked during an attack; Vercel's firewall rate limits can sit in front of this.
- **Why not Better Auth anymore:** with one env-defined account, its user, account and session tables, OAuth flow and adapters were all unused weight. `packages/auth` is about 100 lines with 16 tests.

---

## 7. Data model

> As built in `packages/db/src/schema` (migration `0000_init`). Embedding columns arrive with M3.

All money is stored as **integer centavos**, always PHP, and formatted with `Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })`. The day a transaction belongs to is `local_date` (`YYYY-MM-DD` in the owner's timezone), so month grouping is a string prefix with no timezone math. `created_at` orders entries within a day. There's no separate `occurred_at`: a backdated entry only knows its day anyway.

There are no user ids: one deploy is one person's ledger.

```
settings       id = 1 (single row), time_zone ('Asia/Manila'), created_at

categories     id, name, emoji, kind ('expense'|'income'),
               sort, archived            unique (kind, lower(name))

merchants      id, name, default_category_id?
people         id, name, aliases (json)

entries        id, raw_text, mode ('log'|'ask'), created_at
               -- one line typed; can yield N transactions

transactions   id, entry_id?, kind ('expense'|'income'|'lend'|'settle'),
               amount (signed; for splits, your share), local_date,
               description, note, category_id?, merchant_id?, person_id?,
               split?, recurring, status ('pending'|'parsed'|'needs_review'|'confirmed'),
               ai_confidence, created_at, updated_at, deleted_at (soft delete → undo)
               + embedding F32_BLOB(512), embedding_model   (M3)

corrections    id, transaction_id, field, from_value, to_value, created_at

login_attempts id, ip, device_id?, succeeded, created_at   (sign-in throttling, pruned after a day)

budgets (later) id, category_id?, month?, amount
```

Indexes: `(local_date)`, `(category_id, local_date)`, `(person_id)`.

People balances are derived: `SUM` over `lend` and `settle` transactions per person. There is no stored balance to drift.

Default categories are seeded on first sign-in. Expense: Food, Groceries, Transport, Bills, Subscriptions, Shopping, Health, Fun, Others. Income: Salary, Freelance, Gifts, Others.

Drizzle needs a small `customType` for `F32_BLOB(512)`, and vector queries use `sql` with `vector32()` / `vector_distance_cos()`.

---

## 8. Infra & self-hosting

### 8.1 Deploy shape

- **The app** (`apps/app`): the only thing a self-hoster deploys. A Vercel project with Root Directory `apps/app`; Vercel detects TanStack Start and Nitro emits Build Output with one Node function.
- **The landing site** (`apps/web`): the project's own marketing page with a self-hosting guide and GitHub link. Only the canonical project deploys it, as a separate Vercel project.
- **Turso:** pick a region close to the owner (Singapore for PH) and a Vercel function region near it.
- Turborepo runs in strict env mode, so the build task declares the variables Nitro reads (`VERCEL`, `VERCEL_ENV`, `NITRO_PRESET`).

### 8.2 Config (`apps/app/.env.example`)

```
# required
GOATSIDE_USERNAME=
GOATSIDE_PASSWORD=          # 12+ characters
SESSION_SECRET=             # openssl rand -base64 32
TURSO_DATABASE_URL=
TURSO_AUTH_TOKEN=

# AI: OIDC on Vercel; a key locally or on other hosts
AI_GATEWAY_API_KEY=

# optional (M3)
LLM_MODEL=deepseek/deepseek-v4.1-flash
EMBEDDING_MODEL=openai/text-embedding-3-small
```

Env is validated with Zod on first use, so a missing var fails loudly with a clear message. Locally it lives in `apps/app/.env.local`; on Vercel, in the project's environment variables (`vercel env pull` syncs them down).

### 8.3 Self-host flow (`docs/self-hosting.md`)

1. Fork the repo.
2. Create a Turso database and token, then run `pnpm db:migrate` against it.
3. Import the fork in Vercel with Root Directory `apps/app`, add the env vars (username, password, session secret, Turso URL and token), deploy.

Later: a **Deploy to Vercel** button (`vercel.com/new/clone?repository-url=…&root-directory=apps/app&env=…`) so steps 1 and 3 become one click. Turso is also available through the Vercel Marketplace, which could provision the database and its env vars from the same flow.

### 8.4 CI

- GitHub Actions runs lint, typecheck, unit tests and evals (only on `packages/ai` changes). Vercel's Git integration handles preview and production deploys.
- Migrations run with `drizzle-kit` against Turso before deploy.

**Cost estimate:** a log parse is about 1.5k input tokens (mostly cached) plus about 150 output tokens, which is a fraction of a cent. Hundreds of entries a month should cost well under $1 in AI. Turso's and Vercel's free tiers should cover one person.

---

## 9. Milestones

| # | Milestone | Done when |
|---|---|---|
| M0 | **Scaffold** | Turborepo + pnpm, shadcn monorepo (`-t start -b base`), both apps build with Nitro (Vercel Build Output verified locally). **Status: done; first Vercel deploy pending** |
| M1 | **Auth + DB** | Zod env validation; single-account sign-in from env with throttling; Drizzle schema migrated to Turso; default categories seeded. **Status: done, tested locally** |
| M2 | **Manual logging (no AI)** | `core.preparse` with tests; composer saves rows; feed grouped by day; month totals. Usable on its own. **Status: done (composer with live preview, optimistic save, undo, edit drawer, month switcher, interim daily bars + category breakdown)** |
| M3 | **AI parsing** | AI SDK through Vercel AI Gateway, structured-output pipeline, embeddings, retrieval of past examples, review drawer, corrections, undo, eval suite |
| M4 | **Dashboard** | Month switcher, daily bars, category breakdown, Insights page, category management |
| M5 | **Ask mode + People** | Tool-calling agent with streamed answers and inline charts; IOUs, splits, settle-up |
| M6 | **Polish + ship** | PWA + offline queue, quick-repeat chips, monthly recap, CSV export, `docs/self-hosting.md`, landing page |
| Later | | "Of all time" records (lowest-spend day/week/month, streaks), budgets and pace line, recurring detection, receipt photo (vision model), bank/e-wallet CSV import, wallets and balances |

---

## 10. Remaining questions (non-blocking)

1. **License.** MIT is the simplest. AGPL stops someone from turning it into a closed hosted service, which fits the self-host-only positioning. MIT is the default unless you prefer otherwise.
2. **Public demo.** A read-only demo instance with seeded data would help the landing page. It's nice to have and can wait until M6.
