# Wallet Security Test Report

Prepared: 2026-09-19

This report records what has been verified from the repository and what still
requires a real Supabase/Postgres or production owner check. It is not proof
that the live service is safe until the migrations, Edge Functions, Vercel app,
provider settings, and active workers are deployed and verified.

## 26 September Local Recheck

`node scripts/wallet-local-security-suite.mjs --compact` completed with
87/87 local checks passed on the current worktree. This includes the SMS
staff-response privacy fixture, Fraud Review classification model, isolated
financial-truth SQL test, source leak checks, and deployment-manifest coverage.
Docker and `psql` are not available here, so real staging restricted-role,
concurrency, deployed-route, provider, and production checks remain NOT RUN.
The source leak scan still warns that credentials previously committed in
`.env` require owner rotation; a passing current-source scan does not revoke
those credentials.

## 25 September SMS Cancellation Boundary

Source review found that `smsbus` and `manage-staff` could refund after an
unconfirmed Daisy cancellation, a lost allocation response, or
`NO_ACTIVATION`. Daisy's documented `setStatus` success response is
`ACCESS_CANCEL`; `getStatus` reports `STATUS_CANCEL` for a cancelled rental,
while `NO_ACTIVATION` denotes an invalid/missing activation ID. The repository
now holds uncertain outcomes for review, requires confirmation before an
automatic cancellation refund, and conditionally transitions order status so
a stale callback cannot overwrite a terminal/refunded order. The local
`wallet-sms-cancellation-test.mjs` handler fixture and supplier-outcome model
passed, as did the two changed Edge-function Deno type checks. The complete
compact local suite passes 87/87 on the current tree. One earlier rerun hit a
native Node out-of-memory crash in the unrelated admin-settings fixture; that
fixture passed alone and the subsequent full suite passed. A follow-up guard
denies confirmed-cancellation refunds when a code is already recorded. Provider
sandbox, real-Postgres concurrent status/refund tests, and deployed old-worker
retirement are NOT RUN; SMS order creation remains paused by default.

The Fraud Review UI formerly counted review flags as active holds even when
canonical `spending_blocked` was false. The Holds filter and blocked headline
now use that canonical decision; a separate Review flags tab retains those
cases for investigation. `node scripts/fraud-review-ui-test.mjs`,
`npx tsc --noEmit`, changed-file ESLint, and `npm run build` passed. This is
presentation/classification only; it does not change wallet authorization or
prove deployed customer counts. The local source leak scan returned zero
current errors and warned that historical provider credentials still need
owner rotation.

The service-role SMS admin order list also sent cross-customer OTP messages to
any permitted SMS staff browser; its cancellation response could expose a raw
provider payload. Both responses now use a summary without messages or
provider payload. A no-network handler test executes `admin_sms_orders` with
a secret-bearing fixture and checks those fields are absent while `has_code`
preserves the operator stale-order indicator. Customer self-
history remains unchanged. Admin, staff, and customer cancellation screens now
distinguish confirmed refunds from outcome review. This has not been checked
against a deployed staff session. Deno, TypeScript, changed-file lint, the
frontend build, the no-network route mock, and the isolated SMS-order privacy
fixture passed. The rebuilt browser asset leak scan returned zero current
errors; historical credential-rotation warnings remain.

## 25 September privileged-session boundary

Privileged Edge handlers now recheck `profiles.account_suspended` for the
requesting admin/staff actor. Queued staff action execution also rechecks the
staff actor. `node scripts/wallet-runtime-boundary-source-test.mjs`,
`node scripts/security-wallet-check.mjs` (92 checks), and
`node scripts/wallet-provider-error-leak-test.mjs` passed. The complete
`node scripts/wallet-local-security-suite.mjs --compact` run passed 80/80
repository-local checks, including all Edge-function Deno type checks.
`npm run build` passed with existing Vite chunk/import warnings, and
`git diff --check` found no whitespace errors in the touched files. No
deployed old-session test or production grant check was run.

The follow-up database audit found six direct admin RPCs that checked the
current role but not current suspension. The isolated PGlite fixture
`node scripts/wallet-admin-rpc-suspension-pglite-test.mjs` passed: it
reproduced suspended-admin access before migration `20260925017000`, denied
all six after migration, preserved active-admin access, and confirmed an
unexpected function body aborts without a partial rewrite. Deployed schema
and real JWT role probes remain owner-pending.

`node scripts/wallet-admin-audit-read-pglite-test.mjs` also passed against
the `20260925018000` policy change. It reproduces suspended-admin access to
financial audit rows and another customer's SMS order, then verifies denial
of those reads while preserving the caller's own SMS history. Real deployed
RLS/policy state and old-session JWT probes remain owner-pending.

`node scripts/wallet-order-history-pglite-test.mjs` passed after adding
`20260925019000`: it reproduces old suspended-admin cross-customer reads,
then verifies denial while active-admin investigation and customer
completed-order credential history remain available. The deployed view and
real-JWT behavior remain owner-pending.

The same admin-audit PGlite fixture now covers `20260925020000`: it
reproduces suspended-admin alert acknowledgement, then verifies the new
restrictive policy denies read/update even with an additional permissive
legacy policy. Active-admin acknowledgement still succeeds. Deployed policy
and real-JWT behavior remain owner-pending.

The admin-audit fixture also passed for `20260925021000`: all seven older
forensic read policies reproduced suspended-admin access before migration;
the restrictive active-admin policies denied suspended and ordinary callers
afterward, even with a permissive legacy policy present. Actual deployed
grants, extra policies, and old-session JWT behavior remain owner-pending.

`node scripts/wallet-admin-settings-pglite-test.mjs` passed for migration
`20260925022000`. It reproduced suspended-admin direct app/SMS settings
writes, then verified denial despite permissive legacy write policies.
Public storefront setting reads and active-admin writes remained available.
Deployed grants/policies and real-JWT checks remain owner-pending.

`node scripts/wallet-admin-audit-read-pglite-test.mjs` passed after adding
`20260925023000`: it reproduces suspended-admin telemetry reads, then
verifies active-admin and owner-only identity-link reads. The initial
admin-only restrictive SELECT broke customer `INSERT ... RETURNING` in the
fixture; the corrected migration explicitly preserves owner SELECT, and
the insert now passes. Deployed grants/policies and real-JWT probes remain
owner-pending.

`node scripts/wallet-base-financial-read-pglite-test.mjs` passed for
`20260925024000`: it reproduces suspended-admin cross-customer reads on
base `orders` and `transactions`, then verifies only self-history remains
for suspended admins and ordinary customers while active admins retain
investigation reads. Deployed grants/policies and real JWTs remain
owner-pending.

`node scripts/wallet-revenue-read-pglite-test.mjs` passed for
`20260925025000`. It reproduces suspended-admin cross-customer Revenue OS
reads and an anonymous read under an extra permissive policy, then verifies
owner/active-admin event scope, active-admin-only decision-audit scope, and
anonymous grant denial. Deployed grants/policies and real-JWT probes remain
owner-pending.

`node scripts/wallet-istar-signed-event-test.mjs` passed without network
access. A correctly signed body missing `event_type` was rejected despite a
forged `X-iStar-Event` header; malformed signed JSON, an unsupported event,
and a parsed-only body were also rejected before any database client was
created. `node scripts/security-wallet-check.mjs` passed 92 checks after its
source-order anchor was updated; targeted ESLint passed. Genuine provider
callback shape and deployed behavior remain owner-pending.

The expanded iStar handler mock passed stale success/failure outcome cases:
a failed callback reading an old processing snapshot made zero wallet RPCs
after completion had won; a stale completion could not overwrite failure;
an eligible signed failure made one refund RPC and its duplicate made none.
`node scripts/wallet-deno-edge-check.mjs` passed for all 37 Edge entrypoints
after the Telegram poll/admin refund pause. `node scripts/security-wallet-check.mjs`
passed 92 checks, and `node scripts/wallet-route-source-order-test.mjs` passed.
These mocks do not prove live PostgreSQL row-locking, provider delivery order,
or deployment state.

After pausing Telegram customer-poll/admin-cancel refunds and guarding late
order tracking writes, `npm run build` passed with the existing Vite chunk and
mixed-import warnings. Changed-file ESLint passed. The first complete local
suite run passed 85/86: `wallet-ambiguous-provider-outcome-test.mjs` still
required the removed poll-before-final refund behavior. After changing that
test to require review without a wallet credit, its focused run passed and
the complete compact suite passed 86/86. No live database, provider, or
supplier was used. A crash between webhook status transition and wallet
refund remains a staging/reconciliation case, not a proven atomic operation.

After the signed-event change, the complete compact local suite passed
86/86 checks. The completion audit accounted for 70 local security scripts;
the deployment manifest still accounts for 102 migrations. No live provider,
supplier, production route, or production database was queried.

After this migration, the complete compact local suite passed 85/85 checks.
The migration safety and deployment-manifest checks passed across 102
migrations, and the completion audit accounted for 69 local security scripts.
No production database, payment provider, or supplier was queried.

After migration `20260925022000`, the complete compact local suite passed
83/83 checks. The migration safety and deployment-manifest checks passed
across 99 migrations, and the completion audit accounted for 67 local
security scripts. No production database, provider, or supplier was queried.

Earlier, after the first three suspended-admin database migrations and the
bounded query-54 fixture update, the compact local suite passed 82/82 checks. The
migration safety and deployment-manifest checks passed across 96 migrations.
`node scripts/security-leak-check.mjs` reported zero current-source errors;
its historical credential and local `VITE_` warnings remain owner rotation
and deployment-configuration tasks. No live database or provider was queried.

## 25 September checkout-boundary verification

After the Ercas redirect/error, exact-kobo checkout, and purchase-response
changes, `node scripts/security-wallet-check.mjs` passed 92 checks;
`node scripts/wallet-provider-error-leak-test.mjs` and
`node scripts/wallet-runtime-boundary-source-test.mjs` passed; and
`npx deno check` passed for `create-wallet-topup`, `process-purchase`, and
`purchase-bitrefill`. The first full local-suite run passed 72/74: its two
failures were the new hostile-URL fixture matching the personal-email leak
heuristic and the new Edge environment variable missing from the inventory.
After correcting those checks, the full suite passed 74/74. `npm run build`
passed with Vite chunk/dynamic-import warnings, and a post-build
`node scripts/security-leak-check.mjs` found zero current errors. Its historical
credential and local `VITE_` warnings still require owner review and rotation.
These are local checks, not provider redirect, deployed grant, or live wallet
authorization proof.
The subsequent SMS error-boundary test passed for unknown database/provider
failures and known customer declines, and `npx deno check` passed for `smsbus`.
The aggregate suite passed 74/74 again after that additional edit.
After the PocketFi evidence-write guard, the focused webhook source-order
check and `npx deno check supabase/functions/webhook-pocketfi/index.ts` passed.
No simulated provider retry or live database failure injection was run.
After the referral response change, the focused leak test and
`npx deno check supabase/functions/apply-referral/index.ts` passed. The full
local suite passed 74/74 after both Edge edits.

## 24 September financial-truth verification update

The command table below includes earlier point-in-time counts. Current commands
run: `npm run security:wallet` passed 92 source checks;
`node scripts/wallet-migration-safety-test.mjs` passed across 58 migrations;
`node scripts/wallet-deployment-manifest-check.mjs` passed across 58 migrations;
`node scripts/wallet-incident-completion-audit.mjs` passed with 42 scripts and
80 regression rows; and the isolated PGlite financial-truth and policy tests
passed. The local suite's first 56-check run had 55 passing and one stale
documentation-count failure. After correcting that count,
`npm run security:wallet:local -- --compact` passed 56/56 checks before the
public-sales aggregate test was added. The final complete local run passed
57/57 checks after updating a static verifier's stale 89-check expectation.
After the neutral-evidence migration and display changes, a second complete
local run also passed 56/56. `npx tsc --noEmit`, targeted ESLint for the changed
frontend files, and `npm run build` passed. The Vite build emitted existing
chunk-size/dynamic-import warnings but no errors.
`node scripts/wallet-runtime-boundary-source-test.mjs` also verifies that every
mapped IP/user-agent ban query includes the purchasing customer ID. A mocked
guard execution confirms an unrelated customer sharing the IP and user agent
is not denied, while a ban for the current customer still denies. This is
source/local behavior; active deployed Edge versions remain owner evidence.
`node scripts/wallet-pglite-policy-test.mjs` reproduced an authenticated
browser inserting a forged admin security alert under the old policy, then
verified migration `20260924015000` denies that INSERT while preserving admin
read/acknowledge and service-role INSERT. Effective production grants and
any historical forged alerts remain owner-investigation items.
`node scripts/wallet-financial-truth-pglite-test.mjs` reproduced a neutral
admin repair falsely raising expected ledger balance from NGN 15,000 to
NGN 20,000, then verified migration `20260924016000` keeps the evidence row
without posting it as money. A similarly marked row with changed snapshots
still counts as a movement. The staging rollback pack now checks a real admin
repair against the deployed canonical reader. Admin/customer transaction
displays and exports now mark the neutral row as evidence with zero wallet
effect. That pack has not run here.
`node scripts/wallet-public-stats-pglite-test.mjs` reproduced anonymous reads
of exact revenue and product units through the old public RPCs. After migration
`20260924017000`, the same fixture denies those calls, preserves the public
order count and product-ID ranking, denies ordinary customer revenue reads,
and permits current admins and staff with `view_stats`. Production/staging
function definitions, grants, staff-permission write restrictions, and
mixed-version storefront behavior remain
owner verification items.

## Current Scope

The current repository patch is a P0 containment and hardening pass:

- Partner API public access is closed.
- Unsafe paid surfaces are paused by default.
- Wallet changes are routed through `apply_wallet_transaction`.
- Product, SMM, SMS, Telegram, bills, Bitrefill, withdrawal, top-up, admin, and
  webhook paths have been migrated or paused to reduce direct balance mutation
  and pre-authorization delivery.
- Database migrations define guards for protected profile fields, ledger
  authority, profile deletion, auth deletion, identity changes, catalog writes,
  and trusted-credit evidence.
- Separate source maps now track wallet mutation boundaries and paid fulfillment
  boundaries. The mutation map now includes the prompt-field crosswalk for path
  ID, caller/auth, runtime role, SQL/RPC target, input and source-of-funds
  validation, locking/idempotency, ledger writes, security-state effect, tests,
  and production evidence still needed. The fulfillment map now includes the
  prompt-field crosswalk for entry point, price source, order creation,
  authorization, reservation/capture, dispatch, supplier source, first
  irreversible action, retry/cancellation/refund, security checks, and coverage
  test.
- A T01-T80 regression matrix tracks source coverage, incident-migration static
  safety checks, staging SQL coverage, provider-test gaps, concurrency-test
  gaps, and production-owner verification.
- A dedicated financial model document defines backed funds, refund
  conservation, the local product reserve/capture boundary, paused
  provider-route policy, and review rules.
- A dedicated state-machine document defines account access, wallet financial,
  and service health states, plus the review/recovery decision matrix.
- A repository-scoped incident final report separates source findings, patches,
  tests run, tests not run, owner deployment actions, and remaining risks.

## Commands Run

| Command | Result | Evidence meaning |
| --- | --- | --- |
| `npm run security:wallet` | `PASSED` | Static source-level wallet guard passed 89 checks, including partner API closure, partner admin mutation read-only lock, partner data-layer pause, partner table grant hardening, production evidence register coverage, deployed-version evidence gating, future-function default execute revocation, legacy balance RPC retirement, pending-payment evidence hardening, browser payment success/callback pages being unable to create wallet credit, Ercas timeout retry/no-provisional-credit handling, Ercas definitive-failure pending-payment closure, provider payment identity uniqueness, verified provider evidence and amount matching for trusted deposit principal, Ercas provider identity mismatch rejection, money precision/currency/overflow boundaries, frozen-customer read-only order/support access, PocketFi duplicate-reference conflict handling, PocketFi raw-body bridge protection, deployed denied-route smoke coverage, provider evidence template coverage, admin and customer debit display/sign normalization, forged-webhook rejection before customer punishment/credit, ordinary insufficient-funds decline without fraud suspension, approved admin-credit actor and approval-metadata evidence plus balance-neutral admin repair exclusion, balance-neutral admin repair rows requiring a real admin actor, admin fraud-review and admin-unsuspend refund eligibility requiring linkage to trusted-principal-authorized debits, final hardened fraud-evaluator migration ordering, schema-safe admin-unsuspend transaction evidence loading, frozen-wallet incoming-funds recording without auto-unfreeze, fraud scanner no-auto-unsuspend and generic/staff/promotion/correction-credit exclusion, staging DB test-pack coverage, guarded staging DB runner coverage, guarded real-Postgres concurrency runner coverage, incident migration static-safety coverage, provider-adapter mock coverage, local security-suite coverage, deployment-manifest coverage, owner-handoff coverage, incident completion-audit coverage, wallet security event forensic sink/Admin review coverage, request-forensics metadata on high-risk purchase/provider-money ledgers, wallet-engine refund original-debit requirements and caps, refund-owner binding plus original-debit provenance across mapped refund paths, wallet-engine chargeback debt preservation, admin unsuspend wallet-backing reconciliation, refund conservation staging coverage, chargeback debt staging coverage, admin absolute-plus-relative date display, disabled crypto transfer RPC/UI, NOWPayments hard manual-review hold, service-role wallet engine grants, backed-funds purchase gate, direct-ledger guard, protected profile-field guard, narrow service-role-only profile writer RPCs, browser profile/signup mass-assignment protection, referral attribution/withdrawal authority, referral lookup casts, Ercas pending-payment binding, scheduled pending-payment recovery binding, iStar raw-body webhook verification and wallet-engine refunds, explicit authorization boundaries for JWT-disabled Edge Functions, paused paid surfaces, fulfillment ordering before supplier dispatch/value release, completed-only customer credential reveal, frozen-account purchase route ordering, hostile quantity/price input validation, mapped route idempotency-content binding, provider-money ordering for bills/Bitrefill/withdrawals and default-paused SMM/SMS/Telegram order creation, no direct server-side profile balance update literals, no direct wallet-ledger mutations outside audited repair, the guarded read-only reconciliation command, the wallet model generated-sequence test, the wallet concurrency model test, the outbox-decision test, the reservation-decision test, the route-decision test, the route-inventory check, the env-secret inventory check, the supplier-outcome test, the refund-conservation model test, the provider decision test, the fulfillment decision test, the incident mutation/fulfillment maps, the T01-T80 regression matrix and its defined-status glossary, the wallet financial model, and the incident final report. |
| `npm run security:wallet:local -- --compact` | `PASSED` | Local suite ran 50 repository-local checks successfully and reported environment probes: Supabase CLI `2.117.0` available; Docker, `psql`, and direct `deno` unavailable. It now dynamically compares `package.json` wallet-security scripts to local-suite coverage and reported 36 package wallet scripts, 36 local-suite script entries, and zero missing scripts. The suite uses `npx deno` for the all-Edge-Function type check and now runs provider fillable-evidence generation, the provider-evidence validator self-test, guarded DB concurrency runner help, guarded DB concurrency runner self-test, guarded DB security runner help, guarded DB security runner self-test, read-only reconciliation help, read-only reconciliation self-test, deployed-smoke help, deployed-smoke protected-header self-test, deployed-smoke owner-denied probe file validation, production-evidence register coverage, fillable production evidence generation, the production-evidence validator self-test, deployment-version evidence generation, fillable deployed-version evidence generation, the deployed-version evidence validator self-test, machine-readable deployment-plan generation, the deployment-plan validator self-test, and the paid-route reopening-readiness gate help/self-test. The DB concurrency runner self-test verifies fixture UUID parsing, SQL literal escaping, optional second-fixture NULL handling, database URL redaction, and generated SQL coverage for setup top-up evidence, purchase race, refund race, provider-identity race, durable unbacked-freeze proof, and cleanup without connecting to a database. The DB security runner self-test verifies rollback-pack success markers, protected profile write tests, fake-provider evidence rejection, refund-link and over-refund rejection, forged trusted-marker refund rejection, chargeback debt preservation, partner API/table authority coverage, ordinary test-user injection, and database URL redaction without connecting to a database. The read-only reconciliation self-test verifies CSV parsing/classification and proves loose refunds do not create trusted spendable funds in backing calculations without connecting to Supabase. The deployed-smoke self-test verifies built-in and owner-defined probes cannot override the runner-controlled smoke marker, owner probe JSON cannot override protected headers or carry secret-looking custom header values, and the dry validation command checks the owner probe file shape without contacting any deployed route. The production-evidence self-test verifies the evidence-register validator accepts a complete sanitized proof shape across 40 production areas and now validates a fillable JSON evidence file, rejecting missing, duplicate, unknown, pending/non-passed, timestamp-invalid, reference-missing, and secret-looking production proof rows without contacting production. The deployed-version self-test covers 40 deployment surfaces and rejects duplicate surfaces, invalid `verifiedAt` timestamps, altered expected fingerprints, mismatched SHA-256 fingerprints, dirty source without artifact approval, informal dirty artifact approval timestamps, missing per-surface required proof rows, pending required proof rows, unknown proof rows, missing proof references, and secret-looking evidence. The deployment-plan self-test verifies saved deployment plans reject stale migration lists, stale function deploy lists, missing rollback/reopen boundaries, and secret-looking values. The reopening-readiness self-test verifies the final gate rejects missing evidence files, pending production evidence, and deployed smoke output without owner denied probes. Each child check is bounded by `TALLYSTORE_WALLET_LOCAL_CHECK_TIMEOUT_MS` and each tool probe by `TALLYSTORE_WALLET_TOOL_PROBE_TIMEOUT_MS`, with timed-out children reported as explicit failed checks. This suite deliberately states it does not execute Supabase migrations, RLS grants, Postgres locks, deployed routes, provider sandboxes, or production configuration. |
| `npm run security:wallet:deno-edge` | `PASSED` | Deno type checks passed for all 37 local Supabase Edge Function entrypoints using `npx -y deno check --no-lock --node-modules-dir=auto`. This catches source-level Edge Function type errors across every local function, but does not replace deployed Supabase function verification, runtime secret checks, or provider sandbox tests. |
| `npm run security:wallet:db-pack -- --help` and `npm run security:wallet:db-pack -- --self-test` | `PASSED` | Guarded staging DB runner help renders and its no-database self-test passes. The full runner refuses production, requires `TALLYSTORE_DB_TEST_ACK=I_UNDERSTAND_ROLLBACK_TEST_MUTATIONS`, requires `psql`, injects an ordinary test profile id and separate current-admin fixture id into a temporary copy of `wallet-db-security-test-pack.sql`, bounds `psql` execution with `TALLYSTORE_DB_TEST_TIMEOUT_MS`, and expects the rollback success marker. The self-test verifies the SQL pack still has the rollback/success markers, verifies the placeholder test user is replaced before execution, and verifies database URLs are redacted from output without connecting to Postgres. The SQL pack now includes deployed-schema assertions for lingering `auth.users` and partner/API evidence cascades plus reserve/outbox RLS, browser privileges/policies, service-role access, constraints, idempotency indexes, order-table financial-authorization columns/indexes/status constraints, service-role outbox enqueue/claim/finish behavior, changed-payload idempotency conflict, suspended-wallet claim blocking, stale-reservation claim blocking, claim-owner finish enforcement, service-role reservation create/capture/release behavior, active-hold availability reduction, capture-through-wallet-engine proof, and release-without-refund proof. The full DB pack was not run here because `psql`/local Postgres are unavailable. |
| `npm run security:wallet:db-concurrency -- --help` and `npm run security:wallet:db-concurrency -- --self-test` | `PASSED` | Guarded real-Postgres concurrency runner help renders and its no-database self-test passes. The full runner refuses production, requires `TALLYSTORE_DB_CONCURRENCY_ACK=I_UNDERSTAND_COMMITTED_TEST_WALLET_MUTATIONS`, requires `psql`, requires an owner-controlled ordinary non-admin/non-staff test profile id, seeds a verified test top-up through `apply_wallet_transaction`, runs two concurrent over-total purchase calls and two concurrent linked refund calls through the same wallet engine, verifies exactly one purchase and one refund commit, and resets the supplied test wallet to zero. With `--second-test-user-id` or `TALLYSTORE_DB_SECOND_TEST_USER_ID`, it also seeds two pending-payment rows with the same provider identity across two ordinary wallets, races the credits, and verifies only one completed provider credit plus one consumed pending-payment row can commit. It also verifies an unbacked purchase denial persists the freeze state without inserting a purchase ledger row. The self-test verifies runner helper safety, including fixture UUID parsing, SQL literal escaping, optional second-fixture NULL handling, and database URL redaction, but explicitly does not claim real lock/concurrency proof. The full runner was not run here because it requires an owner-controlled staging/local database and fixture account. |
| `npm run security:wallet:deployed-smoke -- --help`, `npm run security:wallet:deployed-smoke -- --self-test`, and `npm run security:wallet:deployed-smoke -- --validate-owner-denied-probes docs/security/wallet-deployed-denied-probes.example.json` | `PASSED` | Safe deployed-route smoke runner help renders, its no-network self-test passes, and the example owner denied-probe file validates without network access. The full runner requires `TALLYSTORE_DEPLOYED_SMOKE_ACK=I_UNDERSTAND_NO_ORDER_CREATION`, a deployed base URL, and `--allow-production` for production. It sends denied/paused requests to partner API, legacy Ercas, PocketFi, and iStar webhook routes, with each request bounded by `TALLYSTORE_DEPLOYED_SMOKE_TIMEOUT_MS` or `--timeout-ms`. When `TALLYSTORE_SUPABASE_FUNCTIONS_BASE_URL` or `--functions-base-url` is provided, it also sends no-order probes to paused paid Edge Functions for bills, Bitrefill, withdrawals, crypto sell orders, SMM orders, SMS OTP purchases, Telegram orders, referral withdrawal, manual/auto restock, partner API, and live-account fulfillment. Without an owner-controlled auth header it accepts safe auth/JWT denial; with `TALLYSTORE_DEPLOYED_SMOKE_AUTHORIZATION` it verifies exact stable `*_PAUSED` codes for paused supplier-money routes and sends malformed product checkout payloads that must fail before order creation, wallet debit, provider dispatch, or value reveal. With a private `TALLYSTORE_DEPLOYED_SMOKE_OWNER_DENIED_PROBES` JSON file and acknowledgement, it can also run owner-controlled denied checkout probes for zero balance, low balance, frozen old-token product/SMM/SMS/Telegram attempts, frozen provider-money attempts for bills/Bitrefill/withdrawals, and stale-client-balance cases, requiring `body.success !== true` plus the configured denial reason. Built-in paused-route probes, built-in malformed-checkout probes, and owner-defined probes all force the runner-controlled `smoke` marker; owner probe JSON cannot override protected headers (`authorization`, `content-type`, `x-tally-smoke-test`, `cookie`, `host`, or `x-cron-secret`), cannot override the runner-controlled `smoke` marker, and rejects secret-looking custom header or payload values; the self-test and dry validation cover those denial branches and file-shape checks without contacting deployed infrastructure. Auto-restock exact pause-code verification also requires `TALLYSTORE_DEPLOYED_SMOKE_CRON_SECRET` because that route validates `x-cron-secret` before its pause gate. |
| `npm run security:wallet:deploy-manifest`, `--plan`, and `--self-test` | `PASSED` | Deployment manifest checker verified 35 hardening migration files, 3 older replay migrations that were made no-op/suspend-only, 27 required hardening Supabase functions, 32 function deploy commands, 32 currently changed function entrypoints from `git status`, the changed shared-function-code redeploy warning, 9 existing security-sensitive functions to verify, 8 JWT-disabled functions from source `config.toml`, 16 Vercel/site surfaces, and 11 required pause flags. Plan mode emits pre-deploy gates, `supabase db push`, all function deploy commands, Vercel/site surfaces, required pause flags, post-deploy proof fields, rollback boundaries, and evidence-generation commands as JSON. The saved-plan validator accepts a current generated plan and rejects stale migration lists, stale function deploy lists, missing rollback/reopen boundaries, and secret-looking values. |
| `npm run security:wallet:env-secrets` | `PASSED` | Env/secret inventory checker scanned 82 env variables across 261 source files, verified 29 server-only/operator variables and 11 incident pause flags are documented, rejected browser-exposed provider secret names, and confirmed `.env.example` uses placeholders instead of real-looking provider keys. |
| `npm run security:wallet:evidence`, `--filled-template`, and `--self-test` | `PASSED` | Production evidence checker verifies the evidence-register labels, standard proof fields, generated JSON evidence field names (`evidenceId`, `verifiedBy`, `verifiedAt`, `evidencePathOrLink`), parseable absolute timestamp requirement for `verifiedAt`, 40 production proof areas, unknown-outcome supplier states, provider capability rows, route reopening gate, dirty-source artifact approval, and staging SQL evidence template. It now also generates and validates a fillable JSON production evidence file for all 40 production areas. The self-test verifies the validator accepts a complete sanitized proof shape and rejects missing evidence labels, missing standard proof fields, missing provider rows, missing dirty-source artifact approval rows, missing reopening safety-boundary text, missing production areas, duplicate production areas, unknown production areas, informal timestamps, missing references, pending/non-passed rows, and secret-looking references. It does not replace collecting that evidence after deployment. |
| `npm run security:wallet:handoff` | `PASSED` | Owner-handoff checker verified 9 documents: the owner checklist, final report, test report, deployment manifest, regression matrix, production-evidence register, route inventory, env/secret inventory, and wallet state-machine document preserve production proof boundaries, 12 paused surfaces, standard human evidence fields, generated JSON evidence fields (`evidenceId`, `verifiedBy`, `verifiedAt`, `evidencePathOrLink`), parseable absolute timestamp wording, deployed-version evidence tooling, provider-evidence tooling, and required owner actions. |
| `npm run security:wallet:audit` | `PASSED` | Incident completion audit verified the required security-prompt deliverables, B15 final-report questions, T01-T80 regression matrix rows, evidence labels, owner proof boundaries, the wallet state-machine document, provider-evidence validator coverage, deployed-version evidence coverage, and dynamically discovered all 54 local wallet-security scripts represented in the repository. The audit parses all 80 regression rows, fails on any matrix status not defined in the glossary, and reports unresolved proof boundaries explicitly; provider, staging, concurrency, and owner proof remain separate from local source checks. |
| `npm run security:wallet:route-inventory` | `PASSED` | Route inventory checker verified `docs/security/wallet-route-inventory.md` classifies 5 Vercel API routes, 37 Supabase Edge Functions, 8 JWT-disabled Edge Functions from source `config.toml`, 17 frontend value surfaces, 13 value-delivery functions, and 9 funding/webhook functions, including every value-delivery, funding/webhook, paused/manual-review, catalog/read-only, admin/internal, and telemetry/utility surface currently in the repository. It also verifies every paused value-delivery Edge Function has a matching deployed smoke denied/paused probe before route reopening evidence can be collected. |
| `npm run security:wallet:route-source-order` | `PASSED` | Route source-order audit verified the local product route checks authorization before loading credentials and completes through atomic reserve/capture functions; mapped provider surfaces keep purchase-permission checks before wallet debits or provider dispatch, local order/evidence rows before external provider calls, completed-only credential reveal, failed evidence preservation, reopened-route idempotency binding, exact existing-order replay handling, and no mixed debit-first hold/refund operations. It covers product, SMM, SMS, Telegram Stars, Telegram Premium, and order-history credential reveal; SMM/SMS/Telegram pause gates and Telegram frontend/server/database idempotency coverage remain included. It does not replace deployed endpoint tests. |
| `npm run security:wallet:adapters` | `PASSED` | No-network provider-adapter mock test covered SMM panel, DaisySMS, iStar, Bitrefill, SageCloud bills, and SageCloud withdrawals. It asserts paused, frozen, insufficient-funds, unavailable-financial-state, and changed-idempotency requests make zero provider calls; successful requests dispatch once; exact idempotent replay does not redispatch; timeout becomes `outcome_unknown` without blind refund; provider failure refunds once; provider failure refunds carry original debit provenance; and naked provider refunds are rejected. It does not replace provider sandbox/dashboard contracts. |
| `npm run security:wallet:admin-ui` | `PASSED` | Local admin UI model verifies admin user-detail dates include absolute timestamp, timezone, and relative age; future and invalid dates do not produce contradictory past labels; admin/staff debits display as negative even when stored positive; and refund/approved-credit rows display as positive restorations. The aggregate static guard also verifies the AdminPage recent-transaction render path derives `+`/`-` signs and styling from `getWalletTransactionDisplayAmount`. It does not replace visual/browser QA. |
| `npm run security:wallet:customer-ui` | `PASSED` | Local customer UI model verifies wallet history and dashboard recent activity render typed `admin_debit`, `staff_debit`, and `chargeback` rows as negative even when legacy rows store positive amounts; render negative-stored refunds/admin credits as positive restorations; keep refund restorations separate from both deposits and purchases; keep wallet total deposits limited to actual deposit/top-up transaction types; label dashboard refunds as restorations rather than top-ups; label admin/staff/promotion/correction/referral credits separately from top-ups; and avoid fake signs on neutral zero-value rows. It does not replace visual/browser QA. |
| `npm run security:wallet:frozen-access` | `PASSED` | Local frozen-access model verifies suspended customers can open read-only order history and support routes, cannot open purchase/checkout routes, can still copy/download completed credentials from history, do not see unfinished credentials, do not see purchase-again prompts, and keep support access with a wallet-review banner. It does not replace deployed route tests or browser visual QA. |
| `npm run security:wallet:admin-review` | `PASSED` | Local admin-review decision model verifies trusted principal comes only from verified gateway deposits and admin credits with matching approval metadata, excludes generic/staff/promotion/unapproved admin/balance-neutral repair credits, keeps refunds out of principal, reports raw completed refunds separately from linked eligible refunds, blocks unbacked unsuspension, blocks non-admin reviewers and unresolved supplier exposure, confirms staff credit requests queue for admin review before they can become trusted principal, confirms manual chargebacks require admin approval, a positive amount, a stable reference, duplicate-reference rejection, no trusted-principal creation, and wallet review freezing, confirms admin/staff/chargeback debit rows render negative even when stored with positive amounts, and confirms generic/staff credits are not labelled as deposit history. It does not replace staging admin workflow or production reviewer evidence. |
| `npm run security:wallet:migrations` | `PASSED` | Static migration-safety test checked 37 incident migrations, 41 security-definer functions, and 19 protected financial/partner/payment/profile-security/ledger/forensic/reservation/outbox tables. It rejects browser write grants on protected tables, browser `EXECUTE` grants on incident functions, disabled RLS, unpinned definer search paths, standalone transaction-control statements inside SQL function bodies, service-role direct balance edits, unrestricted service-role profile privileged-field writes, unsafe top-level migration profile-balance updates, top-level migration transaction-ledger inserts, missing `wallet_security_events` restrictions, missing wallet security event capture triggers, incident evidence tables retaining `auth.users ON DELETE CASCADE`, partner/API evidence tables retaining deletion cascades, browser-accessible reserve/outbox tables, browser-executable outbox RPCs, browser-executable reservation RPCs, and missing additive financial-authorization columns for route migration. This does not replace executing migrations or effective privilege checks in Supabase/Postgres. |
| `npm run security:wallet:money-boundaries` | `PASSED` | Local money-boundary model rejects zero, negative, NaN, infinite, over-precise, oversized, exponent/ambiguous-string, and malformed-currency money inputs; verifies debit rows are signed internally from positive input; and models database-style constraints for signed transaction amounts, debt balances, precision, and currency. It does not replace executing Postgres constraints. |
| `npm run security:wallet:fulfillment` | `PASSED` | Local fulfillment-decision test covers insufficient-funds and unavailable-financial-state decline before authorization, frozen wallet authorization/dispatch blocks, global fulfillment pause, missing/consumed/wrong-amount/wrong-state/stale authorization denial, notification/logging failure after denial without supplier dispatch or credential reveal, unknown supplier outcome preservation, pre-capture hold release without refund credit, post-capture refund without hold release, local-stock reservation failure after debit refunding without credential reveal/sold marking, and credential reveal only for completed orders with credentials. It does not replace real worker/outbox/provider tests. |
| `npm run security:wallet:model` | `PASSED` | Deterministic wallet model sequence test ran 400 generated sequences with 160 steps each and 27,838 posted model events after the reservation-model expansion. It proves model-level conservation for insufficient funds, fake/internal wallet balance denial, valid reservations reducing trusted available without changing book balance, frozen-wallet outgoing blocks, incoming verified credits while frozen, idempotent replays, idempotency conflicts, refunds capped by trusted original debit capacity, and rejected operations leaving balances unchanged. It does not replace DB row-lock, provider, or worker concurrency tests. |
| `npm run security:wallet:outbox` | `PASSED` | Local outbox-decision test covers crash before commit leaving no message or supplier call, crash after commit leaving one recoverable message, old queued messages blocked after freeze, stale financial-security versions blocked after reopen, changed outbox idempotency payload conflict, only the claiming worker being able to finish a dispatch, and two workers unable to dispatch the same claimed message. It does not replace deployed queue tests or route-specific worker integration. |
| `npm run security:wallet:reservations` | `PASSED` | Local reservation-decision test covers active holds reducing trusted available funds, reservation idempotency bound to wallet/order/amount/payload, capture posting one wallet-engine purchase and clearing the hold, release restoring availability without creating refund credit, captured reservations being unreleasable, expired reservations being uncapturable, and refunds restoring linked prior trusted debit capacity without increasing trusted principal. It does not replace Postgres RPC execution or route-specific reserve-first integration. |
| `npm run security:wallet:concurrency` | `PASSED` | Local concurrency-decision test covers simultaneous purchases exceeding funds, concurrent deposit/purchase serialization, freeze/purchase serialization, duplicate linked-refund races, loose/untrusted-linked refund rejection, fake displayed-balance blocking before spend, and rollback after ledger-like or balance-like partial work. It does not replace real Postgres row-lock/fault-injection tests. |
| `npm run security:wallet:routes` | `PASSED` | Local route-decision test covers hostile negative/out-of-range quantities, tampered client prices, ordinary insufficient-funds decline without fraud freeze, active reservations reducing available spend without fraud freeze, stale client/cache balance ignored during authorization, unbacked displayed-balance freeze, unavailable financial state fail-closed behavior, exact idempotency replay, changed idempotency payload conflicts, and Telegram-style server-computed pricing. It does not replace deployed API route tests. |
| `npm run security:wallet:runtime-boundaries` | `PASSED` | Runtime-boundary source test verifies admin unsuspend recalculates backing before status changes, admin credits require admin actor plus approval metadata while refunds only restore linked trusted-debit capacity, NOWPayments verifies IPN signatures before service-role DB access, NOWPayments auto-credit remains disabled and held for manual review, provider payment identity/reference/currency/amount checks remain present, bills, Bitrefill, and withdrawals debit before provider dispatch, bills/Bitrefill/withdrawal debit/refund metadata carries request forensics plus original debit provenance, Bitrefill redemption value is obtained only after provider order lookup, admin/staff debits render negative in history, order-history credentials are completed-order only at the data boundary, SMM status workers cannot dispatch new provider orders, SMM status workers refund through the wallet engine with source-order provenance, pending-payment recovery is cron/service authorized and delegates crediting to `verify-and-credit-wallet`, `verify-and-credit-wallet` validates pending payment/provider evidence before wallet credit, staff SMS refunds use the wallet engine with approving-admin provenance, active revenue/admin-alert logging helpers cannot dispatch suppliers, reveal value, mutate wallets, or throw delivery-changing errors, and current status/recovery/admin worker-like functions cannot dispatch suppliers from stale messages. It does not replace deployed endpoint, provider, or database tests. |
| `npm run security:wallet:suppliers` | `PASSED` | Local supplier-outcome test covers lost supplier responses, late success after unknown outcome, definitive provider failure refund idempotency, capped/idempotent SMM partial refunds, Daisy terminal failure refunds, and late Daisy success without a second refund. It does not replace provider sandbox/dashboard tests. |
| `npm run security:wallet:trusted-principal` | `PASSED` | Local trusted-principal model verifies only verified payment-gateway deposits and approved admin credits create trusted principal; refunds must reference an original trusted debit before they can restore spendable value; refunds restore linked prior trusted debit capacity without increasing principal; unbacked legacy purchases and refunds cannot become spendable even if a fake legacy row claims trusted-principal metadata, because refundable capacity also requires positive `trusted_principal_debit_amount`; pending zero-snapshot refunds are ignored and pending refunds do not consume the original debit refund cap before completion; fabricated displayed balances freeze before purchase; honest insufficient funds decline without fraud suspension; active reservations reduce available funds without a fraud mismatch; and chargebacks consume backing without creating spendable funds. |
| `npm run security:wallet:providers` | `PASSED` | Local provider-decision test covered Ercas, PocketFi, and NOWPayments no-credit cases: missing server-created pending payment, wrong local wallet, provider timeout/pending/failed states, definitive failure/mismatch closure of pending evidence, amount/currency/merchant/environment mismatch, duplicate provider payment across wallets, overlapping pending-payment recovery worker claims, unsigned or invalid PocketFi webhooks, partner PocketFi payments while partner API is paused, duplicate PocketFi reference conflict handling, missing/invalid NOWPayments IPN signatures, partial/expired/unknown/unverified NOWPayments payments, underpaid/wrong-currency/wrong-order NOWPayments status checks, and verified finished NOWPayments payments being held for manual review instead of auto-credit. It does not replace provider sandbox/dashboard verification. |
| `npm run security:wallet:provider-evidence -- --format json`, `--filled-template`, and `--self-test` | `PASSED` | Provider evidence tooling generated proof checklists and a fillable validation-shaped evidence file for Ercas, PocketFi, NOWPayments, iStar, DaisySMS, SMM, Bitrefill, and withdrawals. The self-test proves the validator rejects missing or duplicate provider sections, duplicate required proof rows, pending/unpassed provider proof, passed proof rows without sandbox/dashboard/log references, missing or weak deployed-version evidence linkage, unknown proof rows, invalid `verifiedAt` timestamps, and secret-looking references, including secret-like values in extra proof rows, while accepting a complete sanitized passed evidence shape. It does not contact providers; owner must fill and validate sandbox/dashboard evidence before reopening routes. |
| `npm run security:wallet:reopen-readiness -- --self-test` | `PASSED` | Paid-route reopening-readiness gate verifies the final private evidence bundle before a paused route can be considered for owner-approved reopening. The command can scaffold that private bundle with `--init-bundle`, generating deployment-plan, fillable deployed-version, production, provider, denied-probe, deployed-smoke-result, and README files. The full command requires a validated deployment plan, validated deployed-version evidence, production evidence, provider evidence, owner denied-route probes, and deployed-smoke result JSON. Its self-test proves a complete sanitized bundle passes, proves the generated template bundle does not pass before owner proof is filled, and proves missing evidence files, pending production evidence, and deployed-smoke output without owner denied probes fail closed. This command does not contact production or providers; it validates preserved evidence after those checks are run. |
| `npm run security:wallet:reconcile-offline` | `PASSED` | Offline CSV reconciliation test creates duplicate raw transaction exports, a matching completed order export, a failed order with a posted debit and partial refund, and a derived unexplained-change CSV. It proves duplicate raw exports are deduped, matching order rows are excluded from recorded purchase loss totals, derived analysis files are support-only and not independent spend, failed/refunded rows with posted debits are reported with unresolved exposure, and offline mode needs no production credentials. |
| `npm run security:wallet:refunds` | `PASSED` | Local refund-conservation test covers two legitimate partial refunds against one captured debit, per-order over-refund denial, idempotent duplicate refund replay, changed duplicate refund rejection, owner mismatch rejection, and missing-original-debit denial. It does not replace database/provider concurrency tests. |
| `npm run security:wallet:source-mutations` | `PASSED` | Source mutation audit scanned 214 server/frontend function files and found no direct protected profile balance writes, no legacy wallet RPC calls, and no direct `transactions` table mutations outside the documented balance-neutral admin ledger repair evidence path. The allowed ledger repair exception is scoped to the exact `.insert(repairPayload)` statement, not the whole admin function file. |
| `node scripts/wallet-reconcile-readonly.mjs --help` and `node scripts/wallet-reconcile-readonly.mjs --self-test` | `PASSED` | Help and 23 no-Supabase self-checks passed. The live command reads full-history wallet totals from `wallet_financial_truth_internal`; `--since` changes only a reported transaction coverage count. The offline diagnostic now rejects over-precise provider evidence and conflicting refund IDs, and permits separate spend/refund cycles beyond lifetime principal. It is not used as live authorization truth. Live/staging reconciliation was not run from this environment. |
| `node scripts/wallet-reconcile-readonly.mjs --history-csv "C:\Users\HP ELITEBOOK\Downloads\Supabase Snippet Untitled query (1).csv,C:\Users\HP ELITEBOOK\Downloads\rileygreen-ledger-analysis.csv,C:\Users\HP ELITEBOOK\Downloads\rileygreen-ledger-mismatches.csv,C:\Users\HP ELITEBOOK\Downloads\rileygreen-unexplained-wallet-changes.csv" --json` | `PASSED` | Offline CSV mode classified the raw Riley Supabase ledger export as countable evidence and the derived analysis/mismatch/unexplained-change exports as support-only with `countedInTotals: false`. The corrected count used 140 raw rows, reported 79 completed purchase transaction rows totaling NGN 2,331,442, and avoided double-counting derived analysis rows. This is CSV evidence only, not provider or supplier proof. |
| `npx eslint scripts/security-wallet-check.mjs scripts/wallet-reconcile-readonly.mjs --max-warnings=0` | `PASSED` | Focused lint passed for the security check and read-only reconciliation command. |
| `npx tsc --noEmit --pretty false` | `PASSED` | TypeScript compile check completed without errors. |
| `git diff --check -- ...` | `PASSED_WITH_LINE_ENDING_NOTICE` | No whitespace errors in the latest security-check, webhook, reconciliation, and docs edits; Git warned that LF may become CRLF for some touched files. |
| `npm run lint` | `PASSED_WITH_EXISTING_WARNINGS` | Full lint completed with 0 errors and 25 existing warnings. |
| `npm run build` | `PASSED` | Vite production build completed; remaining warnings were browser-data, mixed static/dynamic import, and bundle-size warnings, not compile failures. |
| Direct wallet/source mutation search | `SOURCE_REVIEWED` | Manual `rg`/`Select-String` audit checked profile balance literals, legacy wallet RPC usage, `transactions` table references, profile table references in server functions, and refund callsites. The repeatable `security:wallet:source-mutations` audit now covers the same high-risk write patterns. The write-like customer money paths found were wallet-engine-backed RPC/helper calls; the only approved direct transaction mutation is the statement-scoped, balance-neutral admin ledger repair row with owner-evidence metadata and unchanged balance snapshots. |

## Not Run Locally

The 24 September refund-link precedence patch passed
`node scripts/wallet-financial-truth-source-test.mjs`,
`node scripts/wallet-migration-safety-test.mjs` (53 migrations), and
`node scripts/wallet-deployment-manifest-check.mjs` (53 migrations). The
new database test deliberately supplies a wrong original-debit ID alongside
a valid weaker key and requires rejection. That test and the dynamic function
rewrite in migration `20260924012000` are **not yet PostgreSQL-executed**;
they require an isolated migrated database before production deployment.
Migration `20260924013000` closes legacy SQL Editor policies that could expose
all app settings, allow public CRO/chat analytics access, or let a browser
forge another user's revenue event. Four unsafe manual repair scripts are now
no-ops. Migration `20260924014000` also binds browser CRO decision rows to the
authenticated caller and forbids server-authoritative markers. Source leak
and migration checks pass across 56 ordered migrations;
the staging pack includes an anonymous read of a private test setting,
effective-role grant checks, and a forged event attempt. These database
checks are **created, not run**.

`node scripts/wallet-pglite-policy-test.mjs` passed against disposable PGlite
0.5.8 (PostgreSQL 18.3 WASM) after installing that package outside the repo.
It reproduced the public app-settings policy reopen, applied migrations
`02000`, `03000`, `13000`, and `14000` to minimal RLS fixtures, verified
permitted and denied browser behavior including a previously forgeable CRO
decision, executed the strict refund matcher, and compiled the
dynamic `12000` rewrite against minimal functions with the reviewed anchors.
This is **isolated PostgreSQL fixture evidence**, not execution against the
actual Supabase schema or the staging rollback pack. In particular, it does
not prove historical refund data impact or deployed function-body compatibility.

`node scripts/wallet-financial-truth-pglite-test.mjs` executed migration
`20260924006000` and `20260924016000` in isolated PGlite with minimal payment and ledger fixtures.
The same test now executes migration `20260924030000`: before the patch, a
valid PocketFi webhook ID produces zero trusted principal because an inner
UUID pattern omits one group, and one credited Ercas pending-payment record
can back two ledger credits with distinct external IDs. After the patch, a
single genuine PocketFi credit is trusted; reused Ercas or PocketFi evidence
sets a payment-identity conflict and confirmed spendable to zero. This is an
isolated PostgreSQL fixture, not evidence about deployed rows or providers.
Migration `20260925003000` also catches two wallets claiming the same
PocketFi reference through distinct external IDs and webhook log rows; both
remain unsuspended but have zero confirmed spendable until review, while an
unrelated backed wallet remains spendable even when an unverified row copies
its payment reference. The admin-only conflict reader
fixture executes `20260925004000` and returns the linked wallets for the
shared provider reference and reference/external-ID alias across a paginated
full-history result. Read-only query 43 executes against the same fixture.
It verified the stored NGN 500,000/unfunded case authorizes zero; a stored
NGN 100,000 balance with NGN 70,000 gateway evidence authorizes NGN 70,000
and reports the NGN 30,000 unexplained difference; a linked refund restores
spendable funds but does not increase principal; active holds reduce capacity;
an unlinked refund cannot create principal; approved admin credit is counted;
balance-neutral admin repair evidence does not alter expected balance while a
changed-snapshot credit remains visible;
the browser role cannot execute the internal function; and a missing payment
evidence table raises an error. This is an isolated PostgreSQL fixture, not a
real Supabase schema, live provider verification, or concurrency proof.

| Check | Status | Reason |
| --- | --- | --- |
| Supabase migration execution against local Postgres | `NOT_RUN_WITH_REASON` | Docker/local Supabase database was unavailable in this environment. |
| `docs/security/wallet-db-security-test-pack.sql` | `CREATED_NOT_RUN` | Staging-only rollback transaction added for restricted-role/RPC/direct-ledger/wallet-engine-profile-update/unbacked-purchase/idempotency/partner-pause checks, including legacy generic/staff/promotion/correction credit exclusion and admin-credit approval-metadata rejection/acceptance, deposit-without-provider-evidence and fake-provider-evidence exclusion from trusted principal, refund-without-original-debit rejection, completed loose-refund history not restoring trusted spend, forged trusted-principal metadata on an unbacked legacy debit still not restoring spend or allowing a new refund, linked over-refund rejection, spoofed non-admin admin-repair rows being skipped/audited, fraud-scanner no-auto-unsuspend behavior, deployed reserve/outbox RLS/privilege/policy checks, reserve/outbox constraint/idempotency-index checks, order-table financial authorization column/index/constraint checks, service-role outbox RPC behavior checks, and service-role reservation RPC behavior checks; requires a running Supabase/Postgres database and an owner-controlled ordinary test profile. |
| RLS/grant tests as `anon`, `authenticated`, and `service_role` | `NOT_RUN_WITH_REASON` | Requires a running Supabase/Postgres test database with the migrations applied. |
| Postgres row-lock/concurrency tests for simultaneous purchases, deposits, refunds, and freezes | `NOT_RUN_WITH_REASON` | Local concurrency model passed, but real database integration tests against Postgres functions and locks still require a running Supabase/Postgres database. |
| Trigger behavior for direct `profiles`, `transactions`, inventory, and identity mutation attempts | `CREATED_NOT_RUN` | Covered in the staging SQL test pack, but not executed here because no local database is available. |
| Provider webhook/integration tests for PocketFi, Ercas, NOWPayments, iStar, DaisySMS, SMM panel, Bitrefill, and withdrawal provider | `PARTIAL_LOCAL_MOCKS_PASSED` | Local no-network provider-decision and provider-adapter mocks passed. Real provider sandbox/dashboard contracts and production tests remain owner-controlled and pending. |
| Broad Edge Function Deno type checks | `LOCAL_CHECK_PASSED` | `npm run security:wallet:deno-edge` now discovers and checks all 37 local Supabase Edge Function entrypoints. This is source-level type coverage only; deployed function versions and runtime configuration still require owner verification. |
| Production deployed-function/version verification | `PRODUCTION_VERIFICATION_PENDING_OWNER` | Owner must deploy and check the active Supabase functions and Vercel app. |

## Static Guard Coverage

`scripts/security-wallet-check.mjs` currently verifies these source invariants:

1. Public partner API bridge returns `PARTNER_API_PAUSED` and contains no upstream
   proxy URL or `fetch()` call while paused.
2. Supabase `partner-api` is hard-paused in code and not controlled by a
   `PARTNER_API_PAUSED` environment variable.
3. Existing `api_partners` rows are marked inactive by migration for
   defense-in-depth against older deployed partner function versions.
4. Partner tables are not directly readable or writable by browser roles.
5. Legacy balance RPCs are revoked from browser roles.
6. Pending payment evidence is server-owned and checkout creation fails closed
   if evidence cannot be stored.
7. PocketFi partner payments are logged for manual review while partner API is
   paused.
8. PocketFi duplicate references cannot silently credit mismatched users or
   amounts.
9. PocketFi Vercel bridge disables body parsing, forwards the raw body and
   provider verification headers to the hardened Edge Function, and does not
   inject server webhook secrets into requests.
10. Legacy Ercas Vercel webhooks are closed.
11. Crypto transfer RPC is disabled and hidden from the UI.
12. NOWPayments crypto webhooks are hard-held for manual review, not
    env-auto-credited, and still require IPN signature plus server-side provider
    status verification before evidence is recorded.
13. Wallet engine is service-role only and rejects conflicting idempotency reuse.
14. Wallet purchases require backed available funds and freeze on mismatch.
15. Direct ledger writes are skipped and audited.
16. `wallet_security_events` and `record_wallet_security_event` provide a
    service-role-only forensic sink for wallet/security decisions with request
    ID, actor, IP/device context, old/new financial values, B/H/A evidence,
    result, and denial code.
17. Blocked direct ledger writes, blocked profile balance writes, and profile
    financial freezes are copied into `wallet_security_events` by database
    triggers for a standard incident timeline.
18. Staging DB security test pack covers dangerous wallet paths.
17. Wallet refunds are capped by trusted original debit capacity before posting.
    The wallet engine and trusted-principal trigger require every new refund to
    link to a trusted-principal-authorized original debit by transaction ID,
    purchase idempotency key, protected source-order metadata, or original
    purchase reference, and that debit must include positive
    `trusted_principal_debit_amount`. They return `REFUND_ORIGINAL_DEBIT_REQUIRED`,
    `REFUND_ORIGINAL_DEBIT_NOT_TRUSTED`, or
    `REFUND_EXCEEDS_TRUSTED_ORIGINAL_DEBIT` instead of letting refunds become
    new principal.
18. Wallet chargebacks and correction debits preserve debt and freeze spending.
    They can record negative wallet balances for real reversal/debt accounting,
    but they set a financial hold before further purchases. The admin route and
    Admin page now include a controlled manual chargeback action that records a
    reference-deduplicated `chargeback` ledger row through the wallet engine and
    places the account into review. The local admin-review model rejects missing
    references, duplicate references, zero amounts, and non-admin chargebacks.
19. Admin unsuspend requires wallet-backing reconciliation. The server function
    returns `WALLET_REVIEW_REQUIRED` instead of clearing a hold when stored
    wallet balance and previous spend are not covered by trusted credits and
    eligible refunds.
20. Staging DB security test pack covers refund conservation edge cases:
    refund rows without original debit evidence return
    `REFUND_ORIGINAL_DEBIT_REQUIRED`, linked over-refund excess returns
    `REFUND_EXCEEDS_TRUSTED_ORIGINAL_DEBIT`, completed loose-refund history
    without original debit linkage cannot restore trusted spend, pending
    refund zero snapshots plus refunds of unbacked legacy purchases must deny
    later spend with `WALLET_UNBACKED_FUNDS`, and forged
    boolean-only `trusted_principal_authorized` metadata on an unbacked legacy
    debit still cannot create refundable trusted capacity or pass a new
    wallet-engine refund attempt.
21. Staging DB security test pack covers chargeback debt handling: a chargeback
    can post a negative wallet balance and must freeze the account.
22. Admin user-detail and fraud-review timestamps show absolute date/time,
    local timezone, and relative age together for joined, suspended, and IP
    evidence timestamps.
23. Profile privileged fields are guarded.
24. Browser-side profile inserts/updates and signup metadata cannot mass-assign
    protected financial, role, suspension, PocketFi, or referral authority
    fields.
25. Referral attribution and withdrawal authority are server-controlled:
    `apply-referral` requires JWTs, derives the user from the session, ignores
    caller-provided user IDs, blocks self-referral, preserves existing
    attribution, and referral withdrawals/referral-to-wallet movement remain
    paused in both UI and backend.
26. New profiles start with zero balances.
27. Referral lookup migration safely casts `uuid`/`text` references.
28. Ercas crediting is bound to server-created pending payments and consumes
    the exact pending-payment row.
29. Ercas definitive provider failures and amount/currency/merchant/environment
    mismatches close pending payment evidence before the wallet engine can
    credit funds; timeout/unavailable and genuinely pending states remain
    retryable pending evidence.
29. Scheduled pending-payment recovery is cron/service-secret authorized, calls
    `verify-and-credit-wallet`, passes the pending payment owner, and does not
    directly update wallet balances or ledger rows.
30. iStar webhook verification uses the raw request body, requires a configured
    webhook secret, compares HMACs safely, refunds failures through
    `apply_wallet_transaction`, and does not directly mutate wallet ledger rows.
31. JWT-disabled Edge Functions are enumerated against an approved list and
    have explicit internal authorization boundaries: provider
    secrets/signatures, cron/service-role gates, partner API hard pause/key
    checks, admin checks, or anonymous site-visit-only behavior.
32. Paid surfaces fail closed by default.
33. Fulfillment routes authorize money before supplier dispatch or value release:
    product checkout debits before local inventory reservation, credential
    assembly, and sold marking, and stock-race reservation failure refunds
    through the wallet engine; SMM, SMS OTP, and Telegram order creation are
    now server-paused by default, and their reopened paths keep provider calls
    after local authorization evidence and wallet-engine debit.
    Telegram debit failures retain the local order as `failed` evidence instead
    of deleting the order row.
34. Mapped purchase routes bind idempotency keys to request contents: product
    checkout binds product id, quantity, and charged amount; SMM binds service,
    quantity, amount, and link; SMS binds service, order type, and charged
    price; Telegram Stars/Premium now require frontend-generated idempotency
    keys, enforce per-user order uniqueness, bind order type, recipient, amount,
    quantity/months, and block orphaned purchase-ledger retries.
35. Paused provider-money routes keep local records and wallet debits before
    provider calls: bills creates a local transaction before debit and calls
    SageCloud only after debit, Bitrefill creates a local order before debit
    and invoice creation, and withdrawals create a local row before debit and
    SageCloud transfer. If the wallet debit is denied, those local records are
    retained as `failed` evidence with `wallet_debit` stage metadata instead of
    being deleted.
36. Server code has no direct profile balance update literals.
37. Server code has no direct wallet-ledger mutations outside the audited,
    balance-neutral admin repair path, and that path requires a real admin
    actor.
38. The read-only reconciliation command exists, requires explicit environment
    and read-only acknowledgement, requires `--allow-production` for production,
    and contains no Supabase mutation or RPC calls.
39. The local security suite runs every repository-local wallet check, records
    Docker/`psql`/Deno/Supabase CLI availability, runs `npx deno`
    checks against all 37 local Edge Function entrypoints, and states that it does not
    execute migrations, RLS grants, provider sandboxes, deployed routes, or
    production configuration.
40. Guarded staging DB runner exists for `wallet-db-security-test-pack.sql`,
    refuses production, requires explicit rollback-mutation acknowledgement,
    injects the owner-controlled test profile id into a temporary SQL copy, and
    checks the rollback success marker.
41. Safe deployed smoke runner exists for the public incident endpoints and
    sends only denied/paused requests for partner API, legacy Ercas, unsigned
    PocketFi, and unsigned/unconfigured iStar.
42. Provider adapter and fulfillment decision tests deny unavailable financial
    state before authorization or provider dispatch.
43. Provider evidence template covers Ercas, PocketFi, NOWPayments, iStar,
    DaisySMS, SMM, Bitrefill, and withdrawals with the sandbox/dashboard proof
    each route needs before reopening.
45. Owner handoff checks verify the checklist, final report, test report,
    deployment manifest, regression matrix, production evidence register,
    route inventory, env/secret inventory, and wallet state-machine document
    keep production proof boundaries and required owner actions visible.
45. Incident migration safety tests cover dangerous migration text before
    runtime: browser write grants on protected financial, partner,
    payment-evidence, profile-security, and ledger tables; browser function
    execution grants; disabled RLS; security-definer functions without pinned
    `search_path`; default future-function execute revocation; wallet-engine
    revokes; and key authority triggers.
46. Provider adapter mock tests cover no-network dispatch boundaries for SMM,
    DaisySMS, iStar, Bitrefill, SageCloud bills, and SageCloud withdrawals.
47. Wallet model generated-sequence tests cover ordinary insufficient funds,
    valid reservations reducing trusted available without changing book balance,
    frozen-wallet outgoing blocks, incoming verified credits while frozen,
    idempotency replays, changed idempotency payload rejection, and refund caps.
48. Provider decision tests cover fake payment and duplicate webhook cases for
    Ercas and PocketFi without live provider calls, including Ercas returned
    currency mismatch and configured merchant/environment mismatch.
49. Fulfillment decision tests cover authorization, freeze, pause, supplier
    outcome, and credential-reveal policy without live suppliers.
50. Route-decision tests cover the book-balance versus available-balance
    distinction for valid reservations, so a legitimate hold reduces spendable
    funds without being treated as unbacked wallet value.
51. Incident wallet mutation and fulfillment maps exist and cover the controlled
    wallet writer, funding sources, purchase debit/refund paths, paused routes,
    paid delivery boundaries, and shared classification labels for patched,
    paused, owner-production-check-required, and historical-cause-unproven
    surfaces.
51. Incident regression matrix exists and tracks T01 through T80 with evidence
    labels for source coverage, staging SQL, provider tests, concurrency tests,
    production verification, and remaining full-test gaps. The aggregate static
    guard now also parses matrix rows and fails if a row uses an undefined
    evidence-status label.
52. Wallet financial model documents backed funds, refund conservation, the
    local product reserve/capture boundary, paused provider-route policy,
    freeze/review behavior, and remaining chargeback/partial-refund/outbox risks.
53. Incident final report exists and separates source-reviewed findings,
    repository patches, fake-gateway assessment, commands run, tests not run,
    owner deployment actions, and remaining risks.

## Staging DB Test Pack Coverage

`docs/security/wallet-db-security-test-pack.sql` is designed to run against a
staging or owner-controlled database after migrations. It rolls back all changes
and verifies:

- ordinary authenticated profile updates cannot create balances, admin/staff
  flags, or unsuspend state;
- direct service-role `profiles.update()` cannot change protected profile
  fields; the approved PocketFi and referral profile RPCs can make only their
  narrow expected changes;
- non-admin callers cannot use the narrow suspension or staff-role RPCs to
  suspend users or grant staff privileges;
- authenticated users cannot execute `apply_wallet_transaction` directly;
- legacy balance RPCs are not executable by browser roles;
- direct `transactions` inserts are skipped and audited;
- the real `apply_wallet_transaction` path, without externally setting guard
  flags, updates the guarded profile wallet balance, atomically consumes Ercas
  `pending_payments` evidence by marking it `credited`, and records debit rows
  as negative with correct before/after snapshots;
- a fabricated stored wallet balance with no trusted backing returns
  `WALLET_UNBACKED_FUNDS` and freezes financial access, including the exact
  NGN 500,000, NGN 450,000, NGN 789,292, and NGN 1 variants;
- a new `admin_credit` without an approving admin-profile actor is rejected at
  write time, and a new `admin_credit` created by a non-admin actor is rejected
  at write time;
- balance-neutral admin repair/evidence rows require a real admin actor and still remain audit-only, are
  audited when spoofed, and do not count as trusted principal,
  even when the row is typed as `admin_credit` and has an admin actor;
- legacy/direct generic, staff, promotion, and correction credit rows do not
  count as trusted principal. The generic-credit case also triggers a
  review/freeze when it creates displayed balance exposure, and the scanner does
  not auto-unsuspend the account after later valid-looking evidence;
- internal balance movement such as `referral_withdrawal` cannot authorize
  product spend as trusted principal and remains paused at both UI and backend
  boundaries during incident review;
- over-refund excess, completed loose-refund history without original debit
  linkage, pending refund rows with invalid zero snapshots, refunds of
  seeded unbacked legacy purchases, and forged boolean-only trusted-principal
  metadata on unbacked legacy debits cannot authorize new spend or a new refund;
- chargeback debt can be recorded as a negative wallet balance and freezes the
  account for review, and the admin UI exposes this as a separate
  `Record Chargeback` action instead of a normal balance deduction; local model
  coverage verifies reference-based duplicate rejection;
- exact idempotent replay is allowed, while conflicting idempotency reuse
  returns `IDEMPOTENCY_CONFLICT`;
- existing API partners are inactive during incident pause.
- `pending_payments` is not directly writable by browser roles.
- failed/cancelled/refunded product, SMM, and SMS rows with posted debits are
  reported with matching refunds and unresolved debit exposure.

This is useful regression coverage, but it does not prove live grants, RLS,
trigger behavior, provider configuration, or external idempotency.

## Incident Requirement Status

| Requirement area | Current status |
| --- | --- |
| P0 loss containment | `PATCH_IMPLEMENTED`, `STATIC_WALLET_SECURITY_CHECK_PASSED`, `PRODUCTION_DEPLOYMENT_PENDING` |
| Partner API shutdown | `PATCH_IMPLEMENTED`, `STATIC_WALLET_SECURITY_CHECK_PASSED`, `PRODUCTION_DEPLOYMENT_PENDING` |
| Wallet mutation boundary | `PATCH_IMPLEMENTED`, `LOCAL_MIGRATION_STATIC_PASSED`, `LOCAL_DB_SECURITY_TESTS_PENDING` |
| Backed-funds purchase authorization | `PATCH_IMPLEMENTED`, `LOCAL_MIGRATION_STATIC_PASSED`, `LOCAL_DB_SECURITY_TESTS_PENDING`, `CONCURRENCY_TEST_PENDING` |
| Payment provenance and duplicate webhook handling | `PATCH_IMPLEMENTED`, `PROVIDER_TEST_PENDING`, `PRODUCTION_VERIFICATION_PENDING_OWNER` |
| Refund/retry safety | `PATCH_IMPLEMENTED`, `CONCURRENCY_TEST_PENDING`, `PROVIDER_TEST_PENDING` |
| Fulfillment before authorization prevention | `PATCH_IMPLEMENTED` for mapped paths, `LOCAL_PROVIDER_ADAPTER_MOCK_PASSED`, `PROVIDER_TEST_PENDING` |
| Admin review and recovery workflow | `DOCUMENTED`, `PRODUCTION_VERIFICATION_PENDING_OWNER` |
| Wallet/account/service state machine | `DOCUMENTED`, `STATIC_WALLET_SECURITY_CHECK_PASSED`, `PRODUCTION_VERIFICATION_PENDING_OWNER` |
| Wallet mutation and fulfillment maps | `DOCUMENTED`, `STATIC_WALLET_SECURITY_CHECK_PASSED`, `PRODUCTION_VERIFICATION_PENDING_OWNER` |
| T01-T80 regression matrix | `DOCUMENTED`, `STATIC_WALLET_SECURITY_CHECK_PASSED`, `LOCAL_MIGRATION_STATIC_PASSED`, `STAGING_SQL_CREATED_NOT_RUN`, `PROVIDER_TEST_PENDING`, `CONCURRENCY_TEST_PENDING`, `PRODUCTION_OWNER_PENDING` |
| Wallet financial model | `DOCUMENTED`, `STATIC_WALLET_SECURITY_CHECK_PASSED`, `RESERVE_FIRST_GAPS_RECORDED` |
| Incident final report | `DOCUMENTED`, `STATIC_WALLET_SECURITY_CHECK_PASSED`, `PRODUCTION_VERIFICATION_PENDING_OWNER` |
| Read-only historical reconciliation command | `PATCH_IMPLEMENTED`, `HELP_COMMAND_PASSED`, `PRODUCTION_VERIFICATION_PENDING_OWNER` |
| Historical root cause | `HISTORICAL_CAUSE_UNPROVEN` until live logs, provider records, and database audit evidence identify the actual write or payment path |

## Restock Response Leak Check (25 September 2026)

`node scripts/wallet-restock-leak-test.mjs` passed. It rejects raw provider
payload/error logging and supplier-provided error text in the two restock
entrypoints. `node scripts/wallet-deno-edge-check.mjs` passed for 37 Edge
Function entrypoints. The full local suite passed 63 of 63 checks at that point. These are
source and local checks; deployed restock code, historical logs, supplier
outcomes, and secret rotation remain owner verification tasks. Both restock
routes remain paused by default.

## Catalog Provider Error Leak Check (25 September 2026)

`node scripts/wallet-provider-error-leak-test.mjs` passed. The two catalog
routes no longer include raw provider response bodies or stack traces in
browser errors or logs. The full local suite passed 64 of 64 checks, including
the all-Edge-Function Deno type check and deployment-manifest coverage. This
cannot prove deployed behavior or erase old logs.

## Ambiguous Provider Outcome Check (25 September 2026)

`node scripts/wallet-ambiguous-provider-outcome-test.mjs` passed. It checks
that bills and withdrawal routes have no automatic provider-error refund,
retain pending status and the original debit for an unknown outcome, avoid
returning raw provider responses, and do not call a pending bills replay a
success. Bank-account verification must also succeed before a withdrawal debit.
The full local suite passed 71 of 71 checks, including the Deno type check.
This is source/local evidence, not a provider-sandbox timeout test. The paid
provider routes remain paused pending provider lookup, retry, and refund proof.

`node scripts/wallet-provider-error-leak-test.mjs` now also covers the paused
admin-only `muabanvia-fulfill` route and the publicly callable crypto catalog
and estimate utilities. It checks generic provider failures, bounded direct
supplier quantity, pause/admin-gate ordering, currency validation, and encoded
estimate query parameters. `npx deno check` passed for all three edited Edge
functions. The 71-check local suite passed after the deployment manifest added
both newly changed crypto functions. These are source/type checks, not live
provider-response or deployed-route tests; no crypto funding or live supplier
delivery was enabled.

The same source guard now covers `purchase-bitrefill`: no automatic refund on
an unconfirmed invoice/order outcome, no raw pending-order replay, and
fail-closed blocklist/markup reads. A provider sandbox and deployed
`bitrefill_orders` read-policy check are still required before reopening.
`node scripts/wallet-bitrefill-history-pglite-test.mjs` passed in isolated
PostgreSQL: the authenticated role can read safe columns of its own rows,
cannot directly read redemption/raw provider columns, and the history RPC
returns redemption only for a successful order. Deployed grants, policies,
and provider outcomes remain unverified.

`node scripts/wallet-admin-credit-demotion-pglite-test.mjs` passed in isolated
PostgreSQL. It executes the real refund trigger and canonical reader: a
recorded approved credit remains trusted after the approver is demoted, a
linked refund restores the original debit, and an admin-looking credit from
an unreviewed route stays quarantined. The two follow-on migrations are not
proven against the deployed Supabase function definitions.

`node scripts/wallet-order-history-pglite-test.mjs` passed in isolated
PostgreSQL. Authenticated users have no direct base-order SELECT; the scoped
view gives customers only their orders, reveals captured completed credentials
to the owner, preserves pre-enforcement completed history, and redacts pending
or uncaptured credentials. Admin history sees order facts without passwords.
The browser build and `npx tsc --noEmit` passed after callers were switched to
the view. Deployed grants and real historical order shapes remain unverified.

`node scripts/wallet-bills-response-pglite-test.mjs` passed in isolated
PostgreSQL. Browser roles can read their own safe bills summary but cannot
select the raw SageCloud response; service role retains full read. The bills
Edge source guard also checks server-owned lookup/insert and fail-closed lookup
errors. Reopening still requires deployed grants and SageCloud sandbox proof.

`node scripts/wallet-financial-history-grants-pglite-test.mjs` passed after
adding migration `20260924027000`. The fixture grants a browser role both
table-wide writes and separate column INSERT/UPDATE/REFERENCES. It confirms
the earlier table-only migration leaves a column UPDATE effective, then checks
the new migration removes both kinds of write across the financial-history
tables, including SMS orders and crypto withdrawals, while retaining SELECT
and service-role INSERT. This is isolated PostgreSQL privilege evidence; the
owner must run read-only query 33 and test history reads against deployed RLS.

`node scripts/wallet-partner-grants-pglite-test.mjs` passed in isolated
PostgreSQL. The fixture demonstrates that the earlier partner-table migration
left `PUBLIC` table and column grants effective. Migration `20260924028000`
then removes direct browser access to all six partner tables while retaining
service-role access. Read-only query 34 and a staging partner API pause test
are still required; no deployed partner grants were inspected here.

`node scripts/wallet-cross-wallet-conflicts-pglite-test.mjs` passed in isolated
PostgreSQL. An ordinary authenticated user cannot execute the admin-only
reader or select the raw ledger; an admin sees 201 cross-wallet identities over
three keyset pages. Same-wallet repeats and purchase-only references are not
classified as cross-wallet funding conflicts. The Fraud Review UI test covers
all pages, a visible failure when evidence is unavailable, and a review-only
signal without automatic suspension. Provider-side reconciliation and deployed
RPC grants remain owner tasks (read-only query 35).

## Acceptance Boundary

Current local verification (2026-09-25):

- `node scripts/wallet-financial-truth-pglite-test.mjs` passed the zero-funded,
  partially backed, linked-refund, reservation, and approved-credit fixtures.
- `node scripts/wallet-financial-truth-source-test.mjs` and
  `node scripts/wallet-financial-truth-ui-test.mjs` passed.
- `node scripts/wallet-provider-error-leak-test.mjs` passed after sanitizing
  customer-visible payment-verification and recovery errors.
- `npx deno check supabase/functions/verify-and-credit-wallet/index.ts supabase/functions/check-pending-payments/index.ts` passed.
- `node scripts/wallet-local-security-suite.mjs --compact` passed 71/71 local
  checks after updating a stale assertion for the sanitized provider failure.
- `npm run build` passed with existing chunk-size and dynamic-import warnings.
- The later Telegram/iStar/PocketFi leak and unknown-outcome patch passed
  `node scripts/wallet-ambiguous-provider-outcome-test.mjs`,
  `node scripts/wallet-provider-error-leak-test.mjs`,
  `npx deno check` for the two affected Edge Functions, and
  `npx tsc --noEmit` for the Vercel webhook. These are local source/type checks,
  not a real supplier timeout or provider callback test.
- After the Telegram retry and iStar completion-write guards, the complete
  `node scripts/wallet-local-security-suite.mjs --compact` run again passed
  71/71 local checks. The public catalog supplier-column grant remains an
  open production finding covered by read-only owner query 37.
- The catalog expand/contract migrations passed
  `node scripts/wallet-catalog-privilege-pglite-test.mjs`: anonymous and
  customer roles retain safe active-product reads but lose whole-row and
  supplier-column access; an authorized admin can update a supplier mapping,
  and `tab_products` staff can read managed rows while add-only staff cannot.
  `npx tsc --noEmit` passed after switching browser queries to public columns
  and admin/staff product screens to scoped readers. This is an isolated
  PostgreSQL fixture, not deployed Supabase/PostgREST proof.
- The Vercel PocketFi bridge now preserves upstream HTTP status while
  returning fixed public error bodies. Mock upstream-error and
  network-exception cases in `node scripts/wallet-provider-error-leak-test.mjs`
  passed; neither response contains the injected secret text. The complete
  local security suite passed 72/72 checks again after this change. Deployed
  bridge behavior and provider retries remain owner checks.
- The catalog privilege fixture now also executes migration `31500` against
  a formerly public `product_relationships` table. Anonymous users can read
  recommendation edges but not whole rows or metadata; migration `30200`
  gives an admin a scoped upsert RPC while ordinary users cannot invoke it.
  The deployed grant shape, admin upsert, and dashboard read must be checked
  with owner query 38 after the browser build is updated.
  `node scripts/wallet-migration-safety-test.mjs` passed 75 migrations,
  `npx tsc --noEmit` and `npm run build` passed, and the complete local suite
  passed 72/72 after this change. The built-asset leak scan found no new
  errors; historical/local credential warnings remain owner rotation work.
- `node scripts/wallet-financial-history-grants-pglite-test.mjs` now applies
  migration `32000`: browser roles cannot select `pending_payments` rows or
  `error_message` through inherited column grants, while the service role
  retains SELECT. Owner query 39 returns the expected restricted grant shape
  in the fixture. The migration-safety check now passes 76 migrations and the
  complete local suite passed 72/72 after the new permission check was added.
  The later explicit service-role SELECT grant passed the focused privilege
  test again. This is not a live check of historical stored errors.
- On 25 September, the path-scoped Git-history audit completed across 78
  reachable commits without printing matched values. It found historical
  personal-email literals and four script paths with secret-shaped literals;
  those findings require private owner review, not an assumption that the
  strings were active credentials. The audit now runs in the standard local
  suite. After the Fraud Review message and public-function disclosure fixes,
  `node scripts/wallet-local-security-suite.mjs --compact` passed 73/73 checks,
  and all 37 Edge Function entrypoints passed the Deno type check. Deployed
  function versions, provider retries, and credential rotation remain pending.
- After the exact Ercas/PocketFi evidence-amount migration and refund-cycle
  self-test alignment, `node scripts/security-wallet-check.mjs` passed 92
  checks and `node scripts/wallet-local-security-suite.mjs --compact` passed
  73/73. The isolated PostgreSQL fixture rejects an over-precise provider
  evidence amount that previously matched after rounding. `git diff --check`
  passed; Git emitted line-ending conversion warnings only.
  `npx tsc --noEmit --pretty false` and `npm run build` passed; Vite retained
  its dynamic-import and bundle-size warnings. Read-only query 41, realistic
  staging migration execution, and production evidence checks remain owner
  tasks.
- The PocketFi Edge webhook replay check now parses the provider's raw amount
  into exact NGN minor units before accepting an idempotent repeat. The focused
  provider decision test rejects an over-precise replay and conflicts on a
  different valid amount; the 92-check source audit and `npx deno check
  supabase/functions/webhook-pocketfi/index.ts` passed. A provider sandbox or
  deployed Edge replay test was not run.
- The admin-only Fraud Review email fallback passed an isolated PostgreSQL
  before/after fixture: a blank profile email displayed as null before the
  migration, the current Auth email appeared after it, and a customer role
  received `42501`. Read-only query 42 and the 81-migration safety/manifest
  checks passed locally. Deployed identity and privilege checks remain pending.
- PocketFi webhook responses were reduced to fixed acknowledgments and errors.
  `node scripts/wallet-provider-error-leak-test.mjs` and
  `npx deno check supabase/functions/webhook-pocketfi/index.ts` passed.
  Successful provider/Vercel responses were not exercised against deployed
  services; the owner must inspect sandbox replies after deployment.
- Crypto order and public chatbot failure responses were sanitized; the
  crypto order route also stopped storing the raw NOWPayments creation error
  and returning Auth-header debug fragments. The focused provider leak guard
  and `npx deno check` for both Edge entrypoints passed. Deployed responses
  and historical logs were not tested here.
- Email, staff-management, and scheduled revenue-loop responses no longer
  return raw SMTP/database/exception text. The focused provider leak guard and
  `npx deno check` for all three Edge entrypoints passed. Deployed responses
  and historical logs were not tested here.
- After the cross-wallet reference migrations and fixtures, the final
  `node scripts/wallet-local-security-suite.mjs --compact` run passed 73/73
  local checks. Migration safety and deployment-manifest checks enumerated 81
  incident migrations; the repository leak scan found zero current-tree errors
  and 13 historical/configuration credential warnings. This is not a
  production-sized query-plan, migration-lock, or provider verification test.
- The SMM supplier-ID patch passed `npm run build`,
  `npx deno check supabase/functions/smm-get-services/index.ts`, and
  `node scripts/wallet-smm-catalog-pglite-test.mjs`. The isolated fixture
  seeded both table-wide and column-specific supplier-ID grants, applied
  additive migration `05000` and contract migration `06000`, then verified
  ordinary catalog reads, supplier-ID/UPDATE denials, and admin-only RPC
  search/toggle behavior. `node scripts/wallet-migration-safety-test.mjs`
  passed 83 migrations, `node scripts/wallet-deployment-manifest-check.mjs`
  passed 83 migrations, and the incident completion audit passed 58 scripts.
  Deployed grants, PostgREST embedded catalog reads, and live SMM admin
  controls are not verified by those local checks.
- After the SMM audit updates, `node scripts/wallet-local-security-suite.mjs
  --compact` passed 74/74 local checks. `node scripts/security-leak-check.mjs`
  reported zero current-tree errors and 13 historical/configuration warnings.
  `git diff --check` passed for the tracked files changed by this patch.
- The follow-up SMM order review added migration `07000` for panel-response
  and supplier-cost browser read restrictions. The isolated PostgreSQL fixture
  passed ordinary-role safe history reads, hidden-column denials, and admin
  catalog controls; source assertions check that ambiguous panel outcomes do
  not call the refund writer. `npx deno check` passed for `smm-create-order`
  and `smm-check-status`; route-source-order and provider-error-leak checks
  passed. Migration safety and deployment-manifest checks counted 84 incident
  migrations. A real panel lost-response test and deployed RLS/grant checks
  remain not run.
- After that review, `npm run build`, `npx tsc --noEmit`, and
  `node scripts/wallet-local-security-suite.mjs --compact` passed (74/74 local
  checks). The deployed `smm_orders.status` constraint and a provider-backed
  `outcome_unknown` transition remain unverified; query 45 supplies the
  read-only schema check for the owner before any SMM route reopening.
- The admin-credit demotion fixture now also executes read-only query 46:
  it returns credits with an unreviewed or missing source while excluding the
  accepted credit whose approver was later demoted. This confirms the effective migration
  chain preserves approved funding across role changes locally; production
  approval provenance and any query 46 candidates still require owner review.
- The public chatbot's `product_groups` query was changed from `*` to the
  catalog contract's allowed columns. `node
  scripts/wallet-catalog-privilege-pglite-test.mjs` passed the anonymous-role
  column read and source guard, and `npx deno check
  supabase/functions/chatbot/index.ts` passed. The deployed chatbot and
  browser/Edge flag alignment were not tested here.
- After the chatbot catalog change, the local wallet suite passed 74/74,
  deployment-plan self-test passed six checks, the current-tree leak scan
  reported zero errors with 13 historical/configuration warnings, and the
  changed-file diff check passed. None is a deployed Edge-version test.

These checks use local fixtures and source assertions. They do not prove that
the migrations, grants, Edge Functions, or payment evidence are current in
production. In particular, the approved legacy baseline is not independent
provider proof for every historical credit.

The SMS purchase failure handler now persists only the allowlisted
`friendlyError` classification in `sms_orders.error_message` and revenue
failure metadata. The focused provider-error source guard and Deno type check
passed locally. Existing order rows may still contain earlier raw error text;
deployed read grants and historical contents need owner review.

The SMS history contract migration `20260925008000` passed an isolated
PostgreSQL-role fixture seeded with broad table and column grants plus an
unsafe permissive read policy. The fixture confirmed own-row reads, admin
safe-row reads, denial of cross-user reads and private error/provider columns,
and service-role access. `npx tsc --noEmit`, `npx deno check` for `smsbus`,
the 85-migration safety/manifest checks, and `npm run build` passed. The first
75-check suite run passed 73 checks; the two failures were stale query-46
extraction and script-count documentation after adding query 47 and a test.
Both failed checks passed separately after correction. The later complete
76-check suite passed 76/76 after the Telegram privacy work. The deployed SMS
schema, RLS, and historic error contents remain unverified.

The Telegram Edge Function now returns retail star presets and a server-priced
custom quote without supplier-cost configuration, plus explicit public order,
recipient, and premium product fields. Migration `20260925009000` revokes
browser table and inherited column grants for `telegram_orders` and
`telegram_products`; the isolated PostgreSQL fixture proves direct browser
denials, and an executed handler test proves retail responses omit a seeded
private supplier configuration. `npx tsc --noEmit`, `npx deno check` for
`telegram-stars`, `npm run build`, the 86-migration safety/manifest checks,
and the 76/76 full local suite passed. Deployed Edge responses, schema grants,
provider behavior, and customer order history remain owner staging checks.

The Bitrefill catalog Edge Function now projects only customer catalog fields
for list, search, and details instead of forwarding provider product objects
with arbitrary extra keys. An executed fixture verified that seeded wholesale
cost, provider margin, provider response, and extra pagination metadata do not
appear in the public result. The isolated projection test passed; this does
not establish the contents of any previously deployed provider response.
The complete local security suite then passed 77/77 checks, including this
projection test. After a final nested-field type guard, the focused projection
test and `npx deno check` passed again; the full suite was not rerun for that
last narrow edit. Previously deployed provider responses remain unverified.

Do not reopen a paused paid route because these local checks pass. Reopen only
after the owner verifies the deployed database permissions, active Edge Function
versions, provider secrets/webhooks, route behavior, and supplier outcome
handling listed in `wallet-owner-verification-checklist.md`.

The bills route previously parsed a browser amount loosely and compared a data
plan quote with the live provider price only after rounding both to whole
naira. It now parses exact minor units, requires an exact match, and charges
the matched provider price. Bills and Bitrefill also previously returned a
same-key order without checking that the retry described the same purchase.
Both now compare the stored product, amount, recipient, and other relevant
order terms and return a conflict for incompatible reuse. Bitrefill flexible
denominations no longer use `parseFloat`, which accepted trailing garbage.
`node scripts/wallet-money-boundary-test.mjs` passed runtime helper cases and
route source assertions; `npx deno check` passed for both changed Edge
functions. The full local suite was rerun after both route edits and passed
77/77 on 25 September 2026. These tests do not execute the deployed handlers
or prove provider sandbox behavior; both routes remain paused pending owner
verification.

The admin/cron Revenue OS maintenance job used to pass complete
`orders.account_details` objects into analytics, although its calculations
need only quantity and three amount fields. That JSON may contain delivered
account credentials. The job now projects each order to those numeric fields
before analytics and selects only named product columns rather than all
future `product_groups` fields. The focused projection assertions in
`wallet-runtime-boundary-source-test.mjs` passed with seeded credential and
supplier-response fields, and `npx deno check` passed for the maintenance
function. This reduces propagation inside the job; it does not remove the
legacy credential JSON from the database or prove the deployed job is updated.
The complete local security suite passed 77/77 again after this change on
25 September 2026. Production schema, role grants, and deployed responses
remain owner verification tasks.

The paused `create-crypto-sell-order` route previously removed punctuation
from client idempotency keys, used only that client key as the merchant order
reference, and returned a same-key payment without comparing currency or
amount. It now rejects malformed keys and amounts, scopes new references to
the project and authenticated user, looks up legacy references to avoid
duplicating old attempts, and conflicts on changed currency/amount/requested
network. `wallet-money-boundary-test.mjs` passed focused amount and retry
cases and `npx deno check` passed for the Edge route. The route stays paused.
This does not prove NOWPayments treats `order_id` as an idempotency key; its
published examples use `order_id` as a merchant-provided tracking field.
Concurrent payment creation before the local transaction insert, historical
duplicate references, and the webhook's ambiguous reference lookup still
require a separate redesign and provider sandbox verification before reopening.
The full local security suite completed after this route change on
25 September 2026 with 77/77 checks passing. It did not execute a provider
payment, a production webhook, or a live database migration.

The NOWPayments webhook previously resolved a signed notification with an OR
lookup on provider payment ID or merchant order reference. A non-finished
notification could therefore update a row whose saved payment ID did not
match the notification. The handler now resolves by provider payment ID only,
requires both saved IDs to match before any status write, and records an
unmatched or conflicting signed event in the restricted
`wallet_security_events` table before acknowledging it. Lookup/audit failures
and unhandled processing failures return a non-2xx response rather than
silently reporting successful processing. Focused provider decision tests and
`npx deno check` passed. Provider retry behavior, legacy ambiguous rows,
durable end-to-end IPN processing, and deployed event retention still require
owner staging and provider verification; crypto top-up remains paused.
The complete local security suite passed 77/77 after the identity-gate change
on 25 September 2026; its Supabase CLI availability probe timed out, and no
live or sandbox provider event was sent. A follow-up route change now ignores
older pending/partial notifications after a finished-review or terminal state
and predicates non-final updates on the status read, so a concurrent review
hold cannot be overwritten by a late pending write. Focused provider tests,
an isolated PGlite conditional-update fixture, and Deno type-check passed.
At that point terminal failure/refund/reversal notifications still lacked
provider-authoritative status checks and end-to-end ordering tests; the
subsequent change below addresses the first gap locally, not deployed behavior.
The full local security suite passed 77/77 after this status-ordering change
on 25 September 2026. The Supabase CLI probe timed out; no live provider
notification or deployed database policy was exercised. A subsequent webhook
change now verifies failed/refunded/expired notifications against the current
NOWPayments payment status and saved identities before changing local state.
Conflicts are retained as review events. Both verified-finished holds and
general status writes now require the status read to remain unchanged, so
concurrent terminal/finished updates cannot blindly overwrite one another.
Focused provider decisions, PGlite conditional-update fixtures, and Edge
typecheck passed. The full local security suite passed 77/77 after this change
on 25 September 2026. It did not execute migrations, deployed handlers, or
provider sandbox events; those remain owner verification tasks.
The subsequent webhook review-path change stopped a conflicting `finished`
notification from writing `verification_failed` into a transaction, routes
unsupported signed statuses to audit-only review, keeps the server-created
payment amount/currency unchanged, and refuses to validate a finished payment
without a saved expected amount. Focused provider decisions and Deno typecheck
passed. Provider sandbox and deployed handling remain untested here.
The full local security suite passed 77/77 after this review-path change on
25 September 2026. Docker, `psql`, and direct `deno` were unavailable in
this run; the suite used its `npx deno` fallback for Edge type checks and did
not execute migrations, role grants, deployed handlers, or provider callbacks.
The PocketFi webhook previously allowed a top-level event ID, session ID, or
transaction object ID to stand in for the stable transfer reference used by
the wallet idempotency key. It now requires an explicit reference field and
logs reference-less events for review without credit. The provider decision
test and PocketFi Edge typecheck passed. A genuine permanent-account transfer
payload and provider duplicate/replay behavior still require sandbox proof.
The full local security suite passed 77/77 after this reference-parser change
on 25 September 2026. This did not verify production credentials, real
PocketFi callbacks, or deployed wallet grants.
The staff approval queue had a browser INSERT policy that checked only the
requester's `staff_id`, bypassing the `manage-staff` permission gate at queue
submission. Migration `20260925010000` removes browser table and column
writes, retains own-history reads and service-role queue writes, and admits
the `failed` status already used by the Edge handler. The handler now rechecks
staff status/permission before approval and records auto-approved action audit
rows before applying them. An isolated PGlite fixture reproduced the old
direct insert and confirmed the new grant and status behavior; the DB-pack
self-test, Edge typecheck, and deployment-manifest check passed. The full
local security suite passed 77/77 on 25 September 2026 after these changes.
Real deployed grants, PostgREST denial, and owner approval workflow remain
staging/production verification tasks.
An isolated PostgreSQL fixture also executed
`20260919020000_restrict_auth_user_cascade_evidence.sql` against ordinary and
deferrable staff foreign keys. Both became `ON DELETE RESTRICT`, and an Auth
user delete was denied. The migration now includes the original constraint
definition in its failure detail; query 10d reports whether a deployed
definition matches its rewrite pattern. The earlier owner-reported production
error was not reproduced locally and remains an owner-side schema diagnosis,
not a verified production fix.
The full local security suite passed 77/77 after the cascade fixture and
read-only diagnostic were added on 25 September 2026. No production schema
or customer record was accessed or changed by this verification.

## Legacy Funding Chronology Signal (25 September 2026)

Added migration `20260925011000` to the canonical financial reader and
surfaced its first recorded legacy debit/funding timestamps in admin user
details and Fraud Review. It is a manual-review signal, not a new source of
trusted principal or an automatic account hold. The isolated PGlite fixture
confirmed funding-first, spend-first, and no-recorded-funding cases. The
Fraud Review UI fixture confirmed the spend-first case appears on Watchlist.
Owner query 50 lists such wallets without changing them. Deployment and
provider-record verification remain owner tasks.
`node scripts/wallet-financial-truth-pglite-test.mjs` and
`node scripts/wallet-financial-truth-ui-test.mjs` passed. The initial full
suite reported 73/77 because the new migration had not yet been listed in
the deployment manifest; after adding it, the compact local suite passed
77/77. `npm run build` passed with the existing bundle-size
and mixed static/dynamic import warnings. `git diff --check` is recorded
separately after the final file inspection. None of these checks exercised
the deployed database, provider records, or production wallet state.

## Admin Alert Evidence Writes (25 September 2026)

The earlier admin-alert migration removed browser INSERT but retained broad
UPDATE. The PGlite fixture reproduced an authenticated admin rewriting an
alert message. Migration `20260925012000` removes browser table and column
UPDATE grants, regrants only `acknowledged`, and records the actor/time inside
the database trigger. The browser now sends only that boolean. The fixture
confirmed message rewrites and unacknowledgement are denied, while one admin
acknowledgement and service-role resolution still work. The deployment
manifest, DB-pack self-test, and leak scanner passed after this change.
Staging RLS/grant and deployed UI checks remain owner tasks.
The first full-suite run after this migration passed 75/77: the migration
safety checker needed an exact exception for the reviewed acknowledgement
column, and its invoker-context trigger needed an explicit declaration. A
later run passed 76/77 because the chronology fixture included newly added
query 51 in its query-50 slice. After tightening those checks, the compact
local suite passed 77/77. `npm run build` passed with existing chunk-size and
mixed static/dynamic import warnings. No deployed alert record was changed.

## Profile Read Policy Scope (25 September 2026)

The repository's old `Admin can read all profiles` policy selects from its
own table, and `is_admin_profile()` previously ran as invoker. A PGlite
fixture reproduced recursive RLS (`42P17`). Migration `20260925013000`
replaces the policy with a caller-bound security-definer helper after checking
its owner and expected deployed policy. The isolated fixture passed
customer/staff own-only reads, current-admin full reads, anonymous denial,
and loss of admin helper access on an already-issued suspended-admin session.
The migration safety, deployment-manifest, and DB-pack self-checks passed.
Real JWT, effective-grant, other deployed policy, and production behavior
still require owner staging/deployed verification with query 52.
The first expanded local-suite run passed 77/78; its only failure was the
final report's stale script/check counts after adding the new fixture. After
updating those counts, the compact suite passed 78/78. This does not prove
the migration will match the owner database's policy set or function owner.

## Staff Customer Search Boundary (25 September 2026)

Staff Admin previously called the browser `searchUsers` helper, which used
`profiles.select('*')` and depended on a broad or broken profile read policy.
The screen now calls a `manage-staff` action that checks current `tab_users`
permission and suspension, excludes staff/admin rows, and returns only the
customer fields needed for search and adjustment. The staff action and owner
management branches also reject suspended accounts with existing sessions.
The runtime-boundary test executes the extracted handler with mocked service
queries: permitted customer search succeeds, an extra secret field is omitted,
and suspended, unpermitted, and ordinary callers make zero search reads.
Source-order and Deno type-check passed. Real JWT/RLS/Edge staging behavior
and mixed-version rollout remain owner verification tasks.

The owner browser `getAllUsers`/`searchUsers` queries also used `SELECT *`
against `profiles`. They now request only the fields consumed by owner user
search and account review. A source regression check prevents these two
readers from reverting to wildcard selection; `npx tsc --noEmit` and the
targeted runtime-boundary test passed. Owner staging must verify email, UUID,
and virtual-account lookup and inspect the returned projection. This does
not change database column grants or prove the deployed browser is updated.

## Discount Code Read Scope (25 September 2026)

The old active-code SELECT policy allowed ordinary users to list every
store-wide code; checkout preview also read full rows. New RPCs return only
the discount for a supplied, eligible code and provide an admin/permissioned
staff list, with customer-specific reward codes withheld from staff. The
browser now uses those RPCs. Migration `20260925015000` removes ordinary
table reads only after the matching browser build. An isolated PostgreSQL
role fixture reproduced old enumeration and passed customer, reward-owner,
staff, admin, suspended, and anonymous checks after the contract phase.
Real JWT, effective grants, deployed policies, and checkout UX remain
staging/owner verification tasks; this does not establish live deployment.
After wiring the fixture into the local suite and updating the migration
grant review, the compact suite passed 79/79. `npx tsc --noEmit`, the
deployment-manifest check, owner handoff check, and `npm run build` passed;
the build retained its existing chunk-size and mixed-import warnings.

## Limited-Use Discount Capacity (25 September 2026)

`process-purchase` previously checked `max_uses` before authorization, then
read and overwrote `used_count` after credentials were delivered without
checking the update result. A one-use code could be accepted by concurrent
requests or have an increment lost. Migration `20260925016000` reserves a
use under a discount-row lock during the order insert and posts one completed
use in the order-completion transaction. The Edge route now fails code
redemption closed until the service-only DB readiness RPC is present and no
longer writes `used_count` after delivery. An isolated PostgreSQL fixture
passed one-use, completion replay, failed-order release, wrong amount,
reward-owner, and immutable-link cases, plus query 54. Actual concurrent
connections, mixed-version rollout, and deployed trigger behavior are NOT
RUN locally and remain owner staging verification tasks.
The compact local suite passed 80/80 after this change. The
`process-purchase` Deno type-check, deployment-manifest check, handoff check,
and incident-completion audit also passed.
