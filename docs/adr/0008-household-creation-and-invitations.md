# 8. Household creation and email-bound invitations

## Status

Accepted; implemented, not yet deployed.

## Decision

- Sign in with Google. A signed-in person with no membership sees creation,
  not a broken or shared Ledger. Creation atomically makes a private Household,
  its owner membership and generic default Categories. No existing financial
  data is copied. Current-cycle imports/sync are still subsequent work.
- Registration stays closed: `ALLOWED_EMAILS` admits initial creators.
  An active invitation admits its email for Google sign-in; an accepted Member
  can continue signing in without a deployment-secret change. Neither a signup
  nor opening a link automatically accepts the invitation.
- The original `hh_initial` additionally retains its old allowlist gate for
  migrated memberships. A historical user removed from the allowlist must not
  regain that Ledger merely by migration, or by a pending invite elsewhere.
  An accepted invitation to `hh_initial` is an explicit fresh grant. Audit
  migrated user rows before deploying; only intended partners should remain
  attached. Removing a Member is the supported membership revocation mechanism.
- One Household per Member, enforced with a database unique index. If a
  recipient already belongs to a Household, joining is rejected, not a switch,
  merge or data migration. Membership changes never move financial Accounts.
- Owners alone invite, revoke links, remove Members or transfer ownership.
  Members have the same financial read/write access as owners. Both see the
  membership list; only owners see pending invitations.
- Invitation links are copied/shared by the owner; no email service is used.
  Links contain 32 random bytes, expire in seven days and bind to the invited
  email (case-insensitive, without Gmail-specific alias rewriting). Acceptance
  requires the authenticated Google email to be verified and match exactly.
  Only SHA-256 hashes are stored. Links are displayed only on creation; owners
  can revoke or reissue them. Reissue invalidates the previous active link.
  At most twenty invitations may remain outstanding in a Household.
- Preview requires a verified matching email and returns no details otherwise.
  Acceptance atomically checks the invitation again, inserts membership, and
  consumes it. Database uniqueness protects simultaneous create/join attempts.
  Invite metadata is scoped to its Household and never exposes token hashes.
- Owner-only mutations include live ownership predicates in their SQL, not
  just an earlier UI or authorization check. Ownership transfer atomically
  promotes a current Member and demotes the owner; the owner cannot remove
  themselves and accidentally leave no owner.
- Removing a Member also permanently revokes their Household's MCP tokens.
  Re-inviting them cannot resurrect old tokens or old invitation links. Moves,
  notes, purchases and balances are retained in the shared Ledger.
- Browser query keys include Member and Household identity. Creation/joining
  clears caches and replaces the invitation URL with `/`. Sign-in preserves
  the join path through OAuth; invitation pages set `no-referrer`.
- New Category defaults and owner suggestions do not include the original
  Household's personal names. Existing categories/colors/import classifications
  are preserved; new people come from membership and financial Accounts.

## Usage

1. A creator signs in and names their Household.
2. From the account menu, choose **Household**, enter the partner's Google
   email, create a link and copy/share it. It is not emailed automatically.
3. The recipient opens the link, signs in with that Google account, previews
   the Household and explicitly accepts. They now share the Ledger.
4. The owner manages outstanding links and Members on the same page.

## Rollout

Apply both `0010_household_isolation.sql` and `0011_household_invitations.sql`
with the new Worker in a maintenance window (0007). The first migration
deliberately does not guess the initial owner. Verify the intended owner's
Better Auth user ID, then perform an explicit administration update, e.g.:

```sql
UPDATE household_members
SET role = 'owner'
WHERE household_id = 'hh_initial' AND member_id = '<verified-owner-user-id>';
```

Confirm exactly one owner exists in that Household before sharing links.
Newly created Households get their owner automatically. Local development's
synthetic Member is created as the initial Household's owner on first use;
this path is not present in production builds. Previously persisted local
synthetic memberships keep their existing role unless explicitly promoted.

Public registration, multi-Household switching, email delivery, self-service
leaving and Household deletion are not part of this slice. None are required
to create independent friend Households and invite partners during rollout.

## Validation

Real SQLite/D1-adapter tests cover creation rollback, Household isolation,
email matching, expiration, revocation, reissue, outstanding invite limits,
concurrent joins, verified identity, owner-only changes, cross-Household denial,
ownership transfer, initial-Household admission and MCP token revocation.
Component tests cover creation, errors, explicit invitation acceptance,
already-member/wrong-email messaging and membership management confirmation.
