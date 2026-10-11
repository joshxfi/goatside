# packages/auth

Single-account auth with Web Crypto and no dependencies, in one small file (`src/index.ts`). The app wires it
up in `apps/app/src/server/session.ts` (cookies, throttling, the sign-in route). Design:
`PLAN.md` §6. See the root `AGENTS.md` for repo-wide rules.

```sh
pnpm --filter @workspace/auth test
```

## What's here

- `verifyCredentials`: compares the username and password against env in constant time
  (via HMAC).
- `createSessionToken` / `verifySessionToken`: `<expiresAt>.<HMAC>` over the expiry,
  username and password, keyed by `SESSION_SECRET`. 30 days (`SESSION_TTL_MS`). No session
  table: changing the username, password or secret revokes every session.
- `createDeviceToken` / `verifyDeviceToken`: the year-long trusted-browser cookie that lets
  a known browser skip the sign-in throttle. It's bound to the current credentials.

## Rules

- **Constant-time comparisons only.** Never compare secrets with `===`.
- **Keep it dependency-free** and on Web Crypto (`crypto.subtle`), so it runs anywhere
  Nitro does.
- **Any change to the token format signs everyone out.** Say so in the commit and the
  docs (`apps/web/content/docs/self-hosting/security.mdx`).
- If `SESSION_TTL_MS` changes, also change `PAGE_MAX_AGE_MS` in `apps/app/public/sw.js`,
  which stops showing offline pages older than a session.
- Every behavior here has a test in `src/index.test.ts`; add one with any change.
