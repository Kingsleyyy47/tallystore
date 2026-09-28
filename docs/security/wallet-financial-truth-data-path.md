# Wallet financial truth: data path and limits

Source review date: 2026-09-24. This describes repository code, not a verified
production deployment or a live-database audit.

## Existing user-detail path

`handleViewUser` in `src/pages/AdminPage.tsx` opens the admin drawer. The account
header comes from the selected profile row (including its stored
`wallet_balance`). The activity section separately loads `transactions` through
`getUserTransactions` in `src/lib/supabase.ts`, `crypto_transactions` (at most
500), orders through `getUserOrdersAdmin`, recent `site_visits` (at most 25), and
recent wallet security events (at most 100). The transaction list is ordered by
time and displays a sign chosen by `getWalletTransactionDisplayAmount`: purchase,
admin/staff debit, withdrawal, and chargeback are shown as outflows; refunds and
credit-like types as inflows. That display classification does **not** prove a
gateway payment, admin approval, or an eligible refund. Orders and matching
transactions are not independent money movements. Strictly marked
balance-neutral admin repair entries are shown as ledger evidence with zero
wallet effect; the raw nominal amount remains in history and a separate
`wallet_effect` CSV column.

The detail drawer now also calls `get_admin_wallet_financial_truth(user_id)` via
`getAdminWalletFinancialTruth`. Its financial summary uses the full-history
database result, not totals from the activity list. A failed canonical read is
shown as unavailable. The admin transaction feed now also reports a failed
load rather than displaying a false "No transactions found" result. The
activity helper does not paginate, and the separate crypto activity request is
limited to 500 rows; neither is used for the financial summary. A `topup`
badge in activity is not proof that a gateway payment was verified, and an
order row is not counted again as another debit.

Fraud Review obtains recent IP/device telemetry through the separate
admin-only `get_admin_fraud_latest_visits` RPC. It searches the latest IP and
up to 25 recent IP-bearing visits per flagged user. These values may be
client-influenced and are labeled unverified. A telemetry outage shows a
warning but cannot erase financial findings or change suspension decisions.
Fraud Review classifies a `quarantined_excess` result separately from blocking
integrity risk. Its Excess tab shows the unbacked displayed amount while the
canonical `confirmed_spendable` and `spending_blocked` fields show whether
backed funds can still be used. A manual account suspension or a distinct
wallet hold can still block spending.
The Holds tab counts every row with an actual account suspension or wallet
review flag, including rows primarily classified as excess or integrity risk.
Listing a hold is not an automated determination that it is safe to clear.
Migration `20260925002000` makes the admin-only financial-truth page reader
prefer the current `auth.users.email` when a profile email is missing or
stale. This lets email search identify an already-flagged wallet whose profile
email is blank. It does not enumerate Auth users without profiles or include
unflagged users in Fraud Review, and it does not grant browser roles direct
access to `auth.users`.

## Former divergence and current callers

The former Fraud Review browser scan used its own transaction/payment queries,
including capped history, and interpreted unavailable payment evidence as zero.
The former purchase/review paths had separate debit/refund calculations. This
could classify the same wallet differently; in particular, a refunded gross
debit could be incorrectly excluded from consumed spend.

The shared reader is `public.wallet_financial_truth_internal(uuid)` in
`supabase/migrations/20260924006000_wallet_financial_truth.sql`. The admin
single-user RPC and keyset-paginated 100-user RPC wrap it. Fraud Review walks
*all* pages, then classifies and searches the returned truth; the client does
not sum a transaction subset for authorization. The admin detail summary uses
the single-user wrapper. `evaluate_customer_ledger_suspension` uses the reader
for review decisions. Purchase Edge Functions read it for an early fail-closed
check, while the database `create_wallet_reservation`,
`apply_wallet_transaction`, and purchase insert guard use it at the protected
write boundary. These are patched by migrations `07000` through `09000`; an
unapplied or rejected migration leaves the old behavior in place.
Each Fraud Review page is capped at 100 *users*, but the SQL reader has no
per-user financial-history LIMIT. A failure on any page fails the scan rather
than displaying partial totals. Purchase availability is enforced again under
the wallet/profile lock because an earlier Edge read alone can race another
financial operation.
The owner read-only query pack and the live reconciliation command now call
that same reader for wallet totals. The reconciliation command's `--since`
option changes only a reported transaction coverage count; it does not
truncate wallet truth or the other evidence queries.

## Current calculation

All values are NGN numeric database amounts. The function reads the complete
wallet ledger, the approved legacy baseline, payment evidence in
`pending_payments` and `pocketfi_webhook_logs`, and active/review-required
reservations. Posted movements use recognized completed statuses; a negative
movement with matching before/after snapshots is also counted even if its
status was recorded incorrectly. Sign conflicts and unsupported currencies
are integrity errors. It returns, among other fields:

```
trusted_principal = approved_legacy_baseline
                  + verified_gateway_deposits
                  + approved_admin_credits
trusted_book_balance = trusted_principal - all_posted_debits
                     + eligible_linked_refunds
confirmed_spendable = max(0, min(trusted_book_balance, stored_wallet_balance)
                           - active_reservations)
```

The result is forced to zero for unclassified posted rows, duplicate verified
payment identities, or unsupported wallet currency. `spending_blocked` also
prevents purchase when account/review state or exhausted backing requires it.
Eligible refunds require a matched original debit marked as trusted-authorized,
and total restoration for that debit is capped at its trusted debit amount.
Migration `20260924012000` shares a strict original-debit matcher across the
reader and both refund write guards: an explicit debit ID wins over a purchase
key, which wins over an order ID, which wins over a reference. A mismatching
stronger identifier cannot fall back to a different debit. This migration is
not proven on a live schema here.
Refunds never increase `trusted_principal`. Pending refunds do not count as
posted restoration. Withdrawals and chargebacks are included among posted
debits. `expected_ledger_balance` is the signed sum of posted ledger movements;
`unexplained_difference` is stored minus that sum; `explained_difference` is
that sum minus `trusted_book_balance`. These difference fields are diagnostic,
not authorization amounts. Excess stored value is quarantined by the `min`.
Migration `20260924016000` removes only exact balance-neutral admin repair
evidence from the posted-movement sum; a changed-snapshot row cannot use that
exception. The audit row itself remains available for investigation.
Migration `20260924023000` keeps approved admin credits from the reviewed
`admin-adjust-balance` and `manage-staff` posting routes trusted after an
approver loses admin status; it relies on recorded actor and approval evidence
that the wallet engine validated when posting. Credits from other paths stay
untrusted pending review. Migration `20260924024000` removes the older refund
trigger's separate principal/refund sum and uses this reader for its global
refund-capacity check. The original-debit link and per-debit cap remain.

Thus stored 500000 with no approved/verified principal and no eligible refund
has zero confirmed spendable. Stored 100000 with 70000 trusted book value has
at most 70000 before active holds; the 30000 excess is not spendable, and an
old auto-review reason for excess alone does not automatically block the
backed portion. A separate account suspension or unresolved review can still
block it.

## Evidence and operational limits

Missing required payment-evidence tables cause the migration preflight to
fail; a query error propagates to the caller rather than becoming zero. An
existing but incomplete historical evidence table is harder to distinguish
from a genuinely unpaid account and requires owner reconciliation. The legacy
baseline was populated by a prior migration from pre-cutoff credit-like rows
that lack modern provider proof. It is an explicit historical trust decision,
not independent proof of every original payment; suspected rows require review.
The payment-verification and pending-payment recovery functions now keep
provider/network error text out of customer-readable `pending_payments`
rows and customer responses. Verification failure or outage still cannot
create trusted funding.

The wallet engine trims `external_payment_id` before posting, and migration
`20260919012000` defines a global unique index for wallet-funding payment IDs.
Migration `20260924030000` corrects an inner PocketFi webhook-ID validation
pattern that rejected valid IDs in the canonical reader. It also flags reused
Ercas pending-payment rows or PocketFi webhook-log rows when they back more
than one verified ledger credit with different external IDs. Such a conflict
sets confirmed spendable to zero pending review; a normal one-credit PocketFi
payment remains trusted. The local before/after fixture reproduces both cases,
but deployed function compatibility and historical affected wallets remain
owner verification items.
This is source evidence, not confirmation that the index is valid in production
or that older references contain no aliases. Read-only query #15 in
`wallet-readonly-query-pack.sql` checks the deployed index and reports
historical duplicate funding identities for owner review. It makes no account
or balance changes.
The historical baseline itself is read-only for `service_role` after migration
`20260924000000`; query #16 and the staging database pack check *effective*
runtime grants rather than trusting the migration text. Database owners and
superusers remain outside that runtime-role boundary.

The SQL functions and dynamic patches have not been executed against this
project's live schema here. The owner must apply migrations in order, compare
deployed definitions and grants, test the reservation/purchase boundary using
the real database roles, and keep affected fulfillment paused until verified.
