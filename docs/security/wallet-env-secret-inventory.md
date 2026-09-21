# Wallet Environment And Secret Inventory

Prepared: 2026-09-19

This inventory records environment variables and secrets that affect wallet
funding, delivery, provider calls, route pausing, owner evidence collection, and
incident tooling. It is source evidence only; owner verification must compare it
with the deployed Vercel project, Supabase Edge Function secrets, scheduled jobs,
and provider dashboards.

## Rules

- Browser-exposed `VITE_` variables may contain only public configuration.
- Payment-provider secrets, API keys, webhook secrets, service-role keys, SMTP
  passwords, cron secrets, supplier keys, and bearer tokens must be server-only.
- Do not add `VITE_ERCAS_SECRET_KEY`, `VITE_POCKETFI_SECRET_KEY`,
  `VITE_NOWPAYMENTS_API_KEY`, `VITE_ISTAR_API_KEY`, `VITE_DAISYSMS_API_KEY`,
  `VITE_SMM_PANEL_API_KEY`, `VITE_BITREFILL_API_KEY`,
  `VITE_SAGECLOUD_SECRET_KEY`, or any similar browser-exposed payment/supplier
  credential.
- `.env.example` must not contain real-looking provider keys, even test keys.
  Use placeholders only.
- Missing verification secrets must fail closed. They must not enable a
  production bypass.
- Pause flags stay disabled until the matching route has staging, provider, and
  production evidence.

## Browser-Public Variables

| Variable | Use | Secret? | Rule |
| --- | --- | --- | --- |
| `VITE_SUPABASE_URL` | Public Supabase project URL for browser client. | No | Allowed in browser. |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/public key for browser client. | No | Allowed in browser, still constrained by RLS and grants. |
| `VITE_LIVE_ACCOUNT_FULFILLMENT_ENABLED` | Browser display/sellable hint for live-account availability. | No | Does not authorize fulfillment; server routes remain the enforcement boundary. |

No payment provider, supplier, webhook, cron, SMTP, service-role, or private API
credential may use a `VITE_` prefix.

## Server-Side Supabase And Tooling

| Variable | Surface | Rule |
| --- | --- | --- |
| `SUPABASE_URL` | Supabase Edge Functions, owner tools. | Server-side/project URL. |
| `SUPABASE_ANON_KEY` | Supabase Edge Functions that need user auth context. | Server-side in functions; public key but not a funding authority. |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Functions and owner read-only reconciliation. | Server-only; never browser; rotate if exposed. |
| `SUPABASE_DB_URL` | Staging DB test runner. | Owner-controlled staging/local only. |
| `DATABASE_URL` | Staging DB test runner fallback. | Owner-controlled staging/local only. |
| `TALLYSTORE_DB_TEST_ENV` | DB test runner guard. | Must be `staging` or local owner-controlled value, not production. |
| `TALLYSTORE_DB_TEST_ACK` | DB test runner mutation acknowledgement. | Required before rollback mutation tests. |
| `TALLYSTORE_DB_CONCURRENCY_ACK` | Real Postgres concurrency runner committed-mutation acknowledgement. | Required before committed staging/local race tests that reset the supplied ordinary test wallet. |
| `TALLYSTORE_DB_TEST_USER_ID` | DB test ordinary customer fixture. | Must reference non-admin/non-staff staging profile. |
| `TALLYSTORE_DB_TEST_ADMIN_ID` | DB test current-admin fixture. | Must reference a separate current admin profile used only to verify approved admin-credit evidence; never use a customer or staff-only profile. |
| `TALLYSTORE_DB_SECOND_TEST_USER_ID` | Optional second DB concurrency fixture. | Must reference a different non-admin/non-staff staging profile; enables the cross-wallet same-provider-payment race. |
| `TALLYSTORE_RECONCILE_ENV` | Read-only reconciliation guard. | Production requires explicit `--allow-production`. |
| `TALLYSTORE_RECONCILE_READONLY` | Read-only reconciliation acknowledgement. | Required before live evidence collection. |
| `TALLYSTORE_DEPLOYED_SMOKE_ENV` | Deployed smoke guard. | `staging`, `preview`, or explicit production run. |
| `TALLYSTORE_DEPLOYED_SMOKE_ACK` | Deployed smoke acknowledgement. | Required to confirm no-order probes only. |
| `TALLYSTORE_DEPLOYED_BASE_URL` | Deployed Vercel/site base URL. | Owner-controlled smoke target. |
| `TALLYSTORE_SUPABASE_FUNCTIONS_BASE_URL` | Optional deployed Edge Function base URL. | Owner-controlled smoke target for no-order probes. |
| `TALLYSTORE_DEPLOYED_SMOKE_AUTHORIZATION` | Optional deployed Edge Function smoke auth header. | Server/operator-only bearer value; use an owner-controlled test account and never expose in browser logs. |
| `TALLYSTORE_DEPLOYED_SMOKE_CRON_SECRET` | Optional deployed auto-restock smoke cron secret. | Server/operator-only cron secret; only needed to prove exact `AUTO_RESTOCK_PAUSED` after `x-cron-secret` validation. |
| `TALLYSTORE_DEPLOYED_SMOKE_OWNER_DENIED_PROBES` | Optional deployed denied-checkout probe JSON path. | Operator-only local file path; keep the concrete file outside the repo because it can contain private staging product/account details. |
| `TALLYSTORE_DEPLOYED_SMOKE_OWNER_DENIED_PROBES_ACK` | Owner denied-checkout probe acknowledgement. | Must be `I_UNDERSTAND_TEST_ACCOUNTS_MUST_BE_DENIED` before the smoke runner sends owner-defined denied checkout attempts. |
| `TALLYSTORE_DEPLOYED_SMOKE_TIMEOUT_MS` | Deployed smoke runner per-request timeout. | Operator-local verification control; defaults to 15000ms so deployed denied-route checks cannot hang indefinitely. |
| `TALLYSTORE_WALLET_LOCAL_CHECK_TIMEOUT_MS` | Local wallet security suite child-check timeout. | Operator-local verification control; defaults to 180000ms and should be raised only when preserving slow-machine evidence. |
| `TALLYSTORE_WALLET_TOOL_PROBE_TIMEOUT_MS` | Local wallet security suite tool-probe timeout. | Operator-local verification control; defaults to 15000ms and prevents unavailable tooling probes from hanging incident verification. |
| `TALLYSTORE_DB_TEST_TIMEOUT_MS` | Staging DB security runner `psql` timeout. | Operator-local verification control; defaults to 180000ms and reports an explicit timeout result instead of hanging DB proof collection. |
| `TALLYSTORE_DB_CONCURRENCY_TIMEOUT_MS` | Real Postgres concurrency runner `psql` timeout. | Operator-local verification control; defaults to 180000ms and reports explicit timeout results for purchase/refund race sessions. |

## Payment And Funding Providers

| Variable | Provider/path | Rule |
| --- | --- | --- |
| `ERCASPAY_SECRET_KEY` | Ercas create/verify top-up. | Server-only bearer secret. |
| `ERCAS_SECRET_KEY` | Ercas create/verify top-up fallback. | Server-only bearer secret. |
| `ERCASPAY_MERCHANT_ID` | Ercas verification identity. | Set when provider returns merchant identity. |
| `ERCAS_MERCHANT_ID` | Ercas verification identity fallback. | Set when provider returns merchant identity. |
| `ERCASPAY_BUSINESS_ID` | Ercas verification identity. | Set when provider returns business identity. |
| `ERCAS_BUSINESS_ID` | Ercas verification identity fallback. | Set when provider returns business identity. |
| `ERCASPAY_ENVIRONMENT` | Ercas verification environment. | Must match production/test mode. |
| `ERCAS_ENVIRONMENT` | Ercas verification environment fallback. | Must match production/test mode. |
| `ERCASPAY_MODE` | Ercas verification mode. | Must match production/test mode. |
| `ERCAS_MODE` | Ercas verification mode fallback. | Must match production/test mode. |
| `ERCAS_BASE_URL` | Ercas API endpoint placeholder. | Server-side endpoint config only; do not expose with `VITE_`. |
| `POCKETFI_PUBLIC_KEY` | PocketFi account setup API bearer token. | Server-only despite provider naming. |
| `POCKETFI_API_TOKEN` | PocketFi account setup API bearer token fallback. | Server-only. |
| `POCKETFI_BUSINESS_ID` | PocketFi business/account setup. | Server-only provider config. |
| `POCKETFI_BASE_URL` | PocketFi API endpoint. | Server-side provider endpoint. |
| `POCKETFI_WEBHOOK_SECRET` | PocketFi webhook verification. | Server-only webhook secret. |
| `POCKETFI_SECRET_KEY` | PocketFi webhook verification fallback. | Server-only. |
| `POCKETFI_SECRET_API_KEY` | PocketFi webhook verification fallback. | Server-only. |
| `NOWPAYMENTS_API_KEY` | NOWPayments API calls. | Server-only. |
| `NOWPAYMENTS_EMAIL` | NOWPayments auth. | Server-only. |
| `NOWPAYMENTS_PASSWORD` | NOWPayments auth. | Server-only. |
| `NOWPAYMENTS_IPN_SECRET` | NOWPayments webhook verification. | Server-only webhook secret. |

## Delivery, Supplier, Cron, And Utility Secrets

| Variable | Surface | Rule |
| --- | --- | --- |
| `ISTAR_API_KEY` | Telegram Stars/Premium provider. | Server-only supplier key. |
| `ISTAR_BASE_URL` | Telegram provider endpoint. | Server-side provider endpoint. |
| `ISTAR_WEBHOOK_SECRET` | iStar webhook verification. | Server-only webhook secret. |
| `DAISYSMS_API_KEY` | DaisySMS number rental provider. | Server-only supplier key. |
| `DAISYSMS_BASE_URL` | DaisySMS endpoint. | Server-side provider endpoint. |
| `DAISYSMS_WEBHOOK_SECRET` | DaisySMS webhook verification. | Server-only webhook secret. |
| `SMM_PANEL_API_KEY` | SMM panel provider. | Server-only supplier key. |
| `BITREFILL_API_KEY` | Bitrefill gift card/eSIM provider. | Server-only supplier key. |
| `SAGECLOUD_PUBLIC_KEY` | SageCloud bills/withdrawal auth. | Server-side provider credential. |
| `SAGECLOUD_SECRET_KEY` | SageCloud bills/withdrawal auth. | Server-only provider secret. |
| `MUABANVIA_API_KEY` | Live account supplier/restock. | Server-only supplier key. |
| `MUABANVIA_BASE_URL` | Live account supplier endpoint. | Server-side provider endpoint. |
| `SHOPCLONE_API_KEY` | Live account supplier/restock. | Server-only supplier key. |
| `SHOPCLONE_BASE_URL` | Live account supplier endpoint. | Server-side provider endpoint. |
| `SHOPVIACLONE_API_KEY` | Live account supplier/restock. | Server-only supplier key. |
| `SHOPVIACLONE_BASE_URL` | Live account supplier endpoint. | Server-side provider endpoint. |
| `SMTP_EMAIL` | Email utility. | Server-only mailbox credential. |
| `SMTP_PASSWORD` | Email utility. | Server-only mailbox password. |
| `AUTO_RESTOCK_SECRET` | Auto-restock authorization. | Server-only cron/operator secret. |
| `PAYMENT_RECOVERY_CRON_SECRET` | Pending-payment recovery cron. | Server-only cron secret. |
| `REVENUE_OS_CRON_SECRET` | Maintenance/revenue cron fallback. | Server-only cron secret. |
| `SMM_CHECK_CRON_SECRET` | SMM status worker cron. | Server-only cron secret. |
| `SMM_CRON_SECRET` | SMM status worker cron alias. | Server-only cron secret. |
| `PARTNER_API_INTERNAL_SECRET` | Partner API internal/admin operation boundary. | Server-only; public partner API remains paused during incident review. |

## Incident Pause Flags

These flags must remain unset or explicitly `false` in production until the
matching route has owner-approved evidence:

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

`REFERRAL_WITHDRAWALS_ENABLED` is a legacy old-build guard only. The current
`withdraw-referral-balance` route is hard-paused in source and does not read
that flag.

`CRYPTO_AUTO_CREDIT_ENABLED` must not be capable of reopening automatic
NOWPayments crediting during this incident review.

The partner API pause is hard-coded in source and must not depend on a
`PARTNER_API_PAUSED` environment variable.

## Owner Verification

For each deployment, record:

```text
environment:
provider:
variable checked:
location checked: Vercel / Supabase Edge Function secret / provider dashboard
expected value class: present / absent / false / rotated
verified by:
verified at:
notes:
```

Rotate any value that was exposed in a public file, chat, browser bundle,
screenshare, or provider dashboard screenshot.
