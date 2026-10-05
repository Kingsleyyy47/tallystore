# Customer developer API

The individual API uses the account's verified TallyStore wallet. Ordinary active customers may create separate keys for Products, SMS, and Social Boost from **Profile → Developer API**. A key works only for its named section. An owner override can restrict or disable sections. Staff and admin accounts cannot create customer keys. Partner accounts and partner credit are separate.

Keys are shown once. The server stores their SHA-256 hashes and a short display prefix. Send a key in `Authorization: Bearer <key>` to the Supabase function endpoint. The request limit is 60 requests per minute per key. A revoked key stops working immediately.

Base URL: `https://<supabase-project>/functions/v1/customer-api`

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/catalogue?section=products` | Current section catalogue; sections are `products`, `sms`, or `social_boost` |
| GET | `/v1/quote?section=products&product_group_id=<uuid>&quantity=1` | Current product total after quantity, code, and Tally Circle discounts; optional `discount_code` query parameter |
| GET | `/v1/wallet?section=products` | Verified spendable NGN balance |
| GET | `/v1/orders?section=products` | Recent orders for that section |
| GET | `/v1/orders/<uuid>?section=products` | One owned order; completed, financially captured product orders include delivered account details |
| POST | `/v1/purchases` | Purchase through the existing section checkout engine |

The key's section must match the query or purchase body section. A purchase request must include a unique `idempotency_key` of at least 10 characters. Reuse the same key and exact request when retrying an uncertain network outcome. For products, use the quote's `expected_amount_ngn`; it includes the customer's current 3% Tally Circle discount when eligible. The checkout engine recomputes the price and rejects a stale `expected_amount_ngn` or `expected_price_ngn`; the client never controls the final charge.

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

SMS uses `section: "sms"`, `service_id`, `expected_price_ngn`, and `idempotency_key`. Its existing verified-wallet purchase engine is enabled. Social Boost uses `section: "social_boost"`, `service_id`, `link`, `quantity`, `expected_price_ngn`, and `idempotency_key`, plus service-specific fields when required. Social Boost purchases remain paused; its catalogue and order history are available. PocketFi and partner checkout are outside this individual API.

The API signs a short-lived capability for the matching purchase function. That function checks the signature, target, exact request body, current key grant, and single-use nonce before its existing purchase checks. A key never grants a Supabase user JWT or service-role credential to the caller.

Deployment order: migrations `20261005010000_customer_api_keys.sql`, `20261005013000_default_customer_api_sections.sql`, and `20261005014000_atomic_customer_api_key_creation.sql`; then set a 32+ character `CUSTOMER_API_DELEGATION_SECRET` in the Edge Function environment; then deploy `customer-api`, `process-purchase`, `smsbus`, and `smm-create-order`. Social Boost retains its existing purchase pause until separately reviewed.
