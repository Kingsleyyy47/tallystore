# Wallet State Machine And Review Workflow

Prepared: 2026-09-19

This document defines how TallyStore should decide whether a customer can
spend, receive delivery, receive bookkeeping updates, or be reviewed after a
wallet-integrity event. It is repository guidance plus source-backed
containment evidence. Production safety still requires the owner-side checks in
`wallet-owner-verification-checklist.md`.

## State Axes

Keep these states separate. Do not collapse them into one vague `suspended`
flag.

| Axis | States | Meaning |
| --- | --- | --- |
| Account access state | `ACTIVE`, `RESTRICTED`, `SECURITY_SUSPENDED` | Controls login, support access, and broad account use. |
| Wallet financial state | `ACTIVE`, `REVIEW_REQUIRED`, `FROZEN` | Controls spending, withdrawal, wallet authorization, and undispatched delivery. |
| Service health state | `READY`, `DEGRADED`, `FULFILLMENT_PAUSED` | Controls whether a product/provider route may dispatch at all. |

The current repository stores the financial hold mostly through
`profiles.account_suspended` plus wallet-security events and review metadata.
That is a containment implementation detail. The decision model remains the
three-axis model above.

## Decision Matrix

| Condition | Purchase or delivery decision | State/action |
| --- | --- | --- |
| Trusted funds and journal are valid; backed available amount covers the order. | Authorize through `apply_wallet_transaction` before dispatch or reveal. | Remain active. |
| Trusted funds and journal are valid; backed available amount is too small. | Decline before delivery. | Ordinary `INSUFFICIENT_FUNDS`; do not auto-suspend. |
| Displayed/stored wallet balance exceeds trusted principal minus consumed spend. | Deny before delivery. | Freeze financial access, record review evidence, return `WALLET_UNBACKED_FUNDS`. |
| Credit exists without verified gateway deposit or approved admin-credit lineage. | Deny before delivery. | Mark review required or frozen; do not treat it as money. |
| Funding history is incomplete or ambiguous. | Deny new paid commitments. | Review required until owner evidence resolves the gap. |
| Financial calculation or database dependency is unavailable. | Deny temporarily before supplier call. | Service degraded; do not convert outage into credit or fraud proof. |
| Wallet/account is already frozen or review-required. | Deny new commitments and unused delivery authorizations. | Preserve read-only history/support access where possible. |
| Correctly authenticated duplicate payment event. | Do not credit again. | Return idempotent result or no-op; do not suspend solely for repetition. |
| Unsigned/forged webhook names a customer. | Reject without credit or delivery. | Log/rate-limit source; do not punish the named customer from untrusted payload attribution. |
| Authenticated financial authorization is reused incompatibly. | Deny. | Record incident and escalate with authenticated evidence. |
| Supplier outcome is unknown. | Do not retry, refund, release, or resend by guess. | Keep order/outcome in review until provider lookup, callback, or manual resolution. |
| Confirmed chargeback or payment reversal creates debt. | Block new spending. | Preserve negative/debt accounting and review commitments; do not clamp to zero. |
| Legitimate deposit arrives while wallet is frozen. | Record narrowly authorized incoming bookkeeping. | Keep funds unavailable until review; do not auto-unfreeze. |

## Review And Recovery Workflow

An admin button must start controlled review, not directly set a wallet back to
active.

Required recovery sequence:

1. Preserve the original incident, affected transactions, orders, payment
   evidence, webhook records, supplier references, IP/device evidence, and
   deployed-version notes.
2. Run the read-only query pack or reconciliation command for the affected
   wallet.
3. Recalculate trusted principal from verified gateway deposits plus approved
   admin credits only.
4. Recalculate consumed spend, eligible refunds, unresolved debit exposure,
   unknown supplier outcomes, and any debt/chargebacks.
5. Confirm no queued or undispatched order can still release value using a stale
   authorization.
6. Post any legitimate correction through a controlled wallet-engine path or a
   balance-neutral owner-evidence repair row. Do not update
   `profiles.wallet_balance` directly.
7. Record reviewer identity, reason, evidence references, before/after values,
   and the new financial-security version.
8. Only then clear review/frozen status for the wallet routes whose
   staging/provider/production checks are complete.

Do not clear a financial hold merely because the displayed balance was edited to
match, because a later top-up arrived, or because a later scan did not rediscover
the old divergence.

## Operations While Frozen

Blocked:

- new paid purchases;
- withdrawals and outgoing transfers;
- undispatched supplier calls;
- credential, code, signed URL, or inventory-secret reveal for new value;
- admin direct balance overwrite;
- automatic partner/API fulfillment.

Allowed only through narrow internal paths:

- verified incoming payment recording;
- chargeback/debt recording;
- provider outcome updates for already submitted orders;
- eligible refunds tied to prior trusted debits;
- support/history access that does not reveal new undelivered value;
- owner evidence collection and review notes.

## Customer And Owner Views

Customer-facing text should say that wallet spending is under review, include a
support/reference id where available, and keep permitted order history/support
access. It should not expose anti-abuse thresholds or assert criminal intent
without evidence.

Owner/admin views should show:

- account access state, wallet financial state, and service health state;
- reason code and explanatory text;
- first detected and latest occurrence timestamps with timezone;
- displayed balance, trusted principal, consumed spend, refunds, reservations
  or unresolved exposure, and backed available amount;
- linked payment, order, supplier, incident, and webhook references;
- reviewer history and current production-proof status.

## Current Proof Boundary

Repository checks cover the source policy, local models, static migrations, and
owner handoff. They do not prove deployed database grants, provider dashboard
configuration, Postgres locking, Edge Function runtime behavior, or production
worker versions.

Routes must remain paused until the owner completes route-specific staging,
provider, and production verification.
