# packages/ui

Shared UI for both apps: shadcn/ui components on **Base UI** (not Radix), Tailwind v4
styles and theme tokens, and the coin brand. See the root `AGENTS.md` for repo-wide rules,
including copy and design.

## Layout

- `src/components/`: shadcn components (`button`, `drawer`, `sheet`, `sidebar`, `table`,
  …) plus `brand.tsx` (`CoinMark`, `Coin`, `CoinFlip`, `Wordmark`). `CoinFlip` moves
  with Motion (`toss`, `tossKey`, `tilt`); only its loading spin is CSS.
- `src/shims/`: stand-ins for `use-sync-external-store`, which Base UI pulls in. Its
  CommonJS `require("react")` fails on Vercel ("Cannot find module 'react'"), so both
  apps' `vite.config.ts` alias it to these. Any new app on these components needs the
  same alias.
- `src/hooks/`: `useIsMobile`, and `useTilt` for cards that lean toward the mouse (pair
  it with the `.tilt` class).
- `src/styles/globals.css`: Tailwind v4, the theme tokens for light and dark, and shared
  utility classes (`.figure` for tabular money, `.enter-rise`, `.enter-fade`).
- `src/lib/utils.ts`: `cn` for class names. `src/lib/account-colors.ts`: account card
  colors, shared by the app and the landing page. `src/lib/theme.ts`: light, dark or system,
  per device in localStorage: `THEME_SCRIPT` applies it before first paint, `useTheme`
  and `setTheme` read and change it. `components/theme-switch.tsx` is the three-way
  switch the landing, docs and app share.

Import as `@workspace/ui/components/<name>`, `@workspace/ui/lib/<name>`,
`@workspace/ui/hooks/<name>`, or `@workspace/ui/globals.css`.

## Rules

- **Add components with the shadcn CLI from an app directory**, not by hand:
  `pnpm dlx shadcn@latest add <name> -c apps/app`. They're installed here. Edit them
  afterwards to match the theme.
- **Use the tokens, not raw colors.** Money in is `text-income-foreground` / `bg-income`,
  money out is `text-expense-foreground` / `bg-expense`. `gold`, `silver` and `bronze` are
  for the coin mark only. Account cards use `account-colors.ts`.
- **Type**: `font-display` (Instrument Serif) for headlines and big figures, Geist for the
  rest. Labels are sentence case; never `uppercase tracking-widest`.
- Both themes must work: check new tokens in light and dark.
- oxfmt sorts Tailwind classes (configured against `src/styles/globals.css`), so run
  `pnpm format` rather than ordering classes by hand.
