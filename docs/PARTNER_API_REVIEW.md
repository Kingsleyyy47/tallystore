# Partner API review state

`partner-api` defaults to paused. On October 5, 2026 the reviewed function and migrations were deployed to the existing source project. Its read and atomic local-product flags are enabled. Existing partner rows were made inactive by `20260919007000_pause_existing_api_partners.sql`; this work does not reactivate them.

Migration `20261005015000_partner_owner_admin_actions.sql` adds an owner review marker. Only the verified owner can create a reviewed partner, issue a key for that partner, revoke a key, choose the initial prepaid or unlimited credit mode, or later change credit mode. Provisioning, key issuance, revocation, and their audit rows are transactional. Historical partners do not receive the review marker or new keys automatically. Owner balance adjustments and credit changes use the atomic RPCs from migration `11000`. Other admin accounts can inspect records, but cannot perform these actions. Partner metadata edits and activation remain disabled.

Migration `20261005016000_partner_table_lockdown.sql` removes the older direct authenticated-admin table grants and policies. Without it, an admin could bypass the owner RPCs by writing partner, key, order, or log rows directly through PostgREST. Administrative reads now use the redacted Edge listing.

## Local products

Migration `20261005011000_partner_credit_review_gates.sql` adds owner-granted `unlimited_credit` to partner accounts, kept separate from customer profiles and wallet balances. Only the verified TallyStore owner can change this flag or adjust a partner prepaid balance. The adjustment and its audit row commit together.

Migration `20261005012000_partner_local_product_purchase.sql` adds service-role-only `purchase_api_partner_local_product`. It accepts a key ID, product UUID, quantity, expected NGN amount, idempotency key, and optional partner reference. One transaction checks the current key scope and partner section, locks the partner and product, selects available local accounts, checks the current price, charges prepaid balance or records an unlimited-credit obligation, sells exactly those accounts, saves the completed order, and refreshes stock. The obligation journal cannot be updated or deleted. Replays return the same order; a historical order lacking an obligation requires review. No supplier call occurs in this path.

`handleCreateOrder` routes `item_type: "product"` to this transaction. Partner-facing traffic requires an explicit server-side `PARTNER_API_READ_ENABLED=true` setting. Local product orders additionally require `PARTNER_LOCAL_PRODUCTS_ENABLED=true`. Both default off. The independent purchase gate blocks SMS, Social Boost, bills, gift cards, crypto, Telegram, checkout, and internal checkout confirmation. `order_status` uses stored results while that gate is active, so a read cannot trigger a provider poll or refund.

## Remaining work before broader activation

The legacy paid-service handlers use a separate partner balance read/write and external provider calls without a committed reserve-first outbox. They are blocked by the purchase gate and need transactional idempotency, debit/refund journals, and provider outcome recovery before reopening. Partner credit is not a customer wallet credit and does not authorize individual customer spending.

Deployment order was `20261005011000_partner_credit_review_gates.sql`, `20261005012000_partner_local_product_purchase.sql`, `20261005015000_partner_owner_admin_actions.sql`, then `20261005016000_partner_table_lockdown.sql`, followed by the function. Both read/local flags are enabled under the owner's existing deployment authorization; existing inactive partner accounts remain inactive. External paid routes remain blocked until their transaction and provider recovery paths are implemented and verified.
