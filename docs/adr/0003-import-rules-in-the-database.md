# 3. The Household's import rules live in the database

## Status

Accepted

## Context

Turning an export into names needs Household knowledge: what each account is
called (with its last four digits), stores that go by another name, which
local vendors count as home upkeep, the mortgage servicer, and which rows are
investment contributions rather than spending. The repository is public, so
none of that can live in code.

## Decision

- The code keeps only generic rules: processor prefixes, check and ATM rows,
  big chains, hardware stores as upkeep, escrow disbursements, and personal
  Categories named after an Owner.
- The Household's rules are one JSON record (`settings.import_rules`): store
  aliases, and patterns for upkeep vendors, the mortgage servicer and
  non-spending rows. Members edit it at the foot of Accounts. (The
  whole-household import, its account-name map and the seed script are gone:
  purchases come in per Account, docs/adr/0005.)
- Rules shape future imports only; Transactions already imported keep their
  Store and Category (Moves and Store Rules change those).

## Consequences

- An account's short name feeds its Transactions' ids, so renaming it in the
  rules makes an overlapping re-import add that account's rows again.
- Test fixtures use made-up accounts and vendors.
