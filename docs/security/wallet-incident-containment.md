# Wallet Incident Containment

Prepared: 2026-09-19

This document is a sanitized implementation record. Do not add customer emails,
user IDs, raw payment references, provider secrets, or exported incident rows to
this file.

## Scope

The current objective is to prevent unsupported wallet value from reaching paid
fulfillment while the historical incident is investigated. Repository changes do
not prove the live database, provider dashboards, deployed Edge Functions, or
old workers are safe until the owner performs the production checks.

## P0 Containment Implemented

Status labels:

- `PATCH_IMPLEMENTED`: code or migration exists in the repository.
- `LOCAL_BUILD_PASSED`: `npm run build` completed locally.
- `PRODUCTION_DEPLOYMENT_PENDING`: owner must deploy the app/functions/migrations.
- `PRODUCTION_VERIFICATION_PENDING_OWNER`: owner must verify live state.

Deployment note: `20260919019000_rescan_wallet_integrity_after_hardening.sql`
re-runs the hardened evaluator for existing ordinary customer wallets after the
new trusted-principal rules are installed. The follow-up migration
`20260921000000_separate_wallet_review_from_account_access.sql` routes
system-generated integrity holds into `profiles.wallet_review_required`, so
spending and fulfillment remain blocked while order history, deposits, wallet
activity, and support remain readable. Manual admin suspensions are unchanged,
and the financial review hold is not auto-cleared.

The migration
`20260921010000_grandfather_legacy_wallet_funding.sql` adds the explicit legacy
funding cutoff of **2026-09-19 00:00:00 UTC**. Qualifying wallet credits
recorded before that cutoff become an auditable grandfathered principal
baseline, even if the newer provider-evidence fields did not exist at the
time. Historical debits are linked for refund conservation only. Credits after
the cutoff still require verified PocketFi/Ercas evidence or an approved admin
credit. An account with spending but no qualifying pre-cutoff credit is not
grandfathered and remains subject to wallet review.

| Surface | Current repository behavior | Evidence |
| --- | --- | --- |
| Partner API | Public Vercel proxy returns `503 PARTNER_API_PAUSED`; Supabase `partner-api` is hard-paused for non-admin actions; existing `api_partners` rows are marked inactive by migration; partner tables are no longer directly readable or writable by browser roles; partner/API evidence cascades are replaced with restrictive foreign keys. PocketFi payments to partner customer accounts are logged for manual review without fulfilling partner orders while this pause is active. | `api/partner-api.ts`, `supabase/functions/partner-api/index.ts`, `api/webhook-pocketfi.ts`, `supabase/functions/webhook-pocketfi/index.ts`, `supabase/migrations/20260919007000_pause_existing_api_partners.sql`, `supabase/migrations/20260919008000_harden_partner_table_authority.sql`, `supabase/migrations/20260919021000_restrict_partner_cascade_evidence.sql` |
| Bills and airtime | `purchase-bills` defaults disabled unless `BILLS_ENABLED=true`; when disabled it returns `503 BILLS_PAUSED` before auth/profile reads, local bills row creation, wallet debit, SageCloud setup, or provider purchase. Wallet debit/refund now goes through `apply_wallet_transaction` rather than direct profile balance writes. Debit-denied local transactions are retained as failed `wallet_debit` evidence. | `supabase/functions/purchase-bills/index.ts` |
| Gift cards/eSIM | `purchase-bitrefill` defaults disabled unless `BITREFILL_ENABLED=true`; when disabled it returns `503 BITREFILL_PAUSED` before auth/profile reads, local Bitrefill order creation, wallet debit, provider setup, or invoice creation. Wallet debit/refund now goes through `apply_wallet_transaction` rather than direct profile balance writes. Debit-denied local orders are retained as failed `wallet_debit` evidence. | `supabase/functions/purchase-bitrefill/index.ts` |
| Crypto top-up | Existing crypto top-up path remains default disabled unless `CRYPTO_TOPUP_ENABLED=true`; when disabled it returns `503 CRYPTO_TOPUP_PAUSED` before auth, Supabase client setup, local crypto transaction rows, NOWPayments setup, or provider payment creation. NOWPayments finished-payment webhooks are signature-verified and provider-verified but hard-held for manual review; `CRYPTO_AUTO_CREDIT_ENABLED` cannot reopen auto-credit. Legacy crypto-to-wallet RPC is replaced with an error and revoked, and the old transfer modal is removed from the crypto balance card. | `supabase/functions/create-crypto-sell-order/index.ts`, `supabase/functions/nowpayments-webhook/index.ts`, `supabase/migrations/20260919000000_pause_unsafe_financial_surfaces.sql`, `src/components/CryptoBalanceCard.tsx` |
| Withdrawals | `create-withdrawal-request` defaults disabled unless `WITHDRAWALS_ENABLED=true`; when disabled it returns `503 WITHDRAWALS_PAUSED` before auth/profile reads, local withdrawal row creation, wallet debit, SageCloud setup, or transfer. Selected source balance debit/refund now goes through `apply_wallet_transaction` rather than direct profile balance writes. Debit-denied withdrawal rows are retained as failed `wallet_debit` evidence. | `supabase/functions/create-withdrawal-request/index.ts` |
| Referral withdrawals | `withdraw-referral-balance` is hard-paused in source and returns `503 REFERRAL_WITHDRAWALS_PAUSED` without auth, profile reads, or the referral-to-wallet RPC. The legacy `REFERRAL_WITHDRAWALS_ENABLED` flag must still remain false for old deployments, but the current route does not read it. | `supabase/functions/withdraw-referral-balance/index.ts` |
| Live account supplier fulfillment | Checkout hard-pauses paid live supplier fallback and uses local stock only. Direct MuaBanVia fulfillment remains default-paused unless `LIVE_ACCOUNT_FULFILLMENT_ENABLED=true`; when disabled it returns `503 LIVE_ACCOUNT_FULFILLMENT_PAUSED` before auth, admin profile reads, or supplier fetch. Storefront availability and stock recalculation remain default-paused unless live fulfillment flags are explicitly enabled. | `supabase/functions/process-purchase/index.ts`, `supabase/functions/muabanvia-fulfill/index.ts`, `src/lib/productAvailability.ts`, `src/lib/supabase.ts` |
| Auto/manual restock | Auto-restock and manual restock default disabled unless explicit env flags are set; when disabled they return `503 AUTO_RESTOCK_PAUSED` / `503 MANUAL_RESTOCK_PAUSED` before product lookups, supplier fetches, or inventory writes. | `supabase/functions/auto-restock/index.ts`, `supabase/functions/manual-restock/index.ts` |
| Legacy Ercas Vercel webhooks | Legacy routes return `410`; active Ercas crediting is through server-side verification. | `api/webhook-ercas.ts`, `pages/api/webhook/ercas.ts`, `supabase/functions/verify-and-credit-wallet/index.ts` |

## Wallet Mutation Map

Detailed per-path mutation evidence is maintained in
`docs/security/wallet-mutation-map.md`. The table below is the short operational
summary.

| Path | Classification | Notes |
| --- | --- | --- |
| `apply_wallet_transaction` RPC | `PATCH_IMPLEMENTED` | Single service-role wallet writer with idempotency, row lock, ledger insert, balance update, and purchase backing check. A reused idempotency key only replays when user, type, signed amount, reference, currency, external payment ID, and balance bucket match; otherwise it returns `IDEMPOTENCY_CONFLICT` without mutating the wallet. |
| Direct `transactions` table writes | `PATCH_IMPLEMENTED` | Trigger guard skips and audits direct ledger insert/update/delete unless the wallet engine sets its transaction-local authorization flag. Balance-neutral admin ledger repair evidence remains allowed only with an approving actor and owner-evidence metadata. |
| Product checkout | `PATCH_IMPLEMENTED` | Debits through wallet engine before credentials are saved in a completed order. Checkout blocks orphaned purchase-ledger retries so a previously refunded failed attempt cannot become a fresh credential delivery. Live-provider purchase is hard-paused. |
| PocketFi webhook | `PATCH_IMPLEMENTED` | Verifies webhook secret/signature path, matches account, credits through wallet engine, dedupes by provider reference. |
| PocketFi Vercel bridge | `PATCH_IMPLEMENTED` | Public bridge disables body parsing, forwards the raw webhook body and provider verification headers, no longer injects server webhook secrets, and unsigned bridge calls fail closed before proxying. |
| Ercas verify-and-credit | `PATCH_IMPLEMENTED` | Requires pending payment ownership, verifies payment server-side with Ercas, checks amount/currency/merchant/environment, credits through wallet engine, consumes the exact pending-payment row on success, and closes definitive provider failure/mismatch evidence as `failed` before any wallet credit path. |
| Scheduled pending-payment recovery | `PATCH_IMPLEMENTED` | Cron/service-secret gated, optimistically claims each pending row by `check_count`, and can only ask `verify-and-credit-wallet` to verify the server-created pending payment for its owner; it does not write wallet balances or ledger rows directly. |
| Admin/staff balance adjustment | `PATCH_IMPLEMENTED` | Uses wallet engine rather than direct balance update. Owner must verify deployed role grants and function version. |
| Admin ledger repair | `PATCH_IMPLEMENTED` | Historical credit repair records approving admin metadata and does not change balance. Backing checks count admin/staff/correction credits only when an approving actor is recorded. |
| Referral attribution and credit | `PATCH_IMPLEMENTED` | Referral attribution is applied by an authenticated server function that ignores caller-provided user IDs, blocks self-referral, and does not overwrite existing attribution. Referral commissions post to referral balance through wallet engine. Conversion to wallet is hard-paused and cannot be reopened by route env flag in the current build. |
| Direct profile balance/privileged writes | `PATCH_IMPLEMENTED` | Trigger guard forces ordinary inserted balances to zero and preserves protected fields on ordinary updates. Service-role direct updates are not enough for protected profile fields; legitimate PocketFi, referral, suspension, and staff-role changes use narrow database RPCs. |
| Product/inventory writes | `PATCH_IMPLEMENTED` | New RLS migration makes product writes and plaintext inventory admin-only at the database policy layer. |

## Fulfillment Map

Detailed paid-delivery boundary evidence is maintained in
`docs/security/wallet-fulfillment-map.md`. The table below is the short
operational summary.

| Fulfillment family | Authorization state |
| --- | --- |
| Pre-stocked product credentials | Allowed only after wallet engine purchase authorization. Database RLS restricts plaintext inventory to admins and service role. |
| Live account suppliers | Checkout supplier fallback is hard-paused. Direct supplier fulfillment remains default-paused and must not be re-enabled until purchase authorization is migrated to reserve/authorize backed funds before any paid provider call. |
| SMS | New OTP purchases are default-paused unless `SMS_OTP_ENABLED=true`, returning `503 SMS_OTP_PAUSED` before auth, wallet debit, local order creation, or Daisy allocation. If later reopened, wallet-engine debit happens before Daisy number acquisition; a pending local `sms_orders` row is created before the provider call; orphaned purchase-ledger retries are blocked before any new Daisy number is acquired; failures mark the local order failed, cancel/release the provider number where possible, and refund through wallet engine. |
| SMM/social boost | New SMM orders are default-paused unless `SMM_ORDERS_ENABLED=true`, returning `503 SMM_ORDERS_PAUSED` before auth, wallet debit, local order creation, or panel dispatch. If later reopened, it uses wallet engine for purchase/refunds and blocks orphaned purchase-ledger retries before any panel provider call. |
| Telegram/iStar | New Stars/Premium orders are default-paused unless `TELEGRAM_ORDERS_ENABLED=true`, returning `503 TELEGRAM_ORDERS_PAUSED` before auth, wallet debit, local order creation, or iStar dispatch. If later reopened, it creates the local order before wallet debit, retains debit-failed local orders as `failed` evidence instead of deleting them, uses wallet engine for purchase/refunds, and requires raw-body HMAC verification with a configured iStar webhook secret on the Vercel webhook. |
| Bills and gift cards | Wallet-engine debit/refund is implemented; debit-denied local records are retained as failed `wallet_debit` evidence; still default paused until provider outcome/idempotency tests are run. |
| Withdrawals | Wallet-engine debit/refund is implemented; debit-denied withdrawal rows are retained as failed `wallet_debit` evidence, and returned provider failures and thrown provider errors both refund through the wallet engine with original reference, debit transaction id, debit idempotency key, and `crypto_withdrawals` source-order provenance. Still default paused until provider outcome/idempotency tests are run. |
| Crypto top-up, referral withdrawal, partner API | Default paused pending full route-by-route migration and verification. |

## Fraud Credit Evidence Rule

The detailed accounting definition is maintained in
`docs/security/wallet-financial-model.md`. The current containment patch uses a
debit-first model for paused provider routes. Reserve-first hold math and
outbox/worker-claim dispatch policy are locally modeled, while route-specific
database hold tables, deployed worker locks, partial-refund caps, chargebacks,
and full transactional outbox behavior remain verification or implementation
gaps.

The purchase authorization engine and admin fraud screen now use a stricter
trusted-credit rule:

- Pre-cutoff legacy top-ups and approved wallet credits count as grandfathered
  principal through the one-time `wallet_legacy_funding` table. This preserves
  credible older customer balances without inventing a new deposit.
- Bank/payment top-ups recorded on or after the cutoff count only from
  completed wallet ledger rows with current provider evidence.
- Bank/payment top-ups also require a non-blank provider reference, matching
  `metadata.verified_amount_ngn`, and matching server-side provider evidence:
  Ercas `pending_payments` for the same user/reference/amount or PocketFi
  `pocketfi_webhook_logs` for the matched user. A ledger row with only an
  `external_payment_id` is not trusted principal.
- `admin_credit` counts only when its `created_by` actor resolves to an admin
  profile and the row actually increased the wallet balance. Balance-neutral
  admin repair/evidence rows are audit records only and do not create spendable
  trusted principal.
- Staff, promotion, correction, and generic credit rows do not create trusted
  product-spend principal unless they are reposted through the approved
  `admin_credit` path.
- Referral withdrawals and other internal balance movement do not create trusted
  product-spend principal during the incident review.
- Crypto credits are quarantined during the wallet incident review and do not
  automatically justify wallet spend.
- Refunds offset prior spend; they are not treated as new external funding.
- A customer who spent before the cutoff but has no qualifying historical
  credit is treated as unresolved legacy funding, not automatically trusted.
- Direct ledger mutations are rejected and audited in
  `transaction_ledger_blocked_attempts`.

## Financial Decision Matrix

| Condition | Decision | Repository behavior |
| --- | --- | --- |
| Stored and backed wallet funds cover a purchase | Authorize through wallet engine, then proceed to the mapped fulfillment path. | `apply_wallet_transaction` posts the purchase, updates the balance, and creates a ledger hash chain entry. |
| Customer has too little legitimate balance | Decline as ordinary insufficient funds, not fraud. | Wallet engine returns `insufficient_balance` before any new supplier call. |
| Stored wallet balance is higher than backed available funds | Deny and freeze financial access for review. | Wallet engine returns `WALLET_UNBACKED_FUNDS` and sets `account_suspended = true` before delivery authorization. |
| Pre-cutoff legacy credit exists but lacks newer provider metadata | Use the recorded grandfathered principal, then apply normal debit/refund conservation. | `wallet_legacy_funding` supplies the historical baseline; no new post-cutoff credit is created. |
| Pre-cutoff spending exists with no qualifying historical credit | Deny new financial delivery and require review. | No grandfathered principal row is created; the wallet remains unbacked. |
| Funding record exists without trusted source evidence | Do not count it as backing. | Purchase backing query excludes crypto review credits and requires approving actor metadata for admin/staff/promo/correction credits. |
| Duplicate authenticated payment/webhook arrives | Idempotently acknowledge without additional credit. | Wallet engine idempotency and provider-reference checks prevent duplicate wallet credits. |
| Partner API payment arrives during pause | Record for manual review; do not fulfill partner order. | PocketFi partner account branch logs the payment and returns `PARTNER_API_PAUSED` without order delivery. |
| Provider outcome is failed before value delivery | Refund through wallet engine once. | Product/SMM/SMS/Telegram/Bills/Bitrefill/withdrawal paths use wallet-engine refund keys. |
| Provider outcome is unknown or route not fully verified | Keep route paused or leave order in review/pending state. | Bills, Bitrefill, withdrawals, crypto top-up, live suppliers, and restock remain default-paused. Referral withdrawal and partner API are hard-paused in source. |

## Review And Recovery Workflow

Do not clear a financial freeze by editing a displayed balance. For a frozen or
review-required wallet:

1. Preserve profile, wallet ledger, order, provider, webhook, and blocked-attempt
   evidence first.
2. Run the read-only query pack or live `npm run security:wallet:reconcile` for
   the account and inspect backed available funds, orphaned ledgers, duplicate
   references, blocked attempts, pending payment evidence, and identity audits.
   If you are working from downloaded Admin/Supabase CSVs, run
   `npm run security:wallet:reconcile -- --history-csv "<csv paths>" --json`
   first so duplicate exports and matching order rows are not counted twice.
3. Resolve unknown supplier outcomes before deciding whether funds should stay
   debited, be refunded, or remain held for manual review.
4. If a legitimate correction is needed, use the admin adjustment or
   balance-neutral ledger repair path. Do not directly edit `profiles` balances
   or `transactions` rows.
5. Unsuspend/unfreeze only after the backing calculation, ledger history, and
   unresolved order state are consistent. Re-run production checks before
   enabling new spending.

## Remaining Evidence Limits

- `PATCH_IMPLEMENTED` does not prove the live Supabase project has applied the
  migrations or deployed the matching Edge Function versions.
- `STATIC_WALLET_SECURITY_CHECK_PASSED` is a source-level regression guard; it
  does not prove live grants, RLS, trigger behavior, or concurrency.
- `docs/security/wallet-regression-matrix.md` is the current T01-T80 evidence
  register. Rows marked provider, concurrency, production, or full-test pending
  are not complete.
- `docs/security/wallet-financial-model.md` defines the current backed-funds
  accounting model, local hold/outbox policy coverage, and the remaining
  route-specific partial-refund, chargeback, provider, and production gaps.
- `docs/security/wallet-incident-final-report.md` is the repository-scoped
  final report. It is not production proof until the owner verifies deployment,
  live database grants, provider dashboards, and affected-account evidence.
- Historical cause remains `HISTORICAL_CAUSE_UNPROVEN` until live logs,
  provider records, and database audit evidence identify the write or payment
  path used by the affected accounts.
- Routes marked paused should remain paused until owner-controlled staging or
  production verification proves the full payment -> authorization ->
  fulfillment -> refund lifecycle.

## Production Deployment Order

1. Keep affected fulfillment paused in provider dashboards where possible.
2. Apply all new Supabase migrations through the owner-controlled deployment path.
   `20260919007000_pause_existing_api_partners.sql` intentionally disables
   existing partner records until owner review.
3. Use `docs/security/wallet-deployment-manifest.md` as the authoritative
   deploy list. At the time of this containment record, every changed Edge
   Function below must be deployed because shared function code also changed:
   `admin-adjust-balance`, `apply-referral`, `auto-restock`,
   `check-pending-payments`, `create-crypto-sell-order`,
   `create-pocketfi-topup`, `create-wallet-topup`,
   `create-withdrawal-request`, `manage-staff`, `manual-restock`,
   `muabanvia-fulfill`, `nowpayments-webhook`, `partner-api`,
   `process-purchase`, `purchase-bills`, `purchase-bitrefill`,
   `record-site-visit`, `revenue-os-loop`, `revenue-os-maintenance`,
   `smm-check-all-orders`, `smm-check-status`, `smm-create-order`, `smsbus`,
   `telegram-stars`, `verify-and-credit-wallet`, `webhook-pocketfi`, and
   `withdraw-referral-balance`.
4. Redeploy the Vercel app so `api/partner-api.ts` and storefront availability changes are live.
5. Ensure these env vars are absent or not equal to `true` until review is complete:
   `BILLS_ENABLED`, `BITREFILL_ENABLED`, `WITHDRAWALS_ENABLED`,
   `REFERRAL_WITHDRAWALS_ENABLED`, `CRYPTO_TOPUP_ENABLED`,
   `LIVE_ACCOUNT_FULFILLMENT_ENABLED`, `AUTO_RESTOCK_ENABLED`,
   `MANUAL_RESTOCK_ENABLED`.
6. Partner API must remain hard-paused in code; do not introduce an environment
   variable or fallback proxy path that can reopen public partner calls during
   this review.

## Local Verification

Detailed status is recorded in `docs/security/wallet-test-report.md`.

Commands run locally:

```text
npm run build
git diff --check
supabase --version
supabase db lint --local
npm run lint
docker --version
supabase status
npm run security:wallet:admin-review
npm run security:wallet
npm run security:wallet:local
npm run security:wallet:source-mutations
npm run security:wallet:deploy-manifest
npm run security:wallet:audit
npm run security:wallet:db-pack -- --help
npm run security:wallet:db-concurrency -- --help
npm run security:wallet:deployed-smoke -- --help
npm run security:wallet:handoff
npm run security:wallet:provider-evidence -- --format json
node scripts/wallet-reconcile-readonly.mjs --help
```

Result:

- `LOCAL_BUILD_PASSED`
- `DEPLOYMENT_MANIFEST_CHECK_PASSED`: `npm run security:wallet:deploy-manifest`
  verified 35 hardening migration files, 3 older replay migrations that were
  made no-op/suspend-only, 27 required hardening Supabase functions, 32
  currently changed function entrypoints, 9 existing
  security-sensitive functions to verify, 16 Vercel/site surfaces, and 11
  required pause flags in `docs/security/wallet-deployment-manifest.md`.
- `OWNER_HANDOFF_CHECK_PASSED`: `npm run security:wallet:handoff` verified the
  owner checklist, final report, test report, deployment manifest, regression
  matrix, and production-evidence register preserve proof boundaries and
  required staging/provider/production checks.
- `DB_SECURITY_RUNNER_HELP_PASSED`: `npm run security:wallet:db-pack -- --help`
  verified the guarded staging DB runner usage. The full runner was not run
  here because `psql`/local Postgres are unavailable.
  The SQL pack now also verifies deployed reserve/outbox RLS, browser-role
  privilege and policy absence, service-role access, constraints, and
  idempotency indexes.
- `DB_CONCURRENCY_RUNNER_HELP_PASSED`: `npm run security:wallet:db-concurrency
  -- --help` verified the guarded real-Postgres concurrency runner usage. The
  full runner was not run here because it requires an owner-controlled
  staging/local database, `psql`, and a dedicated ordinary test customer whose
  wallet can be reset to zero after the committed race test.
- `DEPLOYED_SMOKE_HELP_PASSED`: `npm run security:wallet:deployed-smoke -- --help`
  verified the safe deployed-route smoke runner usage. The full runner was not
  run here because no deployed base URL was provided in this local environment.
  With an owner-controlled auth header, it now also verifies paused SMM, SMS,
  and Telegram route codes and sends malformed product checkout probes that
  must fail before order creation, wallet debit, provider dispatch, or value
  reveal.
- `PROVIDER_EVIDENCE_TEMPLATE_PASSED`:
  `npm run security:wallet:provider-evidence -- --format json` generated the
  provider sandbox/dashboard evidence checklist for every external provider
  surface. `npm run security:wallet:provider-evidence -- --filled-template`
  generated a validation-shaped fillable evidence file. `npm run
  security:wallet:provider-evidence -- --self-test` also verified the
  filled-evidence validator rejects missing sections, pending/unpassed proof,
  and secret-looking references while accepting a complete sanitized passed
  evidence shape.
- `PRODUCTION_EVIDENCE_CHECK_PASSED`: `npm run security:wallet:evidence`
  verified the production evidence register includes standard proof fields,
  production proof areas, unknown-outcome supplier states, provider capability
  rows, route reopening gate fields, and staging SQL evidence fields.
- `LOCAL_SECURITY_SUITE_PASSED`: `npm run security:wallet:local -- --compact`
  passed 50 repository-local checks and reported Supabase CLI `2.117.0`
  available, with Docker, `psql`, and direct `deno` unavailable on this
  machine. It uses `npx deno` to type-check all 37 local Edge Functions and
  runs DB-concurrency runner help, DB-concurrency runner self-test,
  DB-security runner help, DB-security runner self-test, deployed-smoke help,
  deployed-smoke protected-header self-test, deployed-smoke owner-denied probe
  file validation, production-evidence register
  coverage, production-evidence validator self-test, provider-evidence
  fillable-template generation, provider-evidence validator self-test,
  deployed-version evidence generation, fillable deployed-version evidence
  generation, plus the deployed-version evidence validator self-test. It
  explicitly does not execute
  Supabase migrations, RLS grants, Postgres locks, deployed routes, provider
  sandboxes, or production configuration.
- `LOCAL_ADMIN_REVIEW_MODEL_PASSED`: `npm run security:wallet:admin-review`
  verifies approved admin credits are the only admin-created trusted principal,
  refunds only restore linked prior trusted debit capacity, staff credits require admin
  review before becoming trusted, and unbacked wallets cannot be reinstated by
  editing a displayed balance. The same local gate verifies admin/staff debit
  rows render negative even when stored with positive amounts, and generic or
  staff credit rows are not labelled as deposit history.
- `DIFF_CHECK_PASSED`
- `SUPABASE_CLI_AVAILABLE`: `2.117.0`
- `LINT_PASSED_WITH_WARNINGS`: `npm run lint` reports 0 errors and 25 existing warnings.
- `STATIC_WALLET_SECURITY_CHECK_PASSED`: `npm run security:wallet` reports 89 passing checks covering the partner API pause, partner admin mutation read-only lock, partner data-layer pause, partner table grant hardening, production evidence register coverage, deployed-version evidence gating, future-function default execute revocation, legacy balance RPC retirement, pending-payment evidence hardening, browser payment success/callback pages being unable to create wallet credit, Ercas timeout retry/no-provisional-credit handling, Ercas definitive-failure pending-payment closure, provider payment identity uniqueness, verified provider evidence and amount matching for trusted deposit principal, Ercas provider identity mismatch rejection, money precision/currency/overflow boundaries, frozen-customer read-only order support access, PocketFi duplicate-reference conflict handling, PocketFi raw-body bridge protection, deployed denied-route smoke coverage, provider evidence template coverage, admin and customer debit display/sign normalization, forged-webhook rejection before customer punishment/credit, ordinary insufficient-funds decline without fraud suspension, approved admin-credit actor and approval-metadata evidence, frozen-wallet incoming-funds recording without auto-unfreeze, fraud scanner no-auto-unsuspend and generic/staff/promotion/correction-credit exclusion, staging DB test-pack coverage, guarded staging DB runner coverage, guarded real-Postgres concurrency runner coverage, incident migration static-safety coverage, provider-adapter mock coverage, local security-suite coverage, deployment-manifest coverage, owner-handoff coverage, incident completion-audit coverage, wallet security event forensic sink/Admin review coverage, request-forensics metadata on high-risk purchase ledgers and denied-purchase freeze events, wallet-engine refund caps, refund-owner binding and original-debit provenance across mapped refund paths, wallet-engine chargeback debt preservation, admin unsuspend wallet-backing reconciliation, refund conservation staging coverage, chargeback debt staging coverage, admin absolute-plus-relative date display, disabled crypto transfer RPC/UI, NOWPayments hard manual-review hold, wallet engine grants, backed-funds purchase gate, direct-ledger guard, protected profile fields, narrow service-role-only profile writer RPCs, browser profile/signup mass-assignment protection, referral attribution/withdrawal authority, referral lookup casts, Ercas pending-payment binding, scheduled pending-payment recovery binding, iStar raw-body webhook verification and wallet-engine refunds, explicit authorization boundaries for JWT-disabled Edge Functions, fail-closed paid surfaces, fulfillment ordering before supplier dispatch/value release, completed-only customer credential reveal, frozen-account purchase ordering, hostile quantity/price input validation, mapped route idempotency-content binding, provider-money ordering for bills/Bitrefill/withdrawals plus default-paused SMM/SMS/Telegram order creation, absence of direct server-side profile balance update literals, absence of direct wallet-ledger mutations outside audited repair, the guarded read-only reconciliation command, the migration-safety test, the wallet model generated-sequence test, the wallet concurrency model test, the outbox-decision test, the reservation-decision test, the route-decision test, the route-inventory check, the env-secret inventory check, the supplier-outcome test, the refund-conservation model test, the provider decision test, the fulfillment decision test, the incident mutation/fulfillment maps, the T01-T80 regression matrix, the wallet financial model, and the incident final report.
- `LOCAL_MIGRATION_STATIC_TEST_PASSED`: `npm run security:wallet:migrations`
  checked 37 incident migrations, 41 security-definer functions, and 19
  protected tables for dangerous browser grants, browser function execution,
  disabled RLS, unpinned security-definer search paths, required wallet
  engine/partner/payment evidence revokes, unsafe top-level migration balance
  writes, top-level migration ledger inserts, and restricted
  `wallet_security_events` writes and capture triggers. It also requires
  public-schema `auth.users ON DELETE CASCADE` references and partner/API
  evidence cascades to be replaced with restrictive evidence-preserving foreign
  keys. This does not prove effective live database grants until the migrations
  are executed and inspected in Supabase/Postgres.
- `LOCAL_MODEL_SEQUENCE_TEST_PASSED`: `npm run security:wallet:model`
  runs deterministic generated wallet sequences covering insufficient funds,
  freezes, incoming credits while frozen, idempotency replay/conflict behavior,
  and refund caps. This is model evidence, not a substitute for staging DB
  row-lock/provider tests.
- `LOCAL_CONCURRENCY_MODEL_TEST_PASSED`:
  `npm run security:wallet:concurrency` covers local double-spend,
  deposit/purchase, freeze/purchase, duplicate-refund, and rollback
  interleavings. This is model evidence, not a substitute for staging DB
  row-lock/fault-injection tests.
- `LOCAL_ROUTE_DECISION_TEST_PASSED`: `npm run security:wallet:routes`
  covers local hostile quantity/price payloads, ordinary insufficient-funds
  decline without fraud freeze, unbacked displayed-balance freeze, unavailable
  financial-state fail-closed behavior, exact idempotency replay, and
  changed-payload conflicts. This is local policy evidence, not deployed route
  proof.
- `LOCAL_RUNTIME_BOUNDARY_SOURCE_TEST_PASSED`:
  `npm run security:wallet:runtime-boundaries` verifies targeted source
  boundaries for admin unfreeze backing checks, crypto manual-review holds,
  webhook signature-before-mutation ordering, debit-before-provider dispatch,
  original-debit refund provenance, and completed-only value reveal. This is
  repository source evidence, not deployed endpoint, provider, or database
  proof.
- `LOCAL_PROVIDER_ADAPTER_MOCK_TEST_PASSED`:
  `npm run security:wallet:adapters` covers no-network SMM, DaisySMS, iStar,
  Bitrefill, SageCloud bills, and SageCloud withdrawal adapters. Paused,
  frozen, insufficient-funds, and changed-idempotency requests make zero mock
  provider calls; successful orders dispatch once; exact replay does not
  redispatch; timeout holds `outcome_unknown` without blind refund; provider
  failure refunds once. This is mock evidence, not provider sandbox/dashboard
  proof.
- `LOCAL_SUPPLIER_OUTCOME_TEST_PASSED`:
  `npm run security:wallet:suppliers` covers local unknown supplier outcomes,
  late success, definitive failure refunds, duplicate callbacks, SMM partial
  refunds, and Daisy terminal statuses. This is local policy evidence, not
  provider sandbox/dashboard proof.
- `LOCAL_PROVIDER_DECISION_TEST_PASSED`: `npm run security:wallet:providers`
  covers local Ercas/PocketFi no-credit decisions for wrong wallet, pending or
  failed provider state, definitive failure/mismatch pending-evidence closure,
  amount/currency/merchant/environment mismatch, invalid signatures, duplicate
  references, and partner payments during the partner API pause. This is not a
  substitute for provider sandbox/dashboard verification.
- `LOCAL_FULFILLMENT_DECISION_TEST_PASSED`:
  `npm run security:wallet:fulfillment` covers local dispatch/reveal policy for
  authorization, frozen state, global pause, unknown supplier outcomes, and
  pre-capture versus post-capture failure handling. This is not a substitute
  for worker/outbox/provider tests.
- `READONLY_RECONCILIATION_COMMAND_CREATED`: `npm run security:wallet:reconcile`
  produces an owner-controlled read-only report for one user. It refuses to run
  without `TALLYSTORE_RECONCILE_ENV`, `TALLYSTORE_RECONCILE_READONLY`, a target
  user/email, Supabase credentials, and `--allow-production` for production.
- `STAGING_DB_SECURITY_TEST_PACK_CREATED`: `docs/security/wallet-db-security-test-pack.sql`
  provides rollback-based adversarial DB checks for restricted-role profile
  writes, wallet RPC permissions, legacy balance RPC grants, direct ledger
  writes, unbacked purchase denial, idempotency conflicts, pending-payment grant
  checks, and partner data pause.
- `LOCAL_SUPABASE_NOT_AVAILABLE`: Docker is not installed/running in this
  environment, so local Supabase database containers cannot be inspected or
  started here.

Not run:

- `LOCAL_DB_SECURITY_TESTS_PASSED`: not run because local Supabase/Postgres is
  unavailable without Docker.
- `LOCAL_DB_ROW_LOCK_TESTS_PASSED`: not run.
- `PRODUCTION_VERIFICATION_PENDING_OWNER`: required before claiming production safety.


