# 16. Account labels and "Shown as", on the Accounts screen only

## Status

Accepted. Implemented on the `account-labels` branch; not yet deployed.

## Context

Members name Accounts after people ("Addie 529", "Addie Trump Account",
"Alex Apple Card"), so lists on the Accounts screen repeat the person and
bury what tells the Accounts apart. The Owner can't carry the person: it
says whose spending an Account is, and the children's Accounts are Joint.
An Account's `name` is also its identifier, referenced by Transactions,
Balances, bank links, upload tokens, Lenses and Agents' tools, so renaming
Accounts to "529" would break that and make names collide.

## Decision

- A Household has **Account labels** (`account_labels`: household, name,
  colour; names unique in any case, 1–30 characters). An Account may have
  one (`accounts.label`) and a **Shown as** (`accounts.display_name`, up to
  60 characters, not unique). Both columns are nullable; the migration
  (`0025_account_labels.sql`) is additive.
- A label's colour is a key of a fixed palette of ten
  (`LABEL_COLORS`, `src/lib/model/labels.ts`), each with chip fill and
  text for light and dark themes at 4.5:1 or better (tested). Never a raw
  colour from the browser; the server validates the key.
- Renaming a label rewrites its Accounts' `label` in the same D1 batch;
  deleting one clears it from them in the same batch, keeping their Shown
  as. Labelling several Accounts at once ("Also label 2 other accounts
  starting with Addie") is one batch, all or none.
- An Account's label is written only as a subquery of this Household's
  `account_labels`, after a scoped lookup; another Household's label, or
  one deleted meanwhile, can't be set (docs/adr/0007).
- Choosing a label suggests Shown as from the rest of the name ("Addie
  529" → "529", "Addie's Savings" → "Savings"); the Member can change it.
- They show **only on the Accounts screen** (Accounts list, Updates, the
  Account sheet, Duplicates and Money in rows): `[Addie] 529`. The chip is
  text, not colour alone, and the full name stays the row's accessible
  name. Everywhere else (Spending, the Lens, the palette, charts, exports,
  Agents' tools) keeps using the Account's name; `list_accounts_and_categories`
  adds `label` and `shownAs` beside it.
- Demo Household reset deletes `account_labels` with the rest.

## Consequences

The identifier and every integration stay untouched; labels are a
presentation layer that can later spread to other screens or the Lens
without migrating data. Two Accounts may read alike outside the Accounts
screen only as they do today, by name.
