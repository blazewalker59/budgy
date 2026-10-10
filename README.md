# Budgy

Our household budget: import the finance app's transactions, see each month
against a Budget, and plan for the big known bills (car insurance twice a
year) before they land. Domain language lives in [CONTEXT.md](./CONTEXT.md);
decisions in [docs/adr](./docs/adr).

Deployed as a single Cloudflare Worker (TanStack Start + D1), the same setup
as sportsline. During rollout, Google sign-in admits allowlisted creators,
invitees and existing Members; explicit Household membership isolates each
Ledger. Creation and invitation details are in
[ADR 0008](docs/adr/0008-household-creation-and-invitations.md); migration
and the next sync slices are in [ADR 0007](docs/adr/0007-household-isolation.md).

New creators name their Household after signing in, then choose **Household**
in the account menu to create and copy a partner's invitation link. The
partner signs in with the invited Google email and explicitly accepts. Links
expire after seven days; Budgy does not email them automatically. Owners can
revoke links, remove Members and transfer ownership. Public signup is not on:
add a friend's creator email to `ALLOWED_EMAILS`; partners need only an invite.

## Develop

```sh
bun install
bun run db:migrate:local
bun run dev                     # http://localhost:3000
```

`.dev.vars` (git-ignored) holds `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
`ALLOWED_EMAILS`, and optionally `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
Set `DEV_MEMBER_EMAIL` to skip Google locally (development builds only).

`bun run ci` runs format, lint, typecheck, tests and the build.

## Install

Budgy is a PWA, as sportsline: `public/manifest.json`, PNG icons (192,
512, maskable, Apple touch) and `public/sw.js`, registered in production
builds. Install from the account menu (Chrome, Edge, Android) or Share →
Add to Home Screen (iOS). The service worker caches nothing; the budget
is always read live.

## Agents

An MCP server at `/mcp` for AI agents (docs/adr/0004): make a token on the
Agents page (account menu), then e.g.
`claude mcp add --transport http budgy https://<host>/mcp --header "Authorization: Bearer bg_…"`.
Tools cover spending summaries, breakdowns, history, the Budget, upcoming
bills, Budget Alerts and a Daily Digest; write tokens can also add an
account's purchases, record balances, and Move or note purchases.

## Deploy

Merges to `main` deploy to production via GitHub Actions (no staging). By
hand: `bun run ship`. Migrations: `bun run db:migrate:remote -- --env production`.
Purchases come in per Account: upload its export on its Accounts sheet.

Worker secrets (`wrangler secret put <NAME> --env production`):
`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `ALLOWED_EMAILS` (comma-separated; a secret so the
Household's addresses stay out of the repository).

The Google OAuth client needs `<origin>/api/auth/callback/google` as an
authorized redirect URI, for production and for `http://localhost:3000`.
