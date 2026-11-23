# Provider operations

Provider HTTP calls run in Supabase Edge Functions. Admin and staff dashboards call
`provider-operations` directly; Vercel serves the frontend and receives no supplier
credentials. Only active admin/staff profiles can read supplier balances. All
active staff can switch the seven SMS suppliers on/off for new purchases. The
server binds each change to the authenticated staff user and writes an audit row.
Only admins can manually import catalogues.

## Balances

Balances retain their native currencies and decimal strings. A confirmed zero is
different from an unavailable response. Reads coalesce and cache for 60 seconds
per warm function instance. Dashboard refresh is manual, with no polling timer.

Adapters cover GetAText, both DaisySMS domains, DaisySim, HeroSMS, TextVerify,
SMSBus, Lord of Panels, BulkFollows, Bitrefill, FragmentAPI, Kora, NOWPayments,
PocketFi and Sagecloud. HeroSMS is explicitly configured in USD. PocketFi uses its
API bearer token (called Public API Key), rather than its webhook signing secret.
Providers without a verified balance endpoint display an explicit unavailable
integration status; their balances are never inferred from customer payments.

Official references: [DaisySim](https://daisysim.com/doc),
[PocketFi balance](https://developer.pocketfi.ng/docs/api/account-balance),
[NOWPayments balance](https://nowpayments.zendesk.com/hc/en-us/articles/21345824322717-API-and-endpoint-description).

## SMS routing

Routing uses the matched product and country, preserving quality modifiers.
Each product/provider pair accumulates seven days of observed results. A weighted
score uses delivery reliability (75%), observed speed (20%) and availability
(5%), with a small price penalty. Reliability starts with a 4/5 prior; products
without observations prefer the cheapest eligible offer. The dashboard displays
only measured rates, with “Collecting data” when no outcome exists.

Undelivered allocations mature after 20 minutes. Cancellations within two minutes
are excluded from failures. Observed delivery time includes the status polling
delay. No-stock responses temporarily demote a route for 60 seconds; uncertain
responses demote it for five minutes for subsequent orders. Quality can recover
as recent outcomes improve and old events leave the window.

Purchases read provider switches and product metrics freshly, then filter by the
customer's cost ceiling and supplier stock. A proven no-charge decline can try
the next exact match. Accepted or uncertain paid requests remain pinned to their
supplier; routing never creates a second paid allocation to replace them. Status,
cancellation and refund reconciliation continue after a supplier is disabled.
Best-effort telemetry cannot invalidate a confirmed paid result.

## Catalogue refresh

`provider-catalog-sync` refreshes configured boosting catalogues and the US SMS
catalogue at `17 */6 * * *` UTC. SMS countries remain fetched on demand. A private
10-minute lease prevents overlapping scheduled/manual imports. Supabase Cron
uses pg_net, with its authentication token read from Vault at execution time.
The same token is held in the `PROVIDER_CATALOG_SYNC_SECRET` Edge secret. It is
never embedded in the checked-in cron SQL or browser bundle.

Boosting sync batches 1,000 services/routes per atomic RPC, skips unchanged data,
preserves all owner enable/disable choices, and imports new IDs disabled. The
customer boosting catalogue still intersects the current supplier feed with
enabled services, caches provider feeds for 30 seconds, and rechecks the current
service/price/limits before accepting an order.

## Production verification, 22 November 2026

- All 16 provider test suites passed, including actual handler authorization,
  routing, SQL controls, lease concurrency and atomic sync batches.
- Live Edge calls returned balances for ten configured providers, including
  TextVerify and PocketFi. NOWPayments denied balance access; Sagecloud did not
  return a verified balance. Other adapters lacking keys were not authenticated.
- TextVerify balance authentication succeeds, but its tn101 catalogue returns
  HTTP 200 with `success:false` and “Something went wrong,please contact support”.
  That supplier is excluded from catalogue offers until it returns valid data.
- Both boosting providers synced 15,726 products; a repeat processed the same
  catalogue with zero service/route writes. All 9,918 owner-enabled rows stayed
  enabled. The SMS catalogue contained 931 products, with 468 multiple-offer
  products at the time of verification.
- Scheduled function authentication and anonymous denial were tested live.
  No paid supplier purchase or customer financial write was used for testing.

The owner confirmed the store's DaisySim account is its existing SMSBus connection.
Dashboards display this as **DaisySim / SMSBus**, with one balance, switch and
delivery history under the existing `smsbus` ID. No additional DaisySim key is
required. The old direct DaisySim adapter stays hidden unless explicitly configured
with a separate legacy credential; SMSBus credentials are never sent to that API.

Remaining account prerequisites include keys for DaisySMS.com, Kora and
PVACodes. PVACodes still requires private endpoint documentation. Missing keys,
provider refusals and unsupported balance endpoints are visible in the dashboard.
