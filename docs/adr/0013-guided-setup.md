# 13. Guided setup for a new Household

## Status

Accepted. Implemented on the `onboarding-flow` branch; not yet deployed.
Number 0012 is left for the security hardening work done alongside it.

## Context

A new Household used to name itself and land on an empty Overview: time zone
fixed to New York, no people but Joint, a generic set of Categories it
couldn't rename or remove, Accounts added one at a time (even ones SimpleFIN
had already found), first imports almost all Uncategorized, every Typical
month $0, and no hint of what to do next.

## Decision

- **Basics at creation.** Creating a Household asks for its name, time zone
  (the device's, if Intl lists it) and the people in it (the Member's first
  name suggested; Joint is always there). The server accepts only zones in
  `Intl.supportedValuesOf('timeZone')` or UTC, and up to 12 people of up to
  40 characters each. After creation the Member lands on `/setup`.
- **Any Member may change the name, time zone and people** (Household page
  and setup's first step). They shape the shared Ledger, like Categories, so
  they follow 0007/0008's "both roles read and edit the Ledger". Membership
  (invites, removal, ownership) stays the owner's.
- **Setup is derived, not stored.** Each step's done state is read from the
  Ledger: people beyond Joint; another Member or a pending invite; an open
  Account; purchases in 2 of the last 3 full months; under 5% of purchases
  Uncategorized; a Pay Schedule; a Target; a Planned Expense. Only what the
  Ledger can't show is kept: steps skipped, Categories reviewed, and the
  checklist put away. These live in the existing `settings` table under the
  key `setup`, scoped by `household_id` like every Ledger row, so they need
  no table of their own and can never be read across Households.
- **Overview shows "Finish setup"** until every step is done or skipped, or
  a Member puts it away (Setup stays in the account menu). An empty month
  points there instead of saying "Nothing spent."
- **Categories can be renamed, hidden or deleted.** Categories are still
  keyed by name. A rename rewrites every row that names it in one D1 batch:
  Transactions (Moves and import Categories), Store Rules (both sides),
  Targets, Planned Expenses, Money in offsets, Saved Lenses and dismissed
  suggestions. It refuses a name already used anywhere, and Transfer and
  Uncategorized can't be renamed or hidden. The old name is kept as a Bank
  category meaning the new one, so imports and import buckets ("Home
  upkeep") that still say it land in the right place. Hiding keeps every
  purchase and total and only leaves pickers, the palette and the Budget (a
  hidden Category still shows on the Budget while it's spent in or has a
  Target). Only a Category nothing refers to can be deleted; the check is
  repeated in the delete's SQL.
- **Bank categories.** Each purchase now keeps the category its bank or
  finance app gave it (`transactions.bank_category`). A Member can say
  which Category a Bank category means (setup's sort step, and Accounts,
  Rules). That is applied at import as if the bank had named the Category,
  so it sets the purchase's import Category: a Move, a Store Rule for that
  import Category, and a store-wide Store Rule all still win over it, as
  they do today. Saying it also files that Bank category's purchases still
  Uncategorized (or filed by its old meaning); clearing it puts them back
  in Uncategorized. We chose this over a new kind of Store Rule because the
  model already has the right precedence for an import Category, and over
  applying it only to future imports because a first upload happens before
  anyone has had a chance to map anything.
- **Sorting spending** lists Stores with Uncategorized purchases, most
  money first. Choosing a Category makes the store-wide Store Rule that
  Moving with "Always" makes.
- **Adding SimpleFIN accounts at once.** After a connection finds accounts,
  "Add these accounts" offers each unlinked one to add as a new Account
  (name, kind guessed from the name, owner, institution, all editable),
  link to an existing Account, or skip. One server function validates all
  choices with the same rules as linking one (USD only, present, one bank
  account per Account, an open Account) and runs one D1 batch, so a failure
  adds and links nothing. It's on setup's connect step and in Accounts,
  Updates' Bank connections box. The copy says Bridge is a separate paid
  service and can't reach every card.
- **Targets from Typical months.** Setup starts each visible Everyday
  Category's Target at its Typical month (last 3 full months, rounded up to
  $10) and saves the ones the Member keeps in one batch, from the current
  month. Without history it says so and lets them type or skip.
- Pay, history and bills link to what already exists (the Pay sheet,
  Upload an export on an Account, Plan's Bills and its suggestions). No new
  SimpleFIN backfill.

## Consequences

- Every new server function validates input with bounds, resolves the
  Household from membership (`withMember`) and scopes each query;
  isolation tests cover each one.
- Category names remain keys. A rename touches many rows but stays one
  atomic batch; Moves made concurrently with an old name can recreate it.
- A Member renaming a Category also teaches imports the old name. That
  meaning shows in the Bank categories list and can be cleared there.
- Clearing a Bank category's meaning moves its purchases filed under that
  meaning back to Uncategorized, even ones a Store's history put there.
- Two migrations: `0017_category_hidden.sql` (`categories.hidden`) and
  `0018_bank_category.sql` (`transactions.bank_category`). Both add a
  column with a default and are safe before or after the code deploys.
- Creating a Household still requires an allowlisted creator or an invite
  (0008). Creator invite links are deferred until the hardening work lands.
