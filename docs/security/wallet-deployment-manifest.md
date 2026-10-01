# Wallet Incident Deployment Manifest

Prepared: 2026-09-19

This manifest lists the repository surfaces that must be deployed or explicitly
verified for the wallet-security incident patch. The project-level
`supabase/config.toml` now records the eight functions that require gateway
JWT verification disabled; all other functions keep the default enabled.

Do not use this manifest as proof that production is safe. It is a deployment
inventory. Production safety still requires the staging, provider, and owner
checks in `wallet-owner-verification-checklist.md`.

## Pre-Deploy Local Gates

Run these before deployment:

```bash
npm run security:wallet:local
npm run security:history-leaks
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
- `security:wallet` runs the current source security checks, including
  admin-role revocation and public-data read boundaries.
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
- `security:wallet:migrations` checks the incident migrations in the current repository.
- `security:wallet:deploy-manifest -- --plan` prints the machine-readable
  deployment plan, including pre-deploy gates, `supabase db push`, all listed
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
20260921000000_separate_wallet_review_from_account_access.sql
20260921010000_grandfather_legacy_wallet_funding.sql
20260921011000_reconcile_grandfathered_wallet_reviews.sql
20260924000000_fix_trusted_spend_accounting.sql
20260924001000_close_public_identity_surfaces.sql
20260924002000_restrict_site_visit_fraud_evidence.sql
20260924003000_restrict_public_app_settings.sql
20260924004000_restrict_referral_lookup.sql
20260924005000_pause_public_activity_feed.sql
20260924006000_wallet_financial_truth.sql
20260924007000_use_financial_truth_for_review.sql
20260924008000_route_wallet_gates_through_financial_truth.sql
20260924009000_use_financial_truth_in_purchase_trigger.sql
20260924010000_admin_fraud_visit_telemetry.sql
20260924011000_remove_email_based_financial_audit_access.sql
20260924012000_refund_link_precedence_in_financial_truth.sql
20260924013000_close_manual_sql_editor_rls_reopens.sql
20260924014000_bind_browser_cro_decision_evidence.sql
20260924015000_restrict_admin_alert_inserts.sql
20260924016000_ignore_balance_neutral_ledger_evidence.sql
20260924017000_restrict_public_sales_aggregates.sql
20260924018000_restrict_pocketfi_payment_evidence.sql
20260924019000_restrict_financial_history_table_privileges.sql
20260924020000_revoke_legacy_balance_rpc_overloads.sql
20260924021000_recheck_wallet_truth_when_unsuspending.sql
20260924022000_hide_unfinished_bitrefill_redemption.sql
20260924023000_preserve_recorded_admin_credit_approval.sql
20260924024000_use_financial_truth_for_refund_capacity.sql
20260924025000_hide_uncommitted_order_credentials.sql
20260924026000_restrict_bills_provider_response.sql
20260924027000_revoke_financial_history_column_writes.sql
20260924028000_close_partner_inherited_grants.sql
20260924029000_admin_cross_wallet_payment_conflicts.sql
20260924030000_detect_reused_gateway_evidence.sql
20260924030200_add_admin_product_relationship_writer.sql
20260924030500_add_managed_catalog_readers.sql
20260924031000_restrict_catalog_supplier_config.sql
20260924031500_restrict_product_relationship_metadata.sql
20260924032000_restrict_pending_payment_browser_reads.sql
20260925000000_restore_refunds_across_spend_cycles.sql
20260925001000_require_exact_gateway_evidence_amounts.sql
20260925002000_admin_fraud_auth_email_fallback.sql
20260925003000_review_cross_wallet_gateway_reference_reuse.sql
20260925004000_show_cross_wallet_gateway_reference_conflicts.sql
20260925005000_restrict_smm_supplier_ids.sql
20260925006000_restrict_smm_supplier_ids_browser_grants.sql
20260925007000_restrict_smm_order_panel_response_reads.sql
20260925008000_restrict_sms_order_private_reads.sql
20260925009000_restrict_telegram_order_browser_reads.sql
20260925010000_restrict_staff_action_queue.sql
20260925011000_surface_legacy_funding_chronology.sql
20260925012000_restrict_admin_alert_acknowledgement.sql
20260925013000_secure_profile_admin_reader.sql
20260925014000_add_scoped_discount_readers.sql
20260925015000_restrict_discount_code_browser_reads.sql
20260925016000_reserve_discount_uses_with_orders.sql
20260925017000_recheck_suspended_admin_rpcs.sql
20260925018000_restrict_suspended_admin_audit_reads.sql
20260925019000_restrict_suspended_admin_order_history.sql
20260925020000_restrict_suspended_admin_alert_access.sql
20260925021000_restrict_suspended_admin_forensic_reads.sql
20260925022000_restrict_suspended_admin_settings_writes.sql
20260925023000_restrict_suspended_admin_telemetry_reads.sql
20260925024000_restrict_suspended_admin_financial_history.sql
20260925025000_restrict_suspended_admin_revenue_reads.sql
20260928000000_record_approved_historical_admin_funding.sql
20260928001000_allow_reviewed_historical_wallet_deficits.sql
20260928002000_stop_automatic_fraud_holds.sql
```

The final `20260928002000` migration is an emergency policy change. It stops
automatic wallet-review writes, releases system-generated review holds, and
uses the stored balance for purchases by customers with pre-cutoff wallet
activity/profile history and recorded
funding. New customers and customers with no recorded funding remain limited
by canonical confirmed funds; manual account suspensions and reviewer-set
wallet holds still apply. It does
not insert credits, change wallet balances, or establish the provenance of
historical gaps. Deploy the matching Edge and web builds; old builds may still
check retired device bans or wallet-review flags. See
`2026-09-28-legacy-purchase-policy.md` for the owner verification sequence.

These older replay migrations were also touched so a not-yet-applied database
does not briefly clear wallet holds before the hardened evaluator and rescan
run:

```text
20260914006000_normalize_ledger_suspension_checks.sql
20260914011000_harden_crypto_transfer_and_fraud_credits.sql
20260914012000_reset_auto_fraud_suspensions.sql
```

The old reset migration is now a no-op. The old fraud evaluators can still mark
accounts for review, but they do not clear financial review automatically.
`20260921000000_separate_wallet_review_from_account_access.sql` moves
system-generated holds into the wallet-review state while preserving read-only
access to account history and deposits.

`20260921010000_grandfather_legacy_wallet_funding.sql` must be applied after
that migration. It records qualifying wallet credits before
`2026-09-19 00:00:00 UTC` as an auditable legacy principal baseline, marks
matching historical debits for refund conservation, and patches the fraud
evaluator, wallet engine, and transaction guard to use the same baseline.
Post-cutoff credits remain provider-verified or approved-admin-only. The
migration fails if it cannot patch the expected deployed function bodies; do
not bypass that failure by manually editing the migration in production.

`20260921011000_reconcile_grandfathered_wallet_reviews.sql` must be applied
after the legacy baseline. It clears only automatic wallet-review holds for
grandfathered customer accounts whose current spend and displayed balance are
covered by the legacy-aware evaluator. It does not change manual suspensions
and does not clear review holds for customers without a qualifying legacy
funding row.

`20260924000000_fix_trusted_spend_accounting.sql` follows legacy review
reconciliation. It corrects the consumed-spend equation, avoids running the
ledger evaluator between an authorized ledger insert and its balance update,
and clears only reconciled automatic mid-posting reviews. Verify its function
rewrites against the deployed definitions in staging before production use.

`20260924001000_close_public_identity_surfaces.sql` follows the accounting
correction. Verify its identity/RLS changes against the deployed schema and
keep the affected routes paused until restricted-role checks pass.

`20260924002000_restrict_site_visit_fraud_evidence.sql` removes browser write
access to `site_visits`. Deploy it with the updated visitor tracker and Edge
recorder. Existing IP/device bans are preserved; review their provenance before
relying on them to block another account.

`20260924003000_restrict_public_app_settings.sql` limits ordinary browser reads
to storefront configuration keys while retaining the current admin policy.
`20260924004000_restrict_referral_lookup.sql` removes the anonymous referral
graph and replaces its customer use with a signed-in, caller-bound count RPC.
`20260924005000_pause_public_activity_feed.sql` removes browser execution of
the activity RPC because it returned exact financial amounts and event times.
The updated web app no longer mounts the public feed. Deploy these with the
updated web app before considering public-data checks complete.

`20260924006000` defines the full-history, fail-closed canonical financial
reader and admin-only read wrappers. `20260924007000` routes the compatibility
principal/review functions through it. `20260924008000` rewrites the existing
wallet debit and reservation gates in place; it aborts if the deployed function
bodies do not match reviewed anchors. `20260924009000` makes the transaction
purchase insert guard use the same reader and aborts on an unexpected trigger
definition. Apply these together with the updated
admin web app and paid Edge routes. Keep supplier fulfillment paused until
real-Postgres integration tests and owner verification establish that each
deployed gate reads the same confirmed spendable amount. The contract and
legacy-evidence limitations are in `financial-truth-contract.md`.
`20260924010000` adds a separately authorized admin-only IP/device telemetry
read for Fraud Review search. This telemetry never changes the financial truth
or wallet-review decision; older client-written IP evidence is unverified.
`20260924011000` replaces email-based audit read exceptions with current
`profiles.is_admin` checks for both financial audit tables. It does not change
wallet balances, customer holds, or account suspensions.
`20260924012000` makes the canonical reader, refund posting path, and refund
guard use one original-debit matcher. A supplied debit ID cannot fall back to
another debit through a weaker key/order/reference. Existing refunds that only
have an order or reference retain that fallback. It patches function bodies
and aborts on unexpected anchors; verify on an isolated PostgreSQL database
before applying it to production.
`20260924013000` removes broad app-settings, site-visit, CRO, and chat
analytics policies created by retired standalone SQL Editor repair scripts.
It also removes browser UPDATE access to revenue-event evidence and restores
the authenticated-user-bound, non-financial INSERT policy. It must follow the
storefront's narrow app-settings policy in `03000`. The old manual scripts are
now no-ops so rerunning them cannot reopen those reads or writes. The chat
widget does not depend on the optional browser-written chat analytics rows;
verify its normal interaction in staging before deployment.
`20260924014000` replaces the unrestricted browser INSERT policy on
`cro_decision_audit` with an authenticated-user-bound, explicitly
client-observed policy. Anonymous observations remain possible with no
customer ID. This affects analytics evidence, not wallet balances or holds.
`20260924015000` removes the authenticated-browser INSERT policy for
`admin_alerts`. Admins can still read and acknowledge alerts; service-role
Edge Functions can still create them. Check effective deployed grants and the
old policy name with read-only query 22 before treating alerts as trusted.
`20260924016000` removes strictly marked balance-neutral admin repair evidence
from the canonical posted-movement sum. The row remains in transaction
history, but no longer creates a false ledger surplus or stored-balance
deficit. The patch aborts on an unexpected reader definition. Test it against
the actual staging function after `12000`; use read-only query 23 to confirm
the deployed marker and inspect affected rows. It does not clear existing
review holds or change balances.
`20260924017000` removes anonymous exact revenue and product-unit RPC access.
The public storefront switches to count-only and bounded ranking RPCs;
`get_customer_sales_stats` remains available only to a current admin or staff
member with `view_stats`. Browser write grants on `staff_permissions` are
removed so the permission cannot be self-enabled. Deploy the migration with
the updated Vercel app or public order/popularity counters may show zero until
the app is updated. The migration requires `staff_permissions`; it aborts if
the deployed schema does
not match. Verify grants with read-only query 24 and staging role tests.
`20260924018000` removes all browser-role privileges from PocketFi webhook
evidence, including `TRUNCATE`, which RLS does not constrain. The provider
webhook retains service-role read/write access. Verify effective deployed
privileges with read-only query 25 and test a signed sandbox webhook before
reopening PocketFi-backed spending.
`20260924019000` removes effective browser write, `TRUNCATE`, and DDL-adjacent
table privileges from ledger, payment-intent, and order-history tables while
retaining existing SELECT grants. It also revokes profile `TRUNCATE` without
removing guarded profile edits. Verify deployed grants with read-only query 26
and the staging security pack before reopening paid routes.
`20260924020000` revokes browser execution from every deployed overload of
the five known legacy balance-writing RPC names. Confirm the effective result
with read-only query 27; checking only the signature used by the current app
is insufficient when an older overload remains installed.
`20260924021000` rechecks canonical wallet truth inside
`set_customer_suspension_state` after locking the customer profile. The Edge
route's earlier review remains useful for a detailed response, but cannot be
the final unsuspension authorization. Verify the deployed definition and
effective grants with read-only query 28 and a staging review scenario.
`20260924022000` removes direct browser access to Bitrefill redemption and
raw provider columns. Customer history must use the completed-order-only RPC;
verify effective column grants and own-row isolation before reopening it.
`20260924023000` recognizes admin credits from the two reviewed posting routes
using their recorded approval identity and metadata, so later approver role
changes cannot retroactively remove customer backing. Unknown credit sources
remain untrusted. `20260924024000` removes the older refund trigger's separate
principal/refund calculation and uses canonical truth for the global refund
capacity check; its original-debit linkage and per-debit cap remain in place.
Both dynamic patches abort on unexpected deployed function definitions.
Read-only query 30 verifies the deployed definitions and lists the scope of
post-cutoff admin-credit rows requiring separate owner review.
`20260924025000` revokes all direct browser reads of `orders`
and exposes a scoped history view. Only an order's customer can see completed
credentials after a captured purchase, with pre-enforcement completed orders
retained for legacy access. Admin history receives non-secret metadata. Deploy
the matching browser build before reopening order history; an older build
that selects the base-table secret column will fail closed. Read-only query 31
checks effective grants and the deployed view definition.
`20260924026000` removes browser table-wide SELECT from bills history, grants
only customer-facing columns, and keeps raw SageCloud responses server-only.
The matching Edge build uses its server client for order lookup and insert;
the lookup fails closed on error. Keep bills paused until the owner verifies
deployed grants (read-only query 32), payment/provider behavior, and replay
handling in sandbox.
`20260924027000` closes browser writes on SMS orders and crypto withdrawals
and revokes separately granted column INSERT, UPDATE, and REFERENCES across
the paid-history tables. Table-level REVOKE alone does not remove a column
grant. It requires both SMS and withdrawal tables to exist and aborts on an
unexpected schema. Customer history SELECT and service-role writes remain.
Verify effective deployed table and column privileges with read-only query 33.
`20260924028000` completes the partner-table pause at the database boundary:
all six partner tables lose direct browser grants, including privileges inherited
through `PUBLIC` and separately granted on columns. It aborts if any expected
partner table is missing. Admin partner inspection still uses the server-side
Edge function. Verify effective deployed privileges with read-only query 34;
do not re-enable partner operations based on this migration alone.
`20260924029000` adds an admin-only, read-only, keyset-paginated scan for the
same external payment identity appearing on more than one wallet. Deploy it
before the matching admin UI, which fails the Fraud Review load visibly if
the evidence RPC is unavailable. The signal is not payment-provider proof and
does not change customer funding, purchase eligibility, or suspension. Query
35 checks the deployed function grant and historical collision count.
`20260924030000` fixes the malformed inner PocketFi webhook UUID check in the
canonical financial reader. Without it, otherwise valid post-cutoff PocketFi
credits can be reported as untrusted. It also treats one provider evidence row
supporting multiple completed credits as a payment-identity conflict, even if
the ledger rows carry different external payment IDs; spending then fails
closed pending reconciliation. Deploy after `29000`, test a genuine PocketFi
deposit and both provider-reuse cases in staging, and run read-only query 36.
This does not identify the historical cause or automatically reverse credits.

Catalog rollout has a required stop between migrations `30500` and `31000`:
apply the relationship-writer expand migration `30200` and managed catalog
reader `30500`, deploy the matching Vercel/browser build and `chatbot` Edge
Function, and smoke-test public product listings, chatbot product search,
admin/staff product editing, and Revenue OS relationship upserts. Only then apply `31000`
and verify read-only query 37 shows no browser access to supplier IDs or
fulfillment settings. Apply `31500` after the same browser build and verify
query 38 denies public relationship metadata while recommendation edges and
admin product-intelligence reads still work. Do not bulk-push these contract
migrations ahead of the browser/Edge builds; older builds request whole
catalog and relationship rows and will fail after the column-level
contractions. If the app or chatbot deploy fails, keep the old grants
temporarily and do not apply `31000` or
`31500`. Paid-route pause rules are unchanged by this sequence.

Migration `32000` then removes direct browser SELECT on `pending_payments`,
including inherited column grants. The checkout/recovery functions and
canonical reader use server-side access; the storefront has no direct table
caller. Run read-only query 39 after applying it and keep historical provider
error text restricted to owner investigation.

Migration `20260925000000` corrects refund restoration across repeated
spend/refund cycles in the canonical reader, refund trigger, and wallet engine.
It follows the `20260924` migrations and deliberately aborts if any deployed
function differs from the reviewed body. Test a full funded cycle and an
unbacked original-debit rejection in staging, then run read-only query 40.
Do not treat its local fixture as proof that production has this definition.

Migration `20260925001000` removes two-decimal rounding from Ercas/PocketFi
evidence matching in the canonical reader and wallet writer. It deliberately
aborts on unexpected function bodies. Apply after `25000000`; run the
over-precise evidence scenario in staging and read-only query 41 against the
deployed definitions before treating a deposit as backed.

Migration `20260925002000` lets the admin-only Fraud Review reader use the
current Auth email when `profiles.email` is missing or stale. Apply after the
canonical reader, then run read-only query 42 and test both an admin lookup
and an ordinary customer's denied call in staging. Do not expose `auth.users`
directly to browser roles.

Migrations `20260925003000` and `20260925004000` make a post-cutoff provider
reference claimed by multiple wallets a canonical payment-identity conflict
and show the linked wallets in the admin-only Fraud Review reader. Distinct
ledger `external_payment_id` aliases no longer hide a shared reference. They
do not edit balances or auto-suspend accounts, but the canonical gate denies
new spending on ambiguous claims until reviewed. Run read-only query 43 before
and after deployment, preserve any matching evidence, and test a legitimate
funded wallet plus a cross-wallet collision in staging. The signal is not
independent provider proof or an accusation against either customer. Migration
`03000` builds two normal expression indexes on gateway-credit identities;
measure `transactions` size and expected write-lock time in staging before
applying it to production.

SMM catalog rollout has a second required stop. Apply `20260925005000` to add
admin-gated SMM reader/toggle RPCs while old browser grants remain. Deploy the
matching Vercel/browser build and `smm-get-services`, `smm-check-status`, and
`smm-create-order` Edge Functions, then verify customer catalog and order
history loading, admin search and toggles, and the paused SMM checkout path
in staging. Only then apply `20260925006000` and `20260925007000`, which
remove broad and inherited column grants from the service and order tables.
Run read-only query 44 after the contract: `external_id` must be unreadable by
both browser roles, safe catalog columns must remain readable, and ordinary
customers must be denied by the admin RPCs. Query 45 must show that browser
roles cannot read `smm_orders.panel_response` or `cost_usd`. An old browser
build still reading whole SMM service/order rows or directly updating the
service table will break after these contractions. If the app deploy fails,
leave old grants temporarily and do not apply `06000` or `07000`. Keep SMM
fulfillment paused regardless of catalog availability. The new supplier
unknown-outcome branch preserves the debit and requires manual/provider
reconciliation before any refund; it is not a reason to reopen SMM checkout.
Before deploying that Edge build, inspect the deployed `smm_orders.status`
type and CHECK constraints with query 45; if `outcome_unknown` is rejected,
keep checkout paused and adjust the schema under review first.

SMS order history has a separate browser-grant contraction. Deploy the
matching browser build (explicit safe SMS history columns) and `smsbus` Edge
Function (safe failure text and explicit admin/staff order response) first.
Confirm customer SMS history and admin Sales/History/SMS tabs in staging.
Then apply `20260925008000`, which restricts browser SELECT to safe columns
and customer-owned rows or current admins even if an older permissive policy
remains. It aborts when required deployed columns are missing. Query 47 checks
effective grants and policies afterward. An older browser build selecting
`sms_orders.*` will fail after this migration; leave fulfillment paused and
do not apply the contraction until the matching build is ready. Existing
`sms_orders.error_message` rows are preserved as incident evidence and may
contain older raw errors; only server-side restricted review should read them.

Telegram retail prices and customer order status now come from explicit
`telegram-stars` response shapes. Deploy that Edge Function and the matching
browser build together while `TELEGRAM_ORDERS_ENABLED=false`. Verify preset
prices, a custom-quantity quote, premium catalog labels, and customer order
history in staging. Then apply `20260925009000`, which removes browser table
and inherited column grants for `telegram_orders` and `telegram_products`;
the service role retains the internal reads and writes. Query 48 checks the
deployed grants. Keep Telegram fulfillment paused until supplier idempotency,
refund, and denied-order evidence are independently verified. Old deployed
bundles may still display supplier pricing fields until replaced; removing
database grants alone does not replace the Edge response.

`20260925010000` removes browser insert/update authority over
`staff_pending_actions`, including inherited column grants, while keeping
staff own-history reads and service-role queue operations. It also admits a
`failed` audit state for an approved action whose execution fails. Confirm
`manage-staff` is the active submission/approval route, then apply this
migration before deploying the matching Edge build. It checks for an unknown
old status constraint and fails for schema review rather than leaving failed
actions marked approved. Query 49 checks deployed grants and the constraint;
verify an ordinary authenticated account cannot create an approval request
directly through PostgREST. The constraint replacement takes a table lock;
schedule it for the small staff queue during a controlled deployment.

`20260925011000` adds recorded legacy debit/funding chronology to the
canonical financial reader. Apply it after all earlier reader patches and
before the matching admin UI. It does not alter trusted principal, spending
authorization, or wallet holds. Query 50 lists manual-review candidates;
verify the actual function definition and payment-history coverage in staging
before relying on the signal.

`20260925012000` removes table/column UPDATE grants on `admin_alerts` from
browser roles, regrants only acknowledgement to authenticated admins, and
records acknowledgement actor/time in a trigger. Deploy it with the matching
`AdminAlerts` browser build, which writes only `acknowledged`. Query 51 and
the staging DB pack verify the effective grants and trigger. Preserve
existing alerts; do not clear them during deployment.

`20260925013000` replaces the recursive profile SELECT policy and makes the
existing caller-bound `is_admin_profile()` helper a search-path-pinned
security definer. It preflights the helper owner and deployed policy; stop
for schema review if either differs. Deploy the matching `manage-staff` Edge
Function and Staff Admin browser build before applying the policy change;
the Users tab now uses a permission-scoped customer search rather than direct
profile search. Then run query 52 and authenticated staging reads for
own, other-customer, staff, admin, and suspended-admin accounts. An existing
session must lose admin helper access after suspension. Do not infer production
profile scope from the isolated fixture alone. Stage Staff Admin search with
and without `tab_users`, and with an already-suspended staff session; none
may expose staff/admin identities or private profile columns.

`20260925014000` adds caller-bound discount-code preview and managed-list
RPCs. Deploy the matching browser build and verify customer checkout preview,
owner code management, and permissioned Staff Admin code management before
`20260925015000` removes the ordinary-user discount table SELECT policy and
the reviewed `discount_codes_write` staff `FOR ALL` policy, which also grants
direct SELECT. Confirm the matching Staff Admin build routes code changes
through `manage-staff`; the contract aborts if unknown read policies are
present. Run read-only
query 53 and staging customer/staff/admin/anonymous role checks afterward;
do not bulk-push both migrations before the browser update. A submitted code
can still be guessed, so keep promo codes suitably hard to guess and review
preview request abuse separately.

`20260925016000` moves limited-use discount capacity into the order insert
and completion transactions. Deploy the matching `process-purchase` Edge
build first: it rejects discount-code purchases until the migration's
service-only `discount_code_capacity_version()` reports ready. Wait for all
old Edge requests to drain, then apply the migration and verify query 54 in
staging. Do not run old and new Edge builds across this migration; old builds
increment `used_count` after delivery and would double-count with the new
completion trigger. Ordinary local-product purchases without a code need not
be paused by this change, but code redemption remains unavailable until the
database readiness check succeeds. Validate one-use code replay, two
concurrent checkouts, definitive pre-completion failure, and normal checkout
before enabling discount redemption in production.

`20260925017000` makes the six direct admin financial/investigation/SMM
RPCs reject an administrator whose account is currently suspended. It
rewrites only expected function bodies and aborts atomically on drift. Apply
after `20260925005000` and the latest Fraud Review function definitions.
Run read-only query 55, then test active, suspended-old-session, and ordinary
JWT calls in staging. No wallet or customer account state is changed.

`20260925018000` switches the financial-audit and SMS-history admin read
policies to the current active-admin helper. A suspended admin retains only
their own SMS order history. The migration aborts if the expected policies
are absent. Run read-only query 56 and test current, suspended-old-session,
and customer JWT reads in staging.

`20260925019000` narrows the `orders_safe_history` admin branch to the
active-admin helper without changing customer self-history or completed-order
credential rules. It requires the prior captured-order view contract. Run
read-only query 57 and test a suspended admin's old JWT, an active admin,
and a customer with completed and processing orders in staging.

`20260925020000` removes suspended-admin alert read/acknowledgement access
and adds a restrictive active-admin RLS bound, so an additional permissive
policy cannot reopen those operations. It depends on the active-admin helper
and the existing named alert policies. Run read-only query 58 and test
active, suspended-old-session, and ordinary JWT reads and acknowledgements.

`20260925021000` contracts seven account, balance, identity, and device
forensic read policies to current active admins. Its restrictive read
policies bound any extra permissive policy for authenticated sessions. It
aborts if the expected named policies are absent. Run read-only query 59
and real-JWT active/suspended/customer read probes in staging.

`20260925022000` prevents a suspended admin from changing operational and
SMS product settings directly through PostgREST, including if another
permissive write policy exists. It preserves the storefront's public-key
settings reads. Run read-only query 60 and test active, suspended-old-session,
and customer JWT reads/writes in staging before relying on the restriction.

`20260925023000` narrows site-visit reads to active admins and revenue
identity-link reads to active admins or the link owner. The owner read is
needed for customer `INSERT ... RETURNING` compatibility. It does not
change customer self-link write permissions. Run read-only query 61 and
test active, suspended-old-session, and customer JWT reads and a customer
self-link insert in staging.

`20260925024000` narrows base `orders` and `transactions` reads to the row
owner or a currently active admin. It recognizes the reviewed production
`Users and admins can read ...` policies but aborts on any other extra read
policy. It does not re-grant base-order credential columns. Run read-only
query 62 and real-JWT active/suspended/customer history probes in staging.

`20260925025000` narrows raw Revenue OS event reads to the event owner or an
active admin, and decision-audit reads to active admins. It revokes anonymous
table and column SELECT grants. Run read-only query 63 and real-JWT
active/suspended/customer/anonymous probes in staging; client telemetry
inserts should continue to work.

`20260919019000_rescan_wallet_integrity_after_hardening.sql` re-runs the
hardened ledger evaluator for existing ordinary customer wallets after the new
trusted-principal rules are installed. It can create wallet-review holds for
owner review, and if a wallet cannot be evaluated it fails closed into the same
financial hold. It does not clear a financial review hold automatically.

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

Later production security migrations must also be tracked in order:
`20260929000000_allow_protected_legacy_cutoff_callers.sql`,
`20261001000000_reset_staff_authority_on_role_change.sql`,
`20261001001000_remove_implicit_staff_database_access.sql`,
`20261001002000_link_legacy_smm_refunds.sql`,
`20261001003000_verified_historical_pocketfi_recovery.sql`,
`20261001004000_verified_missing_ercas_funding.sql`,
`20261001005000_schedule_verified_payment_recovery.sql`, and
`20261001006000_require_staff_owner_review.sql`.

Migration `06000` forces every staff permission into review mode and adds a
database constraint against restoring automatic approval. Deploy the matching
`manage-staff`, `email`, and `smsbus` functions and browser build before
creating another staff account. Staff may submit permitted changes; the owner
must approve each change before it takes effect.

## Supabase Edge Functions To Deploy

Run these commands from the repository root with the reviewed project ref.
Do not paste only an `index.ts` file into the Supabase Dashboard editor:
`create-crypto-sell-order`, `nowpayments-webhook`, `process-purchase`,
`purchase-bills`, `purchase-bitrefill`, `verify-and-credit-wallet`, and
`webhook-pocketfi` import sibling `_shared` files that
must be present when bundling. On a machine without Docker, the owner can
append `--use-api --project-ref <reviewed-project-ref>` to an individual
`supabase functions deploy` command. A successful bundle is not proof that
the function is safe to reopen; keep its pause flag disabled until the
route-specific owner checks pass. Before a Git-based deploy, ensure each
imported `_shared` file is included in the commit, not merely present as an
untracked file in this worktree.

To deploy all 37 function directories from this worktree in one owner-run
command, use `supabase functions deploy --use-api --project-ref
<reviewed-project-ref>`. This command bundles imported `_shared` files and
reads per-function JWT settings from `supabase/config.toml`. Do not add
`--no-verify-jwt` to the deploy-all command, and do not add `--prune`.
Keep all incident pause flags disabled until the matching migrations,
Vercel build, and owner verification are complete.

Deploy these changed functions after migrations. Before deploying
`revenue-os-loop`, verify or change its scheduler to use `POST` with a
server-stored service-role bearer token; the function now rejects all other
callers and `GET` requests. Do not expose that token in browser code or a URL.
Set `TALLYSTORE_SITE_ORIGIN` in the Supabase Edge environment to the HTTPS
storefront origin for staging; production defaults to `https://tallystore.org`.
`create-wallet-topup` always sends Ercas back to that origin's `/wallet` path,
regardless of browser `Origin` or request body. Verify `ercas_enabled` is
explicitly `true` before expecting checkout initiation; missing or unreadable
settings now leave Ercas disabled.

```bash
supabase functions deploy admin-adjust-balance
supabase functions deploy apply-referral
supabase functions deploy auto-restock
supabase functions deploy bitrefill-catalog
supabase functions deploy chatbot
supabase functions deploy check-pending-payments
supabase functions deploy create-crypto-sell-order
supabase functions deploy create-pocketfi-topup
supabase functions deploy create-wallet-topup
supabase functions deploy create-withdrawal-request
supabase functions deploy email
supabase functions deploy get-available-cryptos
supabase functions deploy get-data-plans
supabase functions deploy get-my-ip
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
supabase functions deploy update-crypto-rates
supabase functions deploy validate-bank-account
supabase functions deploy verify-and-credit-wallet
supabase functions deploy webhook-pocketfi
supabase functions deploy withdraw-referral-balance
```

Shared code changed:

```text
supabase/functions/_shared/staff-purchase-guard.ts
supabase/functions/_shared/ngn-amount.mjs
```

Shared code is bundled through importing functions, so deploy every function
above even if a route change looks small.
`verify-and-credit-wallet` imports the NGN parser; deploy that function to
replace its former one-kobo amount tolerance, then test exact and mismatched
provider amounts and returned payment identities in staging.

The `check-pending-payments` Edge function also needs a live scheduler. Before
applying `20261001005000_schedule_verified_payment_recovery.sql`, store the
project's Supabase URL in Vault as `tallystore_project_url`, store a random
token in Vault as `payment_recovery_cron_secret`, and set that same token as the
Edge secret `PAYMENT_RECOVERY_CRON_SECRET`. The migration schedules a call every
ten minutes without placing the token in `cron.job`. Confirm the job is active,
an unauthenticated request is denied, and `cron.job_run_details` reports a
successful run. The worker retries only checkouts created in the preceding 48
hours; older pending payments require individual provider and wallet review.
`verify-and-credit-wallet` also requires that review for browser retries older
than 48 hours and rejects payments already recorded in
`wallet_missing_gateway_funding`. An operator recovery must recheck the Ercas
payment and the customer's ledger before using the service role path; no
browser account can bypass the age gate.

Also verify these existing security-sensitive functions are still deployed with
the expected config and secrets:

```text
apply-referral
check-pending-payments
get-my-ip
nowpayments-webhook
partner-api
record-site-visit
revenue-os-maintenance
smm-check-all-orders
smsbus
webhook-pocketfi
```

From project-level `supabase/config.toml`, the currently JWT-disabled functions are:

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
src/App.tsx
src/components/CryptoBalanceCard.tsx
src/components/SimpleProtectedRoute.tsx
src/components/TopUpWallet.tsx
src/components/VisitorTracker.tsx
src/contexts/SimpleAuth.tsx
src/hooks/useAuth.ts
src/hooks/usePaymentStatusChecker.ts
src/hooks/useRecommendations.ts
src/lib/paymentStorage.ts
src/lib/productAvailability.ts
src/lib/revenue-os.ts
src/lib/supabase.ts
src/pages/AdminPage.tsx
src/pages/BillsPayment.tsx
src/pages/CheckoutPage.tsx
src/pages/CryptoHistory.tsx
src/pages/CryptoWithdrawal.tsx
src/pages/GiftCardsEsims.tsx
src/pages/GetIP.tsx
src/pages/Index.tsx
src/pages/OrderHistoryPage.tsx
src/pages/PaymentCallbackPage.tsx
src/pages/PaymentSuccessPage.tsx
src/pages/ProductDetailPage.tsx
src/pages/ProductsPage.tsx
src/pages/SimpleLogin.tsx
src/pages/SimpleRegister.tsx
src/pages/SupportPage.tsx
src/pages/WebServicesPage.tsx
```

Required live checks after redeploy:

- `api/partner-api.ts` returns `503` with `PARTNER_API_PAUSED`.
- Legacy Ercas Vercel webhook routes return `410`.
- PocketFi bridge rejects unsigned requests before proxying.
- iStar bridge rejects invalid signatures, malformed signed JSON, and event
  types supplied only through the unsigned `X-iStar-Event` header. Confirm a
  genuine signed callback still works in provider staging before reopening
  Telegram fulfillment.
- Deploy the matching `telegram-stars` Edge Function and Vercel iStar webhook
  together while new Telegram orders remain paused. The Edge poll/admin
  cancellation paths must not auto-refund or overwrite terminal outcomes;
  the webhook must conditionally transition an eligible order before refund.
  Stop old workers/routes that could still apply a blind cancel or poll refund.
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
