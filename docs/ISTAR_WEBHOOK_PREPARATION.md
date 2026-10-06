# Prepared iStar callback queue

This code is local preparation. It has not been deployed or enabled in either
Supabase project and is separate from the verified migration baseline. The
existing Telegram polling path continues to provide the current recovery path.
Do not add this migration, function pair, or schedule to a frozen copy plan.

## Callback and settlement

The provider requires a 2xx acknowledgment within ten seconds and recommends
persisting callbacks before processing them. Callbacks notify the receiver;
the supplier order lookup provides the authoritative order result.
See [iStar webhooks](https://www.fragmentapi.com/docs/webhooks) and
[order lookup](https://www.fragmentapi.com/docs/orders).

`api/webhook-istar.ts` preserves exact bytes and forwards only the signature to
the reviewed Supabase project selected by public `VITE_SUPABASE_URL`. Its body
and upstream deadlines are five and four seconds. It contains no supplier or
Supabase privileged credentials and never retries the upstream POST itself.

`istar-webhook` verifies raw-body HMAC before parsing, then saves the signed
event through a restricted RPC. It acknowledges only confirmed persistence.
Lost insert responses return 503; a provider retry is deduplicated by the exact
body hash. The ingress body and persistence deadlines are 1.5 and two seconds.
It does not perform supplier lookups or wallet changes while acknowledging.

`istar-webhook-worker` requires a dedicated token and claims one event with a
60-second lease. The SQL settlement uses two sources: the HMAC-verified signed
callback stored in the private inbox, and a fresh authenticated supplier GET by
the saved order ID. The signed callback must bind the order ID, terminal status,
order type, supplier amount, recipient hash, username and quantity or months to
the stored purchase. A failure also needs a signed refund transaction ID and
full supplier refund evidence. The GET must independently confirm the saved
order ID, terminal status, username, quantity or months, wallet currency and
supplier amount; for failures it must report a full refund. Any optional GET
recipient or refund ID must agree with the signed callback. The published GET
Order schema does not guarantee recipient hash or refund transaction ID, so
their absence from GET alone is not treated as proof against a signed event.
Missing signed identity or refund evidence stays in manual review. Conflicting
identity, status, order type, amount or refund claims in known `order` and
`payload` wrappers are rejected before settlement. Uncertain provider results
are deferred with backoff.

The SQL settlement locks the event and order and requires a completed, owned,
trusted wallet debit. A failed supplier order also requires proof that the full
supplier amount was refunded. The order result, customer refund and processed
event commit in one database transaction. A deterministic refund identity and
the canonical wallet writer prevent a second credit. No worker call creates a
new supplier purchase.

## Separate activation prerequisites

Apply `20261006030000_istar_webhook_inbox.sql` only after reviewing the current
production schema and duplicate supplier order IDs. The migration deliberately
fails on an existing conflicting table or duplicate supplier IDs; it does not
delete historical rows. The inbox is private, has no direct browser or service
table grants, and rejects history deletion, truncation or identity changes.

Keep credentials in Supabase secrets and scheduling credentials in Supabase
Vault. Required server settings are `ISTAR_API_KEY`, `ISTAR_WEBHOOK_SECRET`,
`ISTAR_WEBHOOK_WORKER_TOKEN` and the platform's Supabase service key. The webhook
secret follows the provider's 8–64 character contract; use a random 32–64
character value. The dedicated worker token must be 32–256 characters.
`ISTAR_BASE_URL`, if set, must be the reviewed production or sandbox host.

Both function configs disable gateway JWT verification: HMAC authenticates the
ingress and the dedicated Bearer token authenticates the worker. Deploy both
functions and establish a monitored worker schedule before setting
`ISTAR_WEBHOOK_QUEUE_ENABLED=true`. No schedule is installed by the migration.
The gate defaults closed. Change the provider callback destination only after
genuine signed sandbox events and the worker schedule have been verified.

## Local verification

Focused tests cover raw signature verification, persist-before-ACK ordering,
bridge byte preservation, body and response limits, deadlines and late-response
cancellation, worker authorization, no purchase resend, leases, two-source receipt binding
and atomic settlement. The canonical wallet fixture uses real wallet routines:
verified funding, a genuine Telegram debit, one refund, replay, refusal of forged
or mismatched debit proof, and rollback on final order-update failure. Genuine
provider-signed sandbox callback shapes and concurrent production-grade lease
and settlement behavior still require separate validation before activation.

PGlite tests do not prove simultaneous worker races on production PostgreSQL.
Provider sandbox delivery and deployed authorization also remain launch checks.
Local test success is not a claim that callbacks are active in production.

The current local aggregate wallet check passes all 94 assertions after its
stale expectations were reconciled with reviewed owner controls, scoped API
gates, verified crypto funding, supplier journals and safe history reads. The
route inventory check also passes: six Vercel routes, 44 Edge functions and 17
frontend surfaces are recorded, including the retired nested Ercas endpoint.
The canonical wallet fixture additionally rejects 19 independently conflicting
signed or GET receipts without changing wallet, ledger or order rows. These are
source and local database results, not a completed production launch review.
