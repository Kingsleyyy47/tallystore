# Wallet Route Inventory

Prepared: 2026-09-19

This inventory complements the mutation and fulfillment maps. Its purpose is to
make sure every repository API route and Supabase Edge Function has an explicit
incident classification, including routes that do not move money. It is source
evidence only; deployment and provider behavior still need owner verification.

## Edge Function Auth Boundary

Supabase Edge Functions default to JWT verification unless their `config.toml`
explicitly sets `verify_jwt = false`. The only JWT-disabled functions in this
repository are:

```text
check-pending-payments
istar-webhook
istar-webhook-worker
nowpayments-webhook
partner-api
record-site-visit
revenue-os-maintenance
smm-check-all-orders
smsbus
webhook-pocketfi
```

Each JWT-disabled function must perform its own internal authorization,
signature validation, or strict non-financial telemetry boundary. Every other
Edge Function currently relies on the Supabase default JWT gate unless future
source/config changes prove otherwise.

## Classification Labels

- `VALUE_DELIVERY`: can deliver paid value, call a paid supplier, reveal paid
  credentials, or transfer value out.
- `FUNDING_OR_WEBHOOK`: can create or verify incoming funds or provider status.
- `ADMIN_OR_INTERNAL`: privileged admin, staff, cron, restock, maintenance, or
  catalog-sync surface.
- `READ_ONLY_OR_CATALOG`: returns catalogue, rate, availability, support, or
  lookup data without financial mutation.
- `TELEMETRY_OR_UTILITY`: records non-financial telemetry or utility data.
- `PAUSED_OR_MANUAL_REVIEW`: intentionally closed or held for incident review.
- `OWNER_PRODUCTION_CHECK_REQUIRED`: source classification must be compared
  with the deployed route/function list before reopening value movement.

## Vercel API Routes

| Route | Classification | Incident decision |
| --- | --- | --- |
| `api/partner-api.ts` | `VALUE_DELIVERY`, `PAUSED_OR_MANUAL_REVIEW` | Public partner API returns `503 PARTNER_API_PAUSED`; no partner checkout should reopen without route-specific evidence. |
| `api/webhook-ercas.ts` | `FUNDING_OR_WEBHOOK`, `PAUSED_OR_MANUAL_REVIEW` | Legacy Ercas webhook is gone and returns `410`; active Ercas crediting must go through server verification. |
| `api/webhook/ercas.ts` | `FUNDING_OR_WEBHOOK`, `PAUSED_OR_MANUAL_REVIEW` | Retired nested Ercas endpoint returns unconditional `410`; it creates no database client, provider request or wallet credit. |
| `api/webhook-istar.ts` | `FUNDING_OR_WEBHOOK`, `PAUSED_OR_MANUAL_REVIEW` | Prepared raw-byte bridge forwards only the signature to the reviewed project selected by public `VITE_SUPABASE_URL`. Credentials and HMAC verification stay in Supabase. Requires separate ingress/worker deployment; not part of the current migration baseline. |
| `api/webhook-pocketfi.ts` | `FUNDING_OR_WEBHOOK` | Raw-body bridge requires provider verification headers, must not inject server secrets, and returns fixed error bodies rather than reflecting upstream/database/network failures. |
| `product_relationships` browser reads | `READ_ONLY_OR_CATALOG` | Storefront reads only recommendation edge columns; admin count reads only ID/time. Admin upserts use the scoped `save_admin_product_relationships` RPC from migration `30200`; migration `31500` removes direct browser access to behavioral metadata, source, and sample size. Deployed grants remain owner verification. |
| `pending_payments` browser reads | `FUNDING_OR_WEBHOOK` | No storefront caller needs direct reads. Migration `32000` removes browser SELECT on server-created Ercas evidence, references, and historical error messages while retaining service-side verification and recovery. |
| `pages/api/webhook/ercas.ts` | `FUNDING_OR_WEBHOOK`, `PAUSED_OR_MANUAL_REVIEW` | Legacy Pages Ercas webhook is gone and returns `410`. |

## Supabase Edge Functions

| Function | Classification | Incident decision |
| --- | --- | --- |
| `admin-adjust-balance` | `ADMIN_OR_INTERNAL` | Admin/staff value changes must use the wallet engine and approving actor evidence. |
| `apply-referral` | `ADMIN_OR_INTERNAL` | JWT-authenticated profile attribution only; no direct wallet credit. |
| `auto-restock` | `VALUE_DELIVERY`, `PAUSED_OR_MANUAL_REVIEW` | Auto restock remains disabled during incident review. Raw provider payloads and errors are no longer logged or stored; ambiguous supplier outcomes still need durable resolution before enabling. |
| `bitrefill-catalog` | `READ_ONLY_OR_CATALOG` | Catalogue lookup only; provider errors are sanitized before browser response. Purchasing is in `purchase-bitrefill` and remains paused. |
| `chatbot` | `READ_ONLY_OR_CATALOG` | Support/assistant surface; no wallet authority should be granted. |
| `check-pending-payments` | `FUNDING_OR_WEBHOOK`, `ADMIN_OR_INTERNAL` | Cron/service-secret recovery only; delegates to `verify-and-credit-wallet` and must not write balances directly. |
| `create-crypto-sell-order` | `VALUE_DELIVERY`, `PAUSED_OR_MANUAL_REVIEW` | Crypto order/top-up path remains disabled/manual review only. |
| `create-pocketfi-topup` | `FUNDING_OR_WEBHOOK` | Creates/returns virtual-account setup metadata through protected profile RPCs; must not credit wallet. Database/provider errors are not returned to the customer. |
| `create-wallet-topup` | `FUNDING_OR_WEBHOOK` | Creates server-owned pending-payment evidence before checkout URL; no credit at initialization. |
| `create-withdrawal-request` | `VALUE_DELIVERY`, `PAUSED_OR_MANUAL_REVIEW` | Withdrawal route remains disabled; unknown transfer outcomes now retain the debit pending reconciliation. Provider lookup and durable idempotency are still required before enabling. |
| `customer-airtime` | `VALUE_DELIVERY`, `ADMIN_OR_INTERNAL`, `PAUSED_OR_MANUAL_REVIEW` | Authenticated customer or audience-bound individual API delegation; purchases require `CUSTOMER_AIRTIME_ENABLED=true`, owned wallet authorization and one-use invoice/payment claims. Unknown payment outcomes retain the debit for reconciliation. Pricing RPCs separately enforce the current owner; no partner credit is available to individual callers. |
| `customer-api` | `VALUE_DELIVERY`, `READ_ONLY_OR_CATALOG`, `PAUSED_OR_MANUAL_REVIEW` | Individual keys are scoped, rate limited and authorized against the current customer. `CUSTOMER_API_ENABLED` defaults closed. Delegated purchase calls bind the user, section, audience and body to the destination function; purchases charge the customer's wallet. PocketFi and unlimited partner credit are excluded. Responses and upstream calls have byte and time bounds. |
| `customer-giftcards` | `VALUE_DELIVERY`, `PAUSED_OR_MANUAL_REVIEW` | Authenticated customer or audience-bound individual API delegation; `CUSTOMER_GIFTCARDS_ENABLED` defaults closed. Server-owned quotes, wallet reservations and one-use invoice/payment claims precede payment. Delivery requires every selected unit and value to match the original invoice and contain usable redemption details; uncertain results remain held without another payment. |
| `email` | `ADMIN_OR_INTERNAL` | Email utility; should not have wallet mutation authority. |
| `get-available-cryptos` | `READ_ONLY_OR_CATALOG` | Read-only crypto catalogue/rate support; crypto funding remains paused. |
| `get-data-plans` | `READ_ONLY_OR_CATALOG` | Read-only data-plan catalogue; provider errors are sanitized before browser response. Purchasing is in `purchase-bills` and remains paused. |
| `get-my-ip` | `ADMIN_OR_INTERNAL`, `TELEMETRY_OR_UTILITY` | Admin-only Edge utility for outbound IP inspection. The function verifies the current admin role before external lookups and returns fixed errors. The browser route alone is not the security boundary. |
| `istar-webhook` | `FUNDING_OR_WEBHOOK`, `PAUSED_OR_MANUAL_REVIEW` | Prepared HMAC callback persists immutable signed bytes before ACK. Default-disabled `ISTAR_WEBHOOK_QUEUE_ENABLED`; no wallet mutation during ingress. Separate post-migration deployment only. |
| `istar-webhook-worker` | `ADMIN_OR_INTERNAL`, `FUNDING_OR_WEBHOOK`, `PAUSED_OR_MANUAL_REVIEW` | Prepared dedicated-token worker leases inbox events, verifies supplier GET receipts and atomically settles orders/refunds through the canonical wallet writer. No supplier purchase calls. Separate schedule and deployment review required. |
| `manage-staff` | `ADMIN_OR_INTERNAL` | Staff role/adjustment route; balance changes use wallet engine and protected role RPCs. The `staff_customer_search` action checks current `tab_users` permission and suspension before returning a minimal customer-only profile projection. |
| `manual-restock` | `VALUE_DELIVERY`, `PAUSED_OR_MANUAL_REVIEW` | Manual supplier restock remains disabled during incident review. |
| `muabanvia-fulfill` | `VALUE_DELIVERY`, `PAUSED_OR_MANUAL_REVIEW` | Direct live account fulfillment remains disabled. The admin-only route now bounds quantity and redacts supplier errors if explicitly enabled; it is not a customer purchase authorization path and must not be reopened for customer checkout. |
| `nowpayments-webhook` | `FUNDING_OR_WEBHOOK`, `PAUSED_OR_MANUAL_REVIEW` | Verifies raw IPN HMAC before privileged reads, then binds a fresh authenticated provider GET to the registered payment, customer, quote and currency before canonical wallet settlement. Missing, conflicting or uncertain evidence cannot credit a wallet. Crypto funding has a separate server gate; signed notification status alone is insufficient. |
| `partner-api` | `VALUE_DELIVERY`, `PAUSED_OR_MANUAL_REVIEW` | Read and local-product gates default closed and are separate from external paid section gates. Every partner action requires the current scoped key and active owner-reviewed partner; existing inactive accounts remain inactive. Owner creation, key revocation, reviewed balance and credit controls use restricted RPCs. Metadata edits and activation retain their pause. External paid adapters remain prepared pending service-specific recovery proof. |
| `partner-webhook-worker` | `ADMIN_OR_INTERNAL`, `PAUSED_OR_MANUAL_REVIEW` | Defaults closed through `PARTNER_WEBHOOK_WORKER_ENABLED`; requires a dedicated Bearer secret before reading or leasing queued events. Fixed runtime transport pins reviewed destination IPs, rejects private destinations and redirects, and signs notifications. It dispatches existing events without buying supplier value or moving wallet balances. |
| `process-purchase` | `VALUE_DELIVERY` | Local stock purchase path; wallet-engine debit must happen before credential reveal/sold marking. |
| `purchase-bills` | `VALUE_DELIVERY`, `PAUSED_OR_MANUAL_REVIEW` | Bills/airtime remains disabled by default; unknown provider outcomes now retain the debit and pending reference rather than auto-refunding. |
| `purchase-bitrefill` | `VALUE_DELIVERY`, `PAUSED_OR_MANUAL_REVIEW` | Gift card/eSIM purchase remains disabled by default. Unknown invoice/redemption outcomes retain the debit; pending idempotency replays return no redemption. Provider resolution and safe refund/retry proof are pending. |
| `record-site-visit` | `TELEMETRY_OR_UTILITY` | Visit telemetry only; no wallet authority. Anonymous callers receive a fixed failure response, not raw database or configuration errors. |
| `revenue-os-loop` | `ADMIN_OR_INTERNAL` | Service-role bearer token and POST required before maintenance; verify deployed scheduler method/credential. No wallet or fulfillment authority. |
| `revenue-os-maintenance` | `ADMIN_OR_INTERNAL` | Maintenance route; service boundary and no direct wallet mutation must be verified live. |
| `smm-check-all-orders` | `ADMIN_OR_INTERNAL`, `FUNDING_OR_WEBHOOK` | Status worker; refunds must use wallet engine and cron/service authorization. |
| `smm-check-status` | `FUNDING_OR_WEBHOOK` | Order status/refund path; no new supplier order dispatch. |
| `smm-create-order` | `VALUE_DELIVERY`, `PAUSED_OR_MANUAL_REVIEW` | New panel orders return `503 SMM_ORDERS_PAUSED` by default before auth, wallet debit, local order creation, or panel dispatch. Future reopening must keep wallet-engine debit before local order creation and provider dispatch. |
| `smm-get-services` | `READ_ONLY_OR_CATALOG` | Service catalogue lookup only; purchase dispatch is separate. |
| `smm-sync-services` | `ADMIN_OR_INTERNAL`, `READ_ONLY_OR_CATALOG` | Catalogue sync; must not deliver paid customer value. |
| `supplier-catalog-maintenance` | `ADMIN_OR_INTERNAL` | Dedicated cron secret or current unsuspended owner/admin required. Refreshes availability through restricted RPCs and configured supplier mappings; it does not buy supplier products. Only the owner can reset a fallback circuit, and unresolved supplier sends must be reconciled before reset. |
| `smsbus` | `VALUE_DELIVERY`, `FUNDING_OR_WEBHOOK`, `PAUSED_OR_MANUAL_REVIEW` | New OTP rentals return `503 SMS_OTP_PAUSED` by default before auth, wallet debit, local order creation, or Daisy allocation. Existing status/callback actions remain funding/provider-status surfaces and future reopening must keep debit plus pending local order before Daisy allocation. |
| `telegram-stars` | `VALUE_DELIVERY`, `PAUSED_OR_MANUAL_REVIEW` | New Stars/Premium orders return `503 TELEGRAM_ORDERS_PAUSED` by default before auth, wallet debit, local order creation, or iStar dispatch. Ambiguous supplier POST outcomes now retain the debit and require manual resolution; only a confirmed failed order may be refunded. Reopening still needs provider idempotency/lookup proof. |
| `update-crypto-rates` | `ADMIN_OR_INTERNAL`, `READ_ONLY_OR_CATALOG` | Rate update worker; crypto wallet funding remains paused. |
| `validate-bank-account` | `READ_ONLY_OR_CATALOG` | Bank lookup/validation only; withdrawal transfer is separate and paused. |
| `verify-and-credit-wallet` | `FUNDING_OR_WEBHOOK` | Ercas verification and credit path; requires server-created pending payment and wallet-engine posting. |
| `webhook-pocketfi` | `FUNDING_OR_WEBHOOK` | PocketFi provider webhook; must verify secret/signature, dedupe references, and hold partner payments during pause. |
| `withdraw-referral-balance` | `VALUE_DELIVERY`, `PAUSED_OR_MANUAL_REVIEW` | Referral-to-wallet conversion remains disabled during incident review. |

## Frontend Value Surfaces

These pages invoke or expose the value routes above and must stay aligned with
the route/function state:

| Page or module | Classification | Incident decision |
| --- | --- | --- |
| `src/pages/CheckoutPage.tsx` | `VALUE_DELIVERY` | Product checkout should use server-priced routes only and display credentials only after completed purchase. |
| `src/pages/ProductDetailPage.tsx` | `VALUE_DELIVERY` | Leads into product checkout; must not trust client price or quantity. |
| `src/pages/SocialBoostPage.tsx` | `VALUE_DELIVERY`, `PAUSED_OR_MANUAL_REVIEW` | SMM purchase entry; backend `smm-create-order` is default-paused and must not be bypassed. |
| `src/pages/SmsNumbersPage.tsx` | `VALUE_DELIVERY`, `PAUSED_OR_MANUAL_REVIEW` | SMS rental entry; backend new-rental creation is default-paused and must not reveal codes for non-owned/non-completed orders. |
| `src/pages/TelegramStarsPage.tsx` | `VALUE_DELIVERY`, `PAUSED_OR_MANUAL_REVIEW` | Telegram order entry; backend order creation is default-paused and any future reopening must use server-computed pricing. |
| `src/pages/BillsPayment.tsx` | `VALUE_DELIVERY`, `PAUSED_OR_MANUAL_REVIEW` | UI should show maintenance while `BILLS_ENABLED=false`. Customer history reads safe bills columns; raw SageCloud responses are server-only. The Edge order writer uses the service role and fails closed when idempotency lookup is unavailable. |
| `src/pages/GiftCardsEsims.tsx` | `VALUE_DELIVERY`, `PAUSED_OR_MANUAL_REVIEW` | UI should show maintenance/disabled state while `BITREFILL_ENABLED=false`. |
| `src/pages/CryptoExchange.tsx` | `VALUE_DELIVERY`, `PAUSED_OR_MANUAL_REVIEW` | Crypto top-up/sell paths remain paused/manual review. |
| `src/pages/CryptoWithdrawal.tsx` | `VALUE_DELIVERY`, `PAUSED_OR_MANUAL_REVIEW` | Withdrawal-style value movement remains paused/reviewed. |
| `src/pages/ReferralWithdrawal.tsx` / `src/pages/ReferralsPage.tsx` | `VALUE_DELIVERY`, `PAUSED_OR_MANUAL_REVIEW` | Referral withdrawal and referral-to-wallet movement remain disabled in both UI and backend until source-of-funds proof is complete. |
| `src/pages/OrderHistoryPage.tsx` | `VALUE_DELIVERY` | Customer history reads `orders_safe_history`; the database, not browser redaction, controls owner-only credential reveal for completed/captured (or pre-enforcement legacy completed) orders. Direct browser reads of base `orders` are revoked. |
| `src/pages/AdminPage.tsx` | `ADMIN_OR_INTERNAL` | Admin review/adjustment/fraud tools must use wallet-engine and review gates. |
| `src/pages/StaffAdminPage.tsx` | `ADMIN_OR_INTERNAL` | Staff tools must not bypass protected wallet/profile boundaries. |
| `src/pages/WalletPage.tsx` | `FUNDING_OR_WEBHOOK` | Top-up UI must initialize server-owned pending payment only; browser success cannot credit. |
| `src/pages/PaymentCallbackPage.tsx` | `FUNDING_OR_WEBHOOK` | Callback page must ask server to verify; it must not credit from browser state. |
| `src/pages/PaymentSuccessPage.tsx` | `FUNDING_OR_WEBHOOK` | Success page must be display/verification only; no direct credit authority. |

## Review Rule

Any new `api/**/*.ts`, `pages/api/**/*.ts`, `supabase/functions/*/index.ts`,
or frontend paid-value page must be added here and then reviewed against the
mutation and fulfillment maps before it can move money or reveal paid value.
