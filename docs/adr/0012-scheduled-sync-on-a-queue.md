# 12. Scheduled bank sync runs on a queue, one connection per message

## Status

Accepted. Replaces the single-invocation cron sync in
[ADR 0010](0010-shortcut-uploads-and-simplefin-connections.md).

## Context

The cron synced every Household's SimpleFIN connections one after another in
one Worker invocation. Each sync makes many D1 queries and does CPU work per
purchase, and an invocation has per-invocation limits on both. As
Households were added, the run would stop partway, and the Households
listed last would always be the ones that missed out. A slow or failing
Bridge response also held up everyone after it.

## Decision

- The cron (`17 */6 * * *`, off the hour as SimpleFIN asks) only queues
  one Cloudflare Queue message per connection with a linked account. A
  message is the Household id and connection id. No credential, URL or
  account detail goes on the queue; the access URL stays encrypted in D1.
- The same Worker consumes the queue (`queue()` in `src/server.ts`), one
  message per batch. Each message syncs one connection in its own invocation,
  inside that Household's scope (ADR 0007), with the same `syncConnection` as
  **Sync now**.
- A message naming a connection that no longer exists in that Household, or
  has nothing linked, or is malformed, is acked and dropped. A forged or stale
  message can't reach another Household's connection.
- Retry only what another try might fix: Bridge unreachable or a database
  failure is retried after 10, then 20 minutes, up to 3 attempts in all.
  A Member's problem (revoked access, payment, today's request limit, no
  key) is acked: the connection already shows it, and the next cron tries
  again. Each attempt counts toward the 20-a-day request cap (4 crons × 3
  attempts stays under it). A consumer crash leaves the batch to the queue's
  own retries (`max_retries: 3`), then the `budgy-sync-dlq` dead-letter queue.
- **Sync now** still syncs in the request, for the Member's own Household.
- Logs name the connection and an error kind (`simplefin:network`,
  `DrizzleQueryError`), never messages, which can carry values.

## Considered options

- **Batching Households within the cron.** Still one invocation's limits;
  just a later cliff.
- **Workflows or Durable Object alarms.** More machinery than one message
  per connection needs.

## Rollout

The queues must exist before deploying (Wrangler doesn't create them):

```sh
wrangler queues create budgy-sync
wrangler queues create budgy-sync-dlq
```

Merges to `main` deploy automatically, and a deploy whose consumer names a
missing queue fails, so create both before merging. Then deploy as usual;
local `bun run dev` simulates both. Nothing in D1 changes for this (the same
release's `0017_auth_rate_limit.sql` is additive, applied by the deploy
workflow before the Worker). After the first scheduled run, `wrangler queues list` should show
`budgy-sync` with no backlog, and each linked connection a fresh receipt.
