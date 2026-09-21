# Wallet Financial Model

Prepared: 2026-09-19

This document defines the money model used by the current containment patch. It
is deliberately conservative: when funding evidence is incomplete, the system
blocks new paid commitments instead of inventing opening funds or trusting a
displayed balance.

## Current Model

The current implementation has two explicit route modes. The local
pre-stocked-product route uses the reserve-first boundary described below.
Provider-backed routes still use the hardened debit-first engine only where
their code path remains present, and those routes are paused until their own
reserve/dispatch/retry proof is complete.

```text
posted_book_balance = profiles.wallet_balance
trusted_principal =
  verified_gateway_deposits
  + approved_admin_credits

trusted_debit_capacity =
  min(previous_completed_wallet_debits, trusted_principal)

linked_eligible_refunds =
  refunds linked to prior trusted-principal-authorized debits with
  trusted_principal_debit_amount evidence,
  capped per original debit amount and trusted debit amount

eligible_refunds =
  min(linked_eligible_refunds, trusted_debit_capacity)

trusted_consumed_spend =
  max(trusted_debit_capacity - eligible_refunds, 0)

authoritative_backed_available =
  max(trusted_principal - trusted_consumed_spend, 0)
```

The reservation table is not yet used by every mapped route. The local wallet
model and route-decision tests cover the intended book-balance-versus-
available-balance rule: valid reservations reduce available spend without
creating a false unbacked-balance freeze. The local product route now has a
database-backed reserve/capture implementation; provider-backed routes that do
not have the same boundary remain paused.

## Authoritative Fields

| Field | Meaning | Source |
| --- | --- | --- |
| `profiles.wallet_balance` | Current posted wallet balance after wallet-engine movements. | Updated only by `apply_wallet_transaction` or blocked/neutralized by profile guards. |
| `transactions.amount` | Signed movement amount. Positive values credit the selected balance; negative values debit it. | Inserted by `apply_wallet_transaction`; direct writes are skipped/audited. |
| `transactions.balance_before` | Posted balance snapshot immediately before the movement. | Wallet engine. |
| `transactions.balance_after` | Posted balance snapshot immediately after the movement. | Wallet engine. |
| `transactions.balance_type` | `wallet`, `crypto`, or `referral`. | Wallet engine. |
| `transactions.idempotency_key` | Business-operation dedupe key. Reuse must match user, type, amount, reference, currency, external payment ID, and balance bucket. | Wallet engine and route callers. |
| `transactions.transaction_hash` | Local hash-chain evidence for tamper detection relative to trusted checkpoints. | Wallet engine. |

## Money Precision And Bounds

Wallet movements use exact decimal `numeric` values with at most two fractional
digits. The wallet engine rejects zero, negative input amounts, numeric `NaN`,
over-precise amounts, malformed currency codes, and single wallet movements
above NGN 1,000,000,000 before deriving the signed ledger amount. Currency codes
are normalized to uppercase and must match `^[A-Z]{3,8}$`.

Migration `20260919013000_enforce_wallet_money_bounds.sql` adds NOT VALID
constraints so new `transactions` and `profiles` money writes obey the same
precision/currency/boundary rules while preserving historical incident rows for
review.

## Trusted Credit Rule

For wallet purchases, new trusted spendable principal can enter only through:

- completed verified wallet top-ups/deposits with a non-blank
  `transactions.external_payment_id` provider identity and matching trusted
  provider evidence. Ercas deposits must atomically lock and consume a
  server-created `pending_payments` row for the same user/reference/amount, then
  trusted-principal calculations count only the consumed row after it is marked
  `credited`; merely `pending` Ercas evidence is not spendable backing. PocketFi
  deposits must be tied to a processed `pocketfi_webhook_logs` row created by the
  verified webhook route; and the row must carry `verified_amount_ngn` and
  `verified_reference` matching the posted credit amount and reference. A
  deposit-looking row with only an external ID is not trusted principal;
- `admin_credit` whose `created_by` actor resolves to an admin profile, whose
  `metadata.approved_by` matches that actor, whose metadata includes a stable
  `approval_reference` and non-empty `reason`, and whose ledger snapshots show a
  real balance increase. Audit-only repair rows such as
  `metadata.source = admin-ledger-repair`, `balance_unchanged = true`, or
  `requires_owner_evidence = true` are excluded. The wallet engine rejects new
  `admin_credit` rows at write time when the actor is missing, not an admin, or
  missing matching approval metadata;
Refunds are handled separately as restoration of prior completed wallet debits,
capped by the amount of trusted principal that was actually consumed, capped
again by the linked original debit amount, and capped by the
`trusted_principal_debit_amount` recorded by the wallet engine on that debit.
They are not a third source of trusted principal. Wallet refunds must identify the
original completed debit by `source_debit_transaction_id`,
`source_debit_idempotency_key`, protected source-order metadata, or the original
purchase reference, and that debit must have been wallet-engine-authorized from
trusted principal with positive `trusted_principal_debit_amount` evidence.

The calculation intentionally excludes:

- crypto payments held for manual review;
- referral withdrawals or other internal balance movement;
- pending, failed, or malformed rows;
- deposit-looking rows without matching provider evidence and verified amount;
- deposit-looking rows with a provider payment identity but without matching
  server-created provider evidence;
- direct ledger writes blocked by the ledger authority trigger;
- staff, promotion, correction, or generic credit rows, even when they look
  positive, unless they are reposted through the approved `admin_credit` path;
- admin credits with no approving actor, a non-admin actor, missing/mismatched
  `approved_by`, missing `approval_reference`, or missing `reason`;
- balance-neutral admin repair/evidence rows, even when typed as
  `admin_credit`;
- refunds as new outside money;
- refunds beyond the trusted part of previous eligible debits;
- refund rows that are not linked to a trusted-principal-authorized original
  debit with positive trusted debit amount evidence.

## Refund Conservation

Refunds are not outside money. They can restore purchasing power only up to the
amount of trusted principal that prior completed debits consumed:

```text
trusted_debit_capacity = min(previous_completed_wallet_debits, trusted_principal)
linked_eligible_refunds =
  sum(min(sum(refunds linked to each trusted original debit), original debit amount, trusted_principal_debit_amount))
eligible_refunds = min(linked_eligible_refunds, trusted_debit_capacity)
```

The wallet engine also rejects new completed wallet refunds when the requested
refund would exceed the remaining trusted debit capacity or the remaining amount
on the linked original debit:

```text
refundable_remaining = trusted_debit_capacity - linked_eligible_refunds
reject when requested_refund > refundable_remaining
reject when already_refunded_for_original_debit + requested_refund > original_debit
```

An unbacked historical purchase must not become trusted funding merely because a
refund row exists. A loose or ambiguous historical refund remains review
evidence, not automatic spendable capital. A forged or legacy
`trusted_principal_authorized` boolean without a positive
`trusted_principal_debit_amount` is also review evidence only.

## Paused Debit-First Provider Authorization

For a provider-backed route that still uses the debit-first engine:

1. The route derives price, quantity, product/service, discount, and user from
   trusted server-side data.
2. The route calls `apply_wallet_transaction` with type `purchase`.
3. The wallet engine locks the profile row with `FOR UPDATE`.
4. It rejects suspended staff/admin/customer states that cannot purchase.
5. It checks the posted balance cannot go negative.
6. For wallet purchases, it computes authoritative backed available funds from
   trusted credit evidence and previous completed debits/refunds.
7. If the requested purchase exceeds backed available funds, it freezes the
   wallet and returns `WALLET_UNBACKED_FUNDS`.
8. Otherwise it inserts the signed ledger row, updates the posted balance, and
   returns the committed before/after values.

Mapped fulfillment routes must not call suppliers or reveal product value unless
this committed purchase authorization exists or the route is explicitly paused.

## Holds And Reservations

The current patch does not claim a complete reserve-first design for every
provider route. Unverified or higher-risk routes remain paused. The local model
exercises the desired reserve/capture/release accounting policy:

```text
B = posted book balance
H = outstanding valid holds
A = available to spend = B - H
```

Migration `20260919025000_create_wallet_reservation_functions.sql` now provides
service-role-only RPCs for the hold lifecycle:

- `create_wallet_reservation` checks trusted available funds, subtracts active
  reservations, and creates an active hold.
- `capture_wallet_reservation` posts the final purchase through
  `apply_wallet_transaction`.
- `release_wallet_reservation` releases a pre-capture hold without creating
  refund credit.

Until a route is migrated to this real hold/capture/release flow and tested,
the route must stay paused if it cannot be safely handled by the current
debit-first model.

The local product-credentials route is now migrated through
`authorize_product_purchase` and `complete_product_purchase`. Authorization
locks the product inventory and creates the wallet reservation plus a
non-completed order in one transaction. Completion captures the reservation,
stores credentials, and marks the inventory sold in one transaction. Provider
money routes remain paused until they receive an equivalent route-specific
reserve/dispatch/retry implementation and provider evidence.

## Durable Dispatch And Outbox Policy

The repository now has both a local outbox/queue decision model and additive
database infrastructure for the dispatch boundary. Migration
`20260919023000_create_wallet_reservations_and_dispatch_outbox.sql` creates the
service-role-only `fulfillment_dispatch_outbox` table. Migration
`20260919024000_create_fulfillment_outbox_functions.sql` adds service-role-only
RPCs to enqueue, claim, and finish dispatch messages without calling suppliers.
They enforce idempotent enqueue, claim ownership, wallet-active checks, a
committed-reservation requirement, and stale-reservation/security-version
blocking. The profile `financial_security_version` is authoritative and
database-owned: a profile trigger increments it whenever suspension or
reinstatement state changes, while ordinary profile writes are normalized back
to the stored value. Reservations and dispatch messages must carry the current
epoch, so a freeze, review, or later reinstatement invalidates older unused
authorizations instead of allowing a pre-review queue item to run.

The local model proves the intended policy:

- a crash before commit leaves no order, no outbox message, and no supplier
  call;
- a crash after commit leaves one recoverable dispatch message;
- an old queued message cannot dispatch after wallet freeze;
- a financial-security version change invalidates stale queued authorizations
  even if the wallet is later reopened;
- only the worker that holds the claim can dispatch the message.

This is local policy coverage, not proof of a deployed transactional outbox for
every supplier. The database objects and service-role claim RPCs now exist in
the repository, but purchase routes still need route-specific migration
to enqueue through those RPCs, and deployed worker behavior still requires
staging and production verification.

## Freeze And Review

`WALLET_UNBACKED_FUNDS` means the posted balance cannot be trusted for new
delivery. It is different from ordinary insufficient funds.

When this condition occurs:

- new wallet debits and new paid delivery are denied;
- the account is financially frozen through `profiles.account_suspended`;
- evidence should be collected before any correction;
- a legitimate later deposit may be recorded, but it does not automatically
  clear the historical incident;
- admin review must reconcile funding, ledger, orders, provider outcomes, and
  blocked attempts before unsuspending.

Ordinary insufficient funds should not by itself suspend the customer.

## Chargebacks And Debt

Chargebacks and correction debits are accounting events, not ordinary customer
purchases. The wallet engine allows those debit types to preserve a negative
posted wallet balance when the reversal exceeds the current balance, then
freezes the account before any further spending can occur.

This prevents two unsafe outcomes:

- rejecting a real chargeback merely because the wallet is already empty;
- silently clamping debt to zero and losing the amount owed.

Manual owner/admin chargeback recording now posts through the wallet engine as
`chargeback`, places the customer into wallet review, and preserves debt instead
of clamping it away. Provider-specific automated chargeback ingestion, dispute
evidence, debt collection, and live review workflows still require
staging/provider verification before being treated as complete.

## Remaining Model Gaps

These are explicit gaps, not hidden assumptions:

- no universal reservation/hold flow is enforced across all product families,
  although local model coverage now verifies the intended reservation math and
  additive service-role-only reservation tables/RPCs exist;
- per-order partial-refund conservation is modeled locally, but not yet proven
  against every live database refund route and provider callback;
- provider-specific automated chargeback ingestion and full live debt-review
  workflow proof are not complete, though a controlled manual admin chargeback
  path exists;
- transactional outbox/worker claim handling is locally modeled and additive
  service-role-only database RPCs exist, but current route implementations are
  not yet all migrated to use them as deployed route-specific implementations;
- provider unknown-outcome handling still depends on provider-specific tests;
- production permissions and deployed function versions remain owner-verified
  evidence, not local-source facts.

The current safe reopening rule is therefore narrow: reopen only routes whose
payment evidence, wallet authorization, supplier dispatch, idempotency, refund,
and production permission checks have been verified.
