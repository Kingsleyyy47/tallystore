# Provider integration and fallback

Provider release: 19 November 2026. Provider API requests run in Supabase Edge
Functions; Vercel serves the frontend. Deployment evidence and acceptance limits
are recorded in `release-validation.md`. Purchase pause flags are preserved.
Credentials belong in Supabase Edge Function secrets. `.env.example` lists the
names; never prefix supplier credentials with `VITE_`.

## Coverage

| Provider | Connected storefront functionality | Configuration / limits |
| --- | --- | --- |
| GetAText | USA OTP catalogue, allocation, completion, polling, cancellation, matching and fallback | `GETATEXT_API_KEY`; `Auth` header; current `/api/v1` endpoints |
| DaisySMS .com | USA OTP catalogue and complete activation lifecycle | `DAISYSMS_COM_API_KEY`; a separate account from .io |
| DaisySMS .io | USA OTP catalogue and complete activation lifecycle; legacy activation recovery retained | `DAISYSMS_IO_API_KEY`; legacy `DAISYSMS_API_KEY` remains supported |
| DaisySim direct API (legacy, optional) | Country/service discovery, paged quote import, exact live price/route purchase, polling, explicit refund cancellation | `DAISYSIM_API_KEY` only for a separately configured direct API account; hidden when absent. The store's DaisySim account uses the existing SMSBus connection below. |
| HeroSMS | Country/service/pricing discovery, `getNumberV2`, status and cancellation through its handler API | `HEROSMS_API_KEY` or legacy `SMSACTIVATE_API_KEY`; only a confirmed USD API account is enabled with `HEROSMS_CURRENCY=USD` |
| TextVerify | USA temporary numbers on documented `tn101` endpoints, service-key discovery, allocation, polling and rejection | `TEXTVERIFY_API_KEY`; entries without a usable service key are excluded |
| DaisySim / SMSBus OTP | Country/project discovery, fresh prices, allocation, polling and cancellation | Existing `SMSBUS_API_KEY`; one account, switch and delivery history; fixed documented OTP origin |
| DaisySim / SMSBus rentals | Areas, monthly pricing, purchase, renewal, latest/history SMS, cancellation and linked refund | Same `SMSBUS_API_KEY`, `SMS_RENTALS_ENABLED=true`; separate documented rental origin; supplier prices are cents |
| PVACodes | Configuration slot and explicit blocked status | Private endpoint documentation is still required. No guessed API requests are sent. |
| Lord of Panels | Catalogue sync, orders, status and matched fallback with BulkFollows | `LORDOFPANELS_API_KEY` or legacy `SMM_PANEL_API_KEY`; USD panel account |
| BulkFollows | Catalogue sync, orders, status and matched fallback with Lord of Panels | `BULKFOLLOWS_API_KEY`; USD panel account |
| Bitrefill | Existing Personal API gift-card, eSIM and airtime invoice/order flows retained | `BITREFILL_API_KEY`; this is the existing bearer-token Personal API, not a newly implemented Business API |
| PocketFi | Existing durable virtual-account creation and verified deposit flow retained | `POCKETFI_PUBLIC_KEY` or `POCKETFI_API_TOKEN`, `POCKETFI_BUSINESS_ID`, webhook secret |
| Kora | Customer checkout, saved checkout evidence, charge verification, signed webhook and one wallet credit | `KORAPAY_SECRET_KEY`, `KORAPAY_ENABLED=true`, `TALLYSTORE_SITE_ORIGIN` |
| NOWPayments | Existing crypto quote, payment, signed callback and verified wallet settlement retained | `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET`; existing feature gates still apply |
| FragmentAPI | Existing Stars/Premium recipient, order and polling flow updated to current `.app` production endpoint | `FRAGMENTAPI_API_KEY`; legacy `ISTAR_API_KEY` and explicitly configured old hosts remain supported |

This does **not** claim every ancillary API feature is implemented. TextVerify's
`tn102` and `rv202` products, DaisySMS long-term rentals and GetAText's separate
long-term rental products are not wired into the storefront in this change.
They need separate product/term contracts and should not be substituted for the
SMSBus all-service monthly rental. No provider can be marked live-tested before
authenticated catalogue and lifecycle checks with its own account credentials.

## Matching and fallback rules

SMS service names use normalized case, spacing and punctuation, plus a small
explicit alias list (for example Twitter/X and WhatsApp). Google Voice remains
distinct from Google. Numeric service and country IDs are always supplier-local.
US service codes remain stable; other countries have a separate catalogue key.
Unknown shortcodes and numeric IDs are isolated by provider. DaisySMS descriptive
brand slugs resolve only against exact verified catalogue names or the explicit
service-name list; numeric IDs are never treated as shared product identity.

Boosting requires the full normalized name, category, order type, refill and
cancellation capability to agree. Duplicate names within a panel are ambiguous
and receive no automatic cross-panel match. Quantity limits and fresh pricing
are checked before each paid request. Supplier routes and costs stay in tables
unavailable to browser roles. Existing catalogue visibility choices survive sync.

Boosting now uses a [live catalogue joined to owner-enabled supplier IDs](social-boost-live-catalogue.md).
Supplier reads cache for 30 seconds; purchases bypass that cache before debit.
New imports default to disabled, and replacement supplier IDs require approval.

Out-of-stock, price-cap and balance declines can advance to another verified
matching offer. Timeout, malformed reply, transport failure or an uncertain
paid request stops dispatch and retains the order for reconciliation. Polling
always returns to the supplier/account that accepted the original order.
The SMM dispatch claim still fences the entire order. Partner checkout adapters
use the same routing with opaque, private-journal references.

There is no automatic substitution of gift-card regions/denominations, OTPs
with monthly rentals, a permanent bank account with a card checkout, or one
payment asset/network with another. Bitrefill has no second equivalent gift-card
supplier in the supplied list; Kora is an additional payment choice.

DaisySim `Cancelled` with `refunded:false` triggers the explicit documented
`POST /cancel/{activation_id}` and requires refund acknowledgement. SMSBus
rental cancellation is only offered in the documented 20-minute window with no
received SMS. Cancellation and renewal claims exclude one another.

APIs without a purchase price-ceiling field (including SMM and SMSBus) are
requoted immediately before sending. An upstream price change between that
read and the paid request cannot be atomically prevented by those APIs.

## Deployment and activation

1. Check the deployed schema before applying migrations. Apply these new
   migrations in order, after the existing canonical wallet and dispatch migrations:
   - `20261119000000_supplier_product_routing.sql`
   - `20261119001000_korapay_verified_wallet_credit.sql`
   - `20261119002000_sms_rental_dispatch.sql`
   Kora and rental migrations verify the existing financial function contracts
   and abort if those definitions differ; do not bypass that precondition.
2. Deploy the functions listed in `release-validation.md` together. New
   functions are `provider-integrations`, `korapay-wallet`, `korapay-webhook`.
   Only `korapay-webhook` disables the Supabase JWT gate; it verifies the Kora
   HMAC of `payload.data`, then verifies the charge using the merchant API key.
3. Add the provider's server secrets, without replacing unrelated existing
   credentials. Both Daisy domains need their own keys. Configure Kora's
   webhook to `/functions/v1/korapay-webhook`. Its redirect uses the trusted
   `TALLYSTORE_SITE_ORIGIN`, never an arbitrary caller URL.
4. In Admin → Settings → Provider Integrations, check key configuration,
   inspect SMS matches and sync boosting providers. Sync DaisySim one country
   page per minute until its cursor completes. Review unmatched product names.
5. Run authenticated, low-value provider acceptance tests before enabling the
   corresponding ordering flag. Existing `SMS_OTP_ENABLED`, `SMM_ORDERS_ENABLED`,
   `TELEGRAM_ORDERS_ENABLED`, `BITREFILL_ENABLED` and crypto pause flags remain
   unchanged. New Kora and rental flags default to disabled.

Kora checkouts are created locally before contacting Kora. A unique user request
key and one transition to `sending` prevent duplicate initialization. Signed
webhooks only initiate merchant API verification. The database binds the verified
amount/currency/reference to the original customer and credits through the
existing wallet engine, with immutable proof and replay protection.

## Call efficiency

SMS browsing loads health, countries, OTP products and rental areas in one Edge
Function invocation instead of four. Browsing no longer upserts product settings;
that work happens on an admin sync. Per-isolate read caches share concurrent work:
provider catalogue 60 seconds, countries/service metadata 5 minutes, priced SMS
browsing 20 seconds, supplier status 3 seconds, and purchase ranking 1–2 minutes.
Caches are bounded and failures are not cached. Cold isolates still make reads.

SMM status checks group up to 100 order IDs per supplier and keep overlapping
supplier IDs separate. Provider transports use local concurrency limits instead
of two extra database admission RPCs per upstream call. Financial authorization,
wallet writes, purchase claims, fresh supplier quotes and refunds still use the
database. Purchases bypass the browsing price cache and are never retried merely
because a supplier timed out. Hashed frontend assets get one-year immutable
browser caching; HTML revalidates and API responses remain uncached.

## Local validation

`npm run providers:check` runs actual adapter fixtures, routing/error boundaries,
Kora wallet SQL, rental dispatch/refund SQL, SMM concurrency, allocation evidence, bounded status polling, partner adapters and bounded
Fragment transport.
All provider responses are synthetic; these checks make no paid calls.

Also run `npx tsc --noEmit -p tsconfig.app.json`, the changed Edge Function Deno
checks, `npm run build`, and secret scanning. Local success is not evidence of deployment
or authenticated provider acceptance.

## Documentation sources

- [GetAText](https://getatext.com/api-docs)
- [DaisySMS .com](https://daisysms.com/docs/api), [DaisySMS .io](https://daisysms.io/docs/api)
- [DaisySim](https://daisysim.com/doc)
- [HeroSMS](https://hero-sms.com/api)
- [TextVerify Swagger specification](https://panel.textverify.io/docs?api-docs.json), saved in `reference/textverify.openapi.json`
- [SMSBus OTP](https://sms-bus.com/docs/), [rental](https://sms-bus.com/docs/rent)
- [PVACodes public overview](https://pvacodes.com/api) (no public endpoint reference)
- [Lord of Panels](https://thelordofthepanels.com/api), [BulkFollows](https://bulkfollows.com/api)
- [Bitrefill](https://docs.bitrefill.com/reference/get_products)
- [PocketFi](https://developer.pocketfi.ng/)
- [Kora checkout](https://developers.korapay.com/docs/checkout-redirect), [webhooks](https://developers.korapay.com/docs/webhooks)
- [NOWPayments](https://documenter.getpostman.com/view/7907941/2s93JusNJt)
- [FragmentAPI OpenAPI](https://www.fragmentapi.app/openapi.json), saved in `reference/fragmentapi.openapi.json`
