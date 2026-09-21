# Wallet Security Owner Verification Checklist

This checklist is for production verification after deploying the repository
patches and migrations. It is intentionally read-first and pause-first: do not
bulk-edit balances or delete evidence while collecting facts.

## Before Deployment

- Confirm the current deployed app version and deployed Supabase function
  versions.
- Preserve exports for affected profiles, transactions, orders, payment records,
  provider confirmations, webhook logs, and supplier outcomes.
- Keep partner API, bills, gift cards, withdrawals, crypto top-up, SMM/social
  boost orders, SMS OTP rentals, Telegram Stars/Premium orders, referral
  withdrawal, direct live account fulfillment, manual restock, and auto-restock
  disabled. The local pre-stocked product route is the exception: it is
  migrated to `authorize_product_purchase`/`complete_product_purchase` and
  must be deployed with migration `20260919028000`. Checkout live supplier
  fallback remains hard-paused until it is redesigned to authorize backed funds
  before any supplier call.
- Confirm no production env var is set to `true` for:
  `BILLS_ENABLED`, `BITREFILL_ENABLED`, `WITHDRAWALS_ENABLED`,
  `REFERRAL_WITHDRAWALS_ENABLED`, `CRYPTO_TOPUP_ENABLED`,
  `SMM_ORDERS_ENABLED`, `SMS_OTP_ENABLED`, `TELEGRAM_ORDERS_ENABLED`,
  `LIVE_ACCOUNT_FULFILLMENT_ENABLED`, `AUTO_RESTOCK_ENABLED`,
  `MANUAL_RESTOCK_ENABLED`.
- `REFERRAL_WITHDRAWALS_ENABLED` is a legacy old-build guard only; the current
  `withdraw-referral-balance` function is hard-paused in source and should not
  read that flag.
- Partner API is hard-paused in code. There is no environment variable that
  should reopen public partner calls during this review.

## Deploy

- Apply migrations in timestamp order.
- If the earlier security-definer-view migration failed with a
  `referred_by` uuid/text error, rerun the patched migration set. The
  `20260919006000_fix_referral_lookup_casts.sql` follow-up normalizes
  `referral_lookup.referred_by` and backfills it with an explicit cast.
- Run `npm run security:wallet` before deployment. It should report 89 passing
  static wallet-security checks.
- Run `npm run security:wallet:local -- --compact` before deployment. It
  should pass 50 repository-local checks, run `npx deno` checks for all local
  Edge Function entrypoints, and report Docker, `psql`, and direct Deno
  availability honestly for the machine where it is run. The suite has bounded
  child-check and tool-probe timeouts; if a slower owner machine needs more
  time, set `TALLYSTORE_WALLET_LOCAL_CHECK_TIMEOUT_MS` or
  `TALLYSTORE_WALLET_TOOL_PROBE_TIMEOUT_MS` explicitly and preserve the output.
- Run `npm run security:wallet:admin-review` before deployment. It should
  confirm that only verified gateway deposits and approved admin credits create
  trusted principal, refunds do not create principal, staff credits queue for
  admin review, and unbacked wallets cannot be unsuspended by balance editing.
- Run `npm run security:wallet:db-pack -- --help` and
  `npm run security:wallet:db-pack -- --self-test` before deployment to confirm
  the guarded staging DB runner is available and its SQL-pack/user-id
  injection/redaction guardrails pass without a database. Run the full command
  only against staging/local/owner-controlled Postgres after migrations, with
  `TALLYSTORE_DB_TEST_ENV`, `TALLYSTORE_DB_TEST_ACK`,
  `SUPABASE_DB_URL`/`DATABASE_URL`, and an ordinary non-admin/non-staff
  `--test-user-id` plus a separate current-admin `--test-admin-id`. The
  `psql` execution is bounded by
  `TALLYSTORE_DB_TEST_TIMEOUT_MS`; preserve timeout output as failed evidence
  rather than rerunning blindly.
- Run `npm run security:wallet:db-concurrency -- --help` and
  `npm run security:wallet:db-concurrency -- --self-test` before deployment to
  confirm the guarded real-Postgres concurrency runner is available and its
  local argument/UUID/SQL-literal/redaction guardrails pass without a database.
  After migrations are applied in staging/local/owner-controlled Postgres, run
  the full command only with a dedicated ordinary non-admin/non-staff test customer,
  `TALLYSTORE_DB_TEST_ENV`, `TALLYSTORE_DB_CONCURRENCY_ACK`,
  `SUPABASE_DB_URL`/`DATABASE_URL`, and `--test-user-id`. Add
  `--second-test-user-id` with a different dedicated ordinary test customer to
  also prove the same provider payment identity cannot fund two wallets. This
  runner performs committed fixture mutations, seeds verified test top-ups, runs
  concurrent purchase/refund/provider-identity races through
  `apply_wallet_transaction`, verifies exactly one purchase, one refund, and
  when the second fixture is supplied one shared provider credit. It also
  verifies an unbacked purchase denial leaves the wallet frozen after the
  function returns while inserting no purchase ledger row, then resets those
  test wallets to zero.
- Run `npm run security:wallet:deployed-smoke -- --help` before deployment to
  confirm the safe deployed-route smoke runner is available. After deploy, run
  the full command against staging/preview and then production with
  `--allow-production`; it only sends denied/paused requests and must not create
  orders, supplier calls, wallet credits, or top-ups. Without
  `TALLYSTORE_DEPLOYED_SMOKE_AUTHORIZATION`, paid Edge Function checks may stop
  at the platform/JWT auth wall and still prove safe denial. With an
  owner-controlled `TALLYSTORE_DEPLOYED_SMOKE_AUTHORIZATION`, those functions
  must return exact stable `*_PAUSED` codes for paused supplier-money routes.
  The runner also sends malformed product checkout payloads that must fail
  before order creation, wallet debit, provider dispatch, or value reveal. To
  prove the exact auto-restock pause code, also set
  `TALLYSTORE_DEPLOYED_SMOKE_CRON_SECRET` because auto-restock validates
  `x-cron-secret` before its pause gate.
- For deployed denied checkout behavior, copy
  `docs/security/wallet-deployed-denied-probes.example.json` to a private file
  outside the repository, replace the placeholders with owner-controlled
  staging test product/account values, validate it first with
  `npm run security:wallet:deployed-smoke -- --validate-owner-denied-probes C:\private\denied-probes.json`,
  and then run the smoke test with
  `TALLYSTORE_DEPLOYED_SMOKE_OWNER_DENIED_PROBES`,
  `TALLYSTORE_DEPLOYED_SMOKE_OWNER_DENIED_PROBES_ACK=I_UNDERSTAND_TEST_ACCOUNTS_MUST_BE_DENIED`,
  and `TALLYSTORE_DEPLOYED_SMOKE_AUTHORIZATION`. Use this to verify zero
  balance, low balance, frozen old-token product/SMM/SMS/Telegram attempts,
  frozen provider-money attempts for bills, Bitrefill, and withdrawals, and
  stale-client-balance attempts return denied responses with
  `body.success !== true`. Run separate probe files or separate invocations when
  the scenarios require different owner-controlled test accounts, such as
  zero-balance versus frozen-account tokens. Each HTTP probe is bounded by
  `TALLYSTORE_DEPLOYED_SMOKE_TIMEOUT_MS` or `--timeout-ms`;
  preserve timeout output as failed evidence rather than treating it as success.
  Do not put authorization tokens, cookies, cron secrets, provider secrets, or
  protected header overrides in the JSON probe file. The runner rejects
  `authorization`, `content-type`, `x-tally-smoke-test`, `cookie`, `host`,
  `x-cron-secret`, and secret-looking custom header values; provide credentials
  through the dedicated environment variables or CLI flags instead.
- Run `npm run security:wallet:env-secrets` before deployment. It should confirm
  provider secrets are server-only, source env usage is inventoried,
  `.env.example` contains placeholders only, and pause flags are documented.
- Run `npm run security:wallet:evidence` before deployment. It should confirm
  the production evidence register still has standard proof fields, provider
  capability rows, unknown-outcome supplier states, route reopening gate fields,
  and staging SQL evidence fields.
- Run `npm run security:wallet:deployed-versions -- --format json` before
  deployment to inspect the source deployment-version checklist. Generate a
  private fillable file with `npm run security:wallet:deployed-versions --
  --filled-template > deployed-version-evidence.json`, fill it from Vercel,
  Supabase function, migration, and env/pause-flag dashboards after deployment,
  then validate it with `npm run security:wallet:deployed-versions --
  --validate deployed-version-evidence.json`. Pending, missing, failed, blocked,
  fingerprint-mismatched, unknown-proof, missing-proof-reference, or
  secret-looking entries fail validation and mean old builds or old workers have
  not been ruled out. Every surface also has per-surface required proof rows;
  keep each generated `evidence[].proof` row, set it to `passed`, and attach a
  sanitized deployment/smoke/staging reference before treating that surface as
  verified. Keep the generated JSON field names unchanged, especially
  `verifiedBy`, `verifiedAt`, `evidencePathOrLink`, and `evidence`; `verifiedAt`
  must be a parseable absolute timestamp such as `2026-09-20T01:00:00Z`. If the
  generated file has `source.dirty: true`,
  the filled file must also include `source.dirtyArtifactApprovedBy`,
  `source.dirtyArtifactApprovedAt`, `source.dirtyArtifactEvidencePathOrLink`,
  and `source.dirtyArtifactReviewNote`; otherwise the validator rejects it.
  This prevents an uncommitted local worktree fingerprint from being mistaken
  for production proof without a preserved, owner-approved deployment artifact.
- Run `npm run security:wallet:provider-evidence -- --format json` before
  deployment to review the provider sandbox/dashboard evidence checklist. Run
  `npm run security:wallet:provider-evidence -- --filled-template >
  provider-evidence.json` to generate a fillable validation-shaped evidence
  file. Fill the relevant provider sections, then run
  `npm run security:wallet:provider-evidence -- --validate provider-evidence.json`
  before reopening any provider-backed route. Keep the generated JSON field
  names unchanged, especially `evidenceId`, `deploymentEvidenceReference`,
  `verifiedBy`, and `verifiedAt`; `deploymentEvidenceReference` must point to
  the validated deployed-version evidence file/output for the app/functions
  under test, and `verifiedAt` must be a parseable absolute timestamp, not a
  note like "after checking dashboard".
- Before reopening any paid route, run
  `npm run security:wallet:reopen-readiness -- --self-test` locally. Create the
  private evidence bundle with
  `npm run security:wallet:reopen-readiness -- --init-bundle C:\private\wallet-reopen-evidence`,
  fill the generated JSON files from owner-controlled dashboards/logs, validate
  the generated `deployment-plan.json`, replace the generated
  `deployed-smoke-result.json` placeholder with real
  `security:wallet:deployed-smoke -- --json` output, then run the full
  evidence-bundle gate with those owner-controlled files:
  `npm run security:wallet:reopen-readiness -- --deployment-plan C:\private\wallet-reopen-evidence\deployment-plan.json --deployed-version-evidence C:\private\wallet-reopen-evidence\deployed-version-evidence.json --production-evidence C:\private\wallet-reopen-evidence\production-evidence.json --provider-evidence C:\private\wallet-reopen-evidence\provider-evidence.json --denied-probes C:\private\wallet-reopen-evidence\denied-probes.json --deployed-smoke-result C:\private\wallet-reopen-evidence\deployed-smoke-result.json`.
  The command must pass before a route is considered for reopening. It fails
  closed when the deployment plan, deployment evidence, production evidence,
  provider evidence, denied-route probes, or deployed smoke output are missing,
  pending, failed, malformed, secret-looking, stale, or not linked to the
  deployed-version evidence.
- Run `npm run security:wallet:deploy-manifest` before deployment. It should
  confirm the incident migration list, Edge Function deploy list, Vercel/site
  surfaces, and pause flags in `docs/security/wallet-deployment-manifest.md`.
  Run `npm run security:wallet:deploy-manifest -- --plan` to print the
  machine-readable deployment plan with every required Supabase function deploy
  command and post-deploy proof field. Save that JSON beside the deployment
  evidence, then run
  `npm run security:wallet:deploy-manifest -- --validate-plan deployment-plan.json`.
  The saved plan is not deployment proof unless that validation output passes
  and is preserved.
- Run `npm run security:wallet:handoff` before deployment. It should confirm
  the owner checklist, final report, test report, deployment manifest,
  regression matrix, production-evidence register, route inventory, and
  env/secret inventory still separate local repository proof from
  staging/provider/production proof.
- Run `npm run security:wallet:audit` before deployment. It should confirm the
  incident documents still cover the prompt deliverables, B15 final-report
  questions, T01-T80 matrix, evidence labels, owner-only proof boundaries, and
  required local security scripts.
- Run `npm run security:wallet:migrations` before applying migrations. It
  should report 37 incident migrations checked, with no dangerous browser
  grants, browser function-execute grants, disabled RLS, unpinned
  security-definer search paths, unrestricted profile privileged-field writers,
  unrestricted service-role balance edits, or unrestricted
  `wallet_security_events` writes. It should also require public-schema
  `auth.users ON DELETE CASCADE` foreign keys and partner/API evidence cascades
  to be replaced with restrictive evidence-preserving keys. This is a source
  check only; still run the staging DB pack after migrations. The staging DB
  pack includes `pg_constraint` assertions that fail if those cascades remain in
  the deployed schema.
- Confirm `wallet_security_events` and `record_wallet_security_event` exist in
  the deployed database, browser roles cannot write them, and service-role
  wallet/security paths can record request ID, actor, IP/device context,
  old/new financial values, B/H/A evidence, result, and denial code.
- Confirm blocked direct ledger writes, blocked profile balance writes, and
  owner-controlled financial freeze test cases create matching
  `wallet_security_events` rows through the database capture triggers.
- Read `docs/security/wallet-incident-final-report.md` before deploying. It
  separates repository fixes from production proof and lists remaining risks.
- Review `docs/security/wallet-mutation-map.md` and
  `docs/security/wallet-fulfillment-map.md` against the deployed routes. Treat
  any route missing from those maps as not approved for reopening.
- Review `docs/security/wallet-route-inventory.md` and
  `docs/security/wallet-env-secret-inventory.md` against deployed Vercel routes,
  Supabase Edge Functions, scheduled jobs, provider dashboards, and env/secret
  settings.
- Review `docs/security/wallet-regression-matrix.md`. Do not treat a row as
  complete unless its required staging, provider, concurrency, or production
  evidence has actually been collected.
- Review `docs/security/wallet-financial-model.md`. The local product route now
  has a database-backed reserve/capture implementation, but do not reopen
  provider routes whose live behavior depends on unimplemented reserve/dispatch
  holds, route-specific partial refunds, chargebacks, or deployed transactional
  outbox guarantees until those implementations are tested in
  staging/production.
- Review `docs/security/wallet-state-machine.md`. It defines the separate
  account access, wallet financial, and service health states, plus the
  decision matrix for insufficient funds, unbacked value, duplicate webhooks,
  frozen wallets, chargebacks, and admin recovery.
- In staging or an owner-controlled database, run
  `npm run security:wallet:db-pack -- --test-user-id <ordinary-profile-uuid>`
  or run `docs/security/wallet-db-security-test-pack.sql` with a non-admin/non-staff
  test profile id. It should end with
  `wallet-db-security-test-pack passed inside rollback transaction`.
- Deploy all changed Supabase Edge Functions.
- Redeploy the Vercel/site app.
- Do not re-enable paused routes until the matching post-deployment checks pass.

## Post-Deployment Database Checks

Run `docs/security/wallet-readonly-query-pack.sql` with affected users and check:

- Stored wallet balance versus backed available funds.
- `linked_eligible_refunds` increases only for refunds linked to an original
  `trusted_principal_authorized` debit with positive
  `trusted_principal_debit_amount`, capped by that original debit amount and
  trusted debit amount; loose refund rows and forged boolean-only trusted
  markers must not create trusted spendable balance.
- Duplicate transaction references and duplicate idempotency keys.
- Conflicting reuse of the same idempotency key with different amount, type,
  user, reference, currency, external payment ID, or balance bucket.
- Completed product orders without matching purchase ledger entries.
- Product, SMM, SMS, bills, Bitrefill, and withdrawal ledger entries without
  matching local rows; orphaned product/SMM/SMS debits are blocked from retrying
  into new credential/provider delivery and need manual review.
- Evidence-erasing cascade query returns zero rows for `auth.users` and
  partner/API foreign keys.
- Reserve-first order authorization section 10e returns zero missing
  `wallet_reservation_id`, `fulfillment_outbox_id`,
  `financial_authorization_status`, status-constraint, or index rows.
- Blocked profile balance attempts.
- Profile deletion and identity-change audit rows.
- Track production proof in
  `docs/security/wallet-production-evidence-register.md`; do not treat a source
  patch as production evidence.

For one-account owner evidence collection, you can also run the read-only
reconciliation command after deployment:

```text
TALLYSTORE_RECONCILE_ENV=production TALLYSTORE_RECONCILE_READONLY=I_UNDERSTAND_READ_ONLY \
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
npm run security:wallet:reconcile -- --email user@example.com --allow-production --json
```

This command performs Supabase `select` reads only. It still uses a service-role
key, so run it only from an owner-controlled machine and preserve the JSON as
private incident evidence.

For already downloaded Supabase/Admin CSV exports, use the offline mode so
duplicate exported files and matching order rows are not double-counted as
extra losses:

```text
npm run security:wallet:reconcile -- --history-csv "C:\path\to\user-history.csv" --json
```

You can pass multiple local CSV files as a comma-separated list. Offline CSV
mode never contacts Supabase and does not prove payment-provider funding,
supplier delivery, or production permissions; it is for deduplicating exported
incident evidence before manual review. Raw transaction/order-shaped exports
can affect totals; derived analysis, mismatch, unexplained-change, and unknown
schema CSVs are reported as supporting evidence with `countedInTotals: false`
and must not be added into retail loss totals again.

Also verify in Supabase:

- `transfer_crypto_to_wallet(uuid, numeric)` is not executable by `anon` or
  `authenticated` and raises the review-disabled error.
- `apply_wallet_transaction(...)` is executable only by `service_role`.
- Legacy balance RPCs such as `update_wallet_balance`,
  `credit_crypto_balance`, `deduct_crypto_balance`, `transfer_crypto_to_wallet`,
  and `withdraw_referral_balance_to_wallet` are not executable by `anon` or
  `authenticated`.
- Direct `transactions` insert/update/delete does not mutate ledger rows unless
  performed by `apply_wallet_transaction`; blocked attempts appear in
  `transaction_ledger_blocked_attempts`.
- `profiles` protected fields cannot be changed by an ordinary authenticated
  user.
- Signup metadata and browser-side profile writes cannot include balances,
  role flags, suspension state, PocketFi account fields, or referral authority
  fields.
- `apply-referral` has JWT verification enabled, derives the target user from
  the authenticated session, ignores caller-provided user IDs, and does not
  overwrite an existing `referred_by` value.
- `product_groups` public users can read active products but cannot write them.
- `individual_accounts` cannot be selected, inserted, updated, or deleted by an
  ordinary customer session.
- Every deployed function with `verify_jwt = false` is intentional and still has
  its own boundary: provider secret/signature, cron secret/service-role
  authorization, or anonymous site-visit-only behavior.

## Post-Deployment Functional Checks

Use owner-controlled test accounts only.

- A zero-balance customer cannot buy a product and no supplier call is made.
- A customer with a fabricated stored balance but no backed credits is blocked
  by `WALLET_UNBACKED_FUNDS`.
- Admin/staff/correction credit rows without an approving actor and matching approval metadata do not count as
  trusted wallet backing.
- Crypto credits do not count as trusted wallet backing while crypto top-up is
  paused for incident review.
- NOWPayments finished-payment webhooks are held for manual review and cannot
  auto-credit crypto balance through `CRYPTO_AUTO_CREDIT_ENABLED`.
- A legitimate Ercas checkout must be created server-side before
  `verify-and-credit-wallet` will credit it.
- If Ercas exposes merchant/business/environment fields in verification
  responses, set the matching production env vars
  `ERCASPAY_MERCHANT_ID`/`ERCAS_MERCHANT_ID` or
  `ERCASPAY_BUSINESS_ID`/`ERCAS_BUSINESS_ID`, plus
  `ERCASPAY_ENVIRONMENT`/`ERCAS_ENVIRONMENT` or
  `ERCASPAY_MODE`/`ERCAS_MODE`. Then verify a sandbox/wrong-environment record
  fails before wallet credit. Returned non-NGN currency must always fail.
- Fill the provider evidence template generated by
  `npm run security:wallet:provider-evidence -- --filled-template` for Ercas,
  PocketFi, NOWPayments, iStar, DaisySMS, SMM, Bitrefill, and withdrawals as
  applicable. Do not paste secrets or private customer payloads into public
  repository files.
- Validate the filled file with
  `npm run security:wallet:provider-evidence -- --validate provider-evidence.json`.
  A route should remain paused if the validator reports missing proof, a
  pending/unpassed proof item, a non-`passed` provider result, or a
  secret-looking reference.
- `check-pending-payments` is deployed only with cron/service authorization,
  passes the pending payment owner into `verify-and-credit-wallet`, and does not
  directly create transactions or update wallet balances.
- `pending_payments` is not writable by `anon` or `authenticated`, has positive
  amount/nonblank reference constraints, and `create-wallet-topup` does not
  return a checkout URL if pending-payment evidence cannot be stored.
- Replaying the same successful payment reference does not credit twice.
- Reusing an idempotency key for a different financial operation returns
  `IDEMPOTENCY_CONFLICT` and does not create a transaction or update balance.
- Retrying a checkout whose debit exists but order creation failed returns
  `PURCHASE_LEDGER_ORPHANED` and does not reserve accounts or reveal
  credentials.
- Retrying an SMM order whose debit exists but local order creation failed
  returns `SMM_PURCHASE_LEDGER_ORPHANED` and does not call the panel provider.
- Retrying an SMS order whose debit exists but local order creation failed
  returns `SMS_PURCHASE_LEDGER_ORPHANED` and does not acquire a DaisySMS number.
- A new SMS purchase creates a local pending `sms_orders` row before DaisySMS
  number allocation; if allocation or activation fails, the order is marked
  failed/refunded instead of disappearing behind a dummy refund record.
- PocketFi duplicate webhooks do not credit twice.
- PocketFi duplicate references with a different matched user or amount return
  `POCKETFI_REFERENCE_CONFLICT` and do not silently acknowledge the payment.
- Suspended customers cannot create product, SMS, SMM, or Telegram purchases.
- iStar webhook calls without `X-iStar-Signature` or with an invalid signature
  return `401`, and failed iStar orders refund through `apply_wallet_transaction`
  with one deterministic refund key.
- Partner API public calls return `PARTNER_API_PAUSED`.
- `npm run security:wallet:deployed-smoke` passes against the deployed base URL
  and confirms partner API pause, legacy Ercas `410`, unsigned PocketFi
  rejection, and unsigned/unconfigured iStar rejection. Set
  `TALLYSTORE_SUPABASE_FUNCTIONS_BASE_URL` or `--functions-base-url` to also
  probe the paused Supabase Edge Functions with unauthenticated no-order
  requests.
- Existing `api_partners` rows are inactive after
  `20260919007000_pause_existing_api_partners.sql`; re-enable a partner only
  after owner review and route-specific verification.
- `api_partners`, partner keys, partner orders, partner logs, partner customer
  mappings, and partner webhook deliveries are not directly readable or
  writable by `anon` or `authenticated` roles after
  `20260919008000_harden_partner_table_authority.sql`.
- Bills, gift cards, withdrawals, crypto top-up, referral withdrawal, direct live
  fulfillment, manual restock, and auto-restock return maintenance/paused
  errors. Product checkout must not call live account suppliers even if local
  stock is short.
- If bills or gift cards are re-enabled later, their debit and refund ledger
  entries must be created by `apply_wallet_transaction`, and duplicate provider
  failures must not issue more than one refund.
- If withdrawals are re-enabled later, the selected `crypto` or `referral`
  balance debit/refund must be created by `apply_wallet_transaction`, and a
  failed provider transfer must not refund more than once.
- Admin can still view users and fraud review.
- Admin balance adjustment still works through the Edge Function and creates a
  ledger row with before/after balances.
- Admin ledger repair can only add a balance-neutral evidence row with
  `metadata.source = admin-ledger-repair`, `created_by`, unchanged
  before/after balance, and `requires_owner_evidence = true`.

## Evidence Classification

Use these labels in incident notes:

- `OBSERVED_IN_SOURCE`: repository source supports the statement.
- `PATCH_IMPLEMENTED`: repository change exists.
- `LOCAL_BUILD_PASSED`: local app build passed.
- `LOCAL_DB_SECURITY_TESTS_PENDING`: database role/security tests not yet run.
- `PRODUCTION_DEPLOYMENT_PENDING`: code/migration not yet live.
- `PRODUCTION_VERIFICATION_PENDING_OWNER`: owner must verify live behavior.
- `HISTORICAL_CAUSE_UNPROVEN`: source patch reduces risk but does not prove how
  earlier abuse happened.

## Reopening Rules

Only re-enable a paused paid route when:

- `npm run security:wallet:reopen-readiness` passes against the exact evidence
  files for the deployment and route being reopened.
- Its payment or wallet authorization path uses `apply_wallet_transaction` or an
  equivalent protected server-side function.
- It derives price and amount from trusted server data.
- It verifies payment or funding evidence server-side.
- It has idempotency on the business event, not only a random request ID.
- It cannot call a supplier or reveal credentials before committed financial
  authorization.
- Owner production checks confirm grants, RLS, deployed function versions, and
  provider secrets.
