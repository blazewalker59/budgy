# 1. One Household, gated by an email allowlist

## Status

Superseded by [0007](./0007-household-isolation.md) and
[0008](./0008-household-creation-and-invitations.md): explicit membership scopes
Ledger access; closed registration admits allowlisted creators and invitees.
The original Household retains an additional rollout gate for migrated users.

## Context

Sportsline lets any Google account in and scopes data per Viewer. Budgy holds
a household's finances and is used by exactly two people who need to see and
edit the same numbers.

## Decision

- There is one shared Ledger. No table carries a user id; every Member reads
  and writes all of it.
- Only emails in `ALLOWED_EMAILS` get in. Better Auth's `user.create.before`
  hook refuses to create an account for anyone else, and every server
  function checks the session's email against the list again, so removing an
  address locks that person out on their next request.
- `ALLOWED_EMAILS` is a Worker secret, not a var, so the addresses stay out
  of the repository.
- Local development may set `DEV_MEMBER_EMAIL` to act as a Member without
  Google. The check sits behind `import.meta.env.DEV`, so production builds
  don't contain it.

## Consequences

- Adding a Household member is a secret change, with no redeploy
  (`wrangler secret put ALLOWED_EMAILS`).
- More than one Household would need a `household_id` on every Ledger table.
