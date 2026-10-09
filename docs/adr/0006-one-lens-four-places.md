# 6. One Lens over four places, driven by a ⌘K palette

## Status

Accepted

## Context

Budgy grew to seven pages (Month, Spending, Budget, Upcoming, Accounts,
Import, Agents), each with its own filters or none: Spending had a person,
cards and a search; Month a person; the rest nothing. Questions that cross
them ("Alex's Target runs at that store on her card since summer") meant
knowing which page answers them and filtering again on each.

## Decision

- A **Lens** is one set of filters: people, accounts, account types,
  Stores, Categories, Tags, kinds of purchase (refunds, planned bills,
  uncategorized, big), an amount range, dates and text. Filters of one
  kind widen it; filters of different kinds narrow it. It lives in the URL
  and follows a Member between screens, so any view can be shared.
- Four places instead of seven. **Overview** is Month with the next bills
  from Upcoming. **Spending** is the explorer, where every Category,
  Account, Store and purchase is a filter to tap. **Plan** is the Budget
  with Planned Expenses and the forecast. **Accounts** keeps Import. Each
  honors what makes sense of the Lens: Overview all but the dates (it is
  one month), Plan only the person (their typical months against the
  household's Targets), Accounts people and account types. Filters a
  screen ignores stay, faded, for the screens that use them.
- A **⌘K palette** (after t4-pulse-dashboard's) reads what's typed as
  filters: "kroger alex over 50 last month" is four, offered as one
  Apply. It also finds purchases by exact amount or description, screens,
  actions and **Saved Lenses**: a Lens kept under a name in the database,
  shared by the Household.

## Consequences

- Old links keep working: `owner`, `acct` and `cat` read into the Lens, and
  `/budget` and `/upcoming` redirect to Plan.
- A new filter is a field on the Lens, a test in `matchLens`, a chip label
  and (optionally) words the palette reads; every screen gets it at once.
