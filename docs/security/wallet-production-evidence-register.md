# Wallet Production Evidence Register

Prepared: 2026-09-19

Use this register while deploying and investigating the incident. Each item
separates repository evidence from production proof so unsupported value cannot
be treated as resolved just because code changed locally.

## Evidence Labels

- `SOURCE_REVIEWED`: the repository source has been inspected.
- `PATCH_IMPLEMENTED`: a repository change exists.
- `STATIC_CHECK_PASSED`: `npm run security:wallet` covers the source invariant.
- `LOCAL_BUILD_OR_TYPECHECK_PASSED`: local build, typecheck, lint, or Edge
  Function typecheck evidence exists. It does not prove deployment or runtime
  provider behavior.
- `LOCAL_DB_SECURITY_TESTS_PENDING`: needs local/staging Supabase with migrations
  applied, including effective role/grant/RLS/function execution tests.
- `PROVIDER_TEST_PENDING`: needs live provider sandbox/dashboard or
  route-specific runtime proof. Local no-network provider mocks are recorded
  separately when they pass.
- `PRODUCTION_DEPLOYMENT_PENDING`: not proven live.
- `PRODUCTION_VERIFICATION_PENDING_OWNER`: owner must verify in production.
- `HISTORICAL_CAUSE_UNPROVEN`: live evidence has not identified the exact past
  exploit path.

## Standard Evidence Record

Use these field names for every production/staging/provider proof item:

```text
evidence id:
requirement:
production evidence link/path:
verified by:
verified at:
status:
notes:
```

When using the generated JSON evidence files, use the matching machine-field
names exactly:

```text
evidenceId
verifiedBy
verifiedAt
evidencePathOrLink
```

`verifiedAt` must be a parseable absolute timestamp such as
`2026-09-20T01:00:00Z`; informal values like "after deployment" are rejected by
the validators.

## Production Evidence Needed

| Area | Repository evidence | Production evidence still needed |
| --- | --- | --- |
| Wallet mutation map | `docs/security/wallet-mutation-map.md` identifies the controlled writer, payment/funding paths, purchase debit/refund paths, paused routes, and remaining production proof. Static checks ensure the map covers the core wallet boundaries. | Compare every deployed financial route, cron, worker, RPC, and migration against the map. Any missing route must be treated as `UNKNOWN` and paused or reviewed before it can move money. |
| Fulfillment map | `docs/security/wallet-fulfillment-map.md` identifies routes that can call suppliers, reveal credentials, create redeemable orders, or move money out. Static checks ensure the map covers the known paid surfaces. | Compare active deployed routes/workers/provider dashboards with the map. Any paid delivery surface not listed must remain paused until reviewed and tested. |
| Route inventory | `docs/security/wallet-route-inventory.md` classifies every repository Vercel API route, Supabase Edge Function, and frontend value surface as value delivery, funding/webhook, admin/internal, read-only/catalog, telemetry/utility, or paused/manual-review. `npm run security:wallet:route-inventory` fails if a new route/function is not classified. | Compare the deployed Vercel routes, Supabase functions, scheduled jobs, and frontend build with the inventory. Any active route not represented in the inventory and maps must be treated as `UNKNOWN` and paused or reviewed before it can move money, reveal credentials, or accept funding. |
| Environment and secret inventory | `docs/security/wallet-env-secret-inventory.md` lists browser-public variables, server-only provider secrets, webhook secrets, cron secrets, pause flags, and owner proof fields. `npm run security:wallet:env-secrets` scans source env usage, rejects browser-exposed provider secrets, and verifies `.env.example` contains placeholders instead of real-looking keys. | Compare Vercel env vars, Supabase Edge Function secrets, scheduled job secrets, and provider dashboard webhook secrets with the inventory. Rotate any value exposed in `.env.example`, chat, screenshots, browser bundles, or public logs. Confirm pause flags stay false/unset and no payment/supplier secret uses a `VITE_` prefix. |
| Wallet security event ledger | `20260919017000_create_wallet_security_events.sql` creates restricted `wallet_security_events` and service-role-only `record_wallet_security_event`. `20260919018000_capture_wallet_security_events.sql` copies blocked direct ledger writes, blocked profile balance writes, and profile financial freezes into that event ledger. The wallet engine also carries `p_metadata.request_forensics` through a transaction-local setting before freeze updates, so denied unbacked purchase freezes can be reviewed with route, request ID, IP, user-agent, device fingerprint, user-agent hash, and proxy IDs when the caller supplied sanitized metadata. Static checks verify RLS is enabled without forced-RLS breakage, browser write revokes, explicit service-role read/insert policies, service-role function execute grant, capture triggers, and fields for request ID, actor, IP/device context, old/new financial values, B/H/A evidence, result, and denial code. | Confirm the deployed table, function, and capture triggers exist; browser roles cannot insert/update/delete; admins can read through the RLS policy; service-role wallet/security paths can record events; and event rows appear for owner-controlled blocked ledger, blocked balance, and denied/frozen purchase test cases with request context but without exposing secrets or product credentials. |
| Purchase request forensics | Product, SMM, SMS OTP, and Telegram checkout routes attach sanitized `request_forensics` metadata to wallet-engine debits and same-request rollback/refund movements. The metadata includes request ID, route label, IP, user-agent hash, optional device fingerprint, and proxy IDs. The freeze-event capture migration reads the same metadata when the wallet engine freezes an unbacked purchase attempt. Static checks verify the helper and metadata wiring for those high-risk routes. | In staging/deployed owner-controlled purchases, inspect resulting `transactions.metadata->'request_forensics'` and denied-purchase `wallet_security_events` rows, then confirm they record the route and request context without secrets, raw auth headers, product credentials, OTPs, or payment tokens. |
| Admin security event review | `src/pages/AdminPage.tsx` loads `wallet_security_events` in the User Details modal, shows a Security Events card with see-all support, and includes security-event rows in the user-history CSV export. | Open an owner-controlled affected/sandbox user after migration deployment and confirm the Security Events card shows blocked ledger, blocked balance, or freeze events with timestamps/reasons; download CSV and confirm `security_event` rows are included. |
| T01-T80 regression matrix | `docs/security/wallet-regression-matrix.md` records each mandatory scenario with current evidence status and remaining proof. Static checks ensure every T01-T80 row remains present. | Fill in staging DB, live provider sandbox/dashboard or route-specific runtime proof, concurrency/fault, and production owner evidence before marking any row complete. Rows marked `NOT_IMPLEMENTED_AS_FULL_TEST` are explicit remaining engineering gaps, not passed tests. |
| Wallet financial model | `docs/security/wallet-financial-model.md` defines the backed-funds calculation, aggregate refund conservation rule, the database-backed reserve/capture boundary for local products, the paused provider-route policy, local outbox and partial-refund coverage, chargeback debt preservation, and freeze/review behavior. Static checks ensure those assumptions stay visible. | Verify the deployed local product route uses the reserve/capture functions and that provider routes remain paused until their own reserve/dispatch/retry, partial-refund, chargeback, and outbox evidence exists. |
| Linked refund principal proof | Wallet engine, trusted-principal trigger, fraud scanner, AdminPage fraud review, and read-only query pack calculate refund restoration only from refund rows linked to an original `trusted_principal_authorized` wallet debit that also has positive `trusted_principal_debit_amount` evidence, then cap restoration by the linked original debit amount and trusted debit amount. Loose or ambiguous refund rows, including forged boolean-only trusted markers, remain evidence for review and cannot create trusted principal or trusted available balance. | After deployment, run `docs/security/wallet-readonly-query-pack.sql` section 3 for affected and owner-controlled test accounts. Preserve output showing `linked_eligible_refunds`, `eligible_refunds`, `trusted_debit_capacity`, and `backed_available`. Confirm a standalone refund row without `source_debit_transaction_id`, `source_debit_idempotency_key`, source-order linkage, or `original_reference` does not increase `linked_eligible_refunds`; confirm a debit with only `trusted_principal_authorized` but no positive `trusted_principal_debit_amount` does not increase eligible refunds; and confirm the Admin fraud section shows the same uncovered exposure rather than treating the loose refund as eligible restoration. |
| Reserve-first order authorization columns | Migration `20260919026000_add_order_financial_authorization_columns.sql` adds nullable `wallet_reservation_id`, `fulfillment_outbox_id`, `financial_authorization_status`, `financial_security_version`, and `financial_authorization_reference` columns to existing order tables, plus status constraints and indexes, as the additive schema needed before route-specific reserve/outbox migration. | After applying migrations, run `docs/security/wallet-readonly-query-pack.sql` section 10e and preserve a result with zero rows. Do not reopen routes that depend on reserve-first holds or outbox dispatch until the deployed schema has those columns and the staging DB security pack passes. |
| Database-owned financial-security epoch | Migration `20260919027000_harden_financial_security_version.sql` preserves the epoch from ordinary profile writes, initializes ordinary inserts at `1`, and increments it whenever suspension/reinstatement state changes. Reservation creation, outbox enqueue, and worker claim compare against that epoch; enqueue also requires a committed active reservation. | After applying migrations, query the deployed trigger/function definitions and run the staging DB pack cases for suspension, reinstatement, stale reservation, stale outbox message, and missing reservation. Preserve evidence showing the epoch advanced and no stale dispatch was sent. |
| Local product reserve/capture boundary | Migration `20260919028000_migrate_product_purchase_reserve_capture.sql` exposes service-role-only `authorize_product_purchase` and `complete_product_purchase`. The first locks trusted funds, available inventory, and a non-delivered order; the second captures the hold, persists credentials, and marks the same inventory sold atomically. | In staging, run zero-balance, insufficient-trusted-funds, concurrent inventory, exact replay, changed-idempotency, stale-epoch, completion-conflict, and frozen-account cases. Preserve evidence that denied orders make no credential delivery and that successful completion creates exactly one capture and one sold inventory transition. |
| Wallet state machine and review workflow | `docs/security/wallet-state-machine.md` separates account access state, wallet financial state, and service health state. It documents the decision matrix for ordinary insufficient funds, unbacked value, forged/duplicate webhooks, frozen wallets, dependency outages, chargebacks, unknown supplier outcomes, frozen-wallet incoming payments, and controlled review recovery. Static checks and the owner handoff checker require this artifact. | In staging and production, confirm customer-facing and admin-facing behavior matches the decision matrix: honest insufficient funds is a normal decline, unbacked value freezes before delivery, forged webhooks do not punish named customers, legitimate deposits while frozen do not auto-unfreeze, admin recovery records reviewer/evidence, and paused routes remain paused until route-specific proof exists. |
| Incident final report | `docs/security/wallet-incident-final-report.md` separates source-reviewed findings, implemented patches, fake-gateway assessment, commands run, tests not run, owner deployment actions, and remaining risks. Static checks ensure the report keeps those sections. | Treat the final report as repository evidence only. Add deployment timestamps, production query output, provider dashboard proof, and affected-account evidence before calling the live system safe. |
| Deployed version evidence file | `npm run security:wallet:deployed-versions -- --format json` lists the reviewed source commit/fingerprints, every Supabase Edge Function, the app build surface, migrations, and pause flags. `--filled-template` creates a private owner-fillable JSON file, and `--validate deployed-version-evidence.json` fails closed for missing surfaces, duplicate surfaces, missing per-surface required proof rows, pending/non-passed proof rows, missing proof references, unknown proof rows, missing deployment references, invalid `verifiedAt` timestamps, altered expected fingerprints, mismatched SHA-256 fingerprints, or secret-looking values. | After deployment, fill the private evidence file from Vercel, Supabase function, migration, and env/pause-flag dashboards. Confirm incident pause flags include `SMM_ORDERS_ENABLED=false`, `SMS_OTP_ENABLED=false`, and `TELEGRAM_ORDERS_ENABLED=false`. Preserve validation output proving the deployed app build, every deployed Supabase function, database migrations, pause flags, and every generated `evidence[].proof` row match the reviewed source or an explicitly approved deployment artifact. Do not reopen routes if any deployed version row or required proof row is pending, blocked, failed, missing, duplicated, timestamp-invalid, fingerprint-altered, fingerprint-mismatched, unknown, or from an older unsafe build. |
| Dirty source artifact approval | The deployed-version evidence template records `source.dirty`. The validator requires `source.dirtyArtifactApprovedBy`, `source.dirtyArtifactApprovedAt`, `source.dirtyArtifactEvidencePathOrLink`, and `source.dirtyArtifactReviewNote` whenever the reviewed source was generated from a dirty worktree, and rejects informal approval timestamps. | If `source.dirty` is true, preserve the exact reviewed artifact or patch bundle outside the repository, record who approved it, record an absolute approval timestamp, and link that private artifact evidence in the filled deployed-version file. Do not treat a dirty local fingerprint as production proof unless the dirty artifact approval fields validate. |
| Partner API closure | Vercel bridge returns `503`; Supabase `partner-api` hard-pauses non-admin actions; existing partners are marked inactive by migration; partner tables are not directly readable or writable by browser roles; partner/API evidence cascades are replaced with restrictive foreign keys; static check rejects a proxy fallback. | Deploy Vercel app and `partner-api`; apply `20260919007000_pause_existing_api_partners.sql`, `20260919008000_harden_partner_table_authority.sql`, and `20260919021000_restrict_partner_cascade_evidence.sql`; call the public endpoint and Supabase function with a partner key and confirm `PARTNER_API_PAUSED` or inactive-partner denial; verify anon/authenticated have no partner table read/write grants; run the read-only cascade query and confirm zero rows for `auth.users` and partner/API evidence cascades. |
| PocketFi Vercel bridge | Public bridge disables body parsing, forwards the raw webhook body and provider verification headers to `webhook-pocketfi`, fails closed without a verification header, and does not inject server webhook secrets into requests. | Deploy Vercel app; send an unsigned owner-controlled request and confirm `401`; send a provider-shaped signed/sandbox request and confirm Supabase `webhook-pocketfi` receives the raw body and performs verification; verify Vercel env secrets are not used by the public bridge route. |
| PocketFi partner payments during pause | PocketFi branch logs partner payment as manual review when partner API returns `PARTNER_API_PAUSED`. | Send or inspect an owner-controlled test/sandbox partner PocketFi event and confirm no partner order is fulfilled. |
| Wallet engine permissions | Migrations revoke public/browser execution and grant wallet engine to `service_role`. | Query live function grants and attempt restricted-role execution/write tests. |
| Legacy balance RPC retirement | Legacy balance RPCs are revoked from browser roles so old helper functions cannot be called directly by customers. | Verify `anon` and `authenticated` cannot execute `update_wallet_balance`, `credit_crypto_balance`, `deduct_crypto_balance`, `transfer_crypto_to_wallet`, or `withdraw_referral_balance_to_wallet`. |
| Profile financial-field protection | Migrations guard protected fields, force new balances to zero for ordinary inserts, and require narrow service-role-only RPCs for PocketFi account metadata, referral attribution, customer suspension, and staff-role changes. | Attempt ordinary authenticated profile update/upsert with wallet/admin/suspension fields and confirm blocked/no-op behavior plus audit row. In staging, attempt a direct service-role profile update outside the narrow RPCs and confirm protected fields remain unchanged. |
| Referral attribution authority | `apply-referral` is JWT-authenticated, derives the profile from the authenticated user, ignores caller-provided user IDs, and delegates attribution to `apply_profile_referral_attribution`, which blocks self-referral and preserves existing attribution. Referral withdrawals are hard-paused in source and do not call the legacy referral-to-wallet RPC. | Verify deployed `apply-referral` has JWT verification enabled; confirm browser and direct service-role profile writes cannot change `referral_code`, `referred_by`, or `referral_balance` outside the narrow RPC; confirm referral withdrawal returns `REFERRAL_WITHDRAWALS_PAUSED` and current source does not read `REFERRAL_WITHDRAWALS_ENABLED`. |
| Direct ledger mutation protection | Ledger trigger skips/audits direct `transactions` writes outside wallet engine. | Attempt direct insert/update/delete as browser role and service path not using wallet engine; confirm blocked/audited behavior. |
| Purchase backing gate | Wallet engine computes trusted principal only from approved admin credits and verified gateway deposits with matched provider evidence, then applies eligible refunds and prior debits. It returns `WALLET_UNBACKED_FUNDS` on mismatch. | In staging/local DB, seed fabricated balance with no backing and confirm every purchase route denies before supplier/inventory delivery. Also seed a deposit-looking ledger row with only an external payment ID and confirm it is not trusted. |
| Real DB concurrency proof | `npm run security:wallet:db-concurrency -- --help` verifies the guarded runner is present. The full runner uses real `psql` sessions against staging/local/owner-controlled Postgres, seeds verified test top-ups through `apply_wallet_transaction`, launches concurrent over-total purchases, duplicate refunds, and, when a second fixture is supplied, duplicate provider-payment claims across two wallets. It verifies exactly one purchase, one linked refund, and one shared provider credit can commit. It also verifies an unbacked purchase denial durably freezes the wallet without inserting a purchase ledger row, then resets the supplied ordinary test wallet(s) to zero. | After migrations are deployed to staging/local DB, run the full command with `TALLYSTORE_DB_TEST_ENV`, `TALLYSTORE_DB_CONCURRENCY_ACK=I_UNDERSTAND_COMMITTED_TEST_WALLET_MUTATIONS`, `SUPABASE_DB_URL`/`DATABASE_URL`, an owner-controlled ordinary non-admin/non-staff `--test-user-id`, and preferably a different ordinary `--second-test-user-id`. Preserve the JSON output showing one purchase race winner, one refund race winner, one provider-identity race winner when the second fixture is supplied, durable unbacked-freeze proof, final balance checks, and cleanup status. |
| Admin unsuspend review gate | `admin-adjust-balance` recalculates trusted principal from approved admin credits and verified gateway deposits with matched provider evidence, then applies completed debits, linked eligible refunds, and stored wallet balance before `unsuspend_user`; insufficient backing returns `409 WALLET_REVIEW_REQUIRED` with raw `completed_refunds`, `linked_eligible_refunds`, and `eligible_refunds`, and leaves bans/suspension active. PocketFi evidence in this path selects the processed flag, verified amount, and verified reference that the verifier checks. The transaction query probes for `idempotency_key` before selecting it so a stale schema cache or mixed migration state does not turn unsuspend review into a column-cache error. | In staging, attempt to unsuspend a fabricated unbacked wallet and confirm the account stays suspended and fraud bans remain active. Include a loose refund row and confirm it appears in raw completed refunds but not linked eligible refunds; then reconcile with approved evidence and confirm unsuspend succeeds only after the backing check passes. Also run the check before and after applying the idempotency-key migration, or with a stale schema cache, to confirm the review path fails closed rather than crashing on a missing column. |
| Chargeback debt handling | Wallet engine allows `chargeback`/`correction_debit` to post a negative wallet balance and immediately freezes the account; staging SQL pack seeds this case inside a rollback transaction. `admin-adjust-balance` also exposes a controlled manual `record_chargeback` action that requires a provider/dispute reference, posts through the wallet engine, and places the customer into review. | In staging, post an owner-controlled chargeback larger than the wallet balance and confirm the negative debt is preserved, account remains frozen, and no purchase route can dispatch value afterward. Also verify the Admin page `Record Chargeback` action creates exactly one `chargeback` ledger row for the same reference, not an `admin_debit` or direct profile edit. |
| Admin timestamp display | Admin user details and fraud review rows use shared helpers that render absolute date/time, local timezone, and relative age together for joined, suspended, and IP evidence timestamps. | Open an affected/sandbox user in the deployed Admin page and confirm joined, suspended, and IP seen timestamps show exact timestamp plus relative age without contradictory context. |
| Payment top-up evidence | `create-wallet-topup` must store server-owned `pending_payments` evidence before returning a checkout URL; `verify-and-credit-wallet` requires that row, server verification, amount match, returned NGN currency when present, configured Ercas merchant/environment match when present, wallet-engine credit with matching `metadata.verified_amount_ngn`, and exact pending-payment row consumption. PocketFi wallet credit requires raw-body signature verification, a matched `pocketfi_webhook_logs` row, matching user, and matching `metadata.verified_amount_ngn`. An `external_payment_id` by itself is not trusted spendable principal. Definitive provider failure, amount mismatch, currency mismatch, merchant mismatch, and environment mismatch close the pending evidence as `failed`; timeout/unavailable and real pending states stay pending for retry. PocketFi webhooks reject duplicate references that do not match the original credited user and amount, and the public PocketFi bridge preserves raw-body signature verification. | Use sandbox Ercas/PocketFi records to confirm duplicate, wrong-wallet, wrong-amount, wrong-currency, wrong merchant/environment, unsigned, missing-pending-payment, missing verified amount, and fake external-ID cases do not credit or do not count as trusted principal; verify definitive Ercas failures/mismatches mark the local pending row `failed`; verify expected Ercas merchant/environment env vars are set when provider responses expose those fields; verify `pending_payments` is not browser-writable and has positive amount/nonblank reference constraints. |
| Scheduled pending-payment recovery | `check-pending-payments` is cron/service-secret gated, optimistically claims each pending row by `check_count` before verification, and only invokes `verify-and-credit-wallet` with the pending payment owner. Static checks reject direct wallet balance or ledger writes in that function. | Confirm the deployed schedule/cron secret is owner-controlled, old cron versions are not still running elsewhere, overlapping recovery runs produce one claim and one skip, duplicate pending checks do not double-credit, timeout/pending provider statuses do not change wallet balances, and failed provider evidence is not retried after being closed. |
| JWT-disabled Edge Functions | Static checks require every `verify_jwt = false` function to have an internal boundary: PocketFi/NOWPayments/DaisySMS secrets or signatures, cron/service-role checks for scheduled workers, partner API hard pause/key checks, or site-visit-only writes. | Compare deployed function config with repository `config.toml`; confirm no user-authenticated money route has JWT disabled without its own authorization gate. |
| Crypto top-up and transfer | Crypto top-up paused; NOWPayments webhooks hard-hold verified finished payments for manual review; `transfer_crypto_to_wallet` replaced with disabled function; UI transfer removed. | Confirm live UI does not expose transfer, direct RPC execution is revoked/disabled, and `CRYPTO_AUTO_CREDIT_ENABLED` does not auto-credit live webhooks. |
| Legacy webhook routes | Vercel Ercas webhook routes return `410`; active credit path is server verification. | Hit deployed legacy URLs and confirm no crediting path remains active. |
| Provider delivery routes | Product/SMM/SMS/Telegram paths use wallet engine or are paused; bills/Bitrefill/withdrawals remain paused by default. Local no-network adapter mocks prove denied/paused/frozen/insufficient/conflicting requests create zero mock provider calls across SMM, DaisySMS, iStar, Bitrefill, SageCloud bills, and SageCloud withdrawals. | Run owner-controlled deployed route checks proving denied orders create zero real supplier calls and reveal zero credentials; provider sandbox/dashboard contracts still need verification before reopening paused routes. |
| Provider reopening evidence file | `npm run security:wallet:provider-evidence -- --filled-template` creates a fillable JSON evidence file, and `--validate provider-evidence.json` checks every provider, required proof item, standard evidence field, `deploymentEvidenceReference`, passed provider/proof status, sandbox/dashboard reference, and secret-looking value. Pending, blocked, failed, missing deployment evidence linkage, or missing proof makes validation fail closed. | Generate the fillable file, fill it with sanitized owner-controlled sandbox/dashboard proof, link every provider row to the validated deployed-version evidence through `deploymentEvidenceReference`, validate it, and preserve the validation output beside the deployment evidence before any provider-backed route is reopened. |
| Paid-route reopening readiness gate | `npm run security:wallet:reopen-readiness -- --self-test` verifies the final evidence-bundle gate without contacting live services. `--init-bundle C:\private\wallet-reopen-evidence` generates private deployment-plan, fillable deployed-version, production, provider, denied-probe, deployed-smoke-result, and README files. The full command requires a validated deployment plan, validated deployed-version evidence, production evidence, provider evidence, owner denied-route probe definitions, and deployed-smoke result JSON. It fails closed if any proof file is missing, stale, pending, failed, malformed, secret-looking, not linked to deployed-version evidence, or if deployed smoke did not run with owner denied probes and Edge authorization. | Generate the private bundle, validate the generated deployment plan, fill it with sanitized owner-controlled proof, replace the deployed-smoke placeholder with real `--json` smoke output, then run the full command immediately before any paid route is reopened. Preserve the JSON output with the route's reopening record. A passing readiness gate is still not deployment by itself; it is the required final evidence check before owner approval. |
| iStar webhook | `api/webhook-istar.ts` disables body parsing, verifies HMAC over the raw body using `ISTAR_WEBHOOK_SECRET`, and uses `apply_wallet_transaction` for failed-order refunds. | Confirm the deployed iStar dashboard secret matches Vercel, invalid signatures return `401`, valid failed-order callbacks refund once, and duplicate callbacks do not double-refund. |
| Refund/retry idempotency | Functions use deterministic refund/debit idempotency keys and block orphan-ledger retries. | Run concurrent duplicate/retry tests in staging/local DB and provider mocks. |
| Admin/staff adjustments | Admin/staff adjustments route through wallet engine; balance-neutral repair requires owner-evidence metadata. | Confirm live admin action creates wallet-engine ledger rows and no direct profile balance write. |
| Identity/delete audit | Migrations block profile/auth deletion and audit identity changes. | Verify live triggers exist and affected user records cannot be erased by ordinary app paths. |
| Read-only reconciliation report | `scripts/wallet-reconcile-readonly.mjs` reads one profile plus wallet, order, payment, crypto, and provider-side local evidence tables; static check rejects Supabase mutation/RPC methods in the script. Offline `--history-csv` mode dedupes exported CSV rows, excludes matching completed order rows from recorded-loss totals, and classifies derived analysis/mismatch/unexplained-change CSVs as support-only with `countedInTotals: false`. | Run the live command from an owner-controlled machine with production env guards and preserve the JSON output for each affected account. Use offline CSV mode on downloaded exports before manual loss calculations. Compare unexplained differences, duplicate references, orphaned ledgers, pending-payment evidence, and unmatched completed order rows before making corrections. Do not add derived analysis rows to raw transaction/order totals. |

## Unknown-Outcome Supplier Exposure

Before reopening any route, classify existing orders and provider attempts:

- `not_dispatched`: no supplier request or credential reveal occurred.
- `dispatch_claimed`: local worker claimed the order but provider outcome is
  not confirmed.
- `submitted_or_processing`: supplier accepted or may have accepted the request.
- `fulfilled`: product value was delivered or credential/code was revealed.
- `definitively_failed`: provider contract confirms no delivery and no delayed
  success can occur.
- `outcome_unknown`: cannot safely retry or refund without manual review.

Unknown outcomes should stay held/reviewed. Do not blindly retry the supplier,
release a hold, or issue a refund until the provider contract and evidence make
the outcome clear.

## Provider Capability Limits To Verify

| Provider/surface | Capability to confirm |
| --- | --- |
| Ercas | Server verify endpoint, canonical transaction ID, amount/currency matching, duplicate callback behavior. |
| PocketFi | Webhook signature/secret behavior, duplicate delivery behavior, virtual account mapping, manual-review behavior for partner accounts while paused. |
| NOWPayments | IPN signature rules, server status verification, handling of disappearing/partial/underpaid crypto payments. |
| iStar/Telegram | Raw-body webhook signature enforcement, provider order lookup, duplicate refund/callback behavior. |
| DaisySMS | Number acquisition cancellation/release rules, duplicate status callback behavior, code retrieval lifecycle. |
| SMM panel | Provider idempotency support, status lookup authority, timeout and duplicate submission behavior. |
| Bitrefill | Order idempotency, cancellation/refund contract, delayed fulfillment handling. |
| Withdrawal provider | Transfer idempotency, returned failure format, duplicate response behavior. |

## Reopening Gate

For each route, record:

```text
route:
deployed app version:
deployed function version:
migrations applied through:
payment/provider sandbox test:
restricted-role DB test:
denied-order supplier calls observed:
refund/retry duplicate test:
owner approved:
date/time:
```

No route should move from paused to active without this entry filled in and
evidence retained outside the public repository.

## Staging SQL Test Evidence

Before production rollout, run
`docs/security/wallet-db-security-test-pack.sql` against staging or an
owner-controlled database and record:

```text
database/project:
test profile id:
migrations applied through:
result row:
errors:
date/time:
operator:
```

Do not run it against a real customer. The file ends with `ROLLBACK`, but it
still attempts financial/security mutations before rolling them back.
