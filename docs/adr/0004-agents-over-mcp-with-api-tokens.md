# 4. Agents use Budgy over MCP, with a Member's API token

## Status

Accepted

## Context

Members want their AI agents to work with the budget: answer questions
about spending, raise Budget Alerts without being asked, send a daily
digest of every account's purchases on a schedule, and bring in new
exports. Sportsline solved the same problem (its ADR 0007); Budgy follows
it.

## Decision

- An MCP server at `/mcp` in the Worker. One JSON-RPC message per POST,
  answered with JSON (Streamable HTTP without the optional event stream, so
  no sessions to keep), tools only. Notifications get 202, GET 405, a
  browser Origin other than ours 403. Tool failures and bad arguments come
  back as tool results the model can read.
- An agent authenticates with an **API token** made on the Agents page
  (`bg_` and 32 random bytes), shown once and stored as its SHA-256, with a
  name, its first characters and when it was last used. A Member holds at
  most ten; revoking stops one at once. A token also stops working when its
  Member leaves `ALLOWED_EMAILS`.
- Scopes: `read` (every read tool) and `write` (also
  `import_transactions_csv` and `update_transaction`). Write tools aren't
  even listed to a read token.
- Tools read the Ledger fresh each call and reuse the app's model code
  (month view, breakdown, history, plans), so the agent and the screens
  never disagree. Amounts are dollars.
- Proactivity lives in the agent's scheduler, not in Budgy: Budgy has no
  way to reach a Member, so `get_daily_digest` bundles a day's purchases
  with the current Budget Alerts for a scheduled agent to send on.

## Considered options

- **OAuth (claude.ai connectors).** No secret to copy, but more moving
  parts; tokens first, as in Sportsline.
- **Budgy pushing alerts itself** (email, Web Push, a Cron Trigger).
  Possible later; an agent already on a schedule covers it without new
  infrastructure.

## Consequences

- A leaked read token reads the household's spending until revoked; a
  leaked write token can also add rows from a CSV and re-file or note
  purchases (no deletes). The database alone never reveals a token.
- The digest is only as fresh as the latest import; it reports each
  account's latest purchase so the agent can say so.
