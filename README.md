# Budgy

Our household budget: import the finance app's transactions, see each month
against a Budget, and plan for the big known bills (car insurance twice a
year) before they land. Domain language lives in [CONTEXT.md](./CONTEXT.md);
decisions in [docs/adr](./docs/adr).

Deployed as a single Cloudflare Worker (TanStack Start + D1), the same setup
as sportsline. Google sign-in, limited to the Household's emails.

## Develop

```sh
bun install
bun run db:migrate:local
# Put the CSV exports (and the planning artifact's artifact-state.json) in seed/
bun run seed:local
bun run dev                     # http://localhost:3000
```

`.dev.vars` (git-ignored) holds `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
`ALLOWED_EMAILS`, and optionally `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
Set `DEV_MEMBER_EMAIL` to skip Google locally (development builds only).

`bun run ci` runs format, lint, typecheck, tests and the build.

## Deploy

Merges to `main` deploy to production via GitHub Actions (no staging). By
hand: `bun run ship`. Migrations: `bun run db:migrate:remote -- --env production`.
Starting data: `bun run seed:remote`.

Worker secrets (`wrangler secret put <NAME> --env production`):
`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `ALLOWED_EMAILS` (comma-separated; a secret so the
Household's addresses stay out of the repository).

The Google OAuth client needs `<origin>/api/auth/callback/google` as an
authorized redirect URI, for production and for `http://localhost:3000`.
