# Financial truth: current paths (24 September 2026)

This records the pre-consolidation paths and the resulting disagreement. The
current worktree also contains the consolidation described below. Neither the
presence of migration files nor local tests prove production deployment.

## Individual user-detail modal

The admin user list and search load `profiles.select('*')` through
`getAllUsers()` / `searchUsers()` in `src/lib/supabase.ts`. Clicking View passes
that profile object to `handleViewUser()` in `src/pages/AdminPage.tsx`.
The displayed wallet balance is `selectedUser.wallet_balance` from that profile
snapshot. The modal does not recompute it from transactions.

`handleViewUser()` separately requests:

- `getUserTransactions(user.id)`: `transactions.select('*')`, newest first.
  This helper returns `[]` on query error and does not paginate. Its transaction
  labels/amount signs are display rules (`getWalletTransactionDisplayAmount`),
  not payment verification or refund eligibility.
- `crypto_transactions.select('*')`, newest first, limited to 500. Rows are
  converted to display-only `crypto_credit`/crypto events and interleaved with
  wallet transactions. Crypto labels do not establish spendable principal.
- `getUserOrdersAdmin(user.id)`: `orders_safe_history.select('*')`, newest
  first. This is the customer-safe order-history view, not a direct read of
  supplier credentials. The former modal's Total Spent summed `order.amount` for every returned
  order, regardless of completion, debit posting, refund, or duplication with
  a transaction row. A query error is thrown, but the fetch is not paginated.
- Up to 25 `site_visits` and 100 `wallet_security_events`; failures of these
  two requests are converted to empty lists.

The user-detail CSV exports the same in-memory profile, transactions, orders,
and security events. It is an activity/history export, not a proof of lifetime
funding or supplier loss. Individual `topup`, `refund`, `admin_credit`, and
`purchase` labels remain visible even if their financial provenance is invalid.

## Fraud Review

`loadFraudReview()` in `src/pages/AdminPage.tsx` scans profiles, transactions,
`pending_payments`, `pocketfi_webhook_logs`, and `wallet_legacy_funding` in
browser-side paginated reads. It optionally reads crypto and visit records.
It now fails visibly if required payment evidence fails to load or if a table
exceeds its scan cap; it must not replace missing evidence with zero. It still
has caps (50,000 profiles/legacy rows, 500,000 transactions, 200,000 payment
rows/logs), so it is not a lifetime authoritative reader.

The browser independently classifies verified deposits, approved admin credits,
spend, and linked eligible refunds. It calculates
`trusted_available = max(trusted_credits - max(completed_spend - eligible_refunds, 0), 0)`,
then compares both net spend and stored balance with trusted funds. It omits
active reservation amounts from this calculation. It skips profiles currently
marked staff/admin. The page's Scan fraud action reads and labels; it is not
the pre-purchase authorization boundary.

## Database evaluator and purchase gate

`trusted_principal_for_user(uuid)` in
`20260921010000_grandfather_legacy_wallet_funding.sql` adds an approved
pre-cutoff legacy baseline to post-cutoff provider-linked topups and qualified
admin credits. It reads all matching rows in PostgreSQL, not browser pages.
Historical admin credits depend on the approver's *current* `profiles.is_admin`
flag, which can reclassify a past credit after role revocation.

`evaluate_customer_ledger_suspension(uuid,numeric)` began as a separate
database reconstruction of principal, gross debits, and linked refunds.
Later migrations patch its definition and review behavior. The 24 September
accounting migration changes consumed spend from a principal-capped debit to
all completed debits less eligible refund restoration. The evaluator compares
stored `profiles.wallet_balance` with trusted available and marks unexplained
excess for wallet review. Staff/admin profiles are skipped. It does not deduct
active holds; `create_wallet_reservation()` separately sums active reservations
after calling the evaluator.

`authorize_product_purchase()` locks the profile/product, calls the evaluator,
and then calls `create_wallet_reservation()`; the latter calls the evaluator
again and subtracts active holds. `apply_wallet_transaction()` is another
purchase path with its own backed-funds calculation. Routes are expected to
call these service-role-only functions before supplier dispatch or inventory
reveal. `process-purchase` computes discounts server-side, but the database
authorization RPC currently accepts any positive charge below the
undiscounted product total from a privileged caller.

## Why the numbers disagree

1. User details show raw history labels and a stored profile snapshot; they
   do not establish verified funding, eligibility, or full lifetime coverage.
2. The modal and Fraud Review use browser queries with different caps and
   error handling. A failed history read can look like an empty account.
3. Fraud Review and database functions independently implement provider,
   admin, debit, refund, and legacy rules. They can diverge after a rule change.
4. Fraud Review omits active holds; the reservation function subtracts them.
   A book balance, available balance, and displayed balance must not be
   compared as if they meant the same thing.
5. The evaluator treats any unexplained stored excess as a blocking review.
   The requested policy instead quarantines that excess while preserving the
   independently backed portion for spending, unless another incident state
   genuinely requires a full hold.

The replacement must return evidence completeness and one full-history
financial snapshot from the database. The same snapshot must drive operator
views, fraud classification, and purchase authorization under the wallet's
locking protocol. A missing payment-evidence table/query is an error, never
zero confirmed deposits.

## Current worktree after consolidation

- The user-detail modal calls `getAdminWalletFinancialTruth(user.id)` for the
  financial totals and status. Its raw transaction, crypto, order, and event
  lists remain activity evidence only. The modal's completed-purchase total
  comes from the canonical snapshot, not an order-row sum. Activity-load and
  truth-load errors are shown separately.
- Fraud Review pages through `getAdminWalletFinancialTruthPage` until the last
  user. The page size is 100 users, but each user's truth reads full database
  history. A failed financial page clears the partial result and shows an
  error. It also pages through an admin-only, full-history external-payment-ID
  collision reader; shared IDs appear as review evidence without changing the
  canonical amounts or automatically suspending anyone. A failed collision
  page clears the partial review rather than reporting zero duplicates.
  IP/device telemetry is optional and cannot replace financial truth.
- `wallet_financial_truth_internal(uuid)` calculates funding provenance,
  gross posted debits, linked eligible refunds, active holds, expected and
  stored balance, differences, and confirmed spendable. It raises on missing
  required evidence objects; a top-up label or matching ledger total is not
  sufficient to verify a deposit.
- The legacy review/principal RPCs delegate to that reader. Reservation and
  purchase posting, plus the purchase insert guard, use it under the wallet
  mutation protocol. Edge supplier routes precheck the same snapshot before
  dispatch; the database gate remains authoritative against stale prechecks.
- Unbacked displayed excess is classified and quarantined. The backed portion
  remains eligible up to `confirmed_spendable` unless an independent account
  suspension, wallet hold, or severe integrity status blocks spending.

Legacy principal is an owner-approved historical baseline, not independent
gateway verification. Its production provenance and deployed grants remain
owner verification tasks. See `financial-truth-contract.md` for exact field
definitions and `wallet-deployment-manifest.md` for migration order.
