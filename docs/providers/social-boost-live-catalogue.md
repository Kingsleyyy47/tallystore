# Live social boosting catalogue

Implemented 22 November 2026 for the customer storefront, customer API and partner
API. Provider requests run in Supabase Edge Functions.

## What customers see

An enabled database service is an owner-approved supplier ID. The backend joins
that approval with the supplier's current catalogue. Names, categories, prices,
quantity limits and refill/cancellation flags come from the live result. Prices
keep TallyStore's existing two-times supplier-cost markup and current NGN/USD
rate. Existing enabled choices are preserved.

Supplier catalogues are cached for 30 seconds per running function instance.
Concurrent browsing requests share the same upstream read. The approval list is
read again on each request, so disabling a service does not wait for the supplier
cache. This cache does not periodically refresh a customer's screen.

Removed IDs disappear when the supplier cache refreshes. A replacement ID with
the same name does not inherit approval. Admin Sync imports new IDs as disabled;
the owner must enable them in Social Boost Service Visibility. Sync still updates
metadata without overwriting existing enabled/disabled choices.

## Ordering and fallback

Before a new order can debit a wallet, the backend bypasses the browsing cache
and any older browsing request in flight. It checks the original supplier ID,
latest price, supported order type and current quantity limits. A changed price
requires the customer to refresh and confirm the current quote.

Only previously matched equivalent fallback routes are considered. Their live
name, category, service type, refill and cancellation terms must still match.
Removing the primary supplier ID hides the original product; it is not replaced
silently. Accepted orders continue polling their original supplier.

Wallet authorization, idempotency, dispatch claims and uncertain-outcome handling
remain in place. A catalogue read cannot allocate stock or debit a wallet.

## Implementation

- `smm-catalog`: authenticated, read-only storefront catalogue; public fields only.
- `_shared/smm-live-catalog.ts`: owner approvals, live metadata, pricing and fresh
  purchase quotes; supplier catalogues are indexed once per request.
- `_shared/smm-provider-router.ts`: 30-second upstream cache, exact routing,
  replacement-ID isolation and per-supplier funding checks.
- `20261122000000_smm_live_enabled_catalog.sql`: future imports default disabled;
  preserves current choices. `20261122001000_compact_smm_allowlist.sql` adds a
  compact private joined approval-list RPC, read once per catalogue request.
- `smm-create-order`, customer and partner API paths share these checks.

## Validation

`npm run providers:check` includes eight live-catalogue scenarios, the actual
allowlist migration executed in PGlite, existing SMM dispatch races, and the
other provider regression suites. The tests cover cached reads, fresh purchase
reads, in-flight isolation, supplier removal, replacement IDs, owner toggles,
public-field projection, failure handling and bulk reads beyond 1,000 services.
The actual order handler also rejects changed prices, reduced limits and removed
services before its first debit or paid supplier call.

Live acceptance uses the service-only `provider-integrations` action
`smoke_readonly` with `boost_catalogue: true`. It reads current supplier services,
projects enabled products, and checks one fresh quote without making a purchase
or changing customer financial data.
