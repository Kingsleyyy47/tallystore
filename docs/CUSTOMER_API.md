# Customer developer API

Customer API access is currently **Coming soon**. The menu and direct page URL show that state, and the server launch gate blocks customer key issuance, API reads and purchases. Customers can still revoke their own existing keys. The verified owner can prepare future access. These controls are deployed; hiding the menu alone is not the access boundary.

The following describes the prepared API contract, not a currently available customer service. When launched, the individual API will use the account's verified TallyStore wallet. Ordinary active customers will be able to create separate keys for Products, SMS, Social Boost, and International Airtime. A key works only for its named section. Only the verified owner can restrict or disable a customer's sections. Staff and admin accounts cannot create customer keys. Partner accounts, partner credit, and PocketFi are separate.

Keys are shown once. The server stores their SHA-256 hashes and a short display prefix. Send a key in `Authorization: Bearer <key>` to the Supabase function endpoint. The request limit is 60 requests per minute per key. A revoked key stops working immediately.

Base URL: `https://<supabase-project>/functions/v1/customer-api`

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/catalogue?section=products` | Current catalogue for `products`, `sms`, or `social_boost`; airtime uses the phone lookup below |
| GET | `/v1/quote?section=products&product_group_id=<uuid>&quantity=1` | Current product total after quantity, code, and Tally Circle discounts; optional `discount_code` query parameter |
| GET | `/v1/wallet?section=products` | Verified spendable NGN balance |
| GET | `/v1/orders?section=products` | Recent orders for that section |
| GET | `/v1/orders/<uuid>?section=products` | One owned order; completed, financially captured product orders include delivered account details |
| POST | `/v1/purchases` | Purchase through the existing section checkout engine |
| POST | `/v1/airtime/check-phone` | Identify available international airtime operators and denominations for a phone number |
| POST | `/v1/airtime/quote` | Obtain a fresh NGN airtime quote from the server |
| POST | `/v1/airtime/status` | Check one owned airtime order; this may reconcile verified provider delivery without making a second payment |

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

SMS uses `section: "sms"`, `service_id`, `expected_price_ngn`, and `idempotency_key`. Its existing verified-wallet purchase engine is enabled for website purchases. Social Boost uses `section: "social_boost"`, `service_id`, `link`, `quantity`, `expected_price_ngn`, and `idempotency_key`, plus service-specific fields when required. Social Boost purchases remain paused. All customer API catalogue and history routes remain behind the Coming Soon gate.

International Airtime uses an `airtime` section key. It has no generic `GET /v1/catalogue`; send the phone number in a JSON POST body, never in a query URL. `POST /v1/airtime/check-phone` accepts `{ "section": "airtime", "phone_number": "+14155550123" }`. Use its operator and product IDs with either a package ID or a denomination in `POST /v1/airtime/quote`:

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

The API signs a short-lived capability for the matching purchase function. That function checks the signature, target, exact request body, current key grant, and single-use nonce before its existing purchase checks. A key never grants a Supabase user JWT or service-role credential to the caller.

JSON request bodies are limited to 16 KB and must finish within five seconds. Invalid JSON returns `invalid_request` (400), an oversized body returns `request_too_large` (413), and a stalled body returns `request_timeout` (408). These checks happen before key authorization or supplier calls. The Coming Soon gate takes precedence while access is paused.

Deployment order: migrations `20261005010000_customer_api_keys.sql`, `20261005013000_default_customer_api_sections.sql`, `20261005014000_atomic_customer_api_key_creation.sql`, and `20261005033000_customer_api_airtime_section.sql`; then set a 32+ character `CUSTOMER_API_DELEGATION_SECRET` in the Edge Function environment; then deploy `customer-api`, `customer-airtime`, `process-purchase`, `smsbus`, and `smm-create-order`. The customer API remains Coming Soon behind `CUSTOMER_API_ENABLED=false` until its complete service review. Social Boost retains its separate purchase pause.
