# 11. Money in is kept apart, and offsets spending only when filed

## Status

Implemented: Money in from SimpleFIN sync and bank export uploads, the Money
in tab, and filing as income, transfer or offset.

## Context

Updates kept only spending: deposits, transfers and payments were counted as
excluded and dropped (ADR 0009, 0010). But some incoming money is spending
coming back. A Venmo from someone paying their share of a purchase should
make that purchase's Category smaller, the way a refund does. Members also
want to see what came in at all, not just Balances.

Mixing deposits into Transactions would change every spending total and make
every paycheck and transfer something to file away.

## Decision

- A new `money_in` table holds posted incoming money on checking and savings
  Accounts. Card credits stay as they were: refunds are Transactions, and
  payments are left out.
- Each row has a **use**: `review`, `income`, `transfer` or `offset`. A first
  guess comes from the description: money from people (Venmo, Zelle, Cash
  App, PayPal) and anything unrecognized is `review`; payroll, interest,
  dividends and tax refunds are `income`; transfers and payments are
  `transfer`. A Member's filing is never overwritten by a later update.
- **An offset** is a refund Transaction (negative amount) on the same Account
  and day, in the chosen Category, filed as a Move so no Store Rule refiles
  it. The Money in row holds its id; its `sourceKey` is `money-in:<id>`.
  Filing again changes that Transaction; filing as any other use deletes it.
  An offset can be part of the money (the rest was the Household's own), but
  not more than it, and not to Transfer.
- Rows are deduped per Account like purchases: by connector id within the
  connector's namespace, or by a hash of the row and its count of identical
  rows before it. A bank export records Money in only when committed.
- Money in goes with its Account when the Account is deleted.
- Pay Schedules and Take-home pay still don't use it.

## Sync

The first sync after this change reaches back the full 60 days for any mapped
account not yet read for Money in (`bank_accounts.money_in_since` is null),
so recent incoming money arrives without a manual upload. Purchases keep to
their usual window, so the wider fetch adds no older purchases. Closed
Accounts are marked as read too, so one can't make every sync reach back.
Since [ADR 0014](0014-bank-history-health-and-retries.md), Money in comes from
the same history windows as purchases, so a newly linked account's reaches
back as far (up to 180 days).

## Rollout

Apply migration `0016_money_in` to production before, or with, the deploy.
Then sync once to backfill.
