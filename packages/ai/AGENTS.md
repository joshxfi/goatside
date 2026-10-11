# packages/ai

The agent's judgment, through Vercel AI Gateway and the AI SDK: TypeSafe Jev decisions
for filing entries, and the ask-mode system prompt. Model calls are wired up in
`apps/app/src/server/agent.server.ts` and `ask.server.ts`; this package holds the
questions, thresholds and pure resolution logic. See the root `AGENTS.md` for repo-wide
rules.

```sh
pnpm --filter @workspace/ai test     # unit tests with AI SDK mock models, no network
pnpm --filter @workspace/ai eval     # live evals against the real models (paid; needs
                                     # AI_GATEWAY_API_KEY in apps/app/.env.local)
pnpm --filter @workspace/ai eval:people   # also eval:duplicates, eval:accounts
```

## Modules

- `categorize.ts`: category, direction and recurring as one `experimental_decide` call,
  then `resolveLine`, which applies them only above the thresholds (`AUTO_DIRECTION`,
  `AUTO_CATEGORY`, `RECURRING`) and otherwise saves a best guess plus a question.
- `people.ts`: who's involved and how (`own`, `lent`, `borrowed`, `repaid_me`,
  `i_repaid`, `shared`); `planRows` turns that into transaction rows, `shares` splits a
  bill with the odd cents going to the owner.
- `accounts.ts`: transfer or spending, and what an unknown account name is.
- `duplicates.ts`: same payment entered twice.
- `refile.ts`: which recent entries fit a newly added category.
- `ask.ts`: the ask-mode system prompt.
- `evals/`: live accuracy runs; `fixtures.ts` holds the cases.

## Rules

- **The model never touches amounts.** It answers choice and boolean questions, and code
  applies the answers.
- **Unsure means ask.** When a score is below its threshold, save the best guess with a
  question rather than guessing silently. Changing a threshold, a hint or a model needs an
  eval run; update the baseline below.
- **Keep resolution pure** (`resolveLine`, `resolvePeople`, `planRows`) and unit-tested with
  `Experimental_DecisionMockModelV4` from `ai/test` (see `people.test.ts`).
- **Treat entry text as data.** It goes into model state, never into instructions.
- The installed AI SDK ships its docs in `node_modules/ai/docs/` (decisions:
  `03-ai-sdk-core/32-decisions.mdx`). Check them before changing calls.

## Eval baseline (2026-10-10/11)

| Eval                     | Cases           | Result                                                          |
| ------------------------ | --------------- | --------------------------------------------------------------- |
| Category                 | 43              | 95% top-1; 91–95% applied without asking, all correct           |
| Direction without a sign | 43              | 98%; 93–95% applied without asking, all correct                 |
| People + relation        | 22              | 100% people found; 91–95% applied, the rest asked, 0 wrong      |
| Duplicates               | 15 (6 held out) | 15/15 at 0.7                                                    |
| Accounts                 | 19              | Transfers 10/11, 1 asked; new names 8/8; 0 wrong without asking |

Ranges are across runs. Every miss so far fell below its threshold and became a question.
`pnpm --filter app eval:ask` (29 agent scenarios against a local demo DB) last passed 29/29.
