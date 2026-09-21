# Wallet Incident Deployment Manifest

Prepared: 2026-09-19

This manifest lists the repository surfaces that must be deployed or explicitly
verified for the wallet-security incident patch. It is intentionally more
specific than "deploy everything" because this repo has no project-level
`supabase/config.toml` from which to derive the active function set.

Do not use this manifest as proof that production is safe. It is a deployment
inventory. Production safety still requires the staging, provider, and owner
checks in `wallet-owner-verification-checklist.md`.

## Pre-Deploy Local Gates

Run these before deployment:

```bash
npm run security:wallet:local
npm run security:wallet:admin-review
npm run security:wallet
npm run security:wallet:db-pack -- --help
npm run security:wallet:db-concurrency -- --help
npm run security:wallet:deployed-smoke -- --help
npm run security:wallet:env-secrets
npm run security:wallet:evidence
npm run security:wallet:deployed-versions -- --format json
npm run security:wallet:deployed-versions -- --filled-template
npm run security:wallet:deployed-versions -- --self-test
npm run security:wallet:migrations
npm run security:wallet:deploy-manifest
npm run security:wallet:deploy-manifest -- --plan
npm run security:wallet:deploy-manifest -- --self-test
npm run security:wallet:handoff
npm run security:wallet:audit
npm run security:wallet:provider-evidence -- --format json
npm run security:wallet:provider-evidence -- --filled-template
npm run security:wallet:provider-evidence -- --self-test
npm run security:wallet:reservations
npm run build
```

Expected local boundary:

- `security:wallet:local` passes all repository-local checks.
- `security:wallet:admin-review` verifies the local admin-review decision model:
  only verified gateway deposits and approved admin credits create trusted
  principal; refunds only restore linked prior trusted debit capacity; staff credit
  requests queue for admin approval; unbacked wallets and unresolved supplier
  exposure cannot be unsuspended.
- `security:wallet` reports 89 checks passing.
- `security:wallet:db-pack -- --help` confirms the guarded staging DB runner is
  available. The full runner requires staging/local/owner-controlled Postgres,
  `psql`, an ordinary test profile id, and the rollback-mutation acknowledgement.
- `security:wallet:db-concurrency -- --help` confirms the guarded real-Postgres
  concurrency runner is available. The full runner requires
  staging/local/owner-controlled Postgres, `psql`, an ordinary test profile id,
  and the committed-mutation acknowledgement; it seeds a verified test top-up,
  proves over-total purchase and duplicate-refund races through
  `apply_wallet_transaction`, optionally proves one provider payment identity
  cannot fund two wallets when a second fixture is supplied, proves an unbacked
  purchase denial persists the wallet freeze without inserting a purchase row,
  and resets those fixture wallets to zero.
- `security:wallet:deployed-smoke -- --help` confirms the safe deployed-route
  smoke runner is available. The full runner requires an explicit
  no-order-creation acknowledgement and checks only denied/paused routes. With
  only a deployed functions URL it accepts safe auth/JWT denial for paid Edge
  Functions; with `TALLYSTORE_DEPLOYED_SMOKE_AUTHORIZATION` it must see exact
  stable `*_PAUSED` codes. Exact auto-restock pause-code proof also requires
  `TALLYSTORE_DEPLOYED_SMOKE_CRON_SECRET` because that route validates
  `x-cron-secret` before its pause gate.
- `security:wallet:env-secrets` verifies source env usage is inventoried,
  provider secrets are server-only, `.env.example` contains placeholders, and
  incident pause flags remain documented.
- `security:wallet:evidence` verifies the production evidence register keeps
  standard proof fields, provider capability rows, unknown-outcome supplier
  states, route reopening gate fields, and staging SQL evidence fields.
- `security:wallet:deployed-versions -- --format json` prints the app,
  migration, pause-flag, and Supabase function deployment-version checklist.
- `security:wallet:deployed-versions -- --filled-template` prints the private
  validation-shaped evidence file the owner should fill from Vercel/Supabase
  dashboards after deployment.
- `security:wallet:deployed-versions -- --self-test` verifies the validator
  rejects missing surfaces, duplicate surfaces, pending/non-passed proof,
  invalid `verifiedAt` timestamps, altered expected fingerprints, mismatched
  SHA-256 fingerprints, dirty source without artifact approval, informal dirty
  artifact approval timestamps, and secret-looking references while accepting a
  complete sanitized passed evidence shape.
- `security:wallet:migrations` reports 37 incident migrations checked.
- `security:wallet:deploy-manifest -- --plan` prints the machine-readable
  deployment plan, including pre-deploy gates, `supabase db push`, all 32
  Supabase function deploy commands, Vercel/site surfaces, pause flags,
  post-deploy proof fields, and rollback boundaries.
- Save that plan beside the private deployment evidence and validate it with
  `security:wallet:deploy-manifest -- --validate-plan deployment-plan.json`.
  The validator fails closed if migrations, function deploy commands,
  Vercel/site surfaces, pause flags, proof fields, rollback boundaries, evidence
  commands, or secret-looking values do not match the current reviewed repo.
- `security:wallet:deploy-manifest -- --self-test` proves the saved-plan
  validator accepts a current generated plan and rejects stale migration lists,
  stale function deploy lists, missing rollback/reopen boundaries, and
  secret-looking values without contacting production.
- `security:wallet:handoff` verifies the owner checklist, final report, test
  report, deployment manifest, regression matrix, production-evidence register,
  route inventory, env/secret inventory, and wallet state-machine document still
  preserve the production proof boundary.
- `security:wallet:audit` verifies the security-prompt deliverables,
  final-report questions, evidence labels, owner proof boundaries, required
  wallet-security scripts, the wallet state-machine document, and T01-T80
  regression rows stay represented.
- `security:wallet:provider-evidence -- --format json` prints the provider
  sandbox/dashboard evidence template for every external provider surface.
- `security:wallet:provider-evidence -- --filled-template` prints the
  validation-shaped JSON file the owner should fill before reopening provider
  routes.
- `security:wallet:provider-evidence -- --self-test` verifies the filled
  provider-evidence validator rejects missing provider sections,
  pending/unpassed proof, and secret-looking references, and accepts a
  complete sanitized passed evidence shape.
- `security:wallet:reservations` verifies the local hold/capture/release model:
  active holds reduce trusted available funds, reservation idempotency is bound
  to wallet/order/amount/payload, capture posts one wallet-engine purchase,
  release creates no refund credit, captured reservations cannot be released,
  expired holds cannot be captured, and refunds only restore prior trusted debit
  capacity without increasing trusted principal.
- The local suite may report Docker, `psql`, or direct Deno unavailable. That
  means staging DB tests still need another environment; all local Edge
  Function entrypoints are currently type-checked through `npx deno`, while
  deployed-version and runtime configuration checks still belong in staging/CI.

## Database Migrations

Apply migrations in timestamp order. At minimum, this incident patch includes:

```text
20260914007000_fix_security_definer_public_views.sql
20260917000000_block_profile_deletion.sql
20260917001000_block_auth_user_deletion.sql
20260917002000_audit_profile_balance_changes.sql
20260917003000_block_identity_changes.sql
20260917004000_count_refunds_as_fraud_credits.sql
202609170050_enforce_profile_balance_authority.sql
202609170060_create_wallet_transaction_engine.sql
20260919000000_pause_unsafe_financial_surfaces.sql
20260919001000_enforce_backed_wallet_purchases.sql
20260919002000_harden_catalog_inventory_authority.sql
20260919003000_guard_profile_privileged_fields.sql
20260919004000_harden_fraud_credit_evidence.sql
20260919005000_guard_transaction_ledger_authority.sql
20260919006000_fix_referral_lookup_casts.sql
20260919007000_pause_existing_api_partners.sql
20260919008000_harden_partner_table_authority.sql
20260919009000_retire_legacy_balance_rpcs.sql
20260919010000_harden_pending_payment_evidence.sql
20260919011000_harden_default_function_privileges.sql
20260919012000_enforce_external_payment_identity.sql
20260919013000_enforce_wallet_money_bounds.sql
20260919014000_normalize_debit_transaction_signs.sql
20260919015000_enforce_trusted_principal_transaction_guard.sql
20260919016000_restrict_profile_privileged_writes.sql
20260919017000_create_wallet_security_events.sql
20260919018000_capture_wallet_security_events.sql
20260919019000_rescan_wallet_integrity_after_hardening.sql
20260919020000_restrict_auth_user_cascade_evidence.sql
20260919021000_restrict_partner_cascade_evidence.sql
20260919022000_add_telegram_order_idempotency.sql
20260919023000_create_wallet_reservations_and_dispatch_outbox.sql
20260919024000_create_fulfillment_outbox_functions.sql
20260919025000_create_wallet_reservation_functions.sql
20260919026000_add_order_financial_authorization_columns.sql
20260919027000_harden_financial_security_version.sql
20260919028000_migrate_product_purchase_reserve_capture.sql
```

These older replay migrations were also touched so a not-yet-applied database
does not briefly clear wallet holds before the hardened evaluator and rescan
run:

```text
20260914006000_normalize_ledger_suspension_checks.sql
20260914011000_harden_crypto_transfer_and_fraud_credits.sql
20260914012000_reset_auto_fraud_suspensions.sql
```

The old reset migration is now a no-op. The old fraud evaluators can still mark
accounts for review, but they no longer auto-unsuspend any customer.

`20260919019000_rescan_wallet_integrity_after_hardening.sql` re-runs the
hardened ledger evaluator for existing ordinary customer wallets after the new
trusted-principal rules are installed. It can freeze wallets for owner review,
and if a wallet cannot be evaluated it fails closed by suspending that wallet
for owner review. It does not auto-unsuspend any customer.

`20260919020000_restrict_auth_user_cascade_evidence.sql` replaces public-schema
`auth.users` foreign keys that still used `ON DELETE CASCADE` with restrictive
foreign keys. Profile/auth delete triggers remain the first barrier; this
migration prevents older linked evidence tables from disappearing through a
cascade if another privileged delete path is introduced later.

`20260919021000_restrict_partner_cascade_evidence.sql` replaces public-schema
partner/API foreign keys that still used `ON DELETE CASCADE` with restrictive
foreign keys. The partner API remains paused; this prevents partner keys,
customer references, webhook delivery evidence, or other linked records from
being erased by deleting a partner row during review.

`20260919022000_add_telegram_order_idempotency.sql` adds a nullable
`telegram_orders.idempotency_key` plus a per-user partial unique index. This is
required before deploying the Telegram Stars/Premium function changes that
replay exact retries, reject changed request contents, and block orphaned
purchase-ledger retries.

`20260919023000_create_wallet_reservations_and_dispatch_outbox.sql` adds
service-role-only `wallet_reservations` and `fulfillment_dispatch_outbox`
tables. This is an additive reserve-first and durable-dispatch foundation. The
local product route is migrated by `20260919028000`; SMM, SMS OTP, Telegram,
and other provider-backed order creation remain default-paused and must not be
reopened merely because these foundation tables exist.

`20260919024000_create_fulfillment_outbox_functions.sql` adds service-role-only
outbox RPCs to enqueue, claim, and finish durable dispatch messages. These
functions do not call suppliers and do not reopen paused routes; they provide
the controlled worker boundary future route migrations should use.

`20260919025000_create_wallet_reservation_functions.sql` adds service-role-only
reservation RPCs to create, capture, and release wallet holds. The create path
uses trusted available funds from the hardened ledger evaluator and subtracts
active reservations; capture posts the final purchase through
`apply_wallet_transaction`; release does not create refund credit.

`20260919026000_add_order_financial_authorization_columns.sql` adds nullable,
table-existence-guarded authorization columns to order tables that exist in the
target database: `wallet_reservation_id`, `fulfillment_outbox_id`,
`financial_authorization_status`, `financial_security_version`, and
`financial_authorization_reference`. This prepares route-by-route migration to
reserve-first authorization without rewriting legacy rows or assuming every
optional product-family table exists.

`20260919027000_harden_financial_security_version.sql` makes the profile
financial-security epoch database-owned: any suspension or reinstatement state
change increments it, ordinary profile writes cannot change it, and stale
reservations or dispatch messages are rejected before delivery.

`20260919028000_migrate_product_purchase_reserve_capture.sql` moves the active
local product route onto database-owned reserve/capture functions. Authorization
locks trusted funds, inventory, and a non-delivered order together. Completion
captures the hold, stores credentials, and marks the same inventory sold in one
transaction.

Owner command:

```bash
supabase db push
```

If migrations are applied by SQL editor instead of CLI, preserve the SQL output
and then run the read-only checks in `wallet-readonly-query-pack.sql`.

## Supabase Edge Functions To Deploy

Deploy these changed functions after migrations:

```bash
supabase functions deploy admin-adjust-balance
supabase functions deploy apply-referral
supabase functions deploy auto-restock
supabase functions deploy chatbot
supabase functions deploy check-pending-payments
supabase functions deploy create-crypto-sell-order
supabase functions deploy create-pocketfi-topup
supabase functions deploy create-wallet-topup
supabase functions deploy create-withdrawal-request
supabase functions deploy email
supabase functions deploy get-data-plans
supabase functions deploy manage-staff
supabase functions deploy manual-restock
supabase functions deploy muabanvia-fulfill
supabase functions deploy nowpayments-webhook
supabase functions deploy partner-api
supabase functions deploy process-purchase
supabase functions deploy purchase-bills
supabase functions deploy purchase-bitrefill
supabase functions deploy record-site-visit
supabase functions deploy revenue-os-loop
supabase functions deploy revenue-os-maintenance
supabase functions deploy smm-check-all-orders
supabase functions deploy smm-check-status
supabase functions deploy smm-create-order
supabase functions deploy smm-get-services
supabase functions deploy smm-sync-services
supabase functions deploy smsbus
supabase functions deploy telegram-stars
supabase functions deploy verify-and-credit-wallet
supabase functions deploy webhook-pocketfi
supabase functions deploy withdraw-referral-balance
```

Shared code changed:

```text
supabase/functions/_shared/staff-purchase-guard.ts
```

Shared code is bundled through importing functions, so deploy every function
above even if a route change looks small.

Also verify these existing security-sensitive functions are still deployed with
the expected config and secrets:

```text
apply-referral
check-pending-payments
nowpayments-webhook
partner-api
record-site-visit
revenue-os-maintenance
smm-check-all-orders
smsbus
webhook-pocketfi
```

From source `config.toml`, the currently JWT-disabled functions are:

```text
check-pending-payments
nowpayments-webhook
partner-api
record-site-visit
revenue-os-maintenance
smm-check-all-orders
smsbus
webhook-pocketfi
```

Every JWT-disabled deployed function must still match this source list and must
retain its internal authorization, signature, cron-secret, or strict telemetry
boundary. All other deployed Edge Functions should keep Supabase JWT
verification enabled unless a later reviewed source/config change says
otherwise.

## Vercel/Site Routes To Redeploy

Redeploy the web app so these server and UI changes are live:

```text
api/partner-api.ts
api/webhook-ercas.ts
api/webhook-istar.ts
api/webhook-pocketfi.ts
pages/api/webhook/ercas.ts
src/components/CryptoBalanceCard.tsx
src/contexts/SimpleAuth.tsx
src/hooks/useAuth.ts
src/hooks/useRecommendations.ts
src/lib/productAvailability.ts
src/lib/supabase.ts
src/pages/AdminPage.tsx
src/pages/BillsPayment.tsx
src/pages/GiftCardsEsims.tsx
src/pages/OrderHistoryPage.tsx
src/pages/SupportPage.tsx
```

Required live checks after redeploy:

- `api/partner-api.ts` returns `503` with `PARTNER_API_PAUSED`.
- Legacy Ercas Vercel webhook routes return `410`.
- PocketFi bridge rejects unsigned requests before proxying.
- iStar bridge rejects invalid signatures.
- Crypto transfer UI is not visible.
- Suspended users can still open order history/support but cannot make new paid
  purchases.
- `npm run security:wallet:deployed-smoke` passes against the deployed base URL
  after deployment, with `--allow-production` only for production. Provide
  `TALLYSTORE_SUPABASE_FUNCTIONS_BASE_URL` or `--functions-base-url` during
  the same run to verify the paused paid Edge Functions reject unauthenticated
  no-order probes.

## Required Pause Flags

Keep these disabled in production until the matching route-specific staging and
provider proof is collected. `BITREFILL_ENABLED=false` covers gift cards and
eSIM delivery through the Bitrefill/gift-card route:

```text
BILLS_ENABLED=false
BITREFILL_ENABLED=false
WITHDRAWALS_ENABLED=false
REFERRAL_WITHDRAWALS_ENABLED=false
CRYPTO_TOPUP_ENABLED=false
SMM_ORDERS_ENABLED=false
SMS_OTP_ENABLED=false
TELEGRAM_ORDERS_ENABLED=false
LIVE_ACCOUNT_FULFILLMENT_ENABLED=false
AUTO_RESTOCK_ENABLED=false
MANUAL_RESTOCK_ENABLED=false
```

Plain-language pause coverage:

- `BILLS_ENABLED=false`: bills and airtime.
- `BITREFILL_ENABLED=false`: gift cards and eSIM delivery.
- `WITHDRAWALS_ENABLED=false`: withdrawals.
- `REFERRAL_WITHDRAWALS_ENABLED=false`: legacy old-build guard for referral withdrawal. The current `withdraw-referral-balance` function is hard-paused in source and does not read this flag.
- `CRYPTO_TOPUP_ENABLED=false`: crypto top-up.
- `SMM_ORDERS_ENABLED=false`: SMM/social boost order creation.
- `SMS_OTP_ENABLED=false`: new SMS OTP number rentals.
- `TELEGRAM_ORDERS_ENABLED=false`: Telegram Stars and Premium order creation.
- `LIVE_ACCOUNT_FULFILLMENT_ENABLED=false`: direct live account fulfillment.
- `AUTO_RESTOCK_ENABLED=false`: auto-restock.
- `MANUAL_RESTOCK_ENABLED=false`: manual restock.

Partner API is hard-paused in source code and should not have an environment
variable capable of reopening public partner checkout during this review.

## Post-Deploy Proof

Do not reopen any paused route until the owner records:

```text
deployed app version:
deployed function versions:
migrations applied through:
restricted-role DB test result:
provider sandbox/dashboard result:
denied-order supplier-call count:
credential reveal count for denied order:
production evidence link/path:
reviewer:
timestamp:
```

Rollback rule: if a migration or function deploy fails, keep paid/provider
routes paused. Do not roll back to a version that restores direct wallet writes,
partner API checkout, crypto auto-credit, or unverified provider fulfillment.
