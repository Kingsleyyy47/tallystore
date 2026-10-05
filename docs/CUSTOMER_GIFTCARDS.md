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

## Database contract

Migration `20261005034000` creates safe customer order summaries and a private
immutable dispatch record. Quotes contain the selected product, denomination,
quantity, approved NGN total and supplier billing-price candidate. The stable
request fingerprint also includes the approved NGN total. An identical request
can retrieve its existing order before any supplier request; changing the same
key's selection or approved amount is rejected.

Purchases use the existing canonical wallet reservation, capture and release
functions. Stored wallet balance alone cannot authorize a purchase. The database
checks ordinary customer role, suspension and financial security version before
each one-use invoice creation or payment claim.

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
creates an unpaid balance invoice, then exposes a separate explicit payment
method that the future handler must fence with its database claim.
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

1. Verify the merchant account's product-price billing units and rounding against
   real read-only responses. Product denomination currency does not prove billing
   currency, and price candidates must not be assumed to be satoshis or major units.
   Only then set the Supabase-only `BITREFILL_PRICE_UNIT` to `major` for USD/NGN or
   `satoshi` for BTC. An absent or mismatched setting cannot authorize a wallet hold.
2. Implement and test the authenticated `customer-giftcards` handler with strict
   field allowlists, stable retries, owner pricing from migration 290, and exact
   invoice checks before its payment claim. Keep its purchase gate off during this.
3. Wire the customer page to server quotes and owned redemptions, preserving
   historical gift-card orders. Verify partial delivery and uncertain-payment UX.
4. Add a separately reviewed customer API scope only after the engine is ready;
   preserve partner access semantics and the customer's Coming Soon route.

The focused wallet tests execute the actual reservation and settlement routines.
The SOURCE migration runner proves the new access rules and rollback probe while
hashing existing financial rows; it accepts only the SOURCE project reference and
checks the exact migration/probe/runner hashes before applying.
