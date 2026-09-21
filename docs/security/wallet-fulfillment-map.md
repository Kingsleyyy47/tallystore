# Wallet Fulfillment Map

Prepared: 2026-09-19

This map tracks every repository path found that can call a paid provider,
release product value, reveal credentials, create a redeemable order, or move
money out. The acceptance rule is: no route should deliver paid value without a
committed wallet-engine authorization or an explicit incident pause.

Classification labels:

- `PATCH_IMPLEMENTED`: repository patch exists, but live DB/provider proof is
  pending.
- `PAUSED`: route is closed or fails closed by default.
- `OWNER_PRODUCTION_CHECK_REQUIRED`: live grants, function versions, provider
  dashboards, denied-order supplier-call counts, credential-reveal counts, or
  provider logs must be checked by the owner before relying on live behavior.
- `HISTORICAL_CAUSE_UNPROVEN`: source review does not prove what happened in
  the past incident.

## Required Field Coverage

The implementation prompt requires every fulfillment path to identify these
fields. The summary table and route-level notes below cover them as follows:

| Prompt field | Where it is recorded in this map |
| --- | --- |
| Entry point | `Entry point` in the delivery surface summary and route headings. |
| Price source | Route-level notes identify server-side product/service pricing where implemented; paused routes must prove price source before reopening. |
| Order creation location | Route-level notes name the local order/transaction row that is created before dispatch, such as `orders`, `smm_orders`, `sms_orders`, `bitrefill_orders`, `bills_transactions`, or `withdrawals`. |
| Financial authorization function | `Financial authorization before action`; mapped routes use `apply_wallet_transaction`. |
| Reservation/capture location | Route-level notes identify the database-owned reserve/capture boundary for the active local-stock route; paused provider routes remain debit-first only in their closed code paths until reopened. |
| Queue or dispatch mechanism | `First irreversible or costly action` and route-level provider calls/workers. |
| Supplier adapter or inventory source | Provider names and inventory sources in the delivery surface summary. |
| First irreversible action | Dedicated summary column. |
| Retry, cancellation, or refund path | Route-level notes and required proof column. |
| Security-state checks | Current state, pause flags, frozen-wallet checks, device/IP ban checks, and owner proof requirements. |
| Coverage test | Required proof column plus regression matrix and local adapter/fulfillment/outcome tests. |

If a new fulfillment path cannot fill every field above, classify it as
`OWNER_PRODUCTION_CHECK_REQUIRED` and keep it paused until its authorization,
dispatch, retry, refund, and provider evidence are reviewed.

## Delivery Surface Summary

| Surface | Entry point | First irreversible or costly action | Financial authorization before action | Current state | Required proof before reopening or relying on live behavior |
| --- | --- | --- | --- | --- | --- |
| Pre-stocked account credentials | `supabase/functions/process-purchase/index.ts` | Credentials are inserted into `orders.account_details`; `individual_accounts.status` becomes `sold`. | `authorize_product_purchase` locks trusted funds, the order, and inventory reservation together; `complete_product_purchase` captures the hold, writes credentials, and marks the same inventory sold atomically. The route never uses `profiles.wallet_balance` as authority and never directly posts a product debit. | Active for local stock only. | Staging denied-order test proves no credentials returned and no account marked sold when wallet is unbacked/frozen/insufficient; concurrency and fault tests prove one reservation/capture and no duplicate credential delivery. |
| Live account suppliers | `process-purchase`, `muabanvia-fulfill`, auto/manual restock | External provider stock purchase and insertion into inventory. | Checkout supplier fallback is hard-coded off; direct fulfillment/restock routes fail closed by env flags. Direct MuaBanVia fulfillment returns `503 LIVE_ACCOUNT_FULFILLMENT_PAUSED` before auth/admin reads or supplier fetch; manual/auto restock return `503 MANUAL_RESTOCK_PAUSED` / `503 AUTO_RESTOCK_PAUSED` before product lookups, supplier fetches, or inventory writes. | Paused; static check enforces pause ordering. | Redesign to reserve backed funds before provider call, then run provider duplicate/timeout tests. |
| SMM/social boost | `supabase/functions/smm-create-order/index.ts` | `smmClient.createOrder(...)` panel call. | While paused, returns `503 SMM_ORDERS_PAUSED` before auth, wallet debit, local order creation, or panel call. If later reopened, wallet-engine debit occurs before local `smm_orders` insert and before panel call; orphan-ledger retry is blocked; debit/refund metadata includes sanitized request forensics. | Paused by `SMM_ORDERS_ENABLED`; local adapter mock passed; provider sandbox pending. | Local adapter mock covers denied wallet, duplicate idempotency key, panel timeout, accepted dispatch, failed refund, and duplicate refund. Real panel idempotency/status contract still needs sandbox proof before reopening. |
| SMM status workers | `smm-check-status`, `smm-check-all-orders` | Status lookup and possible refund; no new order dispatch. | Refunds use wallet engine with deterministic keys. | Patched, cron boundary checked. | Verify duplicate failed statuses cannot refund twice and cron secret is live-only. |
| SMS OTP rental | `supabase/functions/smsbus/index.ts?action=create_otp` | `daisyGetNumber(...)` number allocation. | While paused, returns `503 SMS_OTP_PAUSED` before auth, wallet debit, local order creation, or Daisy allocation. If later reopened, wallet-engine debit first; pending `sms_orders` row created before Daisy allocation; debit/failure-refund metadata includes sanitized request forensics. | Paused by `SMS_OTP_ENABLED`; local adapter mock passed; Daisy sandbox pending. | Local adapter mock covers denied wallet, timeout/unknown, failed refund, and duplicate refund. Daisy price/cancellation/late-code contract still needs sandbox proof before reopening. |
| SMS status/cancel/keep | `smsbus` order actions and Daisy callback | Revealing OTP code, keeping rental active, canceling provider activation. | Existing local order must belong to user/admin; refunds use wallet engine. | Patched, local outcome mock passed; Daisy sandbox pending. | Verify frozen users cannot start new rentals but can view existing history; duplicate callbacks do not double-refund. |
| Telegram Stars | `supabase/functions/telegram-stars/index.ts` | `istarPost('/orders/star', ...)`. | While paused, returns `503 TELEGRAM_ORDERS_PAUSED` before auth, wallet debit, local order creation, or iStar dispatch. If later reopened, local order is created, then wallet-engine debit, then iStar call; checkout debit/refund metadata includes sanitized request forensics. | Paused by `TELEGRAM_ORDERS_ENABLED`; local adapter mock passed; iStar sandbox pending. | Local adapter mock covers invalid/denied dispatch, response lost, accepted dispatch, and failed refund once. iStar callback/status contract still needs sandbox proof before reopening. |
| Telegram Premium | `telegram-stars` | `istarPost('/orders/premium', ...)`. | While paused, returns `503 TELEGRAM_ORDERS_PAUSED` before auth, wallet debit, local order creation, or iStar dispatch. If later reopened, local order is created, then wallet-engine debit, then iStar call; checkout debit/refund metadata includes sanitized request forensics. | Paused by `TELEGRAM_ORDERS_ENABLED`; local adapter mock passed; iStar sandbox pending. | Same iStar proof as Stars. |
| iStar webhook refunds | `api/webhook-istar.ts` | Refund for failed iStar order. | Raw-body HMAC verification required before order update/refund; refund uses wallet engine. | Patched. | Deployed invalid-signature `401`, valid failure refunds once, duplicate callback idempotent. |
| Bills and airtime | `supabase/functions/purchase-bills/index.ts` | SageCloud airtime/data call. | While paused, returns `503 BILLS_PAUSED` before auth/profile reads, local bills row creation, wallet debit, SageCloud setup, or provider purchase. If later reopened, local `bills_transactions` row and wallet-engine debit happen before provider call; debit-denied rows are kept as failed `wallet_debit` evidence. | Paused by `BILLS_ENABLED`; local adapter mock passed; static check enforces pause ordering. | Local adapter mock proves failed/unknown/duplicate decisions do not double-refund or dispatch without debit. SageCloud sandbox remains required before reopening. |
| Gift cards/eSIM | `supabase/functions/purchase-bitrefill/index.ts` | Bitrefill invoice/order creation. | While paused, returns `503 BITREFILL_PAUSED` before auth/profile reads, local Bitrefill order creation, wallet debit, provider setup, or invoice creation. If later reopened, local `bitrefill_orders` row and wallet-engine debit happen before provider call; debit-denied rows are kept as failed `wallet_debit` evidence. | Paused by `BITREFILL_ENABLED`; local adapter mock passed; static check enforces pause ordering. | Local adapter mock covers idempotency, timeout, failure refund, and duplicate refund. Bitrefill sandbox remains required before reopening. |
| Withdrawals | `supabase/functions/create-withdrawal-request/index.ts` | SageCloud transfer. | While paused, returns `503 WITHDRAWALS_PAUSED` before auth/profile reads, local withdrawal row creation, wallet debit, SageCloud setup, or transfer. If later reopened, local withdrawal row and wallet-engine debit happen before transfer; debit-denied rows are kept as failed `wallet_debit` evidence, and provider-failure refunds carry the original reference, debit transaction id, debit idempotency key, and `crypto_withdrawals` source-order provenance. | Paused by `WITHDRAWALS_ENABLED`; local adapter mock passed; static check enforces pause ordering and refund provenance. | Local adapter mock covers transfer idempotency and duplicate failure-refund behavior. SageCloud sandbox remains required before reopening. |
| Crypto top-up | `create-crypto-sell-order`, `nowpayments-webhook` | Accepting crypto payment as spendable value. | While paused, returns `503 CRYPTO_TOPUP_PAUSED` before auth, Supabase client setup, local crypto transaction rows, NOWPayments setup, or provider payment creation. Auto-credit disabled; finished payments held for manual review. | Paused/manual review only; static check enforces pause ordering. | NOWPayments sandbox for fake/disappearing/partial/underpaid/replayed payments; owner approval workflow for any credit. |
| Referral withdrawal | `withdraw-referral-balance` | Moving referral balance to wallet balance. | Hard-paused in source: returns `503 REFERRAL_WITHDRAWALS_PAUSED` without auth/profile reads or the referral-to-wallet RPC. | Paused; static check enforces that no env flag or legacy RPC call can reopen the route in this build. | Referral source-of-funds proof, redesigned trusted-principal handling, and restricted-role RPC denial before any future replacement. |
| Partner API checkout | `api/partner-api.ts`, `supabase/functions/partner-api/index.ts` | Partner order and partner customer delivery through API. | Public route returns `PARTNER_API_PAUSED`; Edge Function hard-paused for non-admin actions; existing partners inactive. | Closed. | Owner must explicitly review partner, re-enable row, and run route-specific wallet/provider tests before any partner key is trusted. |
| PocketFi partner customer payments | `api/webhook-pocketfi.ts`, `webhook-pocketfi` | Crediting/fulfilling partner customer order. | Bridge requires provider verification headers and raw body; Edge Function logs partner payments for manual review while partner API is paused. | Manual review only. | Sandbox signed partner-account event proves no partner fulfillment is triggered during pause. |
| Manual/admin inventory release | Admin UI, `manage-staff`, product tables | Adding/changing sellable inventory or exposing account rows. | Catalog/inventory RLS makes plaintext inventory admin-only; browser cannot write product tables. | Patched. | Verify live policies and staff permission matrix; ensure staff cannot grant themselves write scopes. |
| Future reserve-first purchase authorization | `create_wallet_reservation`, `capture_wallet_reservation`, `release_wallet_reservation` | Hold creation, capture to wallet debit, or hold release. | Create uses trusted available funds and active holds; capture posts the debit through `apply_wallet_transaction`; release does not create refund credit. | Additive database boundary exists; active supplier routes are not all migrated to it yet. | Route-specific migration must reserve before enqueue/dispatch, capture/release exactly once, and pass staging fault tests before relying on it for live suppliers. |
| Future durable dispatch worker | `enqueue_fulfillment_dispatch`, `claim_fulfillment_dispatch`, `finish_fulfillment_dispatch` | Worker sends supplier request after a durable claim. | Outbox claim blocks suspended wallets and stale reservation/security-version messages before worker dispatch; finish requires the same claimed worker. | Additive database boundary exists; active supplier routes are not all migrated to it yet. | Route-specific migration must enqueue through the RPC, workers must claim through the RPC, and staging fault tests must prove crash/duplicate-worker behavior before relying on it for live suppliers. |

## Route-Level Notes

### Product Credentials

`process-purchase` now blocks live provider fallback with
`const liveAccountFulfillmentEnabled = false`. The function calculates the
server price, then calls `authorize_product_purchase`, which locks the
database-owned financial-security epoch, trusted available funds, the local
order, and the selected inventory in one transaction. Credentials are loaded
only after that hold and inventory reservation commit. `complete_product_purchase`
then captures the hold, stores the credential payload, and marks the same
inventory sold in one transaction. Its capture metadata carries the source
order ID and the request forensics supplied by the route. A crash before
authorization leaves no order, hold, or reserved inventory; a crash after
authorization leaves a resumable non-completed order and hold rather than a
completed credential delivery.

Residual risk: the route is locally reserve-first, but the owner still needs
staging PostgreSQL permission, concurrency, and fault-injection evidence before
claiming the deployed database has the same behavior. Live supplier fallback
remains paused and is not covered by this local-stock migration.

### SMM

`smm-create-order` derives price from `smm_services`, checks idempotency, blocks
orphaned purchase-ledger retries, debits through `apply_wallet_transaction`,
creates a local order row, and calls the panel only after that local state
exists. Checkout debit and same-request failure-refund ledger metadata carries
`request_forensics`. Status workers refund failed orders through the wallet
engine.

Residual risk: panel idempotency and unknown-outcome behavior are provider
contract issues. A lost HTTP response after the panel accepted an order cannot
be proven safe by local database checks alone.

### SMS

`smsbus` debits the wallet first, creates a pending local `sms_orders` row with
`pending_provider_allocation: true`, and only then calls DaisySMS for a number.
If activation fails, the provider number is canceled where possible and the
wallet refund is posted through the wallet engine. Checkout debit and immediate
failure-refund metadata carries `request_forensics`. The route also blocks
active fraud device/IP bans before purchase.

Residual risk: DaisySMS late callbacks, cancellation authority, duplicate
callbacks, and provider "not found" semantics need sandbox/mock verification.

### Telegram/iStar

`telegram-stars` creates a local order, posts the debit through
`apply_wallet_transaction`, and then calls iStar. `api/webhook-istar.ts` disables
body parsing, verifies HMAC over the raw body with timing-safe comparison, and
uses deterministic wallet-engine refund keys for failed provider callbacks.
Checkout debit and same-request iStar-failure refund metadata carries
`request_forensics`.

Residual risk: iStar provider outcome lookup/idempotency still needs sandbox or
mocked tests.

### Paused Provider-Money Routes

Bills, Bitrefill/gift cards, withdrawals, crypto top-up, SMM order creation,
SMS OTP purchases, Telegram order creation, referral withdrawal, direct live
account fulfillment, auto restock, manual restock, and partner API are
intentionally not treated as reopened by this patch. Their code either fails
closed by default or returns a manual-review state. Bills, Bitrefill, and
withdrawals now preserve debit-denied local rows as failed `wallet_debit`
evidence for later review. The owner should keep their env flags disabled until
the route-specific proof above is complete.

## Evidence Limits

- `npm run security:wallet` proves source-level ordering checks; it does not
  prove provider behavior, production deployment, or database grant state.
- A later fraud suspension is not a delivery control. The relevant proof is that
  supplier calls, credential reveal, transfers, or partner fulfillment do not
  happen before authorization.
- Unknown provider outcomes must remain held/reviewed. Do not retry or refund
  solely because a local worker timed out.
