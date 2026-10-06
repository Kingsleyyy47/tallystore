# Customer developer API

Customer API access is currently **Coming soon**. The menu and direct page URL show that state, and the server launch gate blocks customer key issuance, API reads and purchases. Customers can still revoke their own existing keys. The verified owner can prepare future access. These controls are deployed; hiding the menu alone is not the access boundary.

The following describes the prepared API contract, not a currently available customer service. When launched, the individual API will use the account's verified TallyStore wallet. Ordinary active customers will be able to create separate keys for Products, SMS, Social Boost, International Airtime, Gift Cards, and Telegram. A key works only for its named section. Only the verified owner can restrict or disable a customer's sections. Staff and admin accounts cannot create customer keys. Partner accounts, partner credit, and PocketFi are separate.

Keys are shown once. The server stores their SHA-256 hashes and a short display prefix. Send a key in `Authorization: Bearer <key>` to the Supabase function endpoint. The request limit is 60 requests per minute per key. A revoked key stops working immediately.

Base URL: `https://<supabase-project>/functions/v1/customer-api`

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/catalogue?section=products` | Current catalogue for `products`, `sms`, `social_boost`, or `telegram`; airtime uses the phone lookup below |
| GET | `/v1/catalogue?section=giftcards&start=0&limit=20` | Browse gift cards; optional `q` search and ISO country such as `country=NG`; maximum 50 results per page |
| GET | `/v1/quote?section=products&product_group_id=<uuid>&quantity=1` | Current product total after quantity, code, and Tally Circle discounts; optional `discount_code` query parameter |
| GET | `/v1/quote?section=social_boost&service_id=<id>&link=<url>&quantity=<n>` | Current Social Boost total and required service fields; include the same service-specific inputs used at purchase |
| GET | `/v1/wallet?section=products` | Verified spendable NGN balance |
| GET | `/v1/orders?section=products` | Recent orders for that section |
| GET | `/v1/orders/<uuid>?section=products` | One owned order; completed, financially captured product orders include delivered account details |
| POST | `/v1/purchases` | Purchase through the existing section checkout engine |
| POST | `/v1/airtime/check-phone` | Identify available international airtime operators and denominations for a phone number |
| POST | `/v1/airtime/quote` | Obtain a fresh NGN airtime quote from the server |
| POST | `/v1/airtime/status` | Check one owned airtime order; this may reconcile verified provider delivery without making a second payment |
| POST | `/v1/giftcards/details` | Fetch one gift-card product's safe denominations by `product_id` |
| POST | `/v1/giftcards/quote` | Obtain a fresh wallet-funded gift-card quote for a product, denomination, and quantity |
| POST | `/v1/giftcards/status` | Check one owned gift-card order and reconcile only verified delivery from its existing invoice |
| POST | `/v1/telegram/recipient` | Resolve a Telegram username for the selected Stars quantity or Premium plan |
| POST | `/v1/telegram/quote` | Calculate the current NGN Stars or Premium price on the server |
| POST | `/v1/telegram/status` | Check one owned Telegram order without creating another purchase |

The key's section must match the query or purchase body section. A purchase request must include a unique `idempotency_key` of at least 10 characters. Reuse the same key and exact request when retrying an uncertain network outcome. For products, use the quote's `expected_amount_ngn`. Tally Circle is also Coming soon: its 3% discount applies only after its separate trusted launch gate is enabled and the customer qualifies. The checkout engine recomputes the price and rejects a stale `expected_amount_ngn` or `expected_price_ngn`; the client never controls the final charge.

Product example:

```json
{
  "section": "products",
  "product_group_id": "<catalogue product UUID>",
  "quantity": 1,
  "expected_amount_ngn": 2500,
  "idempotency_key": "my-order-20261005-001"
}
```

SMS uses `section: "sms"`, `service_id`, `expected_price_ngn`, and `idempotency_key`. Its existing verified-wallet purchase engine is enabled for website purchases. Social Boost uses `section: "social_boost"`, `service_id`, `link`, `quantity`, `expected_price_ngn`, and `idempotency_key`, plus service-specific fields when required. The Social Boost catalogue lists required fields for each supported service, and its quote returns `expected_price_ngn` from the same server price calculation used by purchase. Fixed packages quote quantity 1; other supported services use per-1,000 pricing and service quantity limits. Social Boost purchases remain paused. All customer API catalogue and history routes remain behind the Coming Soon gate.

Gift Cards use a `giftcards` section key and the existing customer gift-card checkout. Browse or search `/v1/catalogue?section=giftcards&start=0&limit=20`; use its `pagination.next_start` for the next page. Search text is limited to 100 characters and countries use two uppercase letters. The catalogue includes available gift cards and their denominations, with supplier costs and credentials removed. Catalogue prices remain unset until a fresh quote is requested. Send JSON such as `{ "section":"giftcards", "product_id":"<product ID>" }` to `/v1/giftcards/details`.

For `/v1/giftcards/quote`, send `product_id`, the selected `package_id` (or `null` for a variable denomination), `unit_value`, `quantity` (1–20), and a unique `quote_request_id` of 10–120 characters. `unit_value` is required even for a fixed package; use the value supplied by product details. Retry an uncertain quote with the same request ID and exact selection. The server creates one unpaid invoice for that intent and checks its payment total and every child order before returning a quote. A finalized retry returns the stored quote without another supplier request. An uncertain invoice creation is never resent for that intent.

The response includes `quote_id`, `expires_at`, and a `quote` containing `amount_ngn`. Before expiry, purchase with the same product, package, value, and quantity, the returned `quote_id`, that amount as `expected_amount_ngn`, and a separate unique purchase `idempotency_key`. The server reserves verified wallet funds against the stored quote and pays its original invoice once. Completion requires all purchased units to match and contain usable redemption details. Use `GET /v1/orders?section=giftcards` or `GET /v1/orders/<uuid>?section=giftcards` for owned history and completed redemption details; `/v1/giftcards/status` checks one owned order. Gift-card purchasing retains its separate `CUSTOMER_GIFTCARDS_ENABLED` gate. Existing explicit owner-set `allowed_sections` arrays are preserved by the section migration.

Gift-card invoice billing units must be independently verified in the Supabase-only `BITREFILL_INVOICE_PRICE_UNIT` setting: `major` for supported USD/EUR/NGN billing, or `satoshi` for verified integer BTC units. EUR conversion additionally requires the configured NGN/EUR rate. An unset or mismatched unit, missing rate, or insufficient supplier balance prevents purchase authorization. Supplier balance alerts are recorded for staff without exposing credentials.

Telegram uses a `telegram` section key. Its catalogue lists Stars quantities and active Premium plans with retail NGN prices. Quote Stars with `{ "section":"telegram", "product_type":"stars", "quantity":100 }`, or Premium with `{ "section":"telegram", "product_type":"premium", "product_id":"<plan UUID>" }`. Send the same selection plus `username` to `/v1/telegram/recipient`. To purchase, POST `/v1/purchases` with that selection, username, the quote's `price_ngn` as `expected_amount_ngn`, and a unique `idempotency_key`. The server resolves the recipient itself and uses the existing verified-wallet debit. A customer cannot submit a supplier recipient hash, wallet owner or partner credit. History and status show only the key owner's orders. Telegram purchases retain their independent `TELEGRAM_ORDERS_ENABLED` pause.

International Airtime uses an `airtime` section key. It has no generic `GET /v1/catalogue`; send the phone number in a JSON POST body, never in a query URL. `POST /v1/airtime/check-phone` accepts `{ "section": "airtime", "phone_number": "+14155550123" }`. Use its operator and product IDs with either a package ID or a denomination in `POST /v1/airtime/quote`:

The airtime checkout additionally requires the supplier price units to be verified
and stored in the Supabase-only `BITREFILL_PRICE_UNIT` setting. `major` is accepted
only for USD/NGN merchant billing; `satoshi` only for BTC. An unset, unknown or
mismatched setting returns `PRICE_UNAVAILABLE` before wallet reservation or
supplier invoice/payment. This is a server check, separate from the customer API
Coming Soon gate.

```json
{
  "section": "airtime",
  "phone_number": "+14155550123",
  "operator_id": "<provider operator ID>",
  "product_id": "<matching provider product ID>",
  "package_id": "<package ID>"
}
```

For `POST /v1/purchases`, send the same fields with `expected_amount_ngn` from the fresh quote and a unique `idempotency_key`. `GET /v1/orders?section=airtime` and `GET /v1/orders/<uuid>?section=airtime` return only owned, public order fields. `POST /v1/airtime/status` accepts `{ "section": "airtime", "order_id": "<owned order UUID>" }`. The server recomputes the quote, verifies spendable wallet funds, and uses one claimed supplier payment. An ambiguous payment remains held for review; retry with the same idempotency key. Airtime purchasing also has its own server launch flag.

The API signs a short-lived capability for the matching purchase function. That function checks the signature, target, exact request body, current key grant, and single-use nonce before its existing purchase checks. A key never grants a Supabase user JWT or service-role credential to the caller. Internal checkout calls have a deadline covering both headers and streamed response data, reject redirects, and are sent once. An uncertain purchase returns `purchase_outcome_unknown` (503); retry the same idempotency key and exact request or check the owned order, rather than submitting a new purchase key.

JSON request bodies are limited to 16 KB and must finish within five seconds. Invalid JSON returns `invalid_request` (400), an oversized body returns `request_too_large` (413), and a stalled body returns `request_timeout` (408). These checks happen before key authorization or supplier calls. The Coming Soon gate takes precedence while access is paused.

Deployment order: apply the existing customer key, atomic key creation, Airtime and Gift Card wallet migrations first. Then apply `20261006010000_customer_api_giftcards_section.sql`, `20261006011000_customer_api_telegram_section.sql`, `20261006012000_telegram_customer_api_request_binding.sql`, and `20261006020000_customer_giftcard_invoice_quotes.sql`. These migrations check their database baselines and preserve existing explicit access restrictions. The invoice quote migration requires empty customer gift-card order and dispatch tables; existing orders require a separate reviewed migration. Set a 32+ character `CUSTOMER_API_DELEGATION_SECRET` in Supabase's Edge Function secrets, then deploy the reviewed `customer-api`, `customer-airtime`, `customer-giftcards`, `telegram-stars`, `process-purchase`, `smsbus`, and `smm-create-order` functions together with their shared modules. The customer API remains Coming Soon behind `CUSTOMER_API_ENABLED=false` until its complete service review. Social Boost, Gift Cards, Airtime and Telegram retain their separate purchase pauses.
