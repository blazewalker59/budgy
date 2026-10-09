# 5. Accounts and Balances are entered, not synced

## Status

Accepted

## Context

Budgy grows from a budget into the Household's whole picture: cards, bank
accounts, brokerage, retirement plans, 529s and children's accounts. Bank
aggregators (Plaid, SimpleFIN and the like) cover these unevenly: Apple Card
not at all, plan administrators and new account types rarely. Wiring one in
is a large, credential-heavy step before knowing which accounts it serves.

## Decision

- Members add Accounts themselves: a name, a kind (checking, savings, credit,
  brokerage, retirement, education, loan, other), an owner (a Member, Joint,
  or anyone else, such as a child) and an institution. Closing one records a
  final zero and keeps its history.
- A Balance is what an Account held, or owed for a card or loan, on a day.
  Members record them by hand or import a history (a date and a balance per
  line, from any CSV or spreadsheet) when first adding an Account, so trends
  show from the start. Net worth carries each Balance forward month by month.
- Agents do the same over MCP: `record_balances` (one day or a whole
  history) and `add_transactions`, which adds purchases the Agent read
  itself to one Account, filed by the Store's usual Category and skipping
  any already there on the same day for the same amount.

## Consequences

- Freshness is the Household's (or its Agent's) job; Accounts shows each
  Balance's date and flags old ones.
- An aggregator can later be one more writer of the same Balances and
  Transactions, Account by Account, without changing the model.
- Account names stay in the database, never the repository.
