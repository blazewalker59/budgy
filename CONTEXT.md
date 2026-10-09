# Budgy

A household budget for two people: where the money went, against what we
planned, and what's coming. This glossary defines the domain language; it is
not a spec.

## Language

**Household**:
The people who share one Ledger. Budgy has exactly one.

**Member**:
Someone in the Household, allowed in by email (docs/adr/0001). Every Member
sees and edits everything.
_Avoid_: user, viewer

**Ledger**:
Everything Budgy knows: Transactions, Income, Accounts, Categories, Store
Rules, Targets and Planned Expenses.

**Transaction**:
One purchase (or refund) from an import. Transfers, escrow payouts and
investment contributions are left out; deposits are kept apart as Income. Its id is a
hash of the exported row, so importing the same rows again adds nothing.
_Avoid_: expense, charge

**Income**:
A deposit from an import: a paycheck, a refund paid back to the bank, a gift.
Never spending, and never counted against Targets.

**Take-home pay**:
What the Household can count on each month: each employer's usual paycheck
times how often it comes (every 2 weeks is 26 a year), from the employers
still paying. Bonuses and other deposits are **Other income**, shown beside it
but not counted on. The Budget shows each part of spending as a share of it.
_Avoid_: salary, gross income

**Account**:
The card or bank account a Transaction came from. Each has an **Owner**:
Blaze, Alex, or Joint.

**Store**:
Who was paid, normalized from the bank's description ("Amazon", not
"Amazon Mktpl*AB12CD").
_Avoid_: merchant, payee

**Category**:
Where spending is counted: Groceries, Kids, Subscriptions… Each has a **Tag**
and a **Group**.

**Tag**:
How much a Category (or a Store) matters: **Need**, **Nice to have**, or
**Fluff**. "Wants" means everything that isn't a Need.

**Group**:
**Everyday** Categories are what the Budget steers; **Housing** (mortgage,
utilities, upkeep) is shown apart.

**Move**:
Putting one Transaction in a different Category than its Store's (the Best
Buy thermostat goes to Household). A Move wins over a Store Rule.

**Store Rule**:
Filing every Transaction from a Store (that the import put in a given
Category) somewhere else, past and future; it can also re-Tag that Store.

**Note**:
A Member's few words on a Transaction, usually why it was Moved.

**Target**:
What a Category should cost in a month, from a starting month on, until a
later Target replaces it. Targets have history: changing one from October
leaves September's as it was.
_Avoid_: limit, allowance

**Budget**:
The Everyday Targets together.

**Typical month**:
A Category's average monthly spending over the last 3, 6 or 12 full months
(3 unless a Member picks otherwise), leaving out Planned Expense payments. A
Category that started inside that span is averaged over the months since its
first purchase, so a new expense isn't diluted. The fair starting point for a
Target; its trend shows the last 12 months beside it.

**Planned Expense**:
A known, usually lumpy bill (car insurance twice a year, an annual renewal)
with an amount, a cadence and a due date. It is budgeted on its due dates
instead of in a monthly Target (docs/adr/0002).
_Avoid_: bill (in code), recurring

**Due date**:
One occurrence of a Planned Expense. It is **paid** once a matching
Transaction is imported (same Store and at least 40% of the amount, or, with
no Store, within 10% of the amount; within three weeks of the date).

**Coming up**:
Due dates not yet paid, from a few days ago through the next weeks.

**Set-aside**:
A Planned Expense spread over the months between due dates: what to save
each month so the bill is covered.

**Selection**:
A slice of the Household's spending picked on the Spending screen: a person,
some Accounts, a search, or any mix. It is always shown inside the whole,
per Category and against the Targets, so its part of the plan is plain
("Blaze Apple Card is 93% of Groceries and uses 90% of its Target").

**Gap**:
An Account in regular use with nothing near the end of a month, which usually
means the export is missing it.

**Agent**:
A Member's AI assistant using Budgy over MCP with an **API Token** the
Member made on the Agents page (docs/adr/0004). A read token sees
everything; a write token may also import exports and Move or note
purchases.

**Budget Alert**:
Something worth hearing about unasked: a Category over its Target or on
pace to be, everyday spending on pace past the Budget, a Planned Expense due
within two weeks or late, a large purchase in the last week, or an Account
whose imports look out of date.

**Daily Digest**:
One day's purchases across every Account, by person, Account and Category,
with the month so far and the current Budget Alerts: what a scheduled Agent
sends each morning.

