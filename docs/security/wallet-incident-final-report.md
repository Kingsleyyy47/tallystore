# Wallet Security Incident Final Report

> Policy update (28 September 2026): The owner directed removal of broad
> automatic fraud holds after legitimate customers were blocked. Migration
> `20260928002000` stops the automatic hold writer and releases system-generated
> reviews. Pre-cutoff customers with recorded funding can spend their stored
> wallet balance, less holds; new customers and customers with no recorded
> funding remain limited by confirmed funds. Manual account suspensions remain.
> This is a deliberate legacy risk exception, not proof that every historical
> balance increase was verified. See `2026-09-28-legacy-purchase-policy.md`.
> It is repository-only until the owner applies and verifies the migration and
> deploys matching Edge/Vercel builds.

> Policy update (24 September 2026): This report predates the canonical
> financial-truth changes. Its full-freeze-on-excess statements are superseded
> by `financial-truth-contract.md`. Repository code now denies spend beyond
> confirmed backing while surfacing excess for investigation. Production
> deployment and database behavior remain unverified.

Prepared: 2026-09-19

This report is repository-scoped. It does not claim production safety until the
owner deploys the matching migrations/functions/app and verifies live database
grants, provider settings, active workers, and affected-account evidence.

## Verification Labels

- `SOURCE_REVIEWED`: repository source or migration was inspected.
- `PATCH_IMPLEMENTED`: repository change exists.
- `STATIC_CHECK_PASSED`: covered by `npm run security:wallet`.
- `LOCAL_BUILD_OR_TYPECHECK_PASSED`: local build/type/lint evidence exists.
- `LOCAL_DB_SECURITY_TESTS_PENDING`: staging/local Supabase execution required.
- `PROVIDER_TEST_PENDING`: provider sandbox/dashboard or route-specific runtime
  proof still required; local no-network provider mocks may be recorded
  separately where they passed.
- `PRODUCTION_DEPLOYMENT_PENDING`: owner has not proven it live.
- `PRODUCTION_VERIFICATION_PENDING_OWNER`: owner-only live evidence needed.
- `HISTORICAL_CAUSE_UNPROVEN`: repository review cannot identify the past actor
  or exact exploit path without live logs/provider records.

## Executive Finding

The incident class is unsupported value reaching paid fulfillment. The current
repository patch reduces immediate loss by closing partner API access, pausing
unsafe paid surfaces, requiring wallet-engine debit/refund paths for mapped
routes, hardening payment verification, blocking direct ledger/profile balance
mutation, and documenting production verification requirements.

The exact historical cause remains unproven from repository evidence alone.
Possible paths include prior direct balance writes, forged or replayed payment
callbacks, privileged/admin adjustments, legacy RPCs, incomplete provider
verification, old deployed code, or missing production grants. Live logs and
provider evidence are still required.

## Prompt Coverage Notes

The repository artifacts intentionally preserve the prompt's three-part model:
funding provenance, accounting consistency, and delivery authorization.
Trusted principal can increase only through a verified gateway deposit or an
approved admin credit. Refund conservation means refunds restore a prior
trusted debit and do not create principal; new refund rows must link to the
original trusted-principal-authorized debit by transaction ID, purchase
idempotency key, protected source-order metadata, or original purchase
reference, and that original debit must carry positive
`trusted_principal_debit_amount` evidence written by the wallet engine. A
deposit row with only an
`external_payment_id` is not enough: Ercas deposits require matching
server-created pending-payment evidence, PocketFi deposits require matching
webhook-log evidence, and `metadata.verified_amount_ngn` must match the posted
credit amount. Idempotency, provider verification,
direct ledger writes, protected profile fields, fulfillment pause behavior,
`wallet_security_events`, and production permissions are tracked separately so
local repository checks cannot be mistaken for owner-side production proof.
Routes must remain paused until the owner completes the staging, provider, and
production verification checklist for the specific route being reopened.

## Vulnerable Or Suspicious Paths

| Path | Source finding | Risk class | Repository status |
| --- | --- | --- | --- |
| Public partner API | Partner checkout surface could sell through trusted partner keys while wallet review was active. | Deliver before fully verified authorization. | `PATCH_IMPLEMENTED`: public route returns `PARTNER_API_PAUSED`; Edge Function hard-paused; existing partners inactive by migration. |
| PocketFi bridge | Public Vercel bridge previously reserialized parsed bodies and could inject server secrets into webhook requests. It also forwarded raw upstream errors and network exception text to any caller supplying a verification-looking header. | Broken signature verification boundary / public secret-assisted calls / error disclosure. | `PATCH_IMPLEMENTED`, `LOCAL_MOCK_PASSED`: raw-body proxy, verification header required, no secret injection, fixed public error bodies with upstream status preserved. Owner must deploy the Vercel route and verify the live response. |
| iStar unsigned event fallback | The Vercel webhook verified an HMAC over the body but accepted `X-iStar-Event` as a fallback event type. That header is not covered by the documented body signature; a validly signed body without `event_type` could therefore be paired with a caller-chosen order transition. This is a source finding, not historical attack attribution. | Potential false failed-order state and refund if a usable signed body lacking an event type were replayed with a changed header. | `PATCH_IMPLEMENTED`, `LOCAL_HANDLER_TEST_PASSED`: the handler now requires a supported event type in signed JSON and rejects malformed or reconstructed bodies before database access. iStar's [webhook documentation](https://istar.fragmentapi.com/docs) includes `event_type` in the signed body. Owner must deploy and test a genuine signed callback and refund idempotency in provider staging; Telegram fulfillment stays paused meanwhile. |
| Telegram terminal-status/refund race | The Vercel webhook and customer poll updated `telegram_orders` by ID after a separate read; the poll refunded before recording failure, and admin cancellation could refund an order still in flight. A success callback could therefore race with a stale failure/cancel path. This is a source finding, not proof of a historical loss. | Refund after supplier delivery or overwritten terminal status. | `PATCH_IMPLEMENTED`, `LOCAL_HANDLER_MOCK_PASSED`, `EDGE_TYPECHECK_PASSED`: the webhook uses conditional nonterminal transitions before a refund, late order-tracking writes are conditional, polling holds supplier failure for review, and admin cancellation is paused. The no-network handler test makes a stale failed callback produce zero refund RPCs and a valid signed failure refund once. The status update and wallet posting remain separate commits; real-Postgres concurrency, old-worker shutdown, provider sandbox, and deployed-version checks remain owner-pending. |
| PocketFi replay amount | The Edge webhook rounded an existing credited amount and a repeated provider amount to kobo before accepting the replay. A slightly different over-precise amount could be marked processed, and the log's verified amount overwritten with the older ledger amount. This is a repository finding, not evidence of historical abuse. | False payment-evidence match and misleading replay audit. | `PATCH_IMPLEMENTED`, `LOCAL_PROVIDER_DECISION_PASSED`, `EDGE_TYPECHECK_PASSED`: validate the raw provider amount at exact NGN precision and compare exact minor units with the existing credit. Malformed amounts go to review; mismatched valid amounts return `POCKETFI_REFERENCE_CONFLICT`. Owner must deploy and sandbox-test the active webhook. |
| PocketFi webhook response disclosure | The authenticated webhook returned full partner checkout results, wallet user IDs, balances, and payment references on success/replay, and raw database/provider exception text on some failures. The public Vercel bridge forwards successful Edge responses. | Unnecessary private financial and internal-error disclosure to callers holding or obtaining the webhook secret. | `PATCH_IMPLEMENTED`, `LOCAL_SOURCE_GUARD_PASSED`, `EDGE_TYPECHECK_PASSED`: Edge replies now use fixed acknowledgments/errors without partner payloads or wallet details. Provider sandbox and deployed Vercel/Edge response checks remain owner-pending; rotate any historically exposed webhook credential. |
| PocketFi evidence-write failure | The webhook ignored errors when inserting the payment-evidence log or linking it to the wallet, then reached the wallet-credit call with a missing or incomplete evidence ID. The database writer is designed to reject such credits after its migrations, but the Edge route did not independently stop. | False success/failure handling, untrusted credit on an older writer, or legitimate funds later classified as unbacked. This is a source finding, not evidence of a historical incident. | `PATCH_IMPLEMENTED`, `LOCAL_SOURCE_GUARD_PASSED`, `EDGE_TYPECHECK_PASSED`: both evidence writes must succeed before credit; failures return a generic `503` so the provider can retry. Owner must fault-test the deployed/sandbox webhook, reconcile any prior missing-log credits, and confirm the provider's retry and permanent-virtual-account verification contract. The public [PocketFi checkout confirmation documentation](https://developer.pocketfi.ng/docs/api/verify-payment) covers hosted checkout payment IDs and is not assumed to verify permanent-account bank transfers. |
| Fraud Review missing email | The admin financial-truth page used only `profiles.email`; an Auth account with a blank/stale profile email appeared as “Unknown email” and could not be found by its current email in the Fraud Review search. | Missed identity correlation during investigation, not a financial-credit bypass. | `PATCH_IMPLEMENTED`, `ISOLATED_POSTGRES_FIXTURE_PASSED`: migration `20260925002000` adds the current Auth email to the admin-gated page result without browser access to `auth.users`. The fixture checks admin lookup and customer denial. Owner must run query 42 and test the deployed role boundary. |
| Fraud Review hold count | The admin page counted every wallet-review flag as a hold even when the canonical reader explicitly permitted backed spending. | Misleading blocked-customer totals and unnecessary manual unblocking work; it did not alter purchase authorization. | `PATCH_IMPLEMENTED`, `LOCAL_UI_MODEL_PASSED`: Holds and the headline blocked count now use canonical `spending_blocked`; review flags have a separate tab and explanation. TypeScript, lint, and frontend build passed. Deployed UI and actual customer counts remain owner-pending. |
| PocketFi payment evidence grants | The older service-role hardening revoked row reads/writes from browser roles but omitted `TRUNCATE`, which RLS does not restrict. A broad inherited table grant could erase trusted-payment evidence. | Payment-evidence destruction and false wallet holds. | `PATCH_IMPLEMENTED`, `ISOLATED_POSTGRES_FIXTURE_PASSED`: migration `20260924018000` removes all browser table privileges and preserves service-role read/write. Owner must run query 25 against deployed grants. |
| Financial-history table grants | Several older migrations revoked browser row writes but not `PUBLIC` inheritance or `TRUNCATE`; ledger row-write triggers and RLS do not protect table truncation. | Erasure of funding, order, or debit evidence, causing false wallet decisions and lost forensics. | `PATCH_IMPLEMENTED`, `ISOLATED_POSTGRES_FIXTURE_PASSED`: migration `20260924019000` removes effective browser mutation/truncation privileges while retaining reads and service writes. Owner must run query 26 and verify actual deployed grants. |
| Pending-payment evidence reads | The original own-row SELECT policy exposed `pending_payments` references and `error_message` to browser clients; older stored provider errors may contain internal text. No current storefront caller needs direct reads. | Payment-reference and historical provider-error disclosure. | `PATCH_IMPLEMENTED`, `ISOLATED_POSTGRES_FIXTURE_PASSED`: migration `20260924032000` removes table and inherited column SELECT for browser roles while preserving service-side verification. Owner must run query 39 and check checkout/recovery after deployment. |
| Discount-code enumeration | The existing active-code policy let an ordinary user list every store-wide promotion code, and checkout preview read entire rows. | Unintended promotion-code disclosure and discount abuse; not a wallet-funding bypass. | `PATCH_IMPLEMENTED`, `ISOLATED_POSTGRES_FIXTURE_PASSED`: migration `20260925014000` adds caller-bound preview and managed-list RPCs; the matching browser uses them; migration `20260925015000` removes ordinary table reads and requires current admin status for direct management. Deploy browser between migrations, then run query 53 and staging role/checkout checks. Code guessing still needs monitoring and suitably strong codes. |
| Limited-use discount race | Checkout checked `max_uses` before authorization and separately read/overwrote `used_count` after delivery, ignoring errors. Concurrent checkouts could each accept a one-use code or lose an increment. | Undercharged product delivery, not new wallet principal. | `PATCH_IMPLEMENTED`, `ISOLATED_POSTGRES_FIXTURE_PASSED`: migration `20260925016000` locks the code and counts committed/pending uses during order insert, then increments once on completion. The matching Edge build requires a service-only readiness RPC and removes the post-delivery write. Owner must deploy Edge first, drain old requests, apply migration, run query 54, and prove multi-connection concurrency in staging before claiming this race closed in production. |
| Legacy Ercas Vercel webhooks | Older public routes existed beside the server-verified credit function. | Fake or stale callback credit path. | `PATCH_IMPLEMENTED`: legacy routes return `410`. |
| Ercas top-up pause setting | The server initiated Ercas checkout unless `ercas_enabled` was explicitly `false`; a missing setting or failed settings read still allowed initiation while the browser required `true`. | Bypass of the operator's top-up pause, not direct wallet credit. | `PATCH_IMPLEMENTED`, `LOCAL_SOURCE_GUARD_PASSED`, `EDGE_TYPECHECK_PASSED`: server now requires an explicit `true` before calling Ercas. Owner must deploy the Edge Function and verify the live setting and response. |
| Ercas checkout redirect and error disclosure | Checkout initiation allowed the caller's `Origin` to establish an allowed redirect origin, forwarded extra caller metadata to the provider, and returned provider error text on failed initiation. | Payment redirect and provider/internal-error disclosure; not proof of fraudulent wallet credit. | `PATCH_IMPLEMENTED`, `LOCAL_HELPER_TEST_PASSED`, `EDGE_TYPECHECK_PASSED`: checkout uses a server-controlled HTTPS site origin and server-owned metadata, and returns fixed provider failures. The staff toggle now reflects explicit enablement. Owner must set a separate `TALLYSTORE_SITE_ORIGIN` for staging, deploy the Edge/web builds, and test real provider redirects. |
| Purchase price tolerance and raw database errors | Local product and Bitrefill checkout accepted a displayed price up to ₦1 from the server charge; local-order idempotency treated the same difference as the same request. `process-purchase` also returned unexpected database error messages to customers. | Weakened request-content binding and internal-error disclosure; the server still calculated the actual charge, so this alone is not proof of a free purchase. | `PATCH_IMPLEMENTED`, `LOCAL_SOURCE_GUARD_PASSED`, `EDGE_TYPECHECK_PASSED`: both routes require exact kobo price agreement, local-order retries bind the exact amount, and unexpected local-purchase failures have a fixed customer response. Owner must deploy both Edge Functions and exercise price-change/retry cases in staging. |
| SMS provider and database error disclosure | The customer-callable SMS endpoint returned unknown DaisySMS response text and database exception messages through its generic error formatter. | Provider/internal-error disclosure during catalog, history, and existing-order actions, even while new SMS orders are paused. | `PATCH_IMPLEMENTED`, `LOCAL_HELPER_TEST_PASSED`, `EDGE_TYPECHECK_PASSED`: unknown failures now use fixed public messages; known customer declines remain readable. Owner must deploy and smoke-test the SMS Edge Function. |
| SMS cancellation and missing-activation refunds | Admin and approved-staff cancellation paths ignored Daisy cancellation failures or did not check its response body, then marked orders cancelled and refunded them. Customer/status sync also treated `NO_ACTIVATION` as proof of cancellation, although Daisy documents it as a wrong/missing ID. A lost number-allocation response could trigger an immediate refund. | Wallet refund after uncertain or possibly delivered supplier value; late code/status race. | `PATCH_IMPLEMENTED`, `LOCAL_HANDLER_MOCK_PASSED`, `EDGE_TYPECHECK_PASSED`: automated refunds now require documented provider confirmation or a definitive allocation decline, and status transitions are conditional on a nonterminal, unrefunded order. Unknown outcomes retain the debit for review; terminal cancelled rows without a refund no longer auto-credit. Status and refund remain separate commits; provider sandbox, real-Postgres concurrency, old-worker retirement, and deployed-version proof remain owner-pending. |
| SMS staff order data exposure | The service-role `admin_sms_orders` handler returned `publicSmsOrder`, including every customer's OTP message contents, to staff who only needed order status. Admin cancellation responses could return a raw `sms_orders` row with provider payload. | Cross-customer OTP disclosure and unnecessary supplier metadata exposure to permitted staff browsers. | `PATCH_IMPLEMENTED`, `LOCAL_HANDLER_MOCK_PASSED`: staff order lists and cancel responses use a redacted summary with a `has_code` boolean but no `messages` or `provider_payload`; customer self-history still returns their own messages. The admin and staff UIs no longer promise a refund on an unconfirmed outcome. Real deployed permission/response inspection remains owner-pending. |
| Ercas verification acceptance | The repository previously allowed a one-kobo amount difference, ignored the verification HTTP status, and could accept `requestSuccessful = false` when the nested body said `SUCCESSFUL`. It also did not compare returned transaction/payment reference fields with the server-created pending checkout. These are locally observed acceptance gaps, not proof they caused the historical incident. | Unsupported or mismatched payment could be credited if the provider response had those conflicting fields. | `PATCH_IMPLEMENTED`, `LOCAL_PROVIDER_DECISION_PASSED`, `EDGE_TYPECHECK_PASSED`: exact minor-unit amount equality, HTTP/envelope success, and returned reference matching when present are required before credit. Provider sandbox, deployed version, and production evidence remain owner-pending. |
| Rounded gateway evidence in financial truth | The canonical reader and wallet writer rounded ledger and Ercas/PocketFi evidence amounts to two places before comparison, so an over-precise historical evidence value could support a different credit amount. This is a repository finding, not historical attack attribution. | False trusted principal and inconsistent Fraud Review/authorization. | `PATCH_IMPLEMENTED`, `ISOLATED_POSTGRES_FIXTURE_PASSED`: migration `20260925001000` requires exact `numeric` equality. Read-only query 41, realistic staging migration, and provider evidence review remain owner-pending. |
| Cross-wallet provider-reference aliases | The ledger uniquely indexed `external_payment_id`, but two wallets could carry distinct external IDs while claiming one provider reference. The canonical duplicate check was per-wallet, and Fraud Review only showed shared external IDs. | One payment could appear as spendable principal in two wallets if privileged/historical records made conflicting claims. | `PATCH_IMPLEMENTED`, `ISOLATED_POSTGRES_FIXTURE_PASSED`: migrations `20260925003000`/`04000` deny new spending on ambiguous post-cutoff provider-reference claims and show linked wallets to admins, without auto-suspension or balance edits. This is a repo/fixture finding, not proof of a historical duplicate. Owner must run query 43 and verify real provider evidence before resolving accounts. |
| NOWPayments crypto auto-credit | Crypto top-up could become spendable despite fake/disappearing/partial crypto concerns. | Unsupported funding. | `PATCH_IMPLEMENTED`, `LOCAL_PROVIDER_DECISION_PASSED`: auto-credit hard-disabled; local provider model holds partial/expired/unknown/unverified/underpaid/wrong-identity crypto payments and holds verified finished payments for manual review only. |
| Legacy balance RPCs | Older RPCs could change balances outside the wallet engine if callable. | Arbitrary value mutation. | `PATCH_IMPLEMENTED`: revoked/disabled for browser roles; production grants still need verification. |
| Legacy balance-RPC overloads | Exact-signature retirement does not revoke an older overload with different arguments. | A forgotten browser-callable balance writer could bypass the current wallet engine. | `PATCH_IMPLEMENTED`, `ISOLATED_POSTGRES_FIXTURE_PASSED`: migration `20260924020000` revokes browser execution across every deployed overload of five known writer names. Owner must run query 27 against the actual schema. |
| Unsuspension time-of-check race | The Edge admin route reviewed wallet truth, then invoked a separate RPC that cleared account suspension under a later lock without rechecking the financial state. | A concurrent integrity change could invalidate the admin's earlier review decision. | `PATCH_IMPLEMENTED`, `ISOLATED_POSTGRES_FIXTURE_PASSED`: migration `20260924021000` rechecks canonical truth while holding the profile lock. An isolated fixture reproduced the old acceptance and new denial; staging and live definition/grant checks remain pending. |
| Direct profile/privileged-field writes | Client/server profile updates could bypass ledger or alter financial/security identity if grants/triggers allowed. | Arbitrary value mutation, unsuspension, role escalation, or payment-account hijack. | `PATCH_IMPLEMENTED`: profile balance/privileged-field guards, direct-write audits, and narrow service-role-only RPCs for legitimate PocketFi, referral, suspension, and staff-role writes. |
| Direct `transactions` writes | Ledger rows could be inserted/updated outside the wallet engine. | Fabricated funding evidence. | `PATCH_IMPLEMENTED`: direct ledger writes skipped and audited unless wallet engine flag is set. The trusted-principal trigger is scoped to wallet-engine inserts so it cannot raise before the direct-write audit trigger and erase the audit evidence. |
| Canonical gateway evidence reuse and PocketFi lookup | The reader's inner PocketFi webhook-ID pattern omitted a UUID group, so a legitimate valid ID could never match. One credited Ercas evidence row could also match two completed credits with different external IDs; the original duplicate-ID check missed that case. | False denial for genuine PocketFi customers, or overstated trusted funding if ledger integrity was bypassed. | `PATCH_IMPLEMENTED`, `ISOLATED_POSTGRES_FIXTURE_PASSED`: migration `20260924030000` fixes the PocketFi match and flags one provider-evidence row backing multiple credits as a payment-identity conflict with zero confirmed spendable. The local fixture reproduces both old behaviors and the new result. It does not prove how any historical ledger row was written. Staging compatibility, deployed definition, and provider reconciliation remain owner tasks (query 36). |
| Conflicting refund identifiers | A refund naming a wrong debit ID could previously fall back to a weaker key/order/reference and be attributed to a different trusted debit. | False trusted refund restoration or incorrect refund cap. | `PATCH_IMPLEMENTED`: migration `20260924012000` shares a strict debit matcher between the canonical reader, wallet engine, and refund guard. Staging PostgreSQL execution and historical impact review are pending. |
| Balance-neutral admin repair evidence | The admin repair action records a completed `admin_credit` with unchanged wallet snapshots. The canonical reader excluded it from trusted principal but previously added it to expected ledger balance. | False stored-balance deficit or blocked spending for a legitimate wallet. | `PATCH_IMPLEMENTED`, `ISOLATED_POSTGRES_FIXTURE_PASSED`: migration `20260924016000` excludes only strictly marked unchanged-snapshot repair rows from posted movements. The row remains in transaction history. Real-schema staging and production verification remain pending. |
| Manual SQL Editor RLS repair scripts | Four standalone scripts could recreate public `app_settings` reads, browser-written visit/CRO rows, public chat analytics access, and cross-user revenue-event writes after ordered hardening. The `03000` migration missed one of the old app-settings policy names. | Operational setting disclosure, analytics poisoning, and cross-customer chat telemetry disclosure. | `PATCH_IMPLEMENTED`, `ISOLATED_POSTGRES_FIXTURE_PASSED`: the scripts are now no-ops; `02000`/`03000` remove missed policy names and `20260924013000` closes previously applied chat/CRO/revenue policies and browser grants. Real-schema staging and production owner checks remain pending. |
| Browser CRO decision audit | The ordered foundation migration allowed any browser INSERT, including another user's ID and self-declared decision scores. | Admin-visible marketing/fraud investigation evidence poisoning. | `PATCH_IMPLEMENTED`, `ISOLATED_POSTGRES_FIXTURE_PASSED`: `20260924014000` binds non-null user IDs to `auth.uid()` and requires client-observed, non-authoritative metadata. Real-schema staging and production owner checks remain pending. |
| Admin security alerts | The original `admin_alerts` migration granted an authenticated INSERT policy with `WITH CHECK (true)`. Where a table INSERT grant is effective, a customer could forge admin-visible `security` or `system_error` alerts. | Operator evidence poisoning and alert fatigue. | `PATCH_IMPLEMENTED`, `ISOLATED_POSTGRES_FIXTURE_PASSED`: `20260924015000` removes the browser INSERT policy and effective direct grant while retaining admin read/acknowledge and service-role insert. Deployed grants/policies require owner verification. |
| Public sales aggregates | The anonymous storefront called `get_customer_sales_stats()` for an order count, but that RPC also returned exact lifetime revenue. Its public top-products RPC returned exact units sold and accepted an unbounded limit. | Business financial disclosure and excessive public aggregation. | `PATCH_IMPLEMENTED`, `ISOLATED_POSTGRES_FIXTURE_PASSED`: `20260924017000` keeps only count and bounded product IDs public; exact revenue requires current admin or `view_stats` staff authorization. Old units-sold RPC and browser writes to `staff_permissions` are revoked. Deployed grants and app version require owner verification. |
| Staff approval queue | The legacy queue allowed browser INSERT with only `staff_id = auth.uid()`, bypassing `manage-staff` permission checks. An ordinary user could submit a forged action for an admin to approve; this did not itself execute an action. The Edge approval branch also did not recheck current staff permissions, and auto-approved actions were applied before the audit row was written. | Approval-queue poisoning and unsupported admin-credit provenance if a forged row were approved. | `PATCH_IMPLEMENTED`, `ISOLATED_POSTGRES_FIXTURE_PASSED`, `EDGE_TYPECHECK_PASSED`: migration `20260925010000` removes browser table/column writes, retains own-history reads and service writes, and allows failed audit state. Approval rechecks current staff permission; auto-approved actions record audit first. Run query 49 and stage direct-insert, revoked-permission, and failed-action cases before deploying. |
| Revenue OS scheduled loop | The service-role Edge Function accepted GET or POST without its own caller check. A valid ordinary JWT could trigger privileged maintenance if the deployed gateway accepted it. | Unauthorized mutation of marketing/attribution state and repeated privileged work. | `PATCH_IMPLEMENTED`, `LOCAL_AUTH_TEST_PASSED`: POST and an exact service-role bearer token are required before work starts; explicit JWT verification remains enabled. Owner must verify the deployed scheduler and ordinary-customer denial. |
| Cross-account IP/user-agent bans | Purchase guards queried active `fraud_device_bans` by IP or user-agent hash without `banned_user_id`. A shared browser signature or forwarded-header value could block an unrelated customer. | False financial denial / denial of service. | `PATCH_IMPLEMENTED`, `LOCAL_GUARD_TEST_PASSED`: mapped guards now bind both queries to the authenticated customer ID. Shared traits remain investigation signals, not automatic cross-account bans. Deployed function versions and old ban records need owner review. |
| Referral-to-wallet movement | Referral rewards could be confused with spendable trusted principal during incident review. | Unsupported or ambiguous value movement. | `PATCH_IMPLEMENTED`: backend referral withdrawal is hard-paused and the frontend no longer calls the client helper or invites referral-to-wallet movement. Referral rows are excluded from trusted principal. |
| Referral attribution error disclosure | The authenticated `apply-referral` endpoint used a service-role RPC for the current user but returned its raw database error message to the browser on failure. | Internal database/error disclosure, not a wallet-credit bypass. | `PATCH_IMPLEMENTED`, `LOCAL_SOURCE_GUARD_PASSED`, `EDGE_TYPECHECK_PASSED`: failed RPC and unexpected errors now return a fixed customer message. Owner must deploy and test a denied/failing referral in staging. |
| Chargebacks/payment reversals | Reversed payments need to remove backing and block spending without direct balance edits or clamping debt to zero. | Debt preservation / backed-funds correction. | `PATCH_IMPLEMENTED`: wallet engine supports `chargeback` debt posting; admin route/UI has a controlled manual `record_chargeback` action that posts through the wallet engine and places the customer into review. Provider-specific automated chargeback ingestion still requires provider proof. |
| Product/SMM/SMS orphan retries | Debit could exist without matching order, then retry could replay into fresh delivery. | Deliver after ambiguous financial state. | `PATCH_IMPLEMENTED`: orphan-ledger retry blocks for product, SMM, and SMS. |
| Live supplier fallback/restock | Supplier calls could occur before fully proven backed funds. | Paid provider loss. | `PATCH_IMPLEMENTED`: live fallback and restock routes default-paused/hard-paused. |
| Restock provider response disclosure | `auto-restock` logged raw supplier lookup responses, fetch errors with potentially secret-bearing URLs, and supplier-provided purchase errors; `manual-restock` returned supplier errors to the caller. | Purchased account credentials or provider keys could leak into logs, admin-visible error records, or a browser response. | `PATCH_IMPLEMENTED`, `LOCAL_SOURCE_GUARD_PASSED`: both routes use generic outcome text instead of raw provider payloads or fetch errors. Deployed versions and historical logs still require owner review. Unknown supplier outcomes are not yet durably deduplicated; both routes must remain paused until that behavior is resolved and tested. |
| Direct live account fulfillment error surface | The paused `muabanvia-fulfill` route returned raw supplier `msg`/`error` text and accepted an unbounded client quantity when its live flag was enabled. | Provider details could appear in a browser response, and an authorized but mistaken or compromised caller could place an oversized supplier order. | `PATCH_IMPLEMENTED`, `LOCAL_SOURCE_GUARD_PASSED`: the route retains its admin check and default pause, returns generic supplier failures, and bounds quantity to 1-20. This does not make customer checkout safe; the direct route has no order-bound wallet authorization and must remain paused for customer use. |
| Catalog provider error disclosure | `bitrefill-catalog` and `get-data-plans` included raw provider error bodies in exceptions, then logged or returned them to authenticated browsers. | Provider internals or reflected credentials could appear in browser responses and function logs. | `PATCH_IMPLEMENTED`, `LOCAL_SOURCE_GUARD_PASSED`: known request-validation errors remain explicit; provider failures now return fixed messages without raw bodies or stacks. Deployed versions and historical logs require owner verification. |
| Public crypto utility error disclosure | `get-available-cryptos` and `update-crypto-rates` returned raw NOWPayments failure text to browser callers while crypto wallet funding was paused; the estimate route interpolated caller currency into a provider query. | Provider internals or reflected values could leak, and a malformed currency could alter the provider request query. | `PATCH_IMPLEMENTED`, `LOCAL_SOURCE_GUARD_PASSED`: both routes validate currency tokens and return generic failures; the estimate route encodes query parameters. This does not re-enable crypto funding. Deployed versions and historical logs require owner verification. |
| Crypto order and chatbot error disclosure | `create-crypto-sell-order` returned raw Auth, provider, exchange-rate, and database errors, exposed a request-header prefix in an authentication debug object, and saved a raw provider error on failed order creation. The public chatbot also returned caught exception text. | Internal details or partial credential material could reach callers even while crypto top-up is paused. | `PATCH_IMPLEMENTED`, `LOCAL_SOURCE_GUARD_PASSED`, `EDGE_TYPECHECK_PASSED`: fixed public failures, no auth debug object, and no raw provider error stored on this path. Crypto top-up remains paused. Deployed response and historical-log checks remain owner-pending. |
| Email, staff, and scheduled revenue error disclosure | Authorized email and staff endpoints returned raw SMTP/database exception text, and the service-role revenue loop returned its caught exception to the caller. | Internal schema, provider, or mail-service details could appear in browser/worker responses. | `PATCH_IMPLEMENTED`, `LOCAL_SOURCE_GUARD_PASSED`, `EDGE_TYPECHECK_PASSED`: these routes now return fixed failures; explicit authorization errors remain. Deployed response and historical-log checks remain owner-pending. |
| Email broadcast preview recipients | The `email/broadcast` dry run returned up to 200 opted-in customer email addresses to an authenticated admin or staff member with `tab_email`, even when the staff action was not auto-approved. | Unnecessary bulk customer-identifier disclosure through a preview response. | `PATCH_IMPLEMENTED`, `LOCAL_SOURCE_GUARD_PASSED`: the dry run now returns only the opted-in count and the admin UI no longer renders a recipient list. Actual broadcast selection remains opt-in filtered. The owner must verify the deployed Edge and web versions and review historical access logs if needed. |
| Ambiguous SageCloud refund | `purchase-bills` and `create-withdrawal-request` refunded on thrown or non-success provider responses, although a timeout can follow accepted delivery or transfer. The bills catch also enclosed later bookkeeping. Withdrawal could proceed using the caller's account name after bank verification failed. | Paid product or bank transfer could complete while the customer regains the debited funds; an unverified bank destination could receive a transfer. | `PATCH_IMPLEMENTED`, `LOCAL_SOURCE_GUARD_PASSED`: ambiguous outcomes remain pending with the debit retained and a stable reference for reconciliation; raw provider responses are not returned. Withdrawal bank verification now fails before debit if no verified account name is returned. These routes remain paused because provider lookup, durable retry control, and confirmed-failure refund workflow are not yet proven. |
| Ambiguous Bitrefill refund and replay disclosure | `purchase-bitrefill` refunded on provider errors, including a lost invoice or redemption lookup response, and returned the full stored order with `success: true` on a pending idempotency replay. Checkout ignored blocklist/markup-setting load failures. | A delivered code could be refunded; a pending replay could expose stored fields; failed setting reads could bypass curation or undercharge. | `PATCH_IMPLEMENTED`, `LOCAL_SOURCE_GUARD_PASSED`: ambiguous outcomes keep the posted debit and known invoice/order IDs for review, pending replays return no redemption, raw provider errors are sanitized, and failed setting reads stop checkout. Provider lookup, durable retry, confirmed non-delivery refund, and deployed RLS/column-read checks remain pending; keep this route paused. |

## Fake Gateway Trigger Assessment

| Provider/surface | Can fake trigger credit after patch? | Evidence | Remaining proof |
| --- | --- | --- | --- |
| Ercas | The current repository path requires a server-created pending payment, successful verification HTTP response and provider envelope, exact amount, matching returned references when present, and a wallet-engine posting. Browser success and legacy Vercel callbacks alone do not credit. A compromised privileged writer or an unverified deployed version remains outside this source claim. | `PATCH_IMPLEMENTED`, `LOCAL_PROVIDER_DECISION_PASSED`, `EDGE_TYPECHECK_PASSED` | Sandbox tests for one-kobo mismatch, failed HTTP/envelope with a success-looking body, wrong references/user, duplicate, missing pending row, and deployed function/grant verification. |
| PocketFi | Source says unsigned/mismatched webhooks should not credit; duplicate conflicts are rejected; trusted-principal calculation requires a matched `pocketfi_webhook_logs` row and matching verified amount. The webhook no longer accepts event/session/object IDs as substitutes for a transfer reference used in the idempotency key. | `PATCH_IMPLEMENTED`, `LOCAL_PROVIDER_DECISION_PASSED`, `EDGE_TYPECHECK_PASSED` | Sandbox signed/unsigned/replay tests, genuine permanent-account reference shape, fake external-ID ledger tests, and deployed raw-body verification. |
| NOWPayments | Source and local provider-decision model say no auto wallet/crypto credit; finished payments are manual-review only. Signed terminal status is checked against current provider status and payment identity. Conflicting finished/terminal and unsupported statuses are retained for review without rewriting local state; the original quoted amount/currency stay unchanged. Conditional writes prevent an older terminal or finished event from overwriting a newer local state. | `PATCH_IMPLEMENTED`, `LOCAL_PROVIDER_DECISION_PASSED`, `EDGE_TYPECHECK_PASSED` | Confirm deployed env cannot reopen auto-credit, provider dashboard URLs point to current function, conflict and terminal/reversal events behave as expected in sandbox, and historical credits are reconciled before reopening. |
| iStar | Source requires raw-body HMAC, a supported signed-body event type, and a conditional nonterminal status transition before refund. Poll/admin cancel do not auto-credit refunds. | `STATIC_CHECK_PASSED`, `LOCAL_HANDLER_MOCK_PASSED`, `EDGE_TYPECHECK_PASSED` | Sandbox genuine signed callbacks, malformed/header-only events, concurrent success/failure, duplicate callbacks, real-Postgres refund idempotency, and old-worker retirement. |

## P0 Containment Coverage

- Partner API closed in public Vercel route and Supabase Edge Function.
- Existing partner records paused by migration.
- Partner tables hardened against direct browser reads and writes.
- Bills, Bitrefill/gift cards, withdrawals, crypto top-up, SMM order creation,
  SMS OTP purchases, Telegram order creation, referral withdrawal, live account
  fulfillment, manual restock, and auto restock fail closed.
- NOWPayments crypto auto-credit is hard-disabled.
- Legacy Ercas webhooks are gone.
- Legacy crypto transfer UI/RPC is disabled.
- Wallet debits/refunds for mapped routes use `apply_wallet_transaction`.

## Permanent Financial Changes

- `apply_wallet_transaction` is the controlled wallet writer.
- Wallet rows are locked with `FOR UPDATE`.
- Idempotency conflicts return `IDEMPOTENCY_CONFLICT`.
- The wallet engine sets transaction-local ledger/profile authorization flags
  only around its own ledger and profile balance/freeze updates, then clears
  them.
- Wallet purchases compute backed funds from approved admin credits, verified
  gateway deposits with matched provider evidence, eligible refunds, and
  previous completed debits.
- Unbacked purchase attempts return `WALLET_UNBACKED_FUNDS` and freeze
  financial access before delivery.
- Direct ledger writes are skipped/audited, and the trusted-principal trigger is
  scoped to wallet-engine inserts so direct-write audit rows survive.
- Protected profile fields are preserved/neutralized, and legitimate protected
  writes are constrained to narrow database RPCs rather than broad service-role
  `profiles.update()` calls.
- New ordinary profile balances start at zero.
- Admin credits count as trusted backing only with approving actor evidence, matching approved_by metadata, approval reference, and reason;
  staff/correction/generic credits do not create trusted product-spend principal
  unless reposted through the approved admin-credit path.
- Refunds are capped as restoration of previous trusted-principal-authorized
  debits with positive `trusted_principal_debit_amount`, not treated as new
  external funding. The wallet engine and trusted-principal trigger reject
  refund rows that do not identify the original debit, lack trusted debit amount
  evidence, or exceed the remaining amount of that linked trusted debit.
  Existing completed loose refund rows without original-debit linkage, or with
  only forged boolean trusted metadata, are treated as review evidence only and
  cannot restore trusted spend capacity.
- The fraud ledger scanner uses the same trusted-principal rule and excludes
  generic `credit` rows. System-generated integrity findings use the separate
  `wallet_review_required` hold so they block spending and fulfillment without
  blocking read-only order history, deposits, wallet activity, or support.
  Manual account suspension and financial-review resolution remain admin actions.

## Fulfillment Boundary Changes

- Product credentials and local inventory now use
  `authorize_product_purchase` and `complete_product_purchase`: trusted funds,
  the wallet reservation, inventory reservation, and a non-delivered order are
  committed before credentials are loaded; completion captures the hold, stores
  credentials, and marks the reserved inventory sold in one transaction.
  A completion or inventory conflict rolls the transaction back rather than
  leaving a debit plus unsold/undelivered inventory.
- SMM, SMS OTP, and Telegram order creation are now default-paused by server
  flags. If later reopened, SMM creates a local order and calls the panel only
  after wallet-engine debit; SMS debits, creates a pending local order, then
  allocates a Daisy number; Telegram creates a local order, debits, then calls
  iStar, and debit-failed local orders are kept as `failed` evidence instead
  of being deleted.
- iStar failure refunds require raw-body HMAC verification.
- Bills, Bitrefill, and withdrawals create local rows before wallet debit and
  keep debit-denied rows as `failed` `wallet_debit` evidence instead of
  deleting them. Withdrawal provider-failure refunds now carry the original
  debit transaction id, debit idempotency key, original reference, and
  `crypto_withdrawals` source-order provenance.
- Bills, Bitrefill, withdrawals, crypto top-up, referral withdrawal, partner
  API, live supplier fallback, and restock remain paused pending route-specific
  provider/concurrency tests.

## Commands Run

Current local verification is recorded in `docs/security/wallet-test-report.md`.
The latest relevant commands passed:

```text
npm run security:wallet
npm run security:wallet:local
npm run security:wallet:admin-review
npm run security:wallet:customer-ui
npm run security:wallet:db-pack -- --help
npm run security:wallet:db-concurrency -- --help
npm run security:wallet:deployed-smoke -- --help
npm run security:wallet:deploy-manifest
npm run security:wallet:evidence
npm run security:wallet:handoff
npm run security:wallet:audit
npm run security:wallet:source-mutations
npm run security:wallet:provider-evidence -- --format json
npm run security:wallet:provider-evidence -- --filled-template
npm run security:wallet:provider-evidence -- --self-test
npm run security:wallet:adapters
npm run security:wallet:fulfillment
npm run security:wallet:migrations
npm run security:wallet:model
npm run security:wallet:outbox
npm run security:wallet:providers
npm run security:wallet:trusted-principal
npm run lint
npm run build
node scripts/wallet-reconcile-readonly.mjs --history-csv "C:\Users\HP ELITEBOOK\Downloads\Supabase Snippet Untitled query (1).csv" --json
npx eslint scripts/security-wallet-check.mjs scripts/wallet-reconcile-readonly.mjs scripts/wallet-model-sequence-test.mjs scripts/wallet-provider-decision-test.mjs scripts/wallet-fulfillment-decision-test.mjs api/webhook-pocketfi.ts api/webhook-istar.ts --max-warnings=0
npx tsc --noEmit --pretty false
git diff --check -- docs/security/... scripts/security-wallet-check.mjs api/webhook-pocketfi.ts
```

The static guard currently reports 92 checks passing, including this
route inventory, env/secret inventory, wallet security event forensic sink,
request-forensics metadata on high-risk purchase ledgers and denied-purchase
freeze events,
production evidence register coverage,
browser payment success/callback pages being unable to create wallet credit,
the mutation and fulfillment maps,
final-report artifact, the partner admin mutation read-only lock,
completed-only customer credential reveal, frozen-account purchase route
ordering, future-function default execute revocation,
Ercas timeout retry/no-provisional-credit handling,
provider payment identity uniqueness, offline CSV reconciliation/deduplication
with derived analysis files treated as support-only rather than raw totals,
local security-suite coverage,
deployment-manifest coverage,
owner-handoff coverage,
incident completion-audit coverage,
guarded staging DB runner coverage,
guarded real-Postgres concurrency runner coverage,
deployed denied-route smoke coverage,
provider evidence template, fillable evidence file, and filled-evidence
validator coverage,
wallet model generated-sequence coverage, wallet concurrency model coverage,
outbox/queue dispatch decision coverage,
route-decision coverage, refund-conservation model coverage, provider decision coverage,
provider-adapter mock coverage,
supplier-outcome coverage,
admin-review decision and admin/customer transaction-display coverage, including
typed admin/staff/chargeback debits rendering negative, refunds rendering as
restorations rather than deposits, wallet total deposits being limited to actual
deposit/top-up types, and admin/staff/promotion/correction/referral credits
being labelled separately from top-ups,
incident migration static-safety coverage,
Ercas provider identity mismatch rejection, fulfillment decision coverage,
hostile quantity/price input validation, mapped route
idempotency-content binding, wallet-engine refund caps, refund-owner binding
and original-debit provenance across mapped refund paths, forged-webhook rejection
before customer punishment or credit, ordinary insufficient-funds decline
without fraud suspension, approved admin-credit actor and approval-metadata evidence,
frozen-wallet incoming-funds recording without auto-unfreeze, wallet-engine
chargeback debt preservation, admin unsuspend wallet-backing reconciliation,
admin absolute-plus-relative date display, refund conservation staging
coverage including completed loose-refund history denial, referral-to-wallet UI
pause coverage, and chargeback debt staging coverage.

The local suite currently runs 88 repository-local checks, including the
reachable Git-history source exposure audit and `npx deno`
type checks for all 37 local Supabase Edge Function entrypoints, guarded
DB-concurrency runner help/self-test, guarded DB-security runner help/self-test,
read-only reconciliation help/self-test, deployed-smoke help/self-test,
owner-denied probe validation, production-evidence coverage/self-test, provider
fillable-evidence generation, provider-evidence validator self-test,
deployed-version evidence generation, fillable deployed-version evidence
generation, and a deployed-version validator self-test.
The incident
completion audit dynamically confirms 72 local wallet-security scripts are
represented in the repository, parses all 80 regression-matrix rows, and reports
the remaining proof gaps explicitly. Staging SQL rows, patch/runtime rows,
provider rows, concurrency rows, and production-owner rows still require
stronger evidence. It also includes the source-mutation audit that blocks direct
protected profile-balance writes, legacy wallet RPC calls, and direct ledger
mutations outside the documented balance-neutral admin repair path.

Full `npm run lint` also passed with 0 errors and 25 existing warnings. Full
`npm run build` passed; the remaining Vite output was browser-data,
mixed static/dynamic import, bundle-size, and PWA generation notices, not
compile failures.

## Not Run

- Supabase migrations against local/staging Postgres.
- Restricted-role RLS/grant tests as `anon`, `authenticated`, and
  `service_role`.
- Effective deployed privilege tests. The migration-safety script checks SQL
  text for dangerous browser grants/function exposure, but it does not replace
  running those migrations and inspecting effective privileges in Postgres.
- Postgres row-lock/concurrency tests. Local concurrency model tests passed,
  but real database lock/fault-injection tests still require staging Postgres.
- Live provider sandbox/dashboard tests. Local no-network provider-decision,
  provider-adapter, supplier-outcome, and fulfillment-decision tests passed, but
  they do not prove provider dashboard configuration or real provider contracts.
- Deployed Edge Function version and runtime configuration checks. Local Deno
  source type checks now pass for all 37 Edge Function entrypoints, but that
  does not prove the deployed Supabase project is running the same code with
  the intended secrets and function settings.
- Production deployed-version checks.
- Live provider dashboard verification.
- Historical root-cause confirmation from logs.

## Required Owner Deployment Actions

1. Preserve affected-account, provider, webhook, order, and ledger evidence.
2. Apply migrations in timestamp order with the catalog/SMM expand-deploy-
   verify-contract stops in `wallet-deployment-manifest.md`; do not bulk-push
   browser grant restrictions ahead of the matching app build.
3. Deploy changed Supabase Edge Functions.
4. Redeploy Vercel app.
5. Keep paused env flags disabled.
6. Run read-only production query pack and one-account reconciliation reports.
7. Run staging DB security test pack before treating database grants as safe.
8. Verify provider webhook URLs/secrets and duplicate behavior.
9. Verify no old workers/routes remain active.
10. Reopen only routes whose row in the regression matrix has the required
    staging, provider, concurrency, and production evidence.

## Remaining Risks

- Historical cause and actor are not proven.
- The canonical reader intentionally excludes post-cutoff admin-credit rows
  outside reviewed posting sources even when their approval metadata looks
  plausible. Read-only query 46 isolates such rows for owner review; it is
  neither approval evidence nor a reason to auto-unfreeze an account.
- Production may still be running older code until owner deploys.
- Production grants/RLS/triggers may differ from repository migrations.
- Provider behavior may differ from assumptions until live sandbox/dashboard
  checks or owner-approved provider contract evidence is collected.
- PocketFi permanent-account top-ups currently rely on authenticated webhook
  evidence rather than an independently confirmed transfer lookup. The
  provider's documented hosted-checkout confirmation is not assumed to cover
  permanent-account bank transfers. The owner must confirm the transfer
  reference, signature, replay, and lookup contract before claiming the
  funding provenance is independently verified.
- The older catalog migration granted browser SELECT on entire active
  `product_groups` rows, including supplier IDs. Migrations `30500` and
  `31000` plus the browser/admin reader changes now separate public columns
  from managed configuration in the repository. The owner must deploy the
  expand phase, new app, and contract phase in that order; read-only query 37
  and live catalog/editor smoke checks are still needed before treating the
  exposure as closed in production.
- The public chatbot still selected every `product_groups` column through the
  anonymous client, so the catalog contract would reject its product lookup.
  It now requests only public columns and no supplier IDs, and treats
  zero-stock `UNLIMITED` products as auto-fulfillable only when the server
  fulfillment switch is enabled. The isolated grant test and Deno type-check
  pass; the owner must deploy and smoke-test the Edge build.
- The original `product_relationships` grant exposed full behavioral rows to
  browser roles. Migration `30200` adds a scoped admin-only relationship
  writer, and `31500` restricts direct reads to recommendation edge columns;
  the admin count query now selects only ID/time. Isolated PostgreSQL
  privilege and admin RPC upsert checks pass, but read-only query 38 and
  deployed Revenue OS/browser smoke checks remain owner tasks.
- The customer SMM catalog and `smm-get-services` response exposed the
  provider's `external_id`; the browser also selected it for telemetry.
  The repository now omits that field from customer/Edge responses and uses
  admin-checked RPCs for admin search and toggles. Migration `05000` adds
  those RPCs before the matching app deploy; `06000` then removes broad and
  inherited column grants. Isolated PostgreSQL role tests pass, but deployed
  catalog/editor checks and read-only query 44 remain owner tasks. SMM order
  fulfillment stays paused.
- Customer SMM status responses returned raw panel errors and `charge`, and
  broad `smm_orders` reads could expose saved panel responses and supplier
  cost. The route now sends only customer-safe status fields; migration
  `07000` contracts browser reads after the matching app deploy. The SMM
  order route also previously auto-refunded ambiguous panel failures. It now
  retains the debit as `outcome_unknown` and blocks new orders for that wallet
  pending provider/manual reconciliation. Isolated privilege and source tests
  passed, but real panel timeout and deployed row-policy tests remain pending.
- Telegram supplier POST uncertainty now retains the wallet debit instead of
  auto-refunding it; an order without a captured supplier ID still requires
  provider lookup or manual outcome review. The route stays paused by default.
- Reserve-first holds and transactional outbox/worker-claim behavior are now
  locally modeled, including valid reservations, stale queued authorization
  denial, post-commit recovery, pre-commit rollback, and duplicate-worker
  dispatch prevention. The active local product route is migrated to the
  database-backed reserve/capture boundary. Additive database tables plus
  service-role-only reservation and outbox RPCs exist in migrations, but
  provider-backed routes are still paused rather than being treated as
  reserve-first. Route-level database partial-refund enforcement and
  chargeback/debt workflow also remain pending across provider routes. Local
  refund-conservation tests cover legitimate partial refunds, duplicate refund
  replay/conflict, owner mismatch, missing original debits, and over-refund
  denial; mapped refund routes also carry normalized `source_order_id` and
  `source_order_table` metadata where an order or transaction row exists.
- A privileged owner/superuser or compromised service-role secret remains
  outside the protection boundary of ordinary runtime role hardening.
- Several privileged Edge handlers previously checked `is_admin` or
  `is_staff` without rechecking `profiles.account_suspended` on each request.
  The repository now checks current account state in those handlers and when
  executing queued staff actions. The source-level regression check passes;
  staging tests with an already-issued JWT and deployed Edge versions are
  still owner tasks. This finding does not establish how any historical
  customer wallet obtained unsupported value.
- Six direct admin database RPCs for financial truth, fraud telemetry,
  cross-wallet payment conflicts, and SMM management also trusted a current
  admin role without rechecking account suspension. Migration
  `20260925017000` adds that check without changing wallet state; an isolated
  PGlite fixture reproduces the old access and verifies denial, active-admin
  continuity, and atomic abort on definition drift. Real deployed function
  definitions and old-session JWT behavior remain owner-pending.
- Financial-audit and SMS-history RLS policies also used `is_admin` without
  suspension state. Migration `20260925018000` changes those policies to
  the existing active-admin helper. An isolated PGlite fixture reproduces
  the old cross-customer read and verifies denial after migration while
  preserving own SMS history. Deployed policy and real-JWT checks remain
  owner-pending.
- The `orders_safe_history` admin branch also relied on role alone. Migration
  `20260925019000` uses the active-admin helper without changing customer
  self-history or captured-order credential rules. The isolated order-history
  fixture passes; deployed view and real-JWT checks remain owner-pending.
- The older `admin_alerts` SELECT/UPDATE policies allowed an admin role to
  retain alert access after account suspension. Migration `20260925020000`
  adds a restrictive active-admin bound; a PGlite fixture reproduces the
  old acknowledgement and verifies denial even alongside an extra permissive
  policy. Deployed policy and real-JWT checks remain owner-pending.
- Seven older fraud-device, profile/auth deletion, balance, and identity
  audit read policies also relied on the admin role without current
  suspension. Migration `20260925021000` adds restrictive active-admin
  reads; the isolated fixture verifies denial despite an extra permissive
  policy. Deployed grants/policies and real-JWT probes remain owner-pending.
- `app_settings` and `sms_product_settings` still allowed a suspended admin
  to write directly under role-only RLS, bypassing the patched Edge checks.
  Migration `20260925022000` adds active-admin read/write bounds while
  preserving public storefront setting reads. An isolated Postgres fixture
  reproduces the old write and verifies denial. Deployed grants/policies
  and real-JWT checks remain owner-pending.
- Site visits and revenue identity links still had role-only admin read
  policies. Migration `20260925023000` limits site visits to active admins
  and identity links to active admins or the owning customer. The isolated
  fixture verifies suspended-admin denial and customer self-link
  `INSERT ... RETURNING` continuity. Deployed role checks remain pending.
- The older base `orders` and `transactions` RLS policies also allowed a
  suspended admin role to read cross-customer financial history. Migration
  `20260925024000` adds a restrictive owner-or-active-admin read boundary;
  an isolated PostgreSQL fixture verifies active-admin investigation and
  customer self-history remain available. Deployed grants/policies and
  real-JWT behavior remain owner-pending.
- Revenue OS event and CRO decision-audit read policies also relied on the
  admin role without current suspension. Migration `20260925025000` limits
  event reads to the owner or active admin, decision-audit reads to active
  admins, and anonymous raw-table reads through explicit grant revocation.
  An isolated PostgreSQL fixture reproduces the prior leak and verifies
  the corrected role boundaries. Deployed policy/grant and real-JWT checks
  remain owner-pending.

## Supporting Artifacts

- `docs/security/wallet-financial-model.md`
- `docs/security/wallet-state-machine.md`
- `docs/security/wallet-mutation-map.md`
- `docs/security/wallet-fulfillment-map.md`
- `docs/security/wallet-regression-matrix.md`
- `docs/security/wallet-db-security-test-pack.sql`
- `docs/security/wallet-readonly-query-pack.sql`
- `docs/security/wallet-owner-verification-checklist.md`
- `docs/security/wallet-production-evidence-register.md`
- `docs/security/wallet-deployment-manifest.md`
- `supabase/migrations/20260919017000_create_wallet_security_events.sql`
- `supabase/migrations/20260919018000_capture_wallet_security_events.sql`
- `scripts/security-wallet-check.mjs`
- `scripts/wallet-deployment-manifest-check.mjs`
- `scripts/wallet-migration-safety-test.mjs`
- `scripts/wallet-outbox-decision-test.mjs`
- `scripts/wallet-reconcile-readonly.mjs`
