# Budgy

A household budget for two people: where the money went, against what we
planned, and what's coming. This glossary defines the domain language; it is
not a spec.

## Language

**Household**:
The people who share one Ledger. Each Household's Ledger is isolated from
every other Household (docs/adr/0007).

**Member**:
Someone in the Household, admitted through explicit membership
(docs/adr/0007). Registration is closed to allowlisted creators and invitees
during rollout (docs/adr/0008). Every Member sees
and edits everything in their Household, never another Household's Ledger.
An owner manages membership; this is separate from an Account's spending Owner.
A person belongs to one Household. An invitation is email-bound, expires
after seven days, and is accepted explicitly; it never merges Ledgers.
_Avoid_: user, viewer

**Ledger**:
Everything Budgy knows: Transactions, Accounts and their Balances,
Categories, Store Rules, Targets, Planned Expenses and Pay Schedules.

**Transaction**:
One purchase (or refund) on one Account, from that Account's uploaded export
or posted by an Agent. Only spending is kept: card payments, transfers,
deposits, escrow payouts and investment contributions are left out. Its id is
a hash of the row for exports without source IDs, or a stable connector
identity when available; overlapping updates add no duplicate source IDs.
_Avoid_: expense, charge

**Starting purchase**:
A Transaction from the whole-household export Budgy started from. An
Account's own upload can replace the ones over its dates (each handing its
Move and note to the new purchase that day for that amount); any left can
be removed from Accounts.

**Update receipt**:
One committed Account update: its source, dates, added or changed purchases,
skips, review issues, and whether it succeeded, failed or needs attention.
A successful check with no new purchases still has a receipt. The latest
attempt is separate from the last success. A recent check is not proof that
the source supplied complete data through today (docs/adr/0009).

**Pay Schedule**:
A paycheck the Household counts on, entered by hand: whose, how much lands in
the bank per paycheck, how often (every week, every 2 weeks, twice a month,
every month) and one payday to count from. Imported deposits are never used.

**Take-home pay**:
Every Pay Schedule together, per month: each paycheck times paychecks per
year, over 12, so a month with a third paycheck doesn't move it. The Budget
shows each part of spending as a share of it.
_Avoid_: salary, gross income, income

**Account**:
A card, bank, investment, retirement, 529 or other account the Household
has. Each has a **kind**, an **Owner** (Blaze, Alex, Joint, or anyone else,
such as a child for a 529), and optionally an institution. Purchases come
from the card and bank Accounts.

**Balance**:
What an Account held (or, for a card or loan, owed) on a day, recorded by a
Member or an Agent, or uploaded as a history when the Account is added.

**Home equity**:
A property Account (a home, at its estimated value) minus the loans marked as
against it, such as the mortgage.

**Net worth**:
Every open Account's latest Balance, held minus owed. By month, each Balance
counts until a newer one replaces it.

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
Filing every Transaction from a Store somewhere else, past and future
(every upload too); it can also re-Tag that Store. A store-wide rule covers
the Store whatever Category its purchases came in with, and is what Moving a
purchase and choosing "Always" makes; a rule for one import Category wins
over it. Store names match in any case. Members manage them on Filing rules,
where Stores Moved to one Category again and again are suggested as rules.

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
What the Lens picks out on Spending. It is always shown inside the whole,
per Category and against the Targets, so its part of the plan is plain
("Blaze Apple Card is 93% of Groceries and uses 90% of its Target").

**Lens**:
The filters a Member is looking through: people, accounts, account types,
Stores, Categories, Tags, kinds of purchase, an amount range, dates and
text. It follows them between Overview, Spending, Plan and Accounts, each of
which uses what makes sense (docs/adr/0006). Built by tapping, or by typing
in the ⌘K palette.
_Avoid_: filter set, query

**Saved Lens**:
A Lens kept under a name ("Alex fun money"), shared by the Household and
found again in the palette.

**Gap**:
An Account in regular use with nothing near the end of a month, which usually
means the export is missing it.

**Agent**:
A Member's AI assistant using Budgy over MCP with an **API Token** the
Member made on the Agents page (docs/adr/0004). A read token sees
everything; a write token may also add an Account's purchases, record
Balances, and Move or note purchases.

**Budget Alert**:
Something worth hearing about unasked: a Category over its Target or on
pace to be, everyday spending on pace past the Budget, a Planned Expense due
within two weeks or late, a large purchase in the last week, or an Account
whose imports look out of date.

**Daily Digest**:
One day's purchases across every Account, by person, Account and Category,
with the month so far and the current Budget Alerts: what a scheduled Agent
sends each morning.
