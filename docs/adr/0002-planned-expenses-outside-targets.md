# 2. Planned Expenses are budgeted on due dates, outside Targets

## Status

Accepted

## Context

Targets started from monthly averages of history. A $1,700 car insurance bill
twice a year adds about $290 to Insurance's average, so most months look
under budget and the two bill months look badly over. And a bill three weeks
away doesn't show anywhere until it posts.

## Decision

- A Planned Expense has an amount, a cadence (once, monthly, quarterly, twice
  a year, yearly) and one anchor due date; the others step from it.
- Each due date is matched to the closest unclaimed Transaction in its
  Category (same Store, or a close amount, within three weeks). A
  Transaction pays at most one due date.
- Only Planned Expenses less frequent than monthly are set aside. A monthly
  one (a subscription, a cleaner) is part of a typical month: its due dates
  are tracked, but its payments count toward its Category's Target like any
  purchase. (Amended 2026-10: monthly bills had been both in the Targets
  set from history and added on top as planned.)
- Matched Transactions of set-aside Planned Expenses are left out of everyday
  spending and out of Typical month averages. The month shows them as "planned, paid", and unpaid due
  dates as "to come".
- The forecast adds set-aside Planned Expenses to Everyday Targets month by month, and
  the Budget shows their monthly Set-aside.
- Likely Planned Expenses are suggested from history: one Store charging a
  similar large amount every 3, 6 or 12 months. A Member decides; nothing is
  planned automatically.

## Consequences

- Matching is computed in the browser from the whole Ledger, never stored, so
  editing a Planned Expense re-matches history at once.
- A bill paid from a different Store than planned, or far off its date, shows
  as unpaid until the Planned Expense is edited.
