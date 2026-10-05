# Partner API review state

`partner-api` defaults to paused. On October 5, 2026 the reviewed function and migrations were deployed to the existing source project. Its read and atomic local-product flags are enabled. Existing partner rows were made inactive by `20260919007000_pause_existing_api_partners.sql`; this work does not reactivate them.

Migration `20261005015000_partner_owner_admin_actions.sql` adds an owner review marker. Only the verified owner can create a reviewed partner, issue a key for that partner, revoke a key, choose the initial prepaid or unlimited credit mode, or later change credit mode. Provisioning, key issuance, revocation, and their audit rows are transactional. Historical partners do not receive the review marker or new keys automatically. Owner balance adjustments and credit changes use the atomic RPCs from migration `11000`. All partner administration, including inspecting records, requires the verified owner. Partner metadata edits and activation remain disabled.

Migration `20261005016000_partner_table_lockdown.sql` removes the older direct authenticated-admin table grants and policies. Without it, an admin could bypass the owner RPCs by writing partner, key, order, or log rows directly through PostgREST. Administrative reads now use the redacted Edge listing.

## Local products

Migration `20261005011000_partner_credit_review_gates.sql` adds owner-granted `unlimited_credit` to partner accounts, kept separate from customer profiles and wallet balances. Only the verified TallyStore owner can change this flag or adjust a partner prepaid balance. The adjustment and its audit row commit together.

Migration `20261005012000_partner_local_product_purchase.sql` adds service-role-only `purchase_api_partner_local_product`. It accepts a key ID, product UUID, quantity, expected NGN amount, idempotency key, and optional partner reference. One transaction checks the current key scope and partner section, locks the partner and product, selects available local accounts, checks the current price, charges prepaid balance or records an unlimited-credit obligation, sells exactly those accounts, saves the completed order, and refreshes stock. The obligation journal cannot be updated or deleted. Replays return the same order; a historical order lacking an obligation requires review. No supplier call occurs in this path.

`handleCreateOrder` routes `item_type: "product"` to this transaction. Partner-facing traffic requires an explicit server-side `PARTNER_API_READ_ENABLED=true` setting. Local product orders additionally require `PARTNER_LOCAL_PRODUCTS_ENABLED=true`. Both default off. The independent purchase gate blocks SMS, Social Boost, bills, gift cards, crypto, Telegram, checkout, and internal checkout confirmation. `order_status` uses stored results while that gate is active, so a read cannot trigger a provider poll or refund.

## Remaining work before broader activation

The legacy paid-service handlers use a separate partner balance read/write and external provider calls without a committed reserve-first outbox. They are blocked by the purchase gate and need transactional idempotency, debit/refund journals, and provider outcome recovery before reopening. Partner credit is not a customer wallet credit and does not authorize individual customer spending.

Migration `20261005020000_partner_external_purchase_journal.sql` prepares an isolated financial boundary for future SMS, Social Boost, bills, gift cards, and Telegram partner orders. `reserve_api_partner_external_order` locks the partner, checks a current reviewed partner and scoped key, compares the caller's authoritative price to the partner's expected price, and creates one idempotent order plus a prepaid balance hold or unlimited credit reservation. `claim_api_partner_external_dispatch` grants exactly one paid send after rechecking the current key, partner, sections, and credit mode. `record_api_partner_external_outcome` accepts a compatible provider ID/status and captures one immutable obligation, releases a prepaid hold only on a fixed definitive rejection, or marks an unknown outcome without releasing funds. Separate immutable reserve, capture, and release events record the financial transitions. Historical orders without a journal cannot be replayed into a new hold.

Migration `20000` is applied and recorded in the source project. The provider adapters now calculate a server price and canonical request fingerprint before reserving funds, use the claim result as their only permission to make a paid call, and keep an ambiguous response held for review. This does not enable external purchase sections.

## Deployed read and status controls

On October 5, migrations `20261005021000_partner_external_reads_and_rate_limits.sql` and `20261005021100_partner_dispatch_lock_order.sql` were applied and recorded, followed by `partner-api` version 33. Live transaction-only verification used synthetic partners and unusable key hashes; every fixture and test schema change was rolled back before the final migration was applied.

Read admission locks the key for its minute counter and checks current revocation, scope, partner activation and owner review. Paid operations recheck authorization under their mutation locks. A status poll can finish only an accepted, captured order owned by that partner, with the matching provider identity. It cannot change balances or issue a refund. Cancellation releases a prepared reservation once; a claimed send or unknown provider outcome cannot be cancelled this way.

Gift card completion requires every purchased unit: distinct matching provider order IDs and a usable redemption for each card. Responses include `redemptions`, an array of `{ order_id, code?, pin?, link?, instructions?, expiration_date? }`. Quantity-one orders also retain the `redemption` object for compatibility. Missing or ambiguous delivery evidence leaves the order awaiting review.

Product catalog responses retain the quantity-one `price_ngn` and add `quote_quantity`, `total_price_ngn` and `pricing`. Clients can request a current total with `action: "catalogue", section: "products", quote_quantity: <1..500>`, then submit `total_price_ngn` as the purchase's `expected_amount_ngn`. Pricing rounds the complete order upward once, matching the atomic purchase RPC. Multiplying the rounded quantity-one price is not the price formula. Catalog availability reflects the local stock that this purchase path can deliver; supplier fallback is a separate remaining integration.

All partner administration, including listing partners, requires the verified owner. Catalog failures return a fixed `SERVICE_UNAVAILABLE` code rather than provider error text. The deployed smoke test rejected missing/fake keys, invalid and oversized bodies, and paused paid routes without changing orders, obligations or financial events.

## Remaining activation work

External SMS, Social Boost, bills, gift cards and Telegram adapters are deployed behind `PARTNER_EXTERNAL_SECTIONS_ENABLED`, which remains empty. Customer API access remains “Coming soon.” Existing partners remain inactive. No real paid provider request was used to verify this deployment.

The follow-up audit found that hiding the customer API page did not close its key-creation endpoint. `customer-api` version 7 now defaults to a server-side launch gate, with `CUSTOMER_API_ENABLED=false` stored only in Supabase secrets. Key issuance, API reads and delegated purchases return `coming_soon` before creating a database client. Authenticated users can still revoke their own existing keys; the verified owner can prepare future access. Live checks confirmed that the browser cannot execute the key-creation, authorization or capability-consumption database RPCs directly. Future self-service API availability is still part of the requested work, once its complete service and recovery paths are ready.

Before broader activation: finish an owner-reviewed reconciliation path for unknown sends and save failures; replace the paused legacy PocketFi checkout/confirmation and crypto partner paths with verified journaled operations; connect product supplier fallback to the same financial boundary; and complete customer service adapters with ordinary wallet limits and no partner credit privileges. These remain part of the full requested API work.

Migration `20261005024000_partner_external_dispatch_receipts.sql` is now applied
and recorded in the source project. `partner-api` version 36 saves a private,
immutable, section-restricted dispatch receipt before financial settlement.
Failed receipt or outcome writes retain the hold and never authorize another
provider send. Owner-only reconciliation reads list uncertain orders and poll
only matching persisted provider IDs; these observations cannot settle, refund
or change a balance. A live rollback probe verified claimed-order bindings,
replay, browser denial and unchanged financial rows before deployment. The
receipt records the dispatcher observation; it does not resolve a crash before
that observation was saved. See `PARTNER_API_RECONCILIATION_PLAN.md` for the
remaining financial recovery and independent evidence requirements.

Migration `20261005025000_partner_receipt_reconciliation.sql` and `partner-api`
version 37 added audited owner confirmation for a definitive saved receipt.
Migration `20261005026000_partner_bitrefill_invoice_binding.sql` and version 38
now preserve an unpaid Bitrefill invoice ID before payment, prohibit another
payment on a binding replay, and expose owner-only status reads after a lost
response. Live rollback tests verified private grants, exact receipt and order
bindings, wallet isolation and compatibility with receipt recovery. External
sections remain disabled until unknown-send recovery and independent provider
evidence settlement are complete; no real supplier purchase was used to verify
these changes.

## Outgoing webhook delivery

Commit `dc6c16b` deployed the reviewed webhook path in source `partner-api` version 35. It rechecks the current key's `orders:read` scope, active owner-reviewed partner, owned order, and matching captured obligation or prepaid release before delivery. A deterministic primary-key claim allows only one sender for a partner/order/event. Notifications contain a signed order summary; provider responses, purchased credentials and HTTP response bodies are excluded.

The transport resolves IPv4 candidates and connects to a checked public literal address, then verifies the original hostname with TLS on that same socket. It does not follow redirects, retry an ambiguous send, or connect to private addresses. A temporary service-role-only Edge probe verified DNS, literal-address TCP, hostname TLS and a fixed public HEAD request; the probe was deleted and its absence checked. No real partner webhook was sent during verification. Callback hosts need a public IPv4 address; an IPv6-only host is not supported by this transport.

The function sends completed/refunded events only from the reviewed purchase engines. Read-only status polling emits no later completion event. A separate event worker and outcome reconciliation remain necessary before promising asynchronous completion notifications for every external service.

Deployment order was `20261005011000_partner_credit_review_gates.sql`, `20261005012000_partner_local_product_purchase.sql`, `20261005015000_partner_owner_admin_actions.sql`, then `20261005016000_partner_table_lockdown.sql`, followed by the function. Both read/local flags are enabled under the owner's existing deployment authorization; existing inactive partner accounts remain inactive. External paid routes remain blocked until their transaction and provider recovery paths are implemented and verified.
