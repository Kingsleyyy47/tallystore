# Customer gift-card purchase engine

This is preparation for a separate wallet-funded customer checkout. The legacy
`purchase-bitrefill` paid route remains paused. No customer gift-card API scope or
new customer checkout has been activated by this work.

Migration `20261005034000` was applied to SOURCE
`dssvvswvqnxanyzfhixf` on 5 October 2026 after its exact rollback probe passed
both locally and on SOURCE. Post-apply verification matched the recorded SQL,
passed all 79 privilege checks and confirmed existing financial rows were
unchanged. The destination project was not modified.

Migration `20261005035000` was then applied and verified on SOURCE with 16 access
checks. It adds `customer-giftcards` to the existing service-only supplier warning
sources. Existing warnings, warning routines, grants and financial rows were
preserved. This allows a confirmed supplier balance shortfall to reach the existing
staff warning flow when the new checkout is enabled.

The additional `20261006020000_customer_giftcard_invoice_quotes.sql` migration is
prepared and tested locally, not applied to either live project. It replaces the
price-candidate flow below with a quote backed by one verified unpaid invoice.
It checks the exact existing function bodies, security attributes, owners,
privileges, constraints, triggers and table shapes before changing authorization.
It requires empty customer gift-card order and dispatch tables; existing orders
need a separately reviewed migration.

## Database contract

Migration `20261005034000` creates safe customer order summaries and a private
immutable dispatch record. The new invoice quote revision stores the selected
product, denomination, quantity, verified invoice payment total and currency,
complete child-order ID set, approved NGN total, owner and expiry. The stable
request fingerprint also includes the approved NGN total. An identical request
can retrieve its existing order before any supplier request; changing the same
key's selection or approved amount is rejected.

Purchases use the existing canonical wallet reservation, capture and release
functions. Stored wallet balance alone cannot authorize a purchase. The database
checks ordinary customer role, suspension and financial security version before
each one-use quote consumption or payment claim. Quote creation is durably
claimed before its unpaid provider POST. The same quote intent never recreates
an invoice, including after a lost acknowledgement. New quote intents are rate
limited and an unresolved creation blocks another intent for ten minutes.

Completion requires a bound invoice and exactly the purchased number of distinct
redemptions matching the product, denomination, package and currency. Each unit
must contain a usable code or a HTTPS link without URL credentials. Capture,
delivery evidence and the order's completed status commit together. Uncertain
or partial delivery retains the hold and cannot claim another payment or obtain
an automatic refund. A proven rejection before payment may release the hold.

Redemptions are absent from public tables. The customer's own retrieval functions
return them only when the immutable proof, captured reservation and exact purchase
transaction agree. Authenticated browsers cannot call the purchase/claim/settlement
functions, mutate orders, or read the private dispatch table.

## Provider contract

The new shared provider client uses the fixed Bitrefill API origin, bounded
requests and response reads, no redirects and no automatic POST retries. It
creates one unpaid balance invoice for a quote intent. The authenticated handler
fences invoice creation and payment with separate one-use database claims.
Purchase consumes the stored quote and pays that original invoice; it does not
create a replacement invoice after reserving wallet funds. Every fixed package
quote requires its explicit `unit_value` from product details. The public quote
returns `quote_id`, `expires_at` and retail prices; supplier costs and invoice IDs
remain private. Purchase binds the quote ID and exact selection to its separate
idempotency key.
The Personal API uses the fixed `https://api.bitrefill.com/v2` origin and a Bearer
key stored only in Supabase, as documented in the
[Bitrefill Personal API quickstart](https://docs.bitrefill.com/docs/quickstart-2).

Unpaid invoices may list only child IDs; the handler must fetch every corresponding
child detail and verify its product and value before payment. Optional echoed
package/currency fields must agree when present. The total invoice price and
billing currency must match the frozen quote exactly. Completed invoices are
reconciled using the existing all-unit delivery checker, not the first card.
This follows Bitrefill's documented [manual invoice payment flow](https://docs.bitrefill.com/docs/integration-flow)
and [per-unit order model](https://docs.bitrefill.com/docs/core-concepts).

## Gates remaining before customer use

The current SOURCE `BITREFILL_API_KEY` was rejected with HTTP 401 on a read-only
merchant balance request. A working replacement in Supabase secrets is needed
before checking merchant currency and supplier price units. The owner deferred
this key replacement and asked to be reminded only when they ask; no scheduled
reminder or supplier payment was created.

1. Verify actual invoice payment and merchant-balance units. Product denomination
   currency and catalogue price candidates do not prove invoice billing units.
   Only then set the Supabase-only `BITREFILL_INVOICE_PRICE_UNIT` to `major` for
   supported USD/EUR/NGN billing or `satoshi` for verified integer BTC units.
   EUR billing also requires the configured NGN/EUR rate. This new setting is
   separate from the existing airtime `BITREFILL_PRICE_UNIT` setting. An absent
   or mismatched setting cannot authorize a wallet hold. Exchange-rate fallback
   reads have full header/body deadlines, strict response-size limits and fresh
   timestamp checks; malformed or stale rates cannot finalize a quote.
2. Keep the `CUSTOMER_GIFTCARDS_ENABLED` purchase gate off until the supplier
   credentials and price units have been verified. The prepared authenticated
   handler has strict field allowlists, stable retries, owner pricing from
   migration 290, and exact invoice checks before its payment claim.
3. Wire the customer page to server quotes and owned redemptions, preserving
   historical gift-card orders. Verify partial delivery and uncertain-payment UX.
4. The Gift Cards customer API scope and quote/order routes are prepared locally
   with section-bound delegation. Apply their reviewed migrations and deploy the
   matching engine together; preserve explicit customer restrictions, partner
   access semantics and the customer's Coming Soon route. See
   [the prepared customer API contract](CUSTOMER_API.md).

The focused wallet tests execute the actual reservation and settlement routines.
The SOURCE migration runner proves the new access rules and rollback probe while
hashing existing financial rows; it accepts only the SOURCE project reference and
checks the exact migration/probe/runner hashes before applying.

## Handler verification

`scripts/customer-giftcards-engine-test.mjs` bundles and exercises the actual
handler with synthetic Supabase and supplier adapters. It verifies customer JWT
ownership, staff/admin exclusions, paused purchases, missing price units,
insufficient trusted funds, canonical request replay, conflicting retries,
unpaid invoice identity and value checks, one invoice creation and payment,
uncertain or partial delivery retaining its hold, captured-only redemptions,
owned read-only reconciliation, sanitized errors and bounded request bodies.
No real supplier invoice or payment is created by these tests.

The handler was deployed to SOURCE with purchases still gated off. The deployed
smoke test verifies its bundle markers, eight service-only RPC grant boundaries,
eight denied Data API reads and five denied handler requests. Gift-card order and
dispatch counts remain unchanged. The live legacy history routine was also
checked: it filters by `auth.uid()`, returns redemption details only for successful
orders, and browser roles cannot read redemption columns directly.

The normal customer Coming Soon page now includes the ten most recent stored
legacy gift-card orders. Its browser fixture checks error/Retry, timeout, account
switch and sign-out cleanup, exact clipboard/TXT values and HTTPS-only clickable
links without embedded credentials. Older multi-unit records are identified as
potentially incomplete rather than being presented as complete delivery evidence.

Lost settlement replies are reconciled against the owned database outcome:
captured completion with all validated codes remains complete, and a committed
unpaid rejection remains rejected. Confirmed supplier balance warnings are
attempted before rejection; warning failure cannot prevent releasing unpaid funds.

Pricing uses exact decimal arithmetic before rounding each unit up to the next
NGN 10 and multiplying by quantity. Tests cover USD and NGN major units and
explicit BTC satoshis, including an exact decimal rounding boundary. This does
not establish the units used by the current merchant account; that read-only
provider verification remains required before launch.
