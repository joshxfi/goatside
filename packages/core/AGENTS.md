# packages/core

Pure TypeScript with **no runtime dependencies**: money, the entry parser, dates, and
account and name scanning. Both apps and `packages/ai` build on it, and the landing page's
demos run it in the browser. See the root `AGENTS.md` for repo-wide rules.

```sh
pnpm --filter @workspace/core test
pnpm --filter @workspace/core typecheck
```

## Modules

- `preparse.ts`: the deterministic parser behind every logged line. It splits lines,
  reads the sign, amount, date words and "split N", and decides log, ask or undo. A line
  is logged only if it **starts with an amount**; an extra entry after a comma needs a
  signed amount (`250 lunch, -120 coffee`). Anything else is ask mode.
- `money.ts`: `parseAmount` (`500`, `1.5k`, `1,250.50`), `formatMoney` and
  `formatMoneyCompact` in the current currency (`setCurrency`, PHP by default),
  `CURRENCY_MARK` for a sign or code typed before an amount (`$20`, `php 500`), and
  `MAX_CENTS`. Everything is integer cents, hundredths of the currency.
- `dates.ts`: `local_date` strings (`YYYY-MM-DD` in the owner's timezone), with
  `todayIn(timeZone)`, `addDays`, `monthRange`, and the rest. No `Date` math on local dates.
- `accounts.ts`: `scanAccounts` finds the owner's accounts in a line (longest name first,
  with from/to cues) and spots unknown banks and e-wallets; `guessTransfer` reads the
  sides of a transfer.
- `people.ts`: `nameCandidates` over-collects possible names after cue words. The model
  decides which are people.
- `categories.ts`: the default categories seeded on first sign-in.
- `statement.ts`: reads bank and card statements from positioned text (pdf.js items or
  CSV cells). It finds rows by what the cells contain, since some statements draw their
  headers as images. It tries each reading of the amount columns, and `checkStatement`
  keeps the one that matches the statement's running balance, totals or opening and
  closing balances. A statement that can't be checked doesn't pass. Test fixtures are
  made up; never put real statement data in them.

## Rules

- **Keep it dependency-free and side-effect-free.** No I/O, no `process.env`, no clock
  reads except through an explicit `today` or `timeZone` argument, so results are the
  same on the server, in tests and in the browser.
- **Code decides amounts and signs, never a model.** Parser changes need tests in the
  matching `*.test.ts`. Run the whole suite, since the app and the landing page both
  depend on exact behavior.
- tsconfig has `noUncheckedIndexedAccess`; handle the `undefined`.
