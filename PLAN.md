# Goatside: plan

> Status: **M0–M5 built, M6 mostly built** (see §9). Known issues and what's next are in §10.

Goatside is an open-source, personal, agentic finance tracker that you self-host. You type a
line like `180 iced coffee` or `+18000 client payment`, and it becomes a categorized
transaction. On a phone it's a quick logger and a chat with the agent; on a wide screen it's
a dashboard for reviewing your money.

It's for individual use. There is no hosted Goatside service: each person deploys their own
copy to their own Vercel account, with their own database and AI Gateway key.

---

## 0. Decisions

| Topic | Decision |
|---|---|
| Audience | **Individuals who self-host.** Open source; each deploy is one person's instance. No hosted service, no public sign-ups |
| Hosting | **Vercel** (TanStack Start via Nitro, Node runtime on Fluid Compute). No Cloudflare |
| Currency | **PHP (₱) only.** No multi-currency in v1 |
| Scope of money | **Money in and out, IOUs, and accounts.** Banks, e-wallets, credit cards and cash, each with a derived balance; transfers between them aren't spending |
| Auth | **One account per deploy**: username and password from env, signed session cookie. No OAuth, no sign-up |
| LLM | **TypeSafe Jev** (`typesafe-ai/jev`) files entries; **DeepSeek V4.1 Flash** (`deepseek/deepseek-v4.1-flash`) answers questions. Both through **Vercel AI Gateway** with the AI SDK (§5.1) |
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

### 2.1 Layout (phone)

The original sketch. What shipped is in §2.4.1.

```
┌─────────────────────────────┐
│  October 2026        ‹  ›   │  ← change month
│                             │
│  Spent      ₱18,420         │
│  In         ₱25,000         │
│  Net       +₱6,580  ▲12%    │  ← vs last month, same day-of-month
│                             │
│  ▁▃▂▇▁▁▄▂▃▁▅ (daily bars)   │
│                             │
│  Food ████████░░  ₱7,200    │
│  Transport ███░░  ₱2,100    │
│  ...                        │
│                             │
│  Today                      │
│  ☕ Iced coffee     −₱180    │
│  💼 Client payment +₱18,000 │
│  ...                        │
├─────────────────────────────┤
│  ☕ 180  🚕 150  🍜 250       │  ← quick picks (your frequent entries)
│ [ 180 iced coffee        ⏎] │  ← composer, pinned in the thumb zone
└─────────────────────────────┘
```

### 2.2 Composer grammar

The composer accepts free text. A line that **starts with an amount** is logged; the sign is optional (`+` in, `-` out), and without one the agent decides or asks. Anything else, like `lent nini 1000` or a question, goes to **ask mode**, where the chat agent can still log it through its write tools.

| Input | Result |
|---|---|
| `180 iced coffee` | Expense ₱180 · Food · today (the agent picks the direction) |
| `+18000 client payment` | Income ₱18,000 · Freelance |
| `500 daniel paid me back` | If Daniel owes you, it **settles that IOU**. When the agent isn't sure, it asks |
| `1200 dinner with nini and daniel split 3` | Expense ₱400 (your share), plus ₱400 owed by Nini and ₱400 owed by Daniel |
| `150 grab yesterday` | Transport, dated yesterday |
| `200 taxi via gcash` | Filed to the GCash account |
| `2000 cash in gcash from bpi` | A transfer between two accounts, not spending |
| `89 spotify monthly` | Subscriptions, marked recurring |
| `250 lunch, -120 coffee` | Two transactions from one line (each extra entry needs a signed amount after the comma) |
| `how much on food this month?` | Ask mode: a text answer from the ledger |
| `undo` | Removes the newest entry |

Amounts accept `500`, `1.5k`, `1,250.50` and an optional `₱` or `php` prefix. Everything is stored as PHP.

### 2.3 Entry lifecycle (what you see)

1. Press enter. The row appears **immediately** with amount and raw text.
2. Within about a second, it resolves to its category and account, and a **toast with Undo** shows for a few seconds.
3. If confidence is low (unknown merchant, ambiguous person), the row gets a small **"Check"** dot. Tapping it opens a bottom-sheet drawer with the AI's guess preselected, so a fix takes one tap.
4. Edits made in the drawer are stored as **corrections** and feed future parses.

### 2.4 Screens

- **Home / Overview**: month summary, accounts, pace, where it went, day by day, calendar, six-month trend, biggest changes, recent entries, people and repeats.
- **Transactions**: the full ledger for a period, with search, filters, bulk re-file, delete with Undo, and CSV export.
- **Accounts**: banks, e-wallets, credit cards and cash, each with its balance and history.
- **People**: running balance per person ("Nini owes you ₱800"), IOU history, partial or full settle, drafted reminders.
- **Settings**: categories (emoji, rename, add, hide, merge, find entries for a new one), timezone, install on the home screen.

### 2.4.1 Phone vs desktop (as built)

One responsive page, split by CSS breakpoints so the server renders the right layout (no flash):

- **Phone: log and chat.** Summary, daily bars, categories, people and the day-grouped feed, with the composer pinned in the thumb zone and the agent's question cards above it.
- **Desktop (`lg`, 1024px+): review.** A sidebar (Overview, Transactions, Accounts, People, Settings, Ask Goatside ⌘J) and a one-line composer in the header (⌘K). **Overview** is the summary: headline numbers; a row of account cards with their balances; pace vs last month with a projection to month end (recurring bills counted once, the rest at the everyday daily rate); *where it went*, a donut of the top categories plus Other with the total in its center, over a list of each slice and what Other folds in; day by day beside a calendar heatmap (one red hue, stronger on bigger days); six months stacked by category beside money in and out per month; then *biggest changes* (per category against the same point last month), *largest expenses* and *recent* (linking to Transactions), then people and repeats. **Transactions** is the full ledger: a period picker (any month, 3 months, this year, all time), totals for the period, and a TanStack Table with search, category, account and type filters (out, in, IOUs, transfers), sorting, Shift-range multi-select for bulk re-file to a category or account (recorded as corrections) or delete with Undo, and CSV export of what's filtered. **Accounts** groups banks, e-wallets, credit cards and cash as colored cards (balance, or what's owed and the credit left on a card), with totals, the default account, and per account a history with the running balance, "correct the balance", edit, and archive.
- Between 1024 and 1280px the headline numbers go two-up and charts stack, so nothing truncates.

### 2.4.2 Offline and install (as built)

- **Installable.** A manifest with PNG icons (the coin on paper, inside the maskable safe zone), iOS home-screen tags, and Settings → Home screen: an Install button where the browser offers one, steps on iOS.
- **Opens offline.** `public/sw.js`, registered in production builds only. Built assets come from the cache once seen; pages go to the network first (4s, then the kept copy), and each page that loads is kept, so the overview opens with no signal. A page never opened gets `offline.html`. Server functions and `/api/ask` always go to the network. Kept pages go when the session does: on sign-out (first, so it works offline), whenever the sign-in page shows, when a page load is redirected to sign in, and once a copy is older than the 30-day session (each copy is stamped `x-goatside-kept-at`).
- **Logs offline.** Every log goes through an outbox in `localStorage` (`src/lib/outbox.ts`) before it's sent, so a dropped connection or a reload can't lose it. Waiting entries show in the feed as "Waiting to sync" (tap to remove), the composer says so, and they're sent oldest first when the connection returns, the app comes back to the foreground, or every 30s. Each carries an id chosen on the phone (the server saves an id once, so resending is safe) and the time it was typed (so "yesterday" keeps its meaning, and the server never dates an entry in the future). Asking the agent needs a connection.

### 2.4.3 Editing an entry by hand (as built)

The edit drawer covers everything the agent decides, so no fix needs a model or a retyped entry. "Amounts stay as typed" means the model never changes a number; the owner can. Changes stay in the form until Save (`editTransaction` in `ledger.server.ts`), and amount, type and people edits toast with Undo. It opens from the feed, the overview cards, Transactions, and the history on a person's or an account's page (`EntryDrawer` loads the entry by id).

- **A line is your row plus the others' IOUs.** Its type, people and ways decide those rows the way `planRows` does for a typed line, and changing any of them re-plans it: your row keeps its id, questions and history, the others' rows are updated in place, added (same entry, same `createdAt`, so the composer's "undo" still takes the whole line) or soft-deleted.
- **Type**: Spent, Received, Transfer, Lent or Borrowed, for anything but a repayment or someone's share of a split. So a split can become "just me" or "I paid it all for Ben", an IOU can become your own spending or money received, and back. Switching direction clears a category that no longer fits; a transfer needs two different accounts; a transfer turned into money in is filed where it arrived. Changing it closes the agent's direction, transfer, relation and category questions.
- **Split with** (spending): pick people, or "Add someone" (a name or nickname that matches someone picks them). **Ways** counts you in; more ways than people leaves unnamed shares, as "split 4" does. The hint shows who pays what.
- **Amount**, unsigned: the type sets the direction. On a split it's the whole bill, re-divided evenly (`shares()`, odd centavos to you) only when the bill or the split changed, so shares set one by one stay.
- **Lent to / Borrowed from / With**: who an IOU or a repayment is with. Someone's share of a split edits just that share. A repayment can't pay back more than was owed (the same rule as settling up).
- **Repeats every month**, for spending and income: what the pace projection and the Repeats card count.
- **Split bills move together**: the others' shares follow its description, date and account, and deleting your share deletes theirs (one Undo restores all).
- **Add an IOU** (People, and a person's page): I lent or paid for them / they lent or paid for me, who (or someone new), amount, what for, account (the default when lending, none when they paid), date. Saved as typed, no model involved.
- Open questions on the entry get the new amount, so answering one later re-files with it. Every change is a correction (field, old, new, plus `people` for a split's sharers), and an edited row is confirmed, so its category, direction and repeats teach the next categorization.

### 2.5 Small touches

- **Quick picks** above the empty composer: up to four of your frequent entries, weighted toward this time of day (built, §5.2.4).
- **PWA** with an offline queue (built, §2.4.2).
- Money colors: **green for money in, red for money out** (`text-income-foreground`, `text-expense-foreground`).
- Not built yet: a **monthly recap card** on the 1st (total, top category, biggest expense, change vs last month), a **pace line against a budget**, and a haptic tick on save.

### 2.6 Brand

From the founder's sketch: "goat side" means *which side of the coin are you on?*

- **Mark:** a coin struck with a capital "G", drawn as a single stroke (no font needed) so it works from favicon to hero. Components live in `packages/ui/src/components/brand.tsx` (`CoinMark`, `Coin`, `CoinFlip`, `Wordmark`).
- **Metals:** gold, silver and bronze belong to the coin mark only. They're theme tokens (`text-gold-foreground`, `bg-silver`, …) on a warm paper/ink palette, light and dark. Money in and out use green and red, never "gold side / silver side".
- **Type:** Instrument Serif (`font-display`) for headlines, the wordmark and big money figures, in the app and on the landing page. Geist for body, labels and controls. Tabular numerals (`.figure`) for money. Labels are sentence case, never uppercase and letter-spaced.
- **Copy:** plain, short sentences and straight quotes. Example entries are neutral ("180 iced coffee"; people are Nini and Daniel), and no copy tells people to type `+` or `-`.
- **Motion:** the coin toss and flip are reserved for rare moments (landing, sign-in, loading). The composer is used constantly, so it gets no decorative motion. Reduced motion is respected. Elsewhere motion only explains a change: new entries grow into lists and deleted ones fold out, an answered question steps back before the next arrives, and headline figures count to their new value. Arrivals are CSS (`.enter-rise`, `.enter-fade`); exits, collapses and counts use [Motion](https://motion.dev) (`components/motion.tsx`), whose animation code loads after first paint. Nothing animates on first paint, on month switches or on page navigation.
- **Voice:** steady climbing, resilience, abundance, stability. "GOAT" also means greatest of all time, so personal records ("lowest-spend week of all time") are part of the brand.

---

## 3. Stack

| Concern | Choice | Notes |
|---|---|---|
| Monorepo | **Turborepo + pnpm** (workspaces + catalogs) | |
| Apps | **TanStack Start** × 2 (`apps/web` landing, `apps/app` core) | Both build with the `nitro/vite` plugin: Vercel Build Output on Vercel, a Node server elsewhere |
| UI | **shadcn/ui on Base UI** + Tailwind v4 | Base UI has been shadcn's default since July 2026. Scaffold with `shadcn init --monorepo -t start -b base` |
| Data fetching | **TanStack Query** + Start server functions | Optimistic inserts for the composer |
| Tables | **TanStack Table v9** on shadcn's table markup | Desktop transactions table: explicit features (sorting, global filter, pagination); phones keep the card feed |
| Forms | Plain React state + Zod validators on the server functions | Edit drawer, settings, account and IOU forms |
| Charts | **TanStack Charts** (`@tanstack/charts`, React adapter at `@tanstack/charts/react`) | A typed chart grammar; SSR-rendered SVG. `.goat-chart` maps the chart theme to our tokens. Category colors are four `--series-*` hues plus a gray Other, checked with a colorblind-safety validator against the card in both modes; each category keeps its slot (by six-month rank) in every chart, and stacks and rings draw in an order where the one weak pair (blue and violet) never touches. Red and green stay reserved for money out and in |
| DB | **Turso** (libSQL) + **Drizzle ORM** | `drizzle-orm/libsql`. Native vectors via `F32_BLOB`. Local dev uses `turso dev` |
| Auth | **`packages/auth`** (one small file, Web Crypto) | Single account from env; see §6 |
| Categorizing | **AI SDK `experimental_decide`** → `typesafe-ai/jev` | Decision model with probabilities (§5.1). Through Vercel AI Gateway |
| Questions | **AI SDK `streamText`** + tools → `deepseek/deepseek-v4.1-flash` | Vercel AI Gateway (§5.6). No provider packages |
| Embeddings (maybe later) | **AI SDK** → `openai/text-embedding-3-small` @ 512 dims | Only if exact-description memory proves too narrow |
| Hosting | **Vercel** | One project per app (Root Directory `apps/app` / `apps/web`) |
| Lint/format | **oxlint + oxfmt** | No ESLint or Prettier. oxfmt sorts Tailwind classes natively |
| Tests | **Vitest**: unit tests in `packages/*`, and `apps/app` server tests against a temp SQLite file with the real migrations (no model calls); live AI evals run by hand | CI runs everything but the evals (§8.4) |

**About the model ID:** DeepSeek shipped V4.1 Flash on 2026-09-10. On AI Gateway it's `deepseek/deepseek-v4.1-flash` (input $0.30, output $1.20 per 1M tokens at the time of writing). Model IDs live in env (`DECISION_MODEL`, `CHAT_MODEL`) so self-hosters can swap them for any gateway model.

---

## 4. Repo layout

```
goatside/
├─ apps/
│  ├─ app/                 # the self-hosted app: TanStack Start, SSR + server functions
│  └─ web/                 # landing page + docs (Fumadocs, content/docs)
├─ packages/
│  ├─ core/                # pure TS: money, entry parser, dates, account and name scanning
│  ├─ ai/                  # Jev decisions (category, people, accounts, duplicates), ask prompt, evals
│  ├─ db/                  # Drizzle schema, migrations, client factory, demo seed
│  ├─ auth/                # single-account credentials + signed session tokens
│  └─ ui/                  # shadcn components (Base UI), brand, theme tokens, styles
├─ .github/workflows/ci.yml  # checks on every push; migrations on main (§8.4)
├─ turbo.json
├─ pnpm-workspace.yaml     # workspaces + version catalog
├─ .oxlintrc.json          # one lint config for the whole repo
├─ AGENTS.md               # agent notes; each app and package has its own too
└─ PLAN.md
```

`packages/core` has no runtime dependencies, which makes it trivially testable. It holds the most important logic: the amount and sign parser. The self-hosting guide lives in `apps/web/content/docs/self-hosting`. There's no LICENSE yet (§10).

---

## 5. AI design

### 5.1 Two models, two jobs

- **Logging uses a decision model:** TypeSafe's **Jev** (`typesafe-ai/jev`), through AI Gateway with AI SDK's `experimental_decide`. Filing an entry is a set of typed judgments (which category? money in or out? does it repeat?), not text generation. Jev answers choice and boolean questions with probabilities in one fast call per line, so the code can act when it's sure and ask when it isn't.
- **Questions use a chat model:** **DeepSeek V4.1 Flash** (`deepseek/deepseek-v4.1-flash`) runs a tool-calling loop over read-only ledger tools, streamed to the UI with `useChat`. It is only used for the owner's questions.

Both model IDs are env-overridable (`DECISION_MODEL`, `CHAT_MODEL`). Without AI Gateway credentials the app still works: entries save uncategorized, and sign-less entries still get an "in or out?" question.

### 5.2 Log pipeline (`packages/ai/src/categorize.ts`, `apps/app/src/server/agent.server.ts`)

```
raw text
  │
  ├─ 1. core.preparse()      deterministic: split lines, sign, amount, date words, "split N"
  │                          → no amount: ask mode
  │
  ├─ 2. memory               newest owner-confirmed transaction with the same description
  │                          → gives direction + category; skips the model when it settles both
  │
  ├─ 3. Jev decide call      state: { entry, amount }   questions (asked only as needed):
  │                            direction  choice out|in     (only when there's no sign)
  │                            expense    choice over expense categories
  │                            income     choice over income categories
  │                            recurring  boolean
  │                          each category's criteria = built-in hint + up to 6 recent
  │                          descriptions filed there (confirmed rows first)
  │
  ├─ 4. resolveLine()        trust order: explicit sign > memory > model
  │                          direction applied at ≥ 0.85, category at ≥ 0.6, recurring at ≥ 0.8
  │                          anything below → saved with the best guess + a question
  │
  └─ 5. save                 status parsed | needs_review | pending (no model); questions rows
                             one db.batch: the entry, its rows and its questions land together,
                             and the phone-chosen entry id makes a resend return what was saved
```

Model failures (timeout 6s, one retry) never block logging; the line just saves with less certainty. `resolveLine` is pure and unit-tested with AI SDK's mock decision model.

### 5.2.1 Human in the loop: questions

When the agent is unsure, it asks, one card at a time above the composer:

- **"₱500 for 'lunch': was that money out or in?"** for a sign-less line Jev is torn on (or any sign-less line when AI is off). The direction question stores the category rankings for both sides, so answering "in" also files it under the best income category, and asks a category follow-up if that's uncertain too.
- **"Which category fits 'grab bgc'?"** with the top three guesses, the current one highlighted, plus "Other…" to open the edit drawer.
- **"Keep guess"** confirms the saved value.

Answers that differ from the guess are stored as `corrections`. Answered (and hand-edited) rows become `confirmed`, which makes them memory and examples for the next categorization, so the agent learns the owner's habits without fine-tuning. Rows with open questions show a "Check" marker in the feed.

### 5.2.2 People, IOUs and splits (`packages/core/src/people.ts`, `packages/ai/src/people.ts`)

Extraction is code, judgment is Jev (TypeSafe's recommended split for value extraction):

1. `nameCandidates()` collects words after cue words ("with", "w/", "by", "from", "to", "for", "ni", "kay", "utang", "bayad", "lent"…) plus the owner's known people and aliases, in the order mentioned. It over-collects on purpose ("grab to bgc" → "Bgc").
2. A **second, parallel decide call** (separate so the extra context can't sway the category) asks:
   - `person{i}` (boolean, unknown candidates only): is this a person rather than a place, shop, app or thing? Accepted at ≥ 0.6.
   - `relation` (choice): `own` · `lent` · `borrowed` · `repaid_me` · `i_repaid` · `shared`.
   State carries the sign and each person's open balance, **but only when the balance could explain a repayment** (money in from someone who owes you, out to someone you owe). Shown unconditionally, balances pushed a plain group dinner to "shared" at 0.98.
3. `resolvePeople()`: with a sign, only relations that move money that way count (renormalized). Without one, a confident relation also settles the direction. "split N" with people named is always `shared`. Applied at ≥ 0.7; otherwise it's saved as the owner's own money and asked, always offering "Just my spending".
4. `planRows()` turns the decision into rows, with signs as cash flow from the owner's side: `shared` → your share (categorized expense, `split = n`) plus one `lend` row per person; `lent`/`borrowed` → `lend`; repayments → `settle`. A person's balance is `−Σ amount` over their lend/settle rows. IOUs never count toward spending totals.

Answering a relation question re-files the line in place (the primary row keeps its questions and corrections; IOU rows are replaced). The home screen lists open balances with one-tap **Settle**, and the ask agent has a `balances` tool.

### 5.2.3 Duplicates and repeats

- **Duplicates** (`packages/ai/src/duplicates.ts`): code finds the newest entry with the same amount within ±2 days, logged in the last 3 days. Same text within 15 minutes is a repeat outright; otherwise Jev answers "the same single payment entered twice?" with the gap between loggings in state. At ≥ 0.7 the owner is asked "Keep both / Remove this one", and that question replaces the line's others.
- **Repeats:** a description seen in two earlier months (amount within 15%) is recurring regardless of the text; seen once, Jev's recurring score needs only 0.4 instead of 0.8.

### 5.2.4 More agent assists

- **New category → "find entries for this".** Jev re-checks recent entries (last 120 days, up to 80) against the full category list and suggests ones whose best fit is now the new category (≥ 0.7); the owner unticks any and confirms. Examples are dropped for this pass: they come from current filing and vote for the status quo ("kape" as a Food example kept "kape" in Food at 0.70; without examples it's Coffee at 0.79).
- **Payment reminders.** On a person's page, DeepSeek drafts a two-to-three sentence reminder from their actual open IOUs; the owner edits, copies or shares it. Nothing is sent automatically.
- **Quick picks.** Up to four chips above the empty composer: entries typed at least twice in 60 days, weighted toward ones usually logged around this hour. A pick skips the duplicate check, since repeating it is the point.

### 5.2.4.1 Accounts and transfers (`packages/core/src/accounts.ts`, `packages/ai/src/accounts.ts`)

1. `scanAccounts()` finds the owner's accounts in a line by name or nickname, longest first ("bpi card" before "bpi"), with the cue before it: "from" and "to"/"into" say which side of a transfer. "cash", "credit card" and a cued "card" mean the only account of that kind. It also spots a name that isn't set up: a known Philippine bank or e-wallet anywhere ("gcash", "bdo"; ones that double as first names, like "maya", need "via" or "app"), or a name after "using"/"via"/"thru" ("using tala"). It strips the account words, so categories, people and memory see "lunch", not "lunch via gcash".
2. Transfer words: cash in, top up, ATM, withdraw, cash out, card payment, transfer, deposit. A fee ("atm fee") is spending, so it never makes a transfer. `guessTransfer()` reads the sides from the words: from/to, then the card being paid, the wallet being topped up or the cash withdrawn, filling one missing side with the default account (or the cash account for ATM).
3. When the words could make a transfer, Jev answers one boolean, "moving their own money between two of their own accounts?", with the owner's accounts in state. ≥ 0.75 files a transfer; 0.3–0.75 asks "Moved from X to Y / Money I spent"; below that it's spending. An unknown name that isn't on the provider list gets a Jev choice (bank, e-wallet, credit card, cash, not an account); "not an account" at ≥ 0.7 drops it silently ("via grab").
4. `resolveAccounts()`: a transfer, else the account the line names, else, for a recurring charge, the account the same description used last, else the default (not for "borrowed": when someone paid for the owner, none of their accounts moved). An unknown name saves the line unfiled and asks; answering creates the account with the next color and files the line.

A transfer is one row: `kind = 'transfer'`, `amount < 0` out of `account_id`, into `to_account_id`, no category or person. Totals, charts and the ask tools' sums skip transfers. A balance is `opening + Σ amount` filed to the account `− Σ amount` of transfers into it; "correct the balance" moves `opening` so every entry stays. Credit cards hold a negative balance while something's owed.

### 5.2.5 Evals (`pnpm --filter @workspace/ai eval`)

Live runs against the real model, with results as of 2026-10-10:

| Eval | Cases | Result |
|---|---|---|
| Category | 43 | 95% top-1; 91–95% applied without asking, all correct |
| Direction without a sign | 43 | 98%; 93–95% applied without asking, all correct |
| People + relation | 22 | 100% people found; 91–95% applied, the rest asked, 0 wrong without asking |
| Duplicates | 15 (6 held out) | 15/15 at 0.7 |
| Accounts (2026-10-11) | 19 | Transfers 10/11, 1 asked; new names 8/8 (4 from the provider list); 0 wrong without asking |

Ranges are across runs (borderline cases like "gas shell" at 0.51 move a little). Every miss so far fell below its threshold and became a question. Rerun after changing criteria, hints or models.

### 5.3 Ask mode (`apps/app/src/server/ask.server.ts`, `POST /api/ask`)

| Tool | What it does |
|---|---|
| `summarize(from, to, groupBy, direction, category?, account?)` | Totals for a range, grouped by category, day or month |
| `findTransactions(from, to, direction, category?, text?, account?, sort, limit)` | Matching entries (with ids), newest or largest first, with their count and sum |
| `balances(person?)` | Where the owner stands with everyone, or one person's standing and last 10 IOUs. Names match nicknames and "kay Mara"/"Mara's"; an unknown name returns the list of people |
| `iouActivity(from, to, person?)` | IOUs in a range with totals: lent, borrowed, paid back to the owner, paid back by the owner |
| `accounts()` | Each account's balance (a card: owed and available), and which is the default |
| `moveToCategory(filter, newCategory)` | **Write, approval.** Re-files matching spending or income; records corrections |
| `deleteEntries(filter)` | **Write, approval.** Soft-deletes matching entries of any kind (≤ 50), plus the other rows of a split bill |
| `logEntries(text)` | **Write, approval.** Logs composer-syntax text through the full pipeline; the result says how each line was filed and what the owner will be asked |
| `recordIou(person, type, amount, description?, date?, account?)` | **Write, approval.** A new IOU, `lent` or `borrowed`, saved as given; new names join People |
| `settleUp(person, paidBy, amount?, date?, account?)` | **Write, approval.** A full or partial repayment on an existing balance. Refused when the direction doesn't fit the balance or the amount is more than owed |
| `addAccount(name, kind, balance?, creditLimit?, last4?, aliases?)` | **Write, approval.** Sets up an account; for a card, `balance` is what's owed |
| `setAccountBalance(account, balance)` | **Write, approval.** Corrects what an account holds now, keeping its entries |
| `moveToAccount(filter, account)` | **Write, approval.** Files matching entries under an account |

Filters for the write tools take a date range, text, category, exact amount, direction, `person` (IOU entries with them) and `ids` (exact entries from `findTransactions`, for when a text filter would catch too much: "grab rides" but not "grabfood").

IOUs go through structured tools rather than composer text. The chat model has already understood "Ben paid for my lunch"; written as "+350 lunch paid by ben", the decision model had to read it again and filed it as Ben paying the owner back. `recordIou` and `settleUp` plan the change once, and the card and the write both use that plan.

Write tools use AI SDK `toolApproval`. The approval function runs on the server: it finds exactly what would change and writes the confirmation text itself ("Move 3 entries to 🎟️ Going out: grabfood dinner (10-05, ₱510); …"), so the card shows real entries rather than the model's description. Nothing matching, or too much, is an automatic denial with a reason the model can act on. Approvals are HMAC-signed (`experimental_toolApprovalSecret`, derived from `SESSION_SECRET`), so a modified client can't forge one. Results carry undo data (restore, delete, or put categories back), and the chat auto-continues after a decision (`lastAssistantMessageIsCompleteWithApprovalResponses`).

The read tools are fixed queries; the model never writes SQL or changes data. The system prompt (`packages/ai/src/ask.ts`) gives today's date and timezone and the category names, and requires every figure to come from a tool. The route needs a session and passes the CSRF check; it keeps the last 12 messages, starting at one of the owner's, and streams with `reasoning: "none"`.

`pnpm --filter app eval:ask` runs 29 scenarios through the real agent, tools and approval gate against a local demo database, approving every card. Each is checked against the tool calls it should make, the writes it must not make, or the ledger afterwards. It covers IOUs (new loans, someone paying for the owner, splits, partial and full repayments, a repayment in the wrong direction, overpaying, paying for someone else's share, Taglish), spending questions, accounts, logging, re-filing and an off-topic request. It refuses a non-local `TURSO_DATABASE_URL`. Last run: 29/29. Inline charts in answers come later.

### 5.4 Embeddings (deferred)

Not built. Memory currently matches the exact description, and Jev sees recent examples per category. Embeddings would add fuzzy recall ("grab to bgc" ≈ "grab bgc"); the notes below stand if we add them.


I recommend `text-embedding-3-small` with `dimensions: 512`. The reasons:

- Inputs are tiny strings, so cost is effectively zero ($0.02 per 1M tokens).
- Matryoshka truncation to 512 dims keeps rows small with little quality loss for short text.
- It handles mixed-language input (Taglish, slang, shop names) well.
- It is still OpenAI's current small embedding model; no successor has been announced.

Store `embedding_model` on each row so re-embedding stays possible. A `pnpm reembed` script re-embeds everything if the model changes.

**Vector search strategy:** one person has a few thousand rows a year, so we use **brute-force `vector_distance_cos`** with no ANN index. Revisit only if a single instance passes about 50k transactions.

### 5.5 Quality & safety

- **Evals:** see §5.2.5. Next: grow the category set toward ~100 entries, and add held-out phrasing. Amounts never pass through a model, so the amount invariant holds by construction.
- **Prompt injection:** transaction text is the owner's own, but the ask prompt still treats descriptions as data. The read tools are fixed queries, and every write tool needs the owner's approval (§5.3).
- **Privacy:** the ledger lives in the owner's Turso database. Entry text and amounts go through the owner's AI Gateway to TypeSafe (categorizing); questions and the ledger rows the tools return go to DeepSeek. The README should say plainly what leaves the instance.

### 5.6 Vercel AI Gateway

The AI SDK talks to AI Gateway with plain `provider/model` strings, so there are no provider packages and one bill:

```ts
// categorize.ts (abridged)
const { answers } = await experimental_decide({
  model: "typesafe-ai/jev",
  state: { entry: "grab to bgc", amount: "₱180" },
  questions: { expense: { type: "choice", instructions: "…", criteria } },
})
answers.expense.probabilities // { c0: 0.08, c2: 0.81, … }

// ask.server.ts (abridged)
streamText({ model: "deepseek/deepseek-v4.1-flash", system, messages, tools,
  stopWhen: isStepCount(6), reasoning: "none" })
```

- **Auth:** on Vercel, the gateway authenticates through the project's OIDC token automatically. Locally (or on another host) set `AI_GATEWAY_API_KEY`.
- The gateway gives logs, token and cost analytics, budgets, retries and provider fallbacks without code changes.
- AI SDK docs for the installed version ship in `node_modules/ai/docs/` (decisions: `03-ai-sdk-core/32-decisions.mdx`).

---

## 6. Auth

**One account, defined in env.** A self-hosted Goatside belongs to one person, so there's no sign-up, no user table and no OAuth app to register.

- **Credentials:** `GOATSIDE_USERNAME` and `GOATSIDE_PASSWORD` (12+ characters, since the app sits on a public URL). Compared in constant time via HMAC.
- **Session:** a cookie `<expiresAt>.<HMAC-SHA256(SESSION_SECRET, expiry + username + password)>`, `HttpOnly`, `SameSite=Lax`, `Secure` in production, 30 days, renewed once past halfway. No session table: changing the username, password or secret invalidates every session.
- **Sign-in form:** a plain HTML `POST /login` handled by a server route, so it works before hydration and credentials never land in a URL. It has an origin check (TanStack's CSRF middleware); server functions get Start's built-in CSRF protection.
- **Throttling:** every attempt is recorded in `login_attempts` *before* counting, so parallel bursts can't slip under the limit. Any browser gets 5 failures per IP and 25 overall per 15 minutes. A browser that signed in under the current credentials carries a signed `goatside_device` cookie (1 year) that bypasses those caps, so an attacker filling them can't lock the owner out. The bypass ends once that device has more than 10 failures in 24 hours, so a stolen device cookie is worth at most 10 extra guesses a day, and changing the password revokes every device. A brand-new device can still be blocked during an attack; Vercel's firewall rate limits can sit in front of this.
- **Why not Better Auth anymore:** with one env-defined account, its user, account and session tables, OAuth flow and adapters were all unused weight. `packages/auth` is one file of under 200 lines, with 20 tests.

---

## 7. Data model

> As built in `packages/db/src/schema` (migrations `0000`–`0003`). Retrieval uses exact-description memory and recent examples; embedding columns are deferred (§5.4).

All money is stored as **integer centavos**, always PHP, and formatted with `Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })`. The day a transaction belongs to is `local_date` (`YYYY-MM-DD` in the owner's timezone), so month grouping is a string prefix with no timezone math. `created_at` orders entries within a day. There's no separate `occurred_at`: a backdated entry only knows its day anyway.

There are no user ids: one deploy is one person's ledger.

```
settings       id = 1 (single row), time_zone ('Asia/Manila'), default_account_id?, created_at

accounts       id, name, kind ('bank'|'ewallet'|'credit_card'|'cash'), color,
               aliases (json), last4?, credit_limit?, opening, sort, archived
               unique lower(name)

categories     id, name, emoji, kind ('expense'|'income'),
               sort, archived            unique (kind, lower(name))

merchants      id, name, default_category_id?   (reserved: nothing writes it yet)
people         id, name, aliases (json)

entries        id, raw_text, mode ('log'|'ask'), created_at
               -- one line typed; can yield N transactions

transactions   id, entry_id?, kind ('expense'|'income'|'lend'|'settle'|'transfer'),
               amount (signed; for splits, your share), local_date,
               description, note, category_id?, merchant_id?, person_id?,
               split?, account_id?, to_account_id? (transfers), recurring, status ('pending'|'parsed'|'needs_review'|'confirmed'),
               ai_confidence, created_at, updated_at, deleted_at (soft delete → undo)
               -- a split bill is your expense row (split = ways) plus one lend row per
               -- person, linked by entry_id + description + local_date. Rows added to an
               -- existing line copy its created_at, so the composer's "undo" still
               -- targets the newest entry

corrections    id, transaction_id, field, from_value, to_value, created_at

questions      id, transaction_id, kind ('direction'|'category'|'relation'|'duplicate'|'account'|'transfer'), guess,
               options (json: value + model probability), context (json),
               answer?, resolved_at?, created_at        -- the agent asking the owner

login_attempts id, ip, device_id?, succeeded, created_at   (sign-in throttling, pruned after a day)

budgets (later) id, category_id?, month?, amount
```

Indexes: `(local_date)`, `(category_id, local_date)`, `(person_id)`, `(account_id)`, `(to_account_id)`.

People balances are derived: `SUM` over `lend` and `settle` transactions per person. Account balances are derived the same way, from `opening` plus what's filed to the account (§5.2.4.1). There is no stored balance to drift.

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

# optional model overrides
DECISION_MODEL=typesafe-ai/jev
CHAT_MODEL=deepseek/deepseek-v4.1-flash
```

Env is validated with Zod on first use, so a missing var fails loudly with a clear message. Locally it lives in `apps/app/.env.local`; on Vercel, in the project's environment variables (`vercel env pull` syncs them down).

### 8.3 Self-host flow (`apps/web/content/docs/self-hosting`)

1. Fork the repo.
2. Create a Turso database and token, then run `pnpm db:migrate` against it.
3. Import the fork in Vercel with Root Directory `apps/app`, add the env vars (username, password, session secret, Turso URL and token), deploy.
4. Optional: add `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` as Actions secrets on the fork, so later migrations apply on their own (§8.4).

Later: a **Deploy to Vercel** button (`vercel.com/new/clone?repository-url=…&root-directory=apps/app&env=…`) so steps 1 and 3 become one click. Turso is also available through the Vercel Marketplace, which could provision the database and its env vars from the same flow.

### 8.4 CI (`.github/workflows/ci.yml`)

- **check**, on every push and pull request: `pnpm install --frozen-lockfile`, lint, format check, typecheck, tests. AI evals hit paid models, so they stay manual. The route trees aren't diffed: `tsr generate` (run by typecheck) drops the Start `Register` block the Vite plugin writes into `routeTree.gen.ts`, so don't commit what typecheck rewrites there.
- **migrate**, on pushes to `main` once **check** passes: `pnpm db:migrate` with the `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` Actions secrets. Without them it's skipped with a notice. Runs on `main` are never cancelled mid-way, and migrations run one at a time.
- Vercel's Git integration deploys the same push on its own and can finish before **migrate**, so for a minute or two new code can meet the old schema. Keep migrations additive, or apply them by hand before pushing.

**Cost estimate:** a categorization is a few hundred input tokens on Jev ($0.042 per 1M tokens at the time of writing), so effectively free; a question is a few thousand DeepSeek tokens, a fraction of a cent. Hundreds of entries a month should cost well under $1 in AI. Turso's and Vercel's free tiers should cover one person.

---

## 9. Milestones

| # | Milestone | Status |
|---|---|---|
| M0 | **Scaffold**: Turborepo + pnpm, shadcn monorepo, both apps build with Nitro | Done; first Vercel deploy pending |
| M1 | **Auth + DB**: env validation, single-account sign-in with throttling, Drizzle on Turso, default categories | Done |
| M2 | **Manual logging (no AI)**: parser, composer, feed, month totals | Done |
| M3 | **AI parsing**: Jev categorization, memory and examples, questions, corrections, evals | Done; evals in §5.2.5 |
| M4 | **Dashboard**: overview charts, Transactions table, category management | Done |
| M5 | **Ask mode + People + Accounts**: tool-calling agent with approved writes; IOUs, splits, settle-up; accounts, balances, transfers | Done; inline charts in answers pending |
| M6 | **Polish + ship**: PWA and offline queue, quick picks, CSV export, landing page and docs, CI | Done except the monthly recap and a LICENSE |
| Later | | "Of all time" records (lowest-spend day/week/month, streaks), budgets and a pace line, receipt photo (vision model), bank/e-wallet statement import |

---

## 10. Known issues and next

From the code audit on 2026-10-11, roughly by leverage. Fixed since: double-saved offline entries, split bills losing their shares on delete, re-filing after a relation answer, offline pages outliving the session, stale People pages, reopened account balances.

**Bugs and risks**

- **Some multi-row writes aren't atomic.** `editTransaction` (`ledger.server.ts`), `refile` (`questions.server.ts`), `mergePeople` (`people.server.ts`) and `mergeCategory` (`settings.server.ts`) are several separate writes. Logging already uses one `db.batch` (`saveLines`); apply the same here.
- **Agent approvals aren't tied to what the card showed.** `execute` re-runs the filter or re-plans the settle (`ask-actions.server.ts`, `ask-people.server.ts`), so rows that change between the card and the tap can be affected, against §5.3.
- **Client outbox races** (`lib/outbox.ts`, `composer.tsx`): "undo" while a send is in flight deletes the previous entry, removing an entry mid-send can be ignored, two tabs overwrite each other's queue, and rejected entries retry forever with no backoff.
- **Repayments aren't capped consistently.** Typed or answered repayments aren't capped (`packages/ai/src/people.ts` `planRows`), the Settle button caps, and the drawer and agent refuse. Needs a decision: cap, ask, or settle what's owed plus a new IOU for the rest.
- **Agent write tools accept unbounded amounts** (`ask-people.server.ts`, `ask-actions.server.ts`, and the `settleUp` server function).
- **Read and write ask tools filter differently**: read tools ignore account nicknames (`ask.server.ts` vs `ask-actions.server.ts`).
- **The demo seed's split bills have no `entry_id`** (`packages/db/scripts/demo.ts`), so split features don't show on demo data.
- In the edit drawer, someone's share still shows editable description and date fields, which the server refuses.

**Performance**

- `monthView` makes 5 sequential stages of DB round trips and reads settings 4 times; the Accounts pages load the whole month view just to learn the month; there's no index on `transactions.entry_id` or `created_at`.
- Undoing a bulk move is one UPDATE per row (`restoreCategories`, `restoreAccounts`).
- The agent chat client loads on every page (`agent-provider.tsx`).

**Hardening and housekeeping**

- No security headers (CSP, frame-ancestors, nosniff, Referrer-Policy).
- `getRequestIP` trusts the leftmost `X-Forwarded-For`, which is only safe on Vercel.
- `shadcn` (the CLI) is a runtime dependency of `packages/ui`; `nitro` is pinned to a beta.
- About 30 functions call `getDb()` instead of taking `db`, which keeps tests on one database per file.

**Open questions**

1. **License.** The project calls itself open source but has no LICENSE. MIT is the simplest. AGPL stops someone from turning it into a closed hosted service, which fits the self-host-only positioning.
2. **Public demo.** A read-only demo instance with seeded data would help the landing page.

**Product direction**

- A Deploy to Vercel button (§8.3), now that migrations can apply from CI.
- Bank and e-wallet statement import, the mirror of CSV export; it also fills a new instance's empty ledger.
- Budgets and a pace line: the pace projection exists, and `budgets` is sketched in §7.
- A monthly recap and "of all time" records (§2.5, §2.6), as read models over existing data.
