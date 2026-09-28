# Wallet financial truth contract (repository draft, 24 September 2026)

The pre-change user-detail, Fraud Review, and purchase paths are mapped in
`financial-truth-current-path.md`. This contract describes the additive
`20260924006000`-`16000` migrations. It is not proof they are deployed.

## Reader and evidence boundary

`public.wallet_financial_truth_internal(user_id)` is the full-history,
service-role-only PostgreSQL reader. It returns one JSON snapshot, raises if
the profile or required payment-evidence tables cannot be read, and never turns
an evidence load failure into zero deposits. Admin-only authenticated wrappers
return one user or pages of up to 100 users. Pagination limits the number of
users per response, not the financial history read for each user. Raw history
rows in user details remain activity evidence, not a second financial total.
Strictly marked balance-neutral admin repair rows display as evidence with a
zero wallet effect in admin/customer histories. The admin CSV retains the raw
nominal amount and exports a separate `wallet_effect` value; separate crypto
activity leaves that effect blank. Neither is a source of trusted principal.

This reader accepts the owner-approved pre-19 September 2026
`wallet_legacy_funding` baseline as historical principal. That table was
derived from old transaction types, not independently verified gateway
records. Its origin and the integrity of the migration that populated it are
separate production-evidence questions. Post-cutoff gateway deposits require
matching credited Ercas payment or processed PocketFi webhook evidence.
Migration `20260925011000` adds a legacy chronology signal to this same
reader: the first recorded pre-cutoff debit and qualifying funding credit,
plus whether the debit came first or no credit is recorded. Fraud Review
places a clean but flagged wallet on its watchlist and user details show the
timestamps. This is diagnostic only: incomplete older payment coverage means
it must not bulk-freeze or bulk-unfreeze accounts. A wallet with no trusted
principal still has zero confirmed spendable through the purchase gate.
Post-cutoff admin credits require approval metadata and an admin actor.
Migration `20260925001000` requires exact `numeric` equality between each
post-cutoff gateway credit and its recorded provider evidence. Rounding both
sides to two decimal places previously permitted an over-precise evidence
amount to support a slightly different ledger amount. This is a repository
change until the owner verifies the deployed function definitions with
read-only query 41.
Migration `30000` fixes PocketFi webhook-ID matching and detects reuse of one
credited provider-evidence row by multiple ledger credits. A reused evidence
row must not be treated as twice the trusted customer funding: the reader
retains the raw reported principal for investigation but blocks spending until
reviewed. `duplicate_payment_identities` counts collision signals, which can
overlap for one pair of rows; it is not a count of distinct customer payments.
The conflict signal alone does not
identify the actor or explain how the duplicate ledger rows were written.
Migration `23000` preserves approval at posting so later admin-role revocation
does not retroactively remove a valid credit. The approval metadata and the
privileges of its writer still require verification in the deployed database.

## Amounts, in NGN

- `trusted_principal` = legacy approved baseline + verified post-cutoff gateway
  deposits + approved post-cutoff admin credits. Refunds never add principal.
- `completed_debits` = gross posted wallet debits, including purchases,
  withdrawals and chargebacks. Any negative posted wallet movement consumes
  backing even if its legacy type label is unfamiliar. It is not an
  order-status sum. A non-completed transaction with a matching before/after
  debit snapshot also counts, and `posted_debits_with_noncompleted_status`
  reports those rows for investigation.
- `eligible_refunds` = posted refunds linked to a prior marked trusted debit,
  capped cumulatively at that original debit. Unlinked and pending refunds do
  not restore spendable capacity. The strict link matcher checks debit ID,
  then idempotency key, then order ID, then original reference. Once a stronger
  identifier is supplied, a mismatch cannot fall back to a weaker one. The
  aggregate is capped by gross completed debits, not by lifetime principal:
  the same funded money may be spent and refunded across multiple purchases.
- `trusted_book_balance` = principal - completed debits + eligible refunds.
- `active_reservations` = active or review-required holds, even after an
  expiration timestamp, until a definitive release/capture is recorded.
  An expired capture attempt moves the hold to review-required; the ordinary
  release RPC will not free that state. The owner must resolve supplier outcome
  and use a separately reviewed correction/resolution procedure.
- `confirmed_spendable` = max(min(trusted book, stored wallet) - holds, 0),
  or zero when financial classification/payment identity is inconsistent.
  Purchase capture adds back only its own validated hold during that capture.
- `expected_ledger_balance` = signed sum of posted wallet movements,
  including non-trusted credits. A strictly marked admin ledger-repair entry
  with identical non-null before/after snapshots is evidence only, not a
  movement; migration `16000` excludes it. This is an accounting comparison,
  not funding authorization.
- `explained_difference` = expected ledger - trusted book. This shows how
  much ledger movement is not backed under the current evidence rules.
- `unexplained_difference` = stored wallet - expected ledger. This shows a
  wallet/ledger mismatch. Negative differences are preserved, not clamped.
- `quarantined_excess` = max(stored wallet - trusted book, 0). A positive
  excess is visible for review but does not erase the independently backed
  portion of the wallet.

`integrity_status` distinguishes consistent, quarantined excess, stored
deficit, backed-funds exhaustion, unclassified posted movement, and duplicate
payment identity. The separate `spending_blocked` policy blocks severe or
explicit review states; a positive excess is surfaced in Fraud Review without
creating a new blocking wallet hold. Every purchase/reservation must fit within
`confirmed_spendable`, and a zero-backed account cannot purchase regardless
of the displayed balance. A posted wallet movement in another currency blocks
NGN authorization rather than silently mixing currency amounts.
Fraud Review gives quarantined excess its own category rather than counting it
as an overspent/blocking account. The user-detail and Fraud Review views both
display `spending_blocked` alongside the amount: a positive backed amount does
not override an explicit suspension or a separate financial hold.

## Required call sites

Admin user detail and investigation use `get_admin_wallet_financial_truth`.
Fraud Review uses `get_admin_wallet_financial_truth_page` for financial
classification without a lifetime row cap, including staff/admin financial
anomalies in a separate read-only Internal filter. Customer suspension controls
do not apply to internal rows. `trusted_principal_for_user` and
`evaluate_customer_ledger_suspension` become compatibility wrappers over the
reader. `create_wallet_reservation` and `apply_wallet_transaction` use the
same truth under the profile lock before financial authorization. Edge
supplier routes must check current truth before any irreversible supplier
request and cannot rely solely on a profile flag captured at login. The
transaction BEFORE INSERT purchase guard also reads this truth. Migration
`12000` makes the reader, wallet engine, and refund transaction guard share
the same original-debit matcher for eligibility and cumulative refund caps.

The result is computed from a transaction snapshot. It is not a substitute for
the profile lock and the common writer protocol in the mutation functions.
The admin UI is diagnostic; it is never the sole purchase gate.
The reader is declared `VOLATILE` so a call from a posting function can see
earlier writes in that transaction rather than a stale calling-query snapshot.
Migration `20260925002000` changes only the admin page wrapper's identity
column: it prefers the current Auth email over a missing or stale profile
email. The admin authorization check remains in the security-definer wrapper;
ordinary clients receive no direct `auth.users` grant. This fixes search for
already-flagged wallets, not global Auth-user discovery.

## Deployment and verification

Do not apply the canonical migrations without a local/staging PostgreSQL test
against a realistic copy of the deployed schema. `08000` and `09000`
intentionally abort if the existing function bodies differ from their reviewed
anchors. `12000` also rewrites existing function bodies and must pass the
staging refund-link regression before deployment. A static
source check cannot prove those dynamic redefinitions compiled or that all
payment evidence is present. Keep affected supplier fulfillment paused during
mixed app/database versions. The owner must verify exact deployed functions,
grants, approved legacy baselines, and one complete funded purchase/refund
flow before reopening paid routes.
Migration `16000` patches the canonical posted-movement CTE and aborts if its
reviewed body is absent. It must follow `12000`; verify neutral repair rows in
read-only query 23 and test the migration on an isolated PostgreSQL copy first.
Migration `20260925000000` removes the erroneous lifetime-principal refund cap
from the reader and both refund writers. It aborts if the three existing bodies
do not match the reviewed definitions. The isolated PGlite cycle fixture is
not a deployed-function or production-grant test; verify query 40 and a real
funded purchase/refund/re-purchase/refund flow in staging before deployment.
