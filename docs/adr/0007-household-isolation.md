# 7. Each Household has an isolated Ledger

## Status

Accepted. Isolation and Household creation/invitations are implemented.
Connection/ingestion work remains separate. Membership details are in
[0008](./0008-household-creation-and-invitations.md).

## Context

Budgy began with one Household. Sharing it with friends needs independent
Ledgers, not independent data per person: partners share their Household's
budget. Imports, MCP and future bank connections must obey the same boundary.

## Decision

- Add Households and explicit memberships with `owner` and `member` roles.
  Both roles read and edit the Ledger; ownership is for membership
  management, not a financial Account's spending owner label.
- Every Ledger table, import setting and API token carries `household_id`.
  Natural keys and transaction hashes are unique within a Household, not
  across all Households. Names remain the existing model's identifiers.
- Server functions resolve exactly one membership from the authenticated
  Member. No client-supplied Household ID grants access. Missing or ambiguous
  membership fails closed; multi-Household switching is not implemented.
- Ledger helpers require a Household-bound database type and explicitly
  scope reads, writes, conflicts, joins and cleanup. A database client cannot
  be rebound to a different Household. This is application-level isolation,
  not SQLite row-level security: new queries still need scope predicates.
- MCP tokens are bound to one Household. Each request rechecks their creator's
  membership; removing it disables access even if the token was not revoked.
- Keep creator registration closed during rollout. Allowlisted creators,
  invitees and existing Members can sign in (0008). Adding an allowed email
  alone does **not** join that person to the existing Household.
- A unique membership index enforces one Household per Member. Creation and
  joining are atomic D1 batches; concurrent attempts cannot merge Ledgers or
  leave an orphan Household.
- Local development's explicit `DEV_MEMBER_EMAIL` bypass accesses only the
  initial Household; this bypass is compiled out of production builds.

## Migration and rollout

`0010_household_isolation.sql` creates `hh_initial`, preserves every existing
Ledger row and token hash, and attaches existing Better Auth users as Members.
It does not guess who owns the Household, or auto-enroll future sign-ins.
Existing user rows must be reviewed before production migration, particularly
if the allowlist previously included friends. Existing users not on the
allowlist remain blocked regardless of migrated membership.

Before production:

1. Export/back up D1 and review the existing user rows against the intended
   Household membership. Verify both partners have signed in before migration;
   otherwise invite the missing partner once ownership is assigned.
2. Apply the migration in a coordinated maintenance window with the new code.
   Old code is not compatible with the new required Household columns. Do not
   merge to `main` before planning this: merges deploy automatically and the
   deploy workflow applies migrations **before** deploying the new Worker.
   A maintenance window avoids old-code writes between those two steps.
3. Explicitly promote the intended owner's membership after verifying their
   user ID; all migrated memberships initially have role `member`.
4. Check row counts, Moves, notes, balances and settings, then check that both
   partners and existing agent tokens work. Run `PRAGMA foreign_key_check`.
5. Creator signup remains allowlisted. Add a friend's creator email to
   `ALLOWED_EMAILS`; they can create their own Household and invite a partner
   without adding the partner to the secret. Public signup is not enabled.

Tests use real in-memory SQLite behind the D1 adapter, apply all migrations,
and exercise duplicate IDs/names across two Households, scoped imports and
filing rules, edits, deletion, membership denial and token invalidation. A
separate disposable local Wrangler D1 database validates migration syntax.

## Subsequent slices

1. **Unified ingestion foundation:** implemented in
   [0009](./0009-unified-account-updates.md), not yet deployed. Routine export
   updates and agent posts share receipts, leases and filing; stable-ID
   reconciliation is ready for connector adapters.
2. **Apple Card:** verify current-cycle date-range exports on the Household's
   iPhone, then implement a revocable, narrowly scoped share-sheet upload token
   and a "Send to Budgy" Shortcut. No native app or Origin dependency.
3. **SimpleFIN:** Household-owned encrypted credentials, multiple connections,
   provider-account mapping, posted-transaction IDs, daily scheduled jobs,
   retry/overlap windows and reconnect/error handling. Never expose credentials
   in the client, logs, or MCP results. Confirm bank coverage with a pilot.

## Consequences

Cloudflare Worker + D1 remain suitable. The isolation foundation is not yet
a public multi-Household product, nor does it implement automated bank sync.
Connection adapters will receive a trusted Household scope and use the same
Ledger pipeline instead of inventing separate authorization rules.
