# Supplier fallback

Local inventory is counted from available account rows. Browser-supplied stock or sellability values cannot grant supplier readiness. Supabase verifies the server-only key, mapped supplier product, enabled live mode, active product, valid price, pause state and circuit state. Only the safe availability projection reaches the customer catalogue.

When verified local stock cannot fulfil the requested quantity, `process-purchase` reserves the customer's verified spendable funds before requesting the missing quantity. A committed attempt journal claims each paid request. Exactly validated delivery is attached to that reservation and the existing completion transaction captures funds once. A repeated request resumes the same order.

Each configured supplier receives at most three attempts after explicit, structured out-of-stock rejection. An explicit insufficient-balance rejection is attempted once for that supplier, records the staff/admin warning, and allows the next configured supplier. If all configured suppliers explicitly reject, the hold and local inventory are released and fallback is blocked until owner review. Local stock can still be sold.

A timeout, malformed response, server failure, partial delivery or uncertain settlement does **not** authorize another paid attempt. The order remains pending for reconciliation; the circuit prevents further supplier purchases for that product. Already verified delivery can settle without another supplier request. No customer wallet credit is created by supplier funding or delivery.

`supplier-catalog-maintenance` performs no purchases. A minute Supabase cron authenticates using a Vault secret matching the Edge secret `SUPPLIER_CATALOG_SECRET`. Unchanged refreshes write nothing. The secret exists only in Supabase; `scripts/catalog/schedule-supplier-maintenance.sql` contains no credential value.

After resolving a known supplier issue, the owner may POST `{ "action": "reset_fallback", "product_group_id": "<UUID>" }` to this function using the owner's authenticated session. The database locks the product and rejects reset while any sent, unknown or delivered-but-unsettled supplier attempt needs reconciliation. Staff and cron callers cannot reset fallback. Explicitly paused products remain paused.

## October 5, 2026 verification

- Applied source-project migrations 02000–04000, 17000 and 18000 after live transaction dry runs. Migration 18000 restores the explicit public catalogue columns after table SELECT revocation; supplier columns remain private.
- Actual Supabase financial engine, exercised in rolled-back transactions: reserve, supplier journal attachment, one capture, idempotent completion and hold release after explicit rejection passed. No external supplier purchase was made during verification.
- Live projection: 100 active products, 14 ready supplier fallbacks, including 3 with zero local stock. Sixteen active products with zero local stock and no ready fallback are disabled. Inventory count mismatches: zero.
- Warm refresh updated 14 projections; the second refresh updated zero. Scheduled HTTP refresh returned 200 with zero failures and zero unchanged writes.
- Deployed unauthenticated protected routes rejected requests. Public catalogue returned 100 safe rows; supplier projection and journal reads were denied. Browser dispatch, partner writes and Vault reads are denied.
- Temporary key on the owner's ordinary customer account successfully read catalogue, quote, wallet and orders; a Products key was denied SMS access. Wallet truth and order count were unchanged. Key and nonce cleanup was verified.
- Focused PGlite, handler, supplier outcome, capability, routing, TypeScript and production build checks passed. The connected browser was unavailable; authenticated visual browser interaction and real paid supplier delivery were not tested.

The destination Supabase migration remains paused. External partner purchases remain gated pending their separate reserve and recovery implementation; reviewed partner local products use an isolated atomic credit journal.
