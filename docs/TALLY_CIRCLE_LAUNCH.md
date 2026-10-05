# Tally Circle launch controls

Tally Circle remains Coming soon. Migration `20261005023000_tally_circle_launch_gate.sql` stores its default-off launch state in `private.tally_circle_launch`. Browser accounts and the service role cannot read or modify that table directly. There is no storefront or staff setting that enables it. Activation requires a later reviewed database migration.

The prepared qualification rule is five distinct referred customers whose cumulative verified wallet deposits reach ₦1,000 each, then a 3% product discount. Ercas, PocketFi and NOWPayments each require their existing provider evidence. NOWPayments qualification uses the immutable quote, verified finished-payment proof, matching receipt and absence of a revocation. A claimed transaction amount alone cannot qualify a referral. Staff, administrators and suspended accounts receive no customer discount. Deposit commissions remain retired.

The checkout preview, product purchase engine and prepared customer API quote use the same launch state. While paused, status reports no active discount. A failed or eight-second timed-out browser status read permits a standard-price preview; the server recomputes the price before a wallet hold. If the service status read fails, the server permits the standard price only when its separate launch reader confirms the flag is off. An enabled or unknown launch state requires a verified price. A stale expected price never authorizes a hold.

Verification includes the actual purchase handler and API quote calculation, a browser checkout with a never-resolving optional status read, and PostgreSQL fixtures using the real NOWPayments proof helper. The source-project migration dry run exercised service and authenticated customer status reads, verified grants and an off launch state, checked unchanged hashes of customer profiles, transactions and orders, then rolled back. The identical migration was subsequently applied and recorded with its flag off.

No customer API launch, referral activation, wallet adjustment or paid provider request was part of this verification.

Historical referral withdrawals have a separate Supabase-only
`LEGACY_REFERRAL_WITHDRAWALS_ENABLED` gate, default off. Enabling crypto
withdrawals through the general flag cannot reopen referral cash-outs by itself.
Historical balances are preserved. The actual withdrawal-handler fixture proves
the absent/false legacy flag rejects requests before profile, bank, provider,
reservation or ledger work, while the explicitly enabled path still follows the
existing validation. SOURCE withdrawal function version 72 contains this gate;
live checks confirmed both withdrawal flags remain off and both request sources
return `WITHDRAWALS_PAUSED` without provider calls.

Migration `20261005032000_referral_attribution_funding_boundary.sql` adds an onboarding boundary: a customer without an existing referral link can add one only before trusted funding begins. It checks historical verified-payment and approved-admin funding, including legacy funding evidence, rather than the current balance; spending the wallet down to zero cannot reopen attribution. Existing links are preserved. Staff, administrators and suspended targets cannot add a new link.

The attribution routine serializes referral-chain changes and rejects self-referrals, indirect cycles and overlong chains, including historical UUIDs written with different casing. It locks the target profile before reading canonical wallet truth. Current funding routines lock that same profile before posting funds; future funding routines must retain this order. Local PostgreSQL fixtures cover onboarding, spent funding, existing-link replay and cycle denial. The actual source-project rollback probe denied a newly requested link for a verified-funded customer, and both application and verification checked unchanged financial rows, service-only grants and the paused Circle state. Serialized local fixtures do not prove multiple-connection concurrency.
