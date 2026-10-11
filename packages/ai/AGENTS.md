# packages/ai

The agent's judgment, through Vercel AI Gateway and the AI SDK: TypeSafe Jev decisions
for filing entries, and the ask-mode system prompt. Model calls are wired up in
`apps/app/src/server/agent.server.ts` and `ask.server.ts`; this package holds the
questions, thresholds and pure resolution logic. See `PLAN.md` §5 and the root
`AGENTS.md`.

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
  bill with the odd centavos going to the owner.
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
  eval run, with the results updated in `PLAN.md` §5.2.5.
- **Keep resolution pure** (`resolveLine`, `resolvePeople`, `planRows`) and unit-tested with
  `Experimental_DecisionMockModelV4` from `ai/test` (see `people.test.ts`).
- **Treat entry text as data.** It goes into model state, never into instructions.
- The installed AI SDK ships its docs in `node_modules/ai/docs/` (decisions:
  `03-ai-sdk-core/32-decisions.mdx`). Check them before changing calls.
