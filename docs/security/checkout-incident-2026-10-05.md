# Checkout incident: 4–5 October 2026

## Confirmed cause

SOURCE PostgreSQL logs show checkout authorization inserting `processing` while
`orders_status_check` rejected that status. Both local-stock and supplier-stock
authorization were affected. This is a checkout/database rollout compatibility
failure. The logs do not establish which deployment applied the correction.

The reported 21:00–22:00 Nigeria window is 20:00–21:00 UTC on 4 October.
The bounded log query found its first matching failure at 19:54:55 UTC on
4 October and last at 00:20:13 UTC on 5 October. Log records are not unique
customer or purchase counts.

Fresh read-only checks show the validated status rule now allows exactly
`processing`, `completed`, `failed`, `refunded`, and `cancelled`, matching the
installed purchase functions. In the reported hour no orders, order wallet
reservations, order-tagged debits, or sold inventory persisted. Authorization
creates the reservation, reserves inventory, and inserts the order in one
database transaction; a status constraint exception rolls that transaction back.

## Separate reference collision

At 11:27:25 UTC on 5 October a completion failed on
`transactions_reference_key`. Truncating a client request key to its first 24
characters discarded its unique suffix. Repeat purchases by the same customer
for the same product could share a reference.

Completion now uses `PUR-${orderId}`: unique per order and stable on retries.
Full request idempotency keys, customer ownership checks, and reserve/capture
validation remain in place. Existing completed transactions are not renamed.
One identified failed completion retained its original reservation and reserved
local account; recovery must use that exact order and reservation. Never reuse
the older transaction, release an ambiguous supplier order, or start a new paid
supplier request as a recovery shortcut.

## Verification and deployment gate

- `scripts/process-purchase-reference-test.mjs` executes the actual handler and
  owned completion proof: two formerly colliding keys, completed replay,
  changed request rejection, foreign ownership rejection, and old-code
  sensitivity. No provider requests.
- `scripts/catalog/supplier-process-handler-test.mjs` covers supplier recovery,
  release/capture proof, and completed replay without another paid send.
- Recovery, customer status, and SQL wallet integration checks cover reserve,
  capture, release, and trusted-funding boundaries.
- A live read-only schema and ACL check must pass before deployment. Compare
  the downloaded current function and its dependencies; deploy only the
  reviewed reference change with JWT verification retained.

Production deployment and any recovery are recorded separately in private
evidence. This document does not assert that a customer purchase was made as a
test or that all possible checkout failures are resolved.

## Verified repair and separate non-2xx failures

The reviewed reference change was deployed to SOURCE `process-purchase` v77
on 5 October at 19:34:23 UTC. A fresh downloaded bundle matched all six reviewed
modules. JWT verification remains enabled; an unauthenticated status request
returned 401. One previously held local-stock order was completed from its
original reservation, with a fresh read confirming exactly one purchase debit
and one delivered unit. No new paid supplier request was used for verification.

The screenshot titled `Order Failed` matches Social Boost's `smm-create-order`
client. SOURCE function HTTP logs show 503 responses on that route in the
reported evening. Its absent `SMM_ORDERS_ENABLED` flag causes
`SMM_ORDERS_PAUSED` before authentication or spending. Separate withdrawal and
bills 503 responses match their disabled launch flags. These failures are
separate from the product order status constraint and reference collision.
The logs do not reliably identify an authenticated customer for pre-auth pause
responses, so these records cannot be assigned to the supplied customer emails.

Social Boost previously treated the SDK error response body as a parsed object;
it is a stream. The customer UI now decodes a cloned response with byte/time
bounds, allows known public explanations and hides database/provider internals.
An uncertain purchase directs the customer to order history before retrying.
This UI change does not reopen a paused route or automatically repeat a purchase.
