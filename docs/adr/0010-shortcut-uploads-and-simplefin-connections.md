# 10. Shortcut uploads and SimpleFIN connections plug into Account Updates

## Status

Implemented: Shortcut uploads; SimpleFIN connection, discovery, mapping and
scheduled sync of purchases and balances.

## Context

ADR 0009 gave every purchase input one ingestion path and update receipts.
Apple Card, the main spending Account, has no programmatic access: Wallet can
export a date range as CSV, but getting that file into Budgy took several
manual steps. Other institutions can be read through SimpleFIN Bridge, a
read-only aggregator the Household authorizes itself. Neither should become a
separate update experience.

## Decision

- **Upload tokens** (`bu_…`) are per Account and per export format. They can
  only add purchases to that Account through `ingestAccountExport`, the same
  normalizer, filing and receipts as a browser upload, committed without a
  preview. They read nothing, return only counts, and are distinct from
  Agent API tokens (`bg_…`) so neither works for the other. Only the hash is
  stored. A token stops working when revoked, when its creator leaves the
  Household (or fails rollout admission), or while its Account is closed;
  deleting the Account deletes its tokens. At most five active per Account.
- `POST /api/updates/upload` takes the raw CSV as the body. The Household,
  Account and format come from the token, never the request. Cross-site
  browser requests are refused; replies are plain text so the Shortcut can show
  them as a notification. Database errors are not echoed.
- The Shortcut is built by the Member from on-screen steps (Get Contents of
  URL with the token header), since a shared iCloud Shortcut can't carry a
  per-Account secret. Apple's export remains a manual tap; Budgy does not
  scrape or automate Wallet.
- **SimpleFIN connections** belong to a Household and record who connected
  them. The one-time setup token is claimed server-side only after confirming
  `BANK_CONNECTION_KEY` is configured, so a token isn't spent and lost. The
  access URL is encrypted with AES-GCM under that Worker secret, with the
  Household and connection id as additional data, so ciphertext can't be
  moved between them. Its SHA-256 prevents connecting the same access twice.
  It is never returned to the browser or written to errors.
- The client calls only Bridge hosts over HTTPS, without redirects, with a
  timeout and response size limit, and validates responses before use.
  Bridge's own error strings are not stored; connections show a safe message
  and an `attention` status. Requests are capped at 20 per connection per day
  (Bridge asks for under 24).
- **Discovery** (balances-only) lists accounts and stores only names,
  institution and currency. **Mapping** to a Budgy Account is an explicit
  Member choice: any open Account, USD only, one bank account per Budgy
  Account. Accounts Bridge stops listing are marked absent but keep their
  mapping. Mapping itself imports nothing.
- Disconnecting forgets the credential and discovered accounts. Revoking access
  in Bridge is the Member's step; purchases already in Budgy stay.

## Sync

- One Bridge request per connection covers all its mapped accounts, from the
  earliest account's last synced day minus a 10-day overlap (45 days the first
  time, never more than 60), a day early for time zones.
- Card and bank Accounts get posted purchases through `postTransactions`,
  with source IDs namespaced `simplefin:<Bridge account id>`. Re-reading the
  overlap adds nothing twice; a corrected provider purchase updates in place;
  a purchase already uploaded by export is linked when it matches exactly one
  (ADR 0009 reconciliation), otherwise held for review. Pending transactions
  are skipped until they post. The date is the transaction date when Bridge
  gives one, else the posted date, in the Household's time zone. The export
  normalizer's payments/transfers rules decide what counts as spending.
- Every mapped Account records Bridge's balance for its balance date. SimpleFIN
  shows what's owed as negative; Budgy stores a card's or loan's owed balance
  as positive. Investment and other balance-based Accounts get only balances.
- Each purchase sync writes a receipt with source `simplefin` (including
  no-op checks); one Account failing doesn't stop the others.
- A Cloudflare cron runs every six hours for every Household with a mapped
  account, each in its own Household scope; **Sync now** runs the same thing.
  Both count toward the 20-requests-a-day cap.

## Rollout

Apply `0013_uploads_and_bank_connections.sql` and `0014_bank_account_sync.sql`
before the new Worker, and set the `BANK_CONNECTION_KEY` secret before
connecting a bank. The cron trigger is in `wrangler.jsonc` (production). Without it, the
Shortcut flow works and bank connection setup explains what's missing.
