# Durable partner order notifications

The immediate purchase handler and scheduled worker use the same database claim.
They cannot independently authorize two POSTs for the same partner/order/event.
This is notification work only: the worker never creates a supplier order,
repeats a payment, changes a wallet, captures an obligation, or issues a refund.

## Event and authorization boundary

Migration `20261005030000` records an immutable start time. Only orders created
after that boundary can enqueue callbacks; there is no historical backfill.
Database triggers observe order, journal, obligation and financial-event changes.
A completed event requires a matching captured obligation and original funding
evidence. A refunded event requires a full, matching prepaid release and no
capture. Unlimited credit does not manufacture a wallet-refund event.

The event binds the original key, partner, order identity, amount and proof.
Local product purchase records gain only the original API-key ID in the private
request object; their inventory and financial implementation is preserved.
Immediately before claiming, the database locks key, partner, order and event,
then checks revocation, `orders:read`, current section access, active owner review,
callback configuration and the same financial proof. Browser roles cannot read
or execute these private operations. Service clients cannot mutate audit tables
directly; only the narrowed database RPCs can claim and finish.

## Delivery and failure behavior

A committed claim creates the deterministic delivery ID before HTTP. The sender
uses the existing signed, minimal order summary and public-IPv4 pinned TLS
transport. Credentials, provider responses and callback response bodies are
excluded. Redirects and private DNS targets are refused.

Queued work can be picked up by either path. Claimed, delivered, rejected and
uncertain outcomes never automatically authorize another POST. A lost claim or
finish response may leave a claimed record for investigation. HTTP errors are
also treated as uncertain because the recipient may already have processed the
event. Partners should reconcile through their scoped order-status endpoint;
this implementation does not promise an automatic callback retry.

## Private scheduler

`partner-webhook-worker` accepts only its dedicated bearer secret, stored in
Supabase Edge secrets and Vault. It rejects browser/partner tokens, unexpected
fields, oversized or stalled streams, and limits each request to 20 events with
a bounded run time. Its HTTP response contains counts only.

Migration `20261005031000` schedules the worker every minute. The cron command
contains a Vault reference, not the bearer. Supabase manages pg_net grants;
the project database role cannot revoke them. The source runner instead verifies
that net/vault/private are excluded from the Data API, browser net requests fail,
and browser database roles cannot log in. This is the documented
[hosted boundary](https://supabase.com/docs/guides/database/extensions/pg_net#permissions).
A private request-ID/time table allows
an actual scheduled HTTP result to be correlated without copying headers,
secrets or response bodies.

## Verification

- PGlite and live source rollback probes: funding proof, original-key binding,
  fresh permissions, replay denial, private grants, immutable states and no
  financial/audit side effects after rollback.
- The competing-claim PGlite test uses one serialized engine; it is not evidence
  of a multi-connection PostgreSQL race. PostgreSQL claims use row locks plus a
  deterministic unique primary key.
- Actual entry-point/shared-module fixtures: valid IDs, immediate/worker claim
  sharing, one send, authorization, streamed limits, deadlines, unknown outcomes
  and redacted responses. Pinned transport and signature tests are retained.
- Edge compilation, focused lint, deployed unauthorized requests, private RPC
  denial, and an authorized empty-queue run. No real partner callback or paid
  supplier purchase is used as a test.

Source migrations 300/310 are recorded and their exact text verified. Source
`partner-api` version 43 and worker version 3 are active. The private scheduler
request ID was joined to a pg_net HTTP 200 result after a successful cron run;
this confirms scheduled execution, not just the presence of a job record.

Customer API and Tally Circle remain Coming Soon. This change does not activate
partners, external paid routes, or the paused destination-project migration.
