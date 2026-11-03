# 15. A demo sandbox for replaying a new family's first steps

## Status

Accepted. Implemented on the `admin-demo` branch; not yet deployed.
Number 0014 is left for another ADR in flight.

## Context

Before sharing Budgy with other families, the operator needs to replay,
again and again, exactly what a brand-new family sees (creating a
Household, setup from 0013, inviting a partner, the partner accepting) to
find and fix problems. Google sign-in can't do that: each run would need a
fresh Google account, an `ALLOWED_EMAILS` change and a deployment, and the
result couldn't be wiped. A real family's data must never be involved.

## Decision

- **Admins** are listed in a new `ADMIN_EMAILS` Worker secret, parsed like
  `ALLOWED_EMAILS`. Unset means no admins. Every admin request rechecks the
  signed-in, admitted, verified email (`requireAdmin`); a `demo.invalid`
  address is never an admin. Being an admin grants no Ledger access.
- **Demo personas** are synthetic Better Auth users an admin makes at the
  reserved `demo.invalid` domain (RFC 2606: it can never exist), e.g.
  `sam-k3j9x2@demo.invalid`, named "Sam (demo)", email verified, with a row
  in `demo_personas` (who made it, its label). They have no `account` row,
  so nobody can sign in as one. Guards in more than one place:
  - `canSignIn` and `canCreateHousehold` refuse a `demo.invalid` email
    unless it arrives through an admin's demo session. Google sign-in's
    create hook, the MCP endpoint and the Shortcut upload all call
    `canSignIn` without that, so all of them refuse personas, even ones on
    `ALLOWED_EMAILS` or with a membership.
  - Triggers (`0023_demo_guards.sql`): `demo_personas` accepts only a
    `demo.invalid` user with no `account`; an `account` row can never be
    added for a persona; an email can't move into or out of `demo.invalid`.
- **Acting as a persona** is a `demo_sessions` row keyed by the admin's own
  Better Auth session id (cascade on delete), naming the admin and the
  persona. The browser never sends which persona it is; it only asks to
  start or stop. `sessionState()` resolves the signed-in person first
  (`signedIn`), then, only if they are still an admin and a row exists for
  this session and admin, resolves the Member as the persona for everything
  downstream: Household lookup, Onboarding, setup, invitations, joining,
  every `withMember` server function. So a persona walks the production
  code paths. An admin removed from `ADMIN_EMAILS` gets their own Ledger on
  the very next request and the row is deleted; signing out deletes the
  session row and the demo with it. If anything about the persona doesn't
  hold (not synthetic, in a non-demo Household), the demo ends instead.
  Locally, the `DEV_MEMBER_EMAIL` bypass gets a fixed `dev` session row so
  it can act too.
- **Demo Households.** A Household made by a persona (only possible via a
  demo session) has `households.demo = 1`. Triggers keep that flag from
  ever changing, and let only personas be Members of a Demo Household and
  only of one: a real user can't join one and a persona can't join a real
  one. `createInvite` refuses a mismatched address (and repeats it in its
  insert's SQL); `acceptInvite` checks it in its SQL too.
- **Reset and delete.** "Reset to start" deletes a persona's Household if
  it owns it (one D1 batch over every table in `DEMO_HOUSEHOLD_TABLES`,
  each delete naming the Household *and* requiring
  `household_id in (select id from households where demo = 1)`), or takes
  it out of someone's Demo Household (membership, its tokens, its
  invitation) if it joined one. A test compares `DEMO_HOUSEHOLD_TABLES`
  with every table that has a `household_id` in the migrated database, so
  a new table can't be forgotten, and another seeds a row in every such
  table in a demo and a real Household and checks only the demo one empties.
  "Delete persona" resets, then deletes the user (its persona row and any
  demo session cascade).
- **Replay invite** makes a new persona and an invitation for it from an
  owner persona's Household through the real `createInvite`, and shows the
  link once. The admin can act as the new persona and open it.
- **Tokens.** Personas may make Agent and Shortcut tokens, so those screens
  can be seen, but the tokens never authenticate (`canSignIn` refuses
  personas outside a demo session) and reset deletes them. Simpler than a
  second rule in each token path, and fails closed.
- **The admin page** (`/admin`) lists every persona with its Household,
  counts of its own demo data and setup progress (0013's model, computed on
  the server), and the actions. It reads only Demo Households. The Gate
  shows non-admins "Page not found"; its server functions are only
  `runAdmin`, which checks first. A small `admin_audit` row records each
  action (admin, action, persona, time).
- **Banner.** While acting, every screen (Onboarding, setup, the join page,
  the admin page, the app) starts with "Demo: acting as Sam (demo)" and
  Reset to start, Switch persona, Exit demo and sample downloads. Switching
  clears every cache and reloads, as creating or joining does.
- **Sample exports** (an Apple Card CSV, a bank CSV with money out
  negative, a savings balance history) are made in the browser for today
  from a seeded generator (`src/lib/demo/samples.ts`): synthetic purchases
  at common chains over five months, so the history step always has
  recent months. A test imports each through the Members' own paths.
- **SimpleFIN.** The admin page shows SimpleFIN's public reusable demo
  setup token. `bank_connections.access_hash` is unique across all
  Households, so only one Demo Household can hold it at once; resetting
  that persona removes it. No SimpleFIN code changed.

## Consequences

- `sessionState()` does one more read per request (the demo session
  lookup) and, while acting, a check of the Household's demo flag.
- Two migrations: `0022_demo_sandbox.sql` (`households.demo`,
  `demo_personas`, `demo_sessions`, `admin_audit`) and
  `0023_demo_guards.sql` (triggers). Both are additive and safe before or
  after the code deploys. The trigger on `household_members` runs on every
  insert, a small cost on a rare write.
- Demo Households sit beside real ones in D1. Anything operator-facing
  later (counts, digests, backups) should leave out `households.demo = 1`.
- A persona's Household counts against nothing real, but its Ledger rows
  are ordinary rows: every Ledger query keeps working unchanged.
- An admin acting as a persona is that persona everywhere, including
  "Use a different Google account", which signs the admin out.
