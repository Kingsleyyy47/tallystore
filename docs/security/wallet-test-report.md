# Wallet Security Test Report

Prepared: 2026-09-19

This report records what has been verified from the repository and what still
requires a real Supabase/Postgres or production owner check. It is not proof
that the live service is safe until the migrations, Edge Functions, Vercel app,
provider settings, and active workers are deployed and verified.

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
| `npm run security:wallet:audit` | `PASSED` | Incident completion audit verified the required security-prompt deliverables, B15 final-report questions, T01-T80 regression matrix rows, evidence labels, owner proof boundaries, the wallet state-machine document, provider-evidence validator coverage, deployed-version evidence coverage, and dynamically discovered all 37 local wallet-security scripts represented in the repository. The audit parses all 80 regression rows, fails on any matrix status not defined in the glossary, and reports unresolved proof boundaries explicitly; provider, staging, concurrency, and owner proof remain separate from local source checks. |
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
| `node scripts/wallet-reconcile-readonly.mjs --help` and `node scripts/wallet-reconcile-readonly.mjs --self-test` | `PASSED` | Read-only reconciliation command help renders without requiring credentials and documents guarded live mode plus offline `--history-csv` review. Its no-Supabase self-test validates CSV parsing/classification and a miniature trusted-backing calculation where verified deposits and admin credits with matching approval metadata create trusted principal, while loose refunds and forged boolean-only trusted markers remain visible in raw totals but do not restore spendable backing. The live report includes failed/cancelled/refunded rows with posted debits, matching refunds, and unresolved debit exposure. Reconciliation now uses one shared debit classification for backing totals and failed/refunded exposure drill-downs, including `admin_debit`, `staff_debit`, `chargeback`, and `correction_debit`. Live/staging reconciliation was not run from this environment. |
| `node scripts/wallet-reconcile-readonly.mjs --history-csv "C:\Users\HP ELITEBOOK\Downloads\Supabase Snippet Untitled query (1).csv,C:\Users\HP ELITEBOOK\Downloads\rileygreen-ledger-analysis.csv,C:\Users\HP ELITEBOOK\Downloads\rileygreen-ledger-mismatches.csv,C:\Users\HP ELITEBOOK\Downloads\rileygreen-unexplained-wallet-changes.csv" --json` | `PASSED` | Offline CSV mode classified the raw Riley Supabase ledger export as countable evidence and the derived analysis/mismatch/unexplained-change exports as support-only with `countedInTotals: false`. The corrected count used 140 raw rows, reported 79 completed purchase transaction rows totaling NGN 2,331,442, and avoided double-counting derived analysis rows. This is CSV evidence only, not provider or supplier proof. |
| `npx eslint scripts/security-wallet-check.mjs scripts/wallet-reconcile-readonly.mjs --max-warnings=0` | `PASSED` | Focused lint passed for the security check and read-only reconciliation command. |
| `npx tsc --noEmit --pretty false` | `PASSED` | TypeScript compile check completed without errors. |
| `git diff --check -- ...` | `PASSED_WITH_LINE_ENDING_NOTICE` | No whitespace errors in the latest security-check, webhook, reconciliation, and docs edits; Git warned that LF may become CRLF for some touched files. |
| `npm run lint` | `PASSED_WITH_EXISTING_WARNINGS` | Full lint completed with 0 errors and 25 existing warnings. |
| `npm run build` | `PASSED` | Vite production build completed; remaining warnings were browser-data, mixed static/dynamic import, and bundle-size warnings, not compile failures. |
| Direct wallet/source mutation search | `SOURCE_REVIEWED` | Manual `rg`/`Select-String` audit checked profile balance literals, legacy wallet RPC usage, `transactions` table references, profile table references in server functions, and refund callsites. The repeatable `security:wallet:source-mutations` audit now covers the same high-risk write patterns. The write-like customer money paths found were wallet-engine-backed RPC/helper calls; the only approved direct transaction mutation is the statement-scoped, balance-neutral admin ledger repair row with owner-evidence metadata and unchanged balance snapshots. |

## Not Run Locally

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

## Acceptance Boundary

Do not reopen a paused paid route because these local checks pass. Reopen only
after the owner verifies the deployed database permissions, active Edge Function
versions, provider secrets/webhooks, route behavior, and supplier outcome
handling listed in `wallet-owner-verification-checklist.md`.
