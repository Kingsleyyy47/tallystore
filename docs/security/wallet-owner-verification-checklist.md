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

- For an owner-run deploy of all 37 Edge Functions from this worktree, use
  `supabase functions deploy --use-api --project-ref <reviewed-project-ref>`
  from the repository root. The project-level `supabase/config.toml` preserves
  the eight reviewed JWT-disabled webhook/cron routes; every other function
  keeps JWT verification on. Never put `--no-verify-jwt` on the deploy-all
  command and do not use `--prune`. This deploy does not apply migrations or
  publish the Vercel app; keep incident pause flags off during mixed versions.
- Deploy Edge Functions from this repository root with the Supabase CLI, not
  by pasting only `index.ts` into the Dashboard editor. Several functions,
  including `create-crypto-sell-order`, import files from
  `supabase/functions/_shared/`; an editor upload containing only `index.ts`
  fails to bundle with `Module not found .../_shared/...`. Confirm the CLI is
  authenticated and the reviewed project ref matches the intended project.
  On a machine without Docker, the owner can use
  `supabase functions deploy create-crypto-sell-order --use-api --project-ref <reviewed-project-ref>`
  from the repository root. This deploys the paused function only; it does not
  apply migrations or redeploy the other functions. Do not switch on
  `CRYPTO_TOPUP_ENABLED` to test it. Before deploying from a fresh checkout or
  CI, confirm `supabase/functions/_shared/crypto-topup-request.mjs` and the
  other imported `_shared` helpers are included in the commit; they currently
  exist in the local worktree but must not be omitted from a Git-based deploy.
- Apply migrations in timestamp order, including the admin relationship writer
  `20260924030200_add_admin_product_relationship_writer.sql`, with a stop after
  `20260924030500_add_managed_catalog_readers.sql`: deploy the matching
  Vercel/browser build and `chatbot` Edge Function; verify public listings,
  chatbot product search, admin/staff product editing, Revenue OS admin reads,
  and relationship upserts before applying
  `20260924031000_restrict_catalog_supplier_config.sql` and
  `20260924031500_restrict_product_relationship_metadata.sql`. Run read-only
  queries 37 and 38 after the contractions. Do not bulk-push these migrations
  before the app update; old builds request whole catalog and relationship
  rows and will fail after the privilege contraction.
- The old public `chatbot` build requests `SELECT *` from `product_groups`.
  Deploy the patched explicit-column Edge build before the catalog contract
  and test both product and support prompts; a working browser catalog alone
  does not prove the chatbot survived the grant restriction.
- Apply `20260925005000_restrict_smm_supplier_ids.sql` first, deploy the
  matching Vercel/browser build and `smm-get-services`, `smm-check-status`,
  and `smm-create-order`, then verify customer catalog and order history plus
  admin SMM search/toggles in staging. Only then apply
  `20260925006000_restrict_smm_supplier_ids_browser_grants.sql` and
  `20260925007000_restrict_smm_order_panel_response_reads.sql`; run read-only
  queries 44 and 45. Do not apply the contract migrations to the old browser
  build; it still reads whole SMM rows and writes the service table directly.
- If the earlier security-definer-view migration failed with a
  `referred_by` uuid/text error, rerun the patched migration set. The
  `20260919006000_fix_referral_lookup_casts.sql` follow-up normalizes
  `referral_lookup.referred_by` and backfills it with an explicit cast.
- Run `npm run security:wallet` before deployment. It should report 92 passing
  static wallet-security checks.
- Run `npm run security:wallet:local -- --compact` before deployment. It
  should pass 87 repository-local checks, including the Git-history exposure
  audit, run `npx deno` checks for all local
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
  should report 102 incident migrations checked, with no dangerous browser
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
- Query 15 confirms the global funding-payment identity index is valid and
  reports any historical duplicate funding references for manual review.
- Query 16 confirms `anon`, `authenticated`, and `service_role` have no
  effective write access to the historical trusted-principal baseline.
- Query 17 confirms neither browser role can execute the per-customer public
  activity feed. Keep it closed even if an older app build still requests it.
- Query 18 confirms the old anonymous inventory column grants are gone, the
  base table has admin-only RLS, and the public view forces usernames to NULL.
- Query 24 confirms anonymous callers cannot execute the legacy exact-revenue
  or units-sold RPCs, while the replacement public count/ranking readers are
  available. Confirm an ordinary signed-in customer cannot read revenue, and
  a current admin or `view_stats` staff member still can in staging. Browser
  roles must also lack effective write access to `staff_permissions`.
- Query 25 confirms neither browser role has any effective privilege on
  `pocketfi_webhook_logs`, especially `TRUNCATE`; service-role reads and writes
  remain available. Do not infer this from RLS policies alone.
- Query 26 confirms browser roles cannot mutate or truncate financial-history
  tables and cannot truncate `profiles`, including grants inherited through
  `PUBLIC`. Customer/admin history reads and guarded profile edits should
  still work in staging.
- Query 27 lists every deployed overload of the retired balance-writing RPCs.
  Both browser roles must have `can_execute=false` for every returned row.
- Query 28 confirms unsuspension locks the profile and rechecks canonical
  financial truth in the database; browser roles cannot execute that RPC.
  In staging, a severe integrity change between the admin preview and the
  unsuspend request must leave the account suspended.
- Query 33 checks effective table and column write privileges for paid-history
  tables, including SMS orders and crypto withdrawals. After migration 27000,
  both browser roles should have no table writes and zero writable columns;
  customer history SELECT and server-owned writes should still work in staging.
- Query 34 checks all six partner tables for effective browser table and column
  access, including privileges inherited through `PUBLIC`. After migration
  28000, both browser roles should have no partner-table access; separately
  verify the service-role admin inspection path and the continued API pause.
- Query 36 checks that migration 30000 corrected the PocketFi webhook-ID
  pattern in the deployed canonical reader and detects candidate reuse of one
  Ercas/PocketFi evidence row by multiple ledger credits. Resolve candidates
  against provider and ledger evidence; do not bulk-reclassify customers.
  In staging, one genuine PocketFi webhook must back exactly one spendable
  deposit, while two credits claiming the same evidence must authorize zero.
- Query 41 checks that migration `20260925001000` installed exact gateway
  evidence comparisons in both canonical truth and the wallet writer. In
  staging, an over-precise Ercas or PocketFi evidence amount must not support
  a rounded ledger credit or a new wallet top-up; do not inject test records
  into production.
- Query 42 checks that migration `20260925002000` installed the admin-only
  Auth-email fallback. In staging, verify that an admin can find a flagged
  wallet whose profile email is blank, while an ordinary customer cannot call
  the admin page reader or directly select `auth.users`.
- Query 43 lists post-cutoff provider references claimed by multiple wallets
  before migration `20260925003000` changes the spending decision. Preserve
  and review matches against provider records. After migrations `03000` and
  `04000`, both query 43 definition checks should be true; stage one aliased
  cross-wallet collision and one unaffected genuine deposit.
- Query 44 checks effective SMM catalog privileges after migration `06000`.
  Both browser roles must lack `external_id`, UPDATE, and TRUNCATE; safe
  catalog columns must remain readable. Test customer denial and admin access
  through the two RPCs in staging with real JWT roles; grants alone do not
  prove the role check or live catalog experience.
- Query 45 checks that migration `07000` removed browser reads of raw SMM
  supplier responses and cost while preserving customer order-history columns.
  Stage a supplier timeout: the order must remain `outcome_unknown` with its
  debit retained, and a same-key retry must not redispatch or refund by guess.
  Review query 45's deployed `status` type and constraints first; if they do
  not admit `outcome_unknown`, keep SMM ordering paused and adapt the migration.
- Query 46 lists post-cutoff admin credits with approval-shaped metadata but
  a source the canonical reader does not accept. Investigate the original
  action and owner approval before treating one as trusted or fraudulent;
  never bulk-credit or bulk-unfreeze from this candidate list.
- Query 49 checks that ordinary browser roles cannot insert, update, or
  truncate `staff_pending_actions`, including via column grants, while staff
  can still read their own history and the service role can submit/approve.
  Check the deployed status constraint includes `failed`. In staging, a direct
  authenticated INSERT must be denied, a queued action from a revoked or
  non-staff requester must not execute, and an auto-approved action must have
  an audit row before its effect is applied.
- After migration `20260925011000` and the matching admin build, run query 50
  to list wallets whose first recorded legacy debit predates their first
  qualifying legacy credit. Review provider and earlier ledger coverage for
  each result. The signal does not prove missing funding and must not trigger
  a bulk suspension or unsuspension; confirm it appears in Fraud Review and
  user details without changing the canonical spending amount.
- After migration `20260925012000` and the matching admin build, run query 51
  and an admin/staff/ordinary-user staging check. Only a current admin may
  acknowledge an alert; no browser role may rewrite message, severity, or
  context, and the stored acknowledgement actor/time must come from the
  database. Confirm service-owned resolution still works and old security
  alerts remain present.
- Before and after migration `20260925013000`, preserve query 52 output for
  deployed `profiles` SELECT policies and the `is_admin_profile()` owner.
  The migration intentionally aborts if its existing policy or safe owner
  assumption is absent. Deploy the matching `manage-staff` and Staff Admin
  browser build before this policy change. In staging with real JWTs, confirm a customer and a
  staff member can read their own profile but not another customer's or a
  staff email, while a current admin can read the intended admin list. With an
  existing session, a suspended admin must lose admin helper access while
  retaining only permitted self access. Test Staff Admin user search with an
  enabled and disabled `tab_users` permission and a suspended old session.
  Search must return only customer identity, balance, and creation fields;
  it must not reveal staff/admin identities or private profile columns. Do
  not restore public or all-staff profile reads to make the screen work.
  The matching owner browser build also narrows user search to named profile
  columns. Verify owner search by email, UUID, and virtual account number,
  and inspect one browser response for unexpected profile fields.
  Review any additional permissive profile policy before production rollout.
- Deploy the matching privileged Edge builds (`admin-adjust-balance`,
  `partner-api`, `muabanvia-fulfill`, `manual-restock`, `smm-sync-services`,
  `get-my-ip`, `telegram-stars`, `smsbus`, `email`, `manage-staff`, and
  `revenue-os-maintenance`). In staging, suspend an owner/staff test account
  with an existing session and confirm these privileged actions deny it.
  Submit a staff action before suspension, then confirm the queued action
  cannot execute after suspension. Cron/service authorization should continue
  to work only with its own configured credential. Do not equate customer
  wallet review with staff account suspension.
- Apply `20260925014000_add_scoped_discount_readers.sql`, deploy the matching
  browser build, then test a known customer code preview, an invalid code,
  owner listing, and permitted/denied Staff Admin listing in staging. Only
  then apply `20260925015000_restrict_discount_code_browser_reads.sql`.
  Run read-only query 53 and repeat checkout and role tests. Ordinary users
  must not enumerate active store-wide codes or another user's reward codes;
  permissioned staff must not list customer-specific rewards. If the contract
  migration reports an extra policy or missing expected policy, stop and
  inspect the live policy set instead of dropping an unknown policy. The
  reviewed `discount_codes_write` `FOR ALL` staff policy is removed by this
  contract: confirm staff code changes use the `manage-staff` approval path,
  not direct browser writes, before applying it.
- Deploy the matching `process-purchase` Edge build before applying
  `20260925016000_reserve_discount_uses_with_orders.sql`. Its code path must
  return `Discount codes are temporarily unavailable` until the DB readiness
  RPC exists. Wait for old Edge requests to drain, then apply the migration;
  do not run an old build across the new completion trigger because it still
  increments `used_count` after delivery. Run query 54 and staging one-use,
  concurrent-checkout, failed-order, and replay checks. If build overlap
  cannot be ruled out, pause code redemption at the Edge boundary for the
  deployment window. Non-code purchases should remain available.
- Apply `20260925017000_recheck_suspended_admin_rpcs.sql` after the Fraud
  Review and SMM RPC migrations. If its definition preflight aborts, inspect
  the deployed function before changing the migration. Run read-only query
  55; with real staging JWTs, confirm a current admin can use Fraud Review
  and SMM management, while a suspended admin with an old session and an
  ordinary customer cannot call the six RPCs directly. This is distinct
  from a customer wallet review.
- Apply `20260925018000_restrict_suspended_admin_audit_reads.sql` only after
  `is_admin_profile()` is confirmed to check `account_suspended`. Run query
  56 and test a suspended admin's existing JWT against both financial-audit
  tables and another customer's SMS orders. They must be denied, while the
  suspended user's own SMS history and an active admin's authorized reads
  still work. Stop if the expected policy names differ in the deployed DB.
- Apply `20260925019000_restrict_suspended_admin_order_history.sql` after
  the active-admin helper and completed-order history view. Run query 57;
  with real staging JWTs, confirm a suspended admin cannot list another
  customer's orders, an active admin can investigate non-secret order facts,
  and the owning customer can still read completed credentials but not
  pending or uncaptured credentials.
- Apply `20260925020000_restrict_suspended_admin_alert_access.sql` only
  after the active-admin helper and alert-acknowledgement migration. Run
  read-only query 58, including any extra SELECT/UPDATE policies. In staging,
  an active admin must still read and acknowledge a test alert; a suspended
  admin with an old session and an ordinary customer must do neither. If the
  named policies differ, stop and inspect the deployed schema before retrying.
  The reviewed zero-policy, RLS-enabled layout is supported only when the
  acknowledgement trigger and column-scoped grant are already present.
- Apply `20260925021000_restrict_suspended_admin_forensic_reads.sql` only
  after confirming `is_admin_profile()` checks current suspension. Run query
  59 and inspect every additional SELECT/ALL policy on the seven named
  audit/ban tables. In staging, an active admin must retain authorized
  investigation reads; a suspended admin with an existing JWT and an
  ordinary customer must see no cross-customer forensic rows.
- Apply `20260925022000_restrict_suspended_admin_settings_writes.sql` after
  the active-admin helper is deployed. Run query 60 and inspect additional
  policies on `app_settings` and `sms_product_settings`. In staging, confirm
  public storefront keys still load, a current admin can save settings, and
  a suspended admin's existing session cannot insert or update either table
  or read private settings. Do not test by changing live payment flags.
- Apply `20260925023000_restrict_suspended_admin_telemetry_reads.sql` after
  the active-admin helper. Run query 61 and inspect extra policies/grants.
  In staging, a suspended admin's old JWT must not read another customer's
  site visits or identity links, while an active admin retains investigation
  access and a customer can insert/read only their own identity link.
- Apply `20260925024000_restrict_suspended_admin_financial_history.sql`
  after the active-admin helper and the safe order-history view. Run query
  62 and inspect extra SELECT/ALL policies and effective column grants.
  In staging, a suspended admin's existing JWT and an ordinary customer
  must read only their own transaction rows; active admins retain authorized
  investigation access. Confirm customers still use `orders_safe_history`
  for completed-order history and cannot query base `account_details`.
- Apply `20260925025000_restrict_suspended_admin_revenue_reads.sql` after
  the active-admin helper. Run query 63 and inspect all SELECT/ALL policies
  and effective table/column grants. In staging, a suspended admin must see
  only their own revenue events and no CRO decision audit; an active admin
  retains investigation reads, an ordinary customer sees only their events,
  and an anonymous request reads neither table. Confirm permitted browser
  telemetry inserts still work.
- If `20260919020000` fails while rewriting an `auth.users` foreign key,
  run read-only query 10d before retrying. Preserve the returned constraint
  definition and `restrict_rewrite_would_fail` value for review; do not drop a
  customer-evidence foreign key by hand or assume a local fixture proves the
  deployed schema is identical. After migration, query 10d should return no
  evidence-erasing cascades.
- Query 35 checks the admin-gated cross-wallet payment-identity reader's
  effective execution grants and counts historical identities used by more
  than one wallet. Review any finding against provider records; do not
  auto-suspend or merge accounts from a shared reference alone.
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
- `product_groups` public users can read only approved active catalog columns,
  cannot read supplier IDs or fulfillment settings, and cannot write products.
  Run read-only query 37 and confirm the admin/staff managed reader still works.
- `product_relationships` public users can read recommendation edges but not
  metadata, source, sample size, or whole rows. Run read-only query 38 and
  confirm the storefront recommendations and admin Revenue OS count still load.
- `individual_accounts` cannot be selected, inserted, updated, or deleted by an
  ordinary customer session.
- Every deployed function with `verify_jwt = false` is intentional and still has
  its own boundary: provider secret/signature, cron secret/service-role
  authorization, or anonymous site-visit-only behavior.
- `revenue-os-loop` requires `POST` and an exact service-role bearer token.
  Check the deployed scheduler method/credential before deploying the new
  function. A normal customer JWT and an unauthenticated request must return
  `401` without creating a `cro_attribution_closures` run. A `GET` must return
  `405`. Keep the service-role token in the scheduler secret store, never the
  browser or a public URL.

## Post-Deployment Functional Checks

Use owner-controlled test accounts only.

- A zero-balance customer cannot buy a product and no supplier call is made.
- A customer with a fabricated stored balance but no backed credits receives
  `INSUFFICIENT_TRUSTED_AVAILABLE_FUNDS` before any supplier call; ordinary
  insufficiency does not automatically suspend the account.
- A stored NGN 100,000 with NGN 70,000 independently backed permits at most
  NGN 70,000 of new commitments and reports the NGN 30,000 excess for review.
- Admin/staff/correction credit rows without an approving actor and matching approval metadata do not count as
  trusted wallet backing.
- Crypto credits do not count as trusted wallet backing while crypto top-up is
  paused for incident review.
- NOWPayments finished-payment webhooks are held for manual review and cannot
  auto-credit crypto balance through `CRYPTO_AUTO_CREDIT_ENABLED`.
- Check signed NOWPayments identity-review events in the read-only query pack.
  Match provider payment ID and merchant order ID to the provider dashboard
  and local transaction before any correction; do not suspend a customer
  solely because an unmatched event names their order. Confirm staging
  mismatched-ID callbacks cannot update even a pending crypto transaction.
- Check terminal-status review events in that query. In staging, confirm a
  signed failed/refunded/expired IPN whose current provider status differs
  cannot change the local transaction, and that a terminal notification cannot
  overwrite a newer verified-finished hold (or vice versa). Keep crypto
  funding paused until historical credited payments and reversals are reconciled.
- Check finished-payment and unsupported-status review events in the same
  query. A conflicting `finished` notification must leave the local status and
  saved quoted amount/currency unchanged; an unknown status must not become a
  local transaction state. Confirm a missing saved quote cannot be replaced
  by an amount supplied in the notification or provider response.
- A legitimate Ercas checkout must be created server-side before
  `verify-and-credit-wallet` will credit it.
- Redeploy `verify-and-credit-wallet` with its shared NGN minor-unit parser.
  In an isolated provider sandbox, verify an exact paid amount credits once,
  while a one-kobo difference, over-precise amount, zero, or malformed amount
  fails before credit. When the provider returns transaction/payment reference
  fields, they must match the stored server-created pending checkout; mismatches
  must close the pending evidence without wallet credit. Do not fabricate
  payment evidence in production.
- An HTTP error from the Ercas verification endpoint leaves the pending
  checkout uncredited for retry. A verification envelope with
  `requestSuccessful = false` must not credit even if its nested status says
  `SUCCESSFUL`; confirm both cases in sandbox fixtures.
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
- `pending_payments` is also not directly selectable by browser roles after
  migration `32000`; run read-only query 39 to check whole-table and column
  grants. Checkout initialization and payment recovery must still work through
  their server paths.
- `pocketfi_webhook_logs` cannot be selected, written, or truncated through
  ordinary customer credentials; a verified PocketFi webhook can still record
  and consume evidence through the service role.
- In PocketFi staging, make the webhook-log INSERT and wallet-link UPDATE fail
  separately. Neither failure may call the wallet credit RPC; the response is
  retriable and contains no database error text. Confirm PocketFi's retry
  behavior and whether its permanent virtual-account transfers have an
  authoritative lookup endpoint; do not substitute hosted-checkout confirmation
  without a provider-backed contract.
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
  number allocation. A documented definitive allocation decline can refund;
  a lost response, unrecognized provider reply, or `NO_ACTIVATION` cannot.
  Confirmed `ACCESS_CANCEL`/`STATUS_CANCEL` can refund once after a guarded
  nonterminal order transition. Test customer, admin, approved-staff, stale
  batch, sync, and late-code paths in provider sandbox and real-DB staging.
  Keep historical cancelled-but-unrefunded orders for evidence review; do not
  bulk-refund them or reopen SMS ordering from local mock results alone.
- With an SMS-tab staff session, inspect the deployed `admin_sms_orders` and
  cancellation responses: they must omit other customers' OTP `messages` and
  raw `provider_payload`, while retaining order status and refund evidence.
  Confirm the customer self-order response still shows only that customer's
  own codes. Review-required cancellation must never display a success toast
  claiming a refund.
- PocketFi duplicate webhooks do not credit twice.
- In PocketFi staging, a signed success notification with only an event ID,
  session ID, or transaction object ID and no explicit transfer reference is
  logged for review without wallet credit. Confirm genuine permanent-account
  transfers include a stable transaction reference before deploying this
  stricter parser; reconcile any held legitimate transfer with provider proof.
- PocketFi duplicate references with a different matched user or amount return
  `POCKETFI_REFERENCE_CONFLICT` and do not silently acknowledge the payment.
- A signed PocketFi sandbox success or replay response contains no partner
  checkout payload, wallet user ID, balance, or payment reference. A failed
  Edge or Vercel webhook response contains no raw SQL/provider exception text.
- With crypto top-up paused, direct calls to `create-crypto-sell-order` return
  the pause response without exposing Auth-header fragments or provider errors.
  The deployed chatbot also returns a fixed error on an internal failure.
- Test authorized email/staff failure paths and the scheduled revenue loop in
  staging; responses should not include raw SMTP, database, or exception text.
- In PocketFi staging, replaying a credited reference with an over-precise raw
  amount such as `15000.004` is held for review, and a different exact amount
  such as `15000.01` returns `POCKETFI_REFERENCE_CONFLICT`. Neither replay may
  replace the logged verified provider amount with the prior ledger amount.
- Suspended customers cannot create product, SMS, SMM, or Telegram purchases.
- iStar webhook calls without `X-iStar-Signature` or with an invalid signature
  return `401`. A signed body missing `event_type` must be rejected even when
  `X-iStar-Event` names `order.failed`; malformed signed JSON must also be
  rejected before any order update/refund. Verify the provider sends
  `event_type` inside the signed JSON as documented, and that valid failed
  iStar orders refund through `apply_wallet_transaction`
  with one deterministic refund key.
- Keep Telegram order creation paused while reconciling orders already in
  flight. The current customer poll may report supplier failure for review but
  must not create a refund; `admin_cancel_order` must return
  `TELEGRAM_CANCELLATION_REVIEW_REQUIRED` without marking failure or crediting
  the wallet. Verify a success/failure callback race in staging: whichever
  terminal transition loses must make zero refund calls. A signed failure
  that wins may refund once only when an eligible debit exists. Review any
  failed or unknown order left without a refund; do not assume the supplier
  delivered nothing merely because a response or webhook was lost.
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
- Review historical auto-restock function logs and `auto_restock_logs` for raw
  supplier payloads, fetch URLs, or credentials. Rotate any supplier key whose
  exposure is confirmed or cannot be ruled out from retained logs. Keep both
  restock routes paused until unknown supplier outcomes and retry behavior have
  a documented, tested resolution path.
- Confirm the deployed `bitrefill-catalog` and `get-data-plans` functions return
  fixed errors for provider failures and do not log provider response bodies or
  stacks. Review retained logs for earlier disclosure before deciding whether
  the affected provider credentials require rotation.
- If bills or gift cards are re-enabled later, their debit and refund ledger
  entries must be created by `apply_wallet_transaction`, and duplicate provider
  failures must not issue more than one refund.
- Before enabling bills or withdrawals, prove the provider's reference lookup
  and retry contract in a sandbox. Reconcile every pending/unknown outcome;
  a timeout or non-success response alone must not cause a wallet refund or a
  new provider request. Verify a confirmed non-delivery refund is posted once
  against the original debit.
- Before enabling Bitrefill purchases, prove invoice/order lookup, redemption
  timing, and supplier idempotency in its sandbox. Pending replays must not
  return redemption data. Review the deployed `bitrefill_orders` read grants
  and policies so an unfinished row cannot expose a stored code or link through
  a direct browser query.
- For withdrawals, verify the SageCloud bank-validation response shape in its
  sandbox. The route now requires a provider-confirmed account name and stops
  before debit if validation fails; do not reintroduce a caller-name fallback.
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
