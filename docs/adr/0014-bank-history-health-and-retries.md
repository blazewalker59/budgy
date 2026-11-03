# 14. Bank history, connection health and single-account retries

## Status

Accepted. Implemented on the `simplefin-sync` branch; not yet deployed.
Extends [ADR 0010](0010-shortcut-uploads-and-simplefin-connections.md) (its
first-sync window) and [ADR 0012](0012-scheduled-sync-on-a-queue.md) (what
a queue message can be, and what's retried).

## Context

A newly linked bank account brought in 45 days, so the Typical months that
setup's Targets start from (the last 3 full months) were mostly empty until
a Member uploaded older exports by hand. Bridge serves up to 90 days per
request and often more history across requests, depending on the bank.

Every Bridge problem became one "needs attention" message. A lapsed
subscription (402), revoked access (403), a bank wanting a new sign-in
(`con.auth`) and a one-off failure for one account (`act.failed`) all looked
the same, said little about what to do, and still moved an account's
synced-through date past a window it hadn't really read.

Bridge's limits: about 24 requests a day, counted separately for all
accounts and for single accounts (`?account=`), with a little leeway for
initial setup. Going well past them disables the access token.

## Decision

### History

- A newly linked card or bank account reads back up to **180 days**, in
  windows of at most **90 days** (Bridge's limit), newest first. Each window
  asks for just the accounts reading back from the same day (`?account=`,
  repeated), with `start-date` and an exclusive `end-date`.
- History stops for an account when a window returns nothing posted for it
  (the bank has no older history), or at the cap. A quiet account's gap of
  weeks doesn't stop it: only an empty window does.
- Progress is kept per bank account: `history_from` (the oldest UTC day
  read back to) and `history_complete`. A window that couldn't be read
  leaves both, so it's asked for again on a later run.
- The first window is the account's first sync and records its balance.
  Older windows bring purchases and Money in only, and write a receipt only
  when they have purchases, so an empty one doesn't replace the account's
  latest update.
- Money in comes from the same windows, so it reaches back as far.
  `money_in_since` now follows `history_from`.
- Source IDs make re-reading any window add nothing twice. Linking a bank
  account to a different Account (or again after unlinking) starts its
  history afresh.
- Accounts already syncing when this shipped are marked complete
  (`0020_bank_history.sql`): their Households already uploaded history, and
  reading it back would mostly raise reconciliation reviews.
- Routine syncs are unchanged: one request for every account that's
  past its first window, from the earliest synced-through day less a
  10-day overlap, never more than 90 days back.

### Where history runs

- **Linking** (one, or several at once) queues the connection's sync 30
  seconds later instead of reading in the request, so the Worker request
  stays small and quick. `sync_queued_until` on the connection keeps
  accounts linked one after another from queueing a sync each. Without a
  queue binding, linking still works and the next cron reads them.
- The **cron** and **Sync now** read whatever history is still due after
  their routine request, up to four windows a run.

### Health

- **402** sets the connection to `payment_required`: "Your SimpleFIN Bridge
  subscription needs renewing", with a link to Bridge. The cron keeps
  asking (once a run), so syncing resumes on its own after renewal.
- **403**, or `gen.auth` in the error list, sets it to `revoked`: make a
  new setup token and reconnect. The credential is kept so the Member sees
  what's wrong, and the cron stops asking until it's reconnected.
- **Reconnect** takes a new setup token for the same connection: the
  Household is checked before the token is spent, the access is
  re-encrypted under the same connection id, and links, history and sync
  state stay. Bridge's account ids belong to the Member's Bridge account,
  not the token, so they match again; any that don't come back show as no
  longer shared, still linked. This replaces disconnecting and connecting
  again, which still forgets links.
- Protocol 2 `errlist` codes are read; unknown subcodes count as their
  prefix (`act.new` is `act`):
  - `con.auth` (by `conn_id`): the accounts from that bank login need a new
    sign-in in Bridge (`reauth`). Bridge's message is shown.
  - `act.*` (by `account_id`), or another `con` problem: Budgy couldn't get
    everything this time (`failed`), and will retry.
  - `gen.api` is logged by code only and shown as a plain "couldn't answer
    Budgy's request" message, never Bridge's text.
- An account with a problem keeps what Bridge did send (it's real), but its
  synced-through date and history don't move, so the window is read again.
  Its receipt needs attention with the message; an account missing from a
  reply gets a failed receipt (`missing`). `bank_accounts.problem` and
  `problem_kind` hold the latest, cleared by the next good sync.
- Accounts updates show each Account's problem with its fix (open Bridge,
  or Retry) under Needs action, and every Account a paused connection
  feeds says so. The Bank connections row shows the connection's status,
  with Renew or Reconnect.
- A setup token Bridge refuses with 403 when claimed may have been claimed
  by someone else: the Member is told to disable it in Bridge.

### Retries

- Accounts that `failed`, went `missing`, or couldn't be processed are
  retried alone, through the queue: a message `{householdId, connectionId,
  accountIds, round}` (Bridge ids only; no secrets), 30 minutes later, then
  2 hours later, then left to the cron. A `reauth` account isn't retried:
  only the Member can fix it.
- **Retry** on an Account does the same in the request, for that one
  account.
- A retry message is checked like any other (0012): the connection must be
  in that Household and the accounts linked there, or it's dropped.

### Request accounting

- One counter per connection, 20 a day, counts **every** request: all
  accounts and single accounts alike. That keeps each of Bridge's two
  quotas under 20, so no separate per-account counter is needed.
- Requests Budgy makes on its own beyond routine syncs (older history
  windows, queued retries) stop with **4** left, so the day's crons and a
  Member's Sync now always have room. A first window, Sync now and Retry
  use the full allowance.
- Worst case for one connection in a day: 4 crons × 3 attempts (12), plus
  the history windows and retries the reserve allows, never past 20.

## Considered options

- **Backfill in the request on linking.** A 180-day pull of several
  accounts makes for a slow request near the Worker's limits.
- **A separate counter for per-account requests.** Bridge's quotas are
  separate, but one combined counter under both is simpler and more
  conservative.
- **Remapping by Bridge id on disconnect and connect.** Reconnecting the
  same connection keeps everything without guessing which links to restore.

## Rollout

Apply `0020_bank_history.sql` and `0021_bank_health.sql` before the new
Worker. Both add columns with defaults; 0020 also marks accounts already
syncing as having their history. No new Cloudflare resources or secrets:
the existing `budgy-sync` queue carries the new messages, and the Worker
already has its producer binding.
