# 9. Account inputs share one ingestion path and update receipts

## Status

Implemented foundation. The share-sheet Shortcut and SimpleFIN connection
setup followed in [ADR 0010](0010-shortcut-uploads-and-simplefin-connections.md).

## Context

Uploads and agent posts already shared filing logic, but a successful duplicate
upload left no record. Purchase dates were being used as a proxy for freshness.
Routine imports also lived alongside balance-history reconstruction and its
known-balance prompt. Adding bank syncing on top of these assumptions would
create multiple inconsistent update experiences.

## Decision

- **Accounts → Updates** is the common routine-update surface. Each open
  spending Account shows its method, latest attempt and last successful check.
  Balance-based Accounts link to recording their value/history and display
  their actual latest Balance, not a manufactured source-check timestamp. CSV
  preview and confirmation update purchases without a known balance. Historical
  balance imports and manual balance recording remain on the Account sheet.
  This slice does not claim that a purchase update refreshes a balance.
- Export normalization is separate from ingestion. Known Apple Card headers
  and separate Debit/Credit columns can be recognized; arbitrary signed Amount
  columns require an explicit convention. Save that convention within the
  Household and Account, not globally. USD only; unsupported currencies,
  malformed rows and unknown Apple transaction types are rejected rather than
  silently imported. Standard exports are capped at 2 MB and 20,000 rows.
- Include purchases and refunds, excluding payments, transfers, deposits and
  other recognized money movement. Bank credits without refund/return signals
  are excluded rather than treated as income (Budgy's existing spending model).
  The preview exposes the resulting counts before confirmation. Category names
  not recognized in the Household fall back to store history or Uncategorized.
- Every committed purchase writer (`postTransactions`) uses the same receipts
  and Account lease: the new CSV flow, existing uploads and MCP agent posts.
  Preview remains read-only. Successful no-op and excluded-only checks are
  recorded, unlike before; they do not manufacture new purchases.
- A receipt records source, status, date range, counts and safe operational
  errors. Latest attempt and last success are separate queries, so a failure
  never makes an older successful check disappear. “Updated” means a check
  completed—not proof of complete source coverage through today. Existing
  Ledger data is not retroactively labeled fresh by this migration.
- Household-bound Account leases serialize conflicting writers. They expire
  after ten minutes, renew before each D1 batch, and are released by their own
  random token. A lost or interrupted lease can be retried, not stolen by an
  unrelated Household or released by an older job. Account deletion respects
  the same lease and cleans its input settings/receipts.
- Transactions can optionally carry a unique namespaced source identity.
  Connector callers supply a stable namespace and posted IDs; filename, fetch
  time and overlap window are **not** identity. Namespace must be stable across
  retries/reconnections. Plain MCP posts don't claim connector identity.
- Different source IDs on the same Account/day for the same amount remain
  separate purchases. A known source ID may update its date, amount and
  description without changing its ID, Move, note or source Category.
- A previously unidentified purchase may acquire a source ID only when there
  is exactly one unused date/amount/normalized-Store match. It keeps its ID and
  filing and becomes owned by an Account import, not removable starting data.
  Ambiguous matches and possible posting-date shifts are held for review, with
  details in the receipt. They are
  neither arbitrarily paired nor added again. Resolving such ambiguity is part
  of the connector review UX to come.
- Export rows lacking bank IDs retain deterministic occurrence-based IDs and
  one-to-one matching. Date/amount alone no longer collapses purchases from
  unrelated stores. Overlapping exports should include complete date ranges;
  sparse subsets of indistinguishable same-store purchases cannot prove new
  identity without stable bank IDs. Cross-provider migrations are not guessed.
- Large additive updates use bounded D1 batches. Import headers are written
  before purchase chunks, so partial failures don't create orphan purchases or
  mislabel them as starting data. A failed update can have partial valid writes;
  it is reported failed and retried idempotently, never labeled complete.
  Destructive starting-purchase replacement must fit in a single atomic batch;
  larger replacements must use smaller date ranges. The new routine flow never
  deletes purchases absent from an export or replaces balance history.

## Rollout and next adapters

Apply `0012_unified_account_updates.sql` before the new Worker. It adds nullable
source identity to existing transactions, plus scoped input settings, leases
and receipt tables. No existing purchase IDs, Moves, notes, balances or owners
are rewritten. Validate with one overlapping Apple Card export first.

Next, add a narrowly scoped, revocable Account upload token and the iPhone
share-sheet Shortcut. It should accept CSV and call the same normalizer and
ingestion path, not let an agent guess signs or choose another Household.

SimpleFIN comes after that: encrypted Household credentials, institution and
provider-account discovery, explicit mapping to Budgy Accounts, posted-only
USD normalization, balances, overlap windows, scheduled retries, and clear
reconnect/error handling. A live connection requires the Household's own
authorization and a coverage pilot. No credentials have been requested or
connected by this foundation. Routine source failures must not reach an agent
or browser as raw credential-bearing responses.

## Validation

Real SQLite through the D1 adapter tests no-op receipts, read-only previews,
distinct same-value source IDs, provider corrections, preserved Moves/notes,
legacy linking, ambiguous matches, source-ID contradictions, cross-Household
isolation, leases, interrupted multi-batch retries, closed Accounts and cleanup.
Receipt ordering is deterministic even within the same millisecond. Export and
component tests cover Apple credits/payments, sign conventions, rejected rows,
explicit review/confirmation and visible last success after failure.
