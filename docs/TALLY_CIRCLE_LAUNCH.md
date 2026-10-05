# Tally Circle launch controls

Tally Circle remains Coming soon. Migration `20261005023000_tally_circle_launch_gate.sql` stores its default-off launch state in `private.tally_circle_launch`. Browser accounts and the service role cannot read or modify that table directly. There is no storefront or staff setting that enables it. Activation requires a later reviewed database migration.

The prepared qualification rule is five distinct referred customers whose cumulative verified wallet deposits reach ₦1,000 each, then a 3% product discount. Ercas, PocketFi and NOWPayments each require their existing provider evidence. NOWPayments qualification uses the immutable quote, verified finished-payment proof, matching receipt and absence of a revocation. A claimed transaction amount alone cannot qualify a referral. Staff, administrators and suspended accounts receive no customer discount. Deposit commissions remain retired.

The checkout preview, product purchase engine and prepared customer API quote use the same launch state. While paused, status reports no active discount. A failed or eight-second timed-out browser status read permits a standard-price preview; the server recomputes the price before a wallet hold. If the service status read fails, the server permits the standard price only when its separate launch reader confirms the flag is off. An enabled or unknown launch state requires a verified price. A stale expected price never authorizes a hold.

Verification includes the actual purchase handler and API quote calculation, a browser checkout with a never-resolving optional status read, and PostgreSQL fixtures using the real NOWPayments proof helper. The source-project migration dry run exercised service and authenticated customer status reads, verified grants and an off launch state, checked unchanged hashes of customer profiles, transactions and orders, then rolled back. The identical migration was subsequently applied and recorded with its flag off.

No customer API launch, referral activation, wallet adjustment or paid provider request was part of this verification.
