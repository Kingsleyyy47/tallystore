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
`partner-api` version 36. Actual source checks rejected anonymous receipt writes
and reconciliation reads; partner balances, orders, receipts, obligations and
events stayed unchanged. External paid sections remain disabled.

The receipt is the service's durable record of a dispatcher observation. It is
not independent proof of provider delivery. A crash before receipt persistence
can still leave an ambiguous send; settlement after an unknown timeout still
needs independent provider evidence or a separately audited owner decision.

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
