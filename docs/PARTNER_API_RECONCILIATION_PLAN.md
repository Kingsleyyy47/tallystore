# Partner external order reconciliation

The owner-only `admin_reconciliation_cases` action lists at most 50 `sending` or
`unknown` journal cases per page. `admin_reconciliation_probe` accepts one order
UUID and makes a status request only when the same provider ID and source are
already recorded on both the journal and its order. Both actions return a small
summary and never capture, release, refund, or retry a purchase. A missing ID,
timeout, provider error, or lone missing-record response is inconclusive.
These read actions are preparation for recovery; external paid sections remain
disabled. A dormant or revoked partner may still have an earlier obligation
that the owner needs to inspect.

## Durable dispatch receipt

Migration `20261005024000_partner_external_dispatch_receipts.sql` adds a private,
append-only receipt bound to the claimed journal order, partner, key, request
fingerprint, amount, funding snapshot, and normalized outcome. The partner
external runner saves it before calling the existing financial outcome RPC.
Only the service role can call the receipt writer; the private table is not
available to browser or partner roles. Accepted provider identity and public
fields are restricted by section. A receipt write failure keeps the prepaid
reservation held and returns an unknown outcome without another provider send.
On October 5, the migration was applied and recorded on the existing source
project after a live rollback test. The runner and read actions are deployed in
`partner-api` version 37. Actual source checks rejected anonymous receipt writes
and reconciliation reads; partner balances, orders, receipts, obligations and
events stayed unchanged. External paid sections remain disabled.

The receipt is the service's durable record of a dispatcher observation. It is
not independent proof of provider delivery. A crash before receipt persistence
can still leave an ambiguous send; settlement after an unknown timeout still
needs independent provider evidence or a separately audited owner decision.

## Receipt-backed recovery

Migration `20261005025000_partner_receipt_reconciliation.sql` adds a
service-only review RPC that returns only order ID, accepted or rejected receipt
outcome, and proof hash for still-sending cases with consistent journal,
partner, key, amount, funding, reserve, and order bindings. The caller must
verify the owner's JWT before using the service role. The settlement RPC
checks that the supplied owner UUID is the active account owner and the hash
matches the immutable receipt. It passes only stored receipt fields to the
existing finalizer and writes an immutable owner decision in the same database
transaction. Accepted receipts capture once; definitively rejected receipts
release a prepaid hold once. A later legitimate provider status update does
not invalidate an exact replay of the financial decision. Unknown receipts,
missing receipts, and conflicting evidence stay held. On October 5 the migration
was applied to the source project after rollback probes verified prepaid and
unlimited outcomes, exact replays, private grants, and financial rollback on an
audit failure. The owner-only POST action `admin_reconcile_dispatch_receipt` is
deployed in `partner-api` version 37. Anonymous Edge and RPC checks were denied;
partner balances, orders, receipts, decisions, obligations and events were
unchanged. These checks did not send a provider purchase.

The owner panel offers recovery only for a sending journal with a processing
order and a valid accepted or rejected receipt hash. Review is a separate first
step showing the original amount and funding effect; only explicit confirmation
calls the financial action. Duplicate clicks are blocked. An ambiguous timeout
or response requires a fresh read and never automatically repeats the action.
An exact replay confirms the existing audited decision without moving money
again. The database rechecks all bindings independently of the browser.

## Next financial step

Add immutable independent provider evidence and owner decision records bound to
the original order, partner, request fingerprint, provider identity, amount,
and funding snapshot. A crash before receipt persistence still requires
independent provider lookup or documented manual evidence.

Implement a separate service-role-only reconciliation RPC for stale `sending`
and `unknown` journals. It must use the same partner → journal → order lock
order as the applied dispatch migration. It must check one reserve event, no
prior capture or release, exact order/partner/amount/funding consistency, and
the proposed evidence and owner actor. Confirmed acceptance inserts one
obligation and one capture without another prepaid debit. Confirmed non-delivery
or provider refund inserts one release and returns the original prepaid amount
once. Unlimited credit never changes partner balance; no path touches a
customer wallet. All decisions, including manual owner attestations, require
an immutable audit record. If delivery remains uncertain, keep the hold; any
goodwill credit should be a separately labeled compensation.

Provider correlation remains a launch prerequisite. For Bitrefill, create an
unpaid invoice, persist its ID, and only then pay the identified invoice.
For Daisy and Social Boost, a lost response can lose the provider ID; obtain
independent vendor evidence. SageCloud data currently lacks a deterministic
reference, and iStar has no documented read by idempotency key in this adapter.
Do not turn a second paid call into a status probe.
