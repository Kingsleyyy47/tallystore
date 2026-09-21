# Wallet Security Incident Final Report

Prepared: 2026-09-19

This report is repository-scoped. It does not claim production safety until the
owner deploys the matching migrations/functions/app and verifies live database
grants, provider settings, active workers, and affected-account evidence.

## Verification Labels

- `SOURCE_REVIEWED`: repository source or migration was inspected.
- `PATCH_IMPLEMENTED`: repository change exists.
- `STATIC_CHECK_PASSED`: covered by `npm run security:wallet`.
- `LOCAL_BUILD_OR_TYPECHECK_PASSED`: local build/type/lint evidence exists.
- `LOCAL_DB_SECURITY_TESTS_PENDING`: staging/local Supabase execution required.
- `PROVIDER_TEST_PENDING`: provider sandbox/dashboard or route-specific runtime
  proof still required; local no-network provider mocks may be recorded
  separately where they passed.
- `PRODUCTION_DEPLOYMENT_PENDING`: owner has not proven it live.
- `PRODUCTION_VERIFICATION_PENDING_OWNER`: owner-only live evidence needed.
- `HISTORICAL_CAUSE_UNPROVEN`: repository review cannot identify the past actor
  or exact exploit path without live logs/provider records.

## Executive Finding

The incident class is unsupported value reaching paid fulfillment. The current
repository patch reduces immediate loss by closing partner API access, pausing
unsafe paid surfaces, requiring wallet-engine debit/refund paths for mapped
routes, hardening payment verification, blocking direct ledger/profile balance
mutation, and documenting production verification requirements.

The exact historical cause remains unproven from repository evidence alone.
Possible paths include prior direct balance writes, forged or replayed payment
callbacks, privileged/admin adjustments, legacy RPCs, incomplete provider
verification, old deployed code, or missing production grants. Live logs and
provider evidence are still required.

## Prompt Coverage Notes

The repository artifacts intentionally preserve the prompt's three-part model:
funding provenance, accounting consistency, and delivery authorization.
Trusted principal can increase only through a verified gateway deposit or an
approved admin credit. Refund conservation means refunds restore a prior
trusted debit and do not create principal; new refund rows must link to the
original trusted-principal-authorized debit by transaction ID, purchase
idempotency key, protected source-order metadata, or original purchase
reference, and that original debit must carry positive
`trusted_principal_debit_amount` evidence written by the wallet engine. A
deposit row with only an
`external_payment_id` is not enough: Ercas deposits require matching
server-created pending-payment evidence, PocketFi deposits require matching
webhook-log evidence, and `metadata.verified_amount_ngn` must match the posted
credit amount. Idempotency, provider verification,
direct ledger writes, protected profile fields, fulfillment pause behavior,
`wallet_security_events`, and production permissions are tracked separately so
local repository checks cannot be mistaken for owner-side production proof.
Routes must remain paused until the owner completes the staging, provider, and
production verification checklist for the specific route being reopened.

## Vulnerable Or Suspicious Paths

| Path | Source finding | Risk class | Repository status |
| --- | --- | --- | --- |
| Public partner API | Partner checkout surface could sell through trusted partner keys while wallet review was active. | Deliver before fully verified authorization. | `PATCH_IMPLEMENTED`: public route returns `PARTNER_API_PAUSED`; Edge Function hard-paused; existing partners inactive by migration. |
| PocketFi bridge | Public Vercel bridge previously reserialized parsed bodies and could inject server secrets into webhook requests. | Broken signature verification boundary / public secret-assisted calls. | `PATCH_IMPLEMENTED`: raw-body proxy, verification header required, no secret injection. |
| Legacy Ercas Vercel webhooks | Older public routes existed beside the server-verified credit function. | Fake or stale callback credit path. | `PATCH_IMPLEMENTED`: legacy routes return `410`. |
| NOWPayments crypto auto-credit | Crypto top-up could become spendable despite fake/disappearing/partial crypto concerns. | Unsupported funding. | `PATCH_IMPLEMENTED`, `LOCAL_PROVIDER_DECISION_PASSED`: auto-credit hard-disabled; local provider model holds partial/expired/unknown/unverified/underpaid/wrong-identity crypto payments and holds verified finished payments for manual review only. |
| Legacy balance RPCs | Older RPCs could change balances outside the wallet engine if callable. | Arbitrary value mutation. | `PATCH_IMPLEMENTED`: revoked/disabled for browser roles; production grants still need verification. |
| Direct profile/privileged-field writes | Client/server profile updates could bypass ledger or alter financial/security identity if grants/triggers allowed. | Arbitrary value mutation, unsuspension, role escalation, or payment-account hijack. | `PATCH_IMPLEMENTED`: profile balance/privileged-field guards, direct-write audits, and narrow service-role-only RPCs for legitimate PocketFi, referral, suspension, and staff-role writes. |
| Direct `transactions` writes | Ledger rows could be inserted/updated outside the wallet engine. | Fabricated funding evidence. | `PATCH_IMPLEMENTED`: direct ledger writes skipped and audited unless wallet engine flag is set. The trusted-principal trigger is scoped to wallet-engine inserts so it cannot raise before the direct-write audit trigger and erase the audit evidence. |
| Referral-to-wallet movement | Referral rewards could be confused with spendable trusted principal during incident review. | Unsupported or ambiguous value movement. | `PATCH_IMPLEMENTED`: backend referral withdrawal is hard-paused and the frontend no longer calls the client helper or invites referral-to-wallet movement. Referral rows are excluded from trusted principal. |
| Chargebacks/payment reversals | Reversed payments need to remove backing and block spending without direct balance edits or clamping debt to zero. | Debt preservation / backed-funds correction. | `PATCH_IMPLEMENTED`: wallet engine supports `chargeback` debt posting; admin route/UI has a controlled manual `record_chargeback` action that posts through the wallet engine and places the customer into review. Provider-specific automated chargeback ingestion still requires provider proof. |
| Product/SMM/SMS orphan retries | Debit could exist without matching order, then retry could replay into fresh delivery. | Deliver after ambiguous financial state. | `PATCH_IMPLEMENTED`: orphan-ledger retry blocks for product, SMM, and SMS. |
| Live supplier fallback/restock | Supplier calls could occur before fully proven backed funds. | Paid provider loss. | `PATCH_IMPLEMENTED`: live fallback and restock routes default-paused/hard-paused. |

## Fake Gateway Trigger Assessment

| Provider/surface | Can fake trigger credit after patch? | Evidence | Remaining proof |
| --- | --- | --- | --- |
| Ercas | Source says no: browser success and legacy Vercel callbacks do not credit; `verify-and-credit-wallet` requires server-created pending payment, provider verification, matching user, matching amount, and `metadata.verified_amount_ngn`. Deposit-like rows without matching pending-payment evidence do not count as trusted principal. | `STATIC_CHECK_PASSED` | Sandbox tests for wrong user, wrong amount, duplicate, missing pending row, missing verified amount, fake external ID, and failed/pending provider status. |
| PocketFi | Source says unsigned/mismatched webhooks should not credit; duplicate conflicts are rejected; trusted-principal calculation requires a matched `pocketfi_webhook_logs` row and matching verified amount. | `STATIC_CHECK_PASSED` | Sandbox signed/unsigned/replay tests, fake external-ID ledger tests, and deployed raw-body verification. |
| NOWPayments | Source and local provider-decision model say no auto wallet/crypto credit; finished payments are manual-review only. | `STATIC_CHECK_PASSED`, `LOCAL_PROVIDER_DECISION_PASSED` | Confirm deployed env cannot reopen auto-credit and provider dashboard URLs point to current function. |
| iStar | Source says failed-order refunds require raw-body HMAC. | `STATIC_CHECK_PASSED` | Sandbox duplicate invalid/valid callbacks and refund idempotency. |

## P0 Containment Coverage

- Partner API closed in public Vercel route and Supabase Edge Function.
- Existing partner records paused by migration.
- Partner tables hardened against direct browser reads and writes.
- Bills, Bitrefill/gift cards, withdrawals, crypto top-up, SMM order creation,
  SMS OTP purchases, Telegram order creation, referral withdrawal, live account
  fulfillment, manual restock, and auto restock fail closed.
- NOWPayments crypto auto-credit is hard-disabled.
- Legacy Ercas webhooks are gone.
- Legacy crypto transfer UI/RPC is disabled.
- Wallet debits/refunds for mapped routes use `apply_wallet_transaction`.

## Permanent Financial Changes

- `apply_wallet_transaction` is the controlled wallet writer.
- Wallet rows are locked with `FOR UPDATE`.
- Idempotency conflicts return `IDEMPOTENCY_CONFLICT`.
- The wallet engine sets transaction-local ledger/profile authorization flags
  only around its own ledger and profile balance/freeze updates, then clears
  them.
- Wallet purchases compute backed funds from approved admin credits, verified
  gateway deposits with matched provider evidence, eligible refunds, and
  previous completed debits.
- Unbacked purchase attempts return `WALLET_UNBACKED_FUNDS` and freeze
  financial access before delivery.
- Direct ledger writes are skipped/audited, and the trusted-principal trigger is
  scoped to wallet-engine inserts so direct-write audit rows survive.
- Protected profile fields are preserved/neutralized, and legitimate protected
  writes are constrained to narrow database RPCs rather than broad service-role
  `profiles.update()` calls.
- New ordinary profile balances start at zero.
- Admin credits count as trusted backing only with approving actor evidence, matching approved_by metadata, approval reference, and reason;
  staff/correction/generic credits do not create trusted product-spend principal
  unless reposted through the approved admin-credit path.
- Refunds are capped as restoration of previous trusted-principal-authorized
  debits with positive `trusted_principal_debit_amount`, not treated as new
  external funding. The wallet engine and trusted-principal trigger reject
  refund rows that do not identify the original debit, lack trusted debit amount
  evidence, or exceed the remaining amount of that linked trusted debit.
  Existing completed loose refund rows without original-debit linkage, or with
  only forged boolean trusted metadata, are treated as review evidence only and
  cannot restore trusted spend capacity.
- The fraud ledger scanner uses the same trusted-principal rule and excludes
  generic `credit` rows. System-generated integrity findings use the separate
  `wallet_review_required` hold so they block spending and fulfillment without
  blocking read-only order history, deposits, wallet activity, or support.
  Manual account suspension and financial-review resolution remain admin actions.

## Fulfillment Boundary Changes

- Product credentials and local inventory now use
  `authorize_product_purchase` and `complete_product_purchase`: trusted funds,
  the wallet reservation, inventory reservation, and a non-delivered order are
  committed before credentials are loaded; completion captures the hold, stores
  credentials, and marks the reserved inventory sold in one transaction.
  A completion or inventory conflict rolls the transaction back rather than
  leaving a debit plus unsold/undelivered inventory.
- SMM, SMS OTP, and Telegram order creation are now default-paused by server
  flags. If later reopened, SMM creates a local order and calls the panel only
  after wallet-engine debit; SMS debits, creates a pending local order, then
  allocates a Daisy number; Telegram creates a local order, debits, then calls
  iStar, and debit-failed local orders are kept as `failed` evidence instead
  of being deleted.
- iStar failure refunds require raw-body HMAC verification.
- Bills, Bitrefill, and withdrawals create local rows before wallet debit and
  keep debit-denied rows as `failed` `wallet_debit` evidence instead of
  deleting them. Withdrawal provider-failure refunds now carry the original
  debit transaction id, debit idempotency key, original reference, and
  `crypto_withdrawals` source-order provenance.
- Bills, Bitrefill, withdrawals, crypto top-up, referral withdrawal, partner
  API, live supplier fallback, and restock remain paused pending route-specific
  provider/concurrency tests.

## Commands Run

Current local verification is recorded in `docs/security/wallet-test-report.md`.
The latest relevant commands passed:

```text
npm run security:wallet
npm run security:wallet:local
npm run security:wallet:admin-review
npm run security:wallet:customer-ui
npm run security:wallet:db-pack -- --help
npm run security:wallet:db-concurrency -- --help
npm run security:wallet:deployed-smoke -- --help
npm run security:wallet:deploy-manifest
npm run security:wallet:evidence
npm run security:wallet:handoff
npm run security:wallet:audit
npm run security:wallet:source-mutations
npm run security:wallet:provider-evidence -- --format json
npm run security:wallet:provider-evidence -- --filled-template
npm run security:wallet:provider-evidence -- --self-test
npm run security:wallet:adapters
npm run security:wallet:fulfillment
npm run security:wallet:migrations
npm run security:wallet:model
npm run security:wallet:outbox
npm run security:wallet:providers
npm run security:wallet:trusted-principal
npm run lint
npm run build
node scripts/wallet-reconcile-readonly.mjs --history-csv "C:\Users\HP ELITEBOOK\Downloads\Supabase Snippet Untitled query (1).csv" --json
npx eslint scripts/security-wallet-check.mjs scripts/wallet-reconcile-readonly.mjs scripts/wallet-model-sequence-test.mjs scripts/wallet-provider-decision-test.mjs scripts/wallet-fulfillment-decision-test.mjs api/webhook-pocketfi.ts api/webhook-istar.ts --max-warnings=0
npx tsc --noEmit --pretty false
git diff --check -- docs/security/... scripts/security-wallet-check.mjs api/webhook-pocketfi.ts
```

The static guard currently reports 89 checks passing, including this
route inventory, env/secret inventory, wallet security event forensic sink,
request-forensics metadata on high-risk purchase ledgers and denied-purchase
freeze events,
production evidence register coverage,
browser payment success/callback pages being unable to create wallet credit,
the mutation and fulfillment maps,
final-report artifact, the partner admin mutation read-only lock,
completed-only customer credential reveal, frozen-account purchase route
ordering, future-function default execute revocation,
Ercas timeout retry/no-provisional-credit handling,
provider payment identity uniqueness, offline CSV reconciliation/deduplication
with derived analysis files treated as support-only rather than raw totals,
local security-suite coverage,
deployment-manifest coverage,
owner-handoff coverage,
incident completion-audit coverage,
guarded staging DB runner coverage,
guarded real-Postgres concurrency runner coverage,
deployed denied-route smoke coverage,
provider evidence template, fillable evidence file, and filled-evidence
validator coverage,
wallet model generated-sequence coverage, wallet concurrency model coverage,
outbox/queue dispatch decision coverage,
route-decision coverage, refund-conservation model coverage, provider decision coverage,
provider-adapter mock coverage,
supplier-outcome coverage,
admin-review decision and admin/customer transaction-display coverage, including
typed admin/staff/chargeback debits rendering negative, refunds rendering as
restorations rather than deposits, wallet total deposits being limited to actual
deposit/top-up types, and admin/staff/promotion/correction/referral credits
being labelled separately from top-ups,
incident migration static-safety coverage,
Ercas provider identity mismatch rejection, fulfillment decision coverage,
hostile quantity/price input validation, mapped route
idempotency-content binding, wallet-engine refund caps, refund-owner binding
and original-debit provenance across mapped refund paths, forged-webhook rejection
before customer punishment or credit, ordinary insufficient-funds decline
without fraud suspension, approved admin-credit actor and approval-metadata evidence,
frozen-wallet incoming-funds recording without auto-unfreeze, wallet-engine
chargeback debt preservation, admin unsuspend wallet-backing reconciliation,
admin absolute-plus-relative date display, refund conservation staging
coverage including completed loose-refund history denial, referral-to-wallet UI
pause coverage, and chargeback debt staging coverage.

The local suite currently runs 50 repository-local checks, including `npx deno`
type checks for all 37 local Supabase Edge Function entrypoints, guarded
DB-concurrency runner help/self-test, guarded DB-security runner help/self-test,
read-only reconciliation help/self-test, deployed-smoke help/self-test,
owner-denied probe validation, production-evidence coverage/self-test, provider
fillable-evidence generation, provider-evidence validator self-test,
deployed-version evidence generation, fillable deployed-version evidence
generation, and a deployed-version validator self-test.
The incident
completion audit dynamically confirms 37 local wallet-security scripts are
represented in the repository, parses all 80 regression-matrix rows, and reports
the remaining proof gaps explicitly. Staging SQL rows, patch/runtime rows,
provider rows, concurrency rows, and production-owner rows still require
stronger evidence. It also includes the source-mutation audit that blocks direct
protected profile-balance writes, legacy wallet RPC calls, and direct ledger
mutations outside the documented balance-neutral admin repair path.

Full `npm run lint` also passed with 0 errors and 25 existing warnings. Full
`npm run build` passed; the remaining Vite output was browser-data,
mixed static/dynamic import, bundle-size, and PWA generation notices, not
compile failures.

## Not Run

- Supabase migrations against local/staging Postgres.
- Restricted-role RLS/grant tests as `anon`, `authenticated`, and
  `service_role`.
- Effective deployed privilege tests. The migration-safety script checks SQL
  text for dangerous browser grants/function exposure, but it does not replace
  running those migrations and inspecting effective privileges in Postgres.
- Postgres row-lock/concurrency tests. Local concurrency model tests passed,
  but real database lock/fault-injection tests still require staging Postgres.
- Live provider sandbox/dashboard tests. Local no-network provider-decision,
  provider-adapter, supplier-outcome, and fulfillment-decision tests passed, but
  they do not prove provider dashboard configuration or real provider contracts.
- Deployed Edge Function version and runtime configuration checks. Local Deno
  source type checks now pass for all 37 Edge Function entrypoints, but that
  does not prove the deployed Supabase project is running the same code with
  the intended secrets and function settings.
- Production deployed-version checks.
- Live provider dashboard verification.
- Historical root-cause confirmation from logs.

## Required Owner Deployment Actions

1. Preserve affected-account, provider, webhook, order, and ledger evidence.
2. Apply migrations in timestamp order.
3. Deploy changed Supabase Edge Functions.
4. Redeploy Vercel app.
5. Keep paused env flags disabled.
6. Run read-only production query pack and one-account reconciliation reports.
7. Run staging DB security test pack before treating database grants as safe.
8. Verify provider webhook URLs/secrets and duplicate behavior.
9. Verify no old workers/routes remain active.
10. Reopen only routes whose row in the regression matrix has the required
    staging, provider, concurrency, and production evidence.

## Remaining Risks

- Historical cause and actor are not proven.
- Production may still be running older code until owner deploys.
- Production grants/RLS/triggers may differ from repository migrations.
- Provider behavior may differ from assumptions until live sandbox/dashboard
  checks or owner-approved provider contract evidence is collected.
- Reserve-first holds and transactional outbox/worker-claim behavior are now
  locally modeled, including valid reservations, stale queued authorization
  denial, post-commit recovery, pre-commit rollback, and duplicate-worker
  dispatch prevention. The active local product route is migrated to the
  database-backed reserve/capture boundary. Additive database tables plus
  service-role-only reservation and outbox RPCs exist in migrations, but
  provider-backed routes are still paused rather than being treated as
  reserve-first. Route-level database partial-refund enforcement and
  chargeback/debt workflow also remain pending across provider routes. Local
  refund-conservation tests cover legitimate partial refunds, duplicate refund
  replay/conflict, owner mismatch, missing original debits, and over-refund
  denial; mapped refund routes also carry normalized `source_order_id` and
  `source_order_table` metadata where an order or transaction row exists.
- A privileged owner/superuser or compromised service-role secret remains
  outside the protection boundary of ordinary runtime role hardening.

## Supporting Artifacts

- `docs/security/wallet-financial-model.md`
- `docs/security/wallet-state-machine.md`
- `docs/security/wallet-mutation-map.md`
- `docs/security/wallet-fulfillment-map.md`
- `docs/security/wallet-regression-matrix.md`
- `docs/security/wallet-db-security-test-pack.sql`
- `docs/security/wallet-readonly-query-pack.sql`
- `docs/security/wallet-owner-verification-checklist.md`
- `docs/security/wallet-production-evidence-register.md`
- `docs/security/wallet-deployment-manifest.md`
- `supabase/migrations/20260919017000_create_wallet_security_events.sql`
- `supabase/migrations/20260919018000_capture_wallet_security_events.sql`
- `scripts/security-wallet-check.mjs`
- `scripts/wallet-deployment-manifest-check.mjs`
- `scripts/wallet-migration-safety-test.mjs`
- `scripts/wallet-outbox-decision-test.mjs`
- `scripts/wallet-reconcile-readonly.mjs`
