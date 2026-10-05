# Customer service pricing and international airtime

## Owner controls

Admin has separate International Airtime and Gift Card Pricing sections; SMS
pricing is in SMS Products. The owner can add a fixed NGN amount or a percentage
of supplier cost globally, or override an individual product/service. Bitrefill
products additionally support a denomination override. Precedence is denomination,
product, then global. Rules are private, server-read and owner-audited.

New SMS rules and airtime prices round upward to the next NGN10. SMS uses integer
cent/basis-point arithmetic to avoid floating-point rounding at exact multiples.
Legacy SMS prices/manual margins remain until the owner saves a global or matching
service rule. Saving a global rule supersedes legacy manual prices; explicit new
service overrides take priority. The checkout uses the displayed server quote;
later supplier-cost movement cannot increase the wallet debit silently.

Gift-card purchasing remains Coming Soon. Its new pricing controls do not activate
the paused legacy purchase-bitrefill route.

## Airtime payment boundary

The ZIP uses Bitrefill for international airtime. The new customer-airtime Edge
function fixes the provider origin, prohibits redirects, checks an international
phone number/operator/product/denomination, and quotes merchant billing cost rather
than face value. The live merchant account and catalog authenticate successfully;
merchant currency is BTC and package prices are satoshis. The ZIP's invoice quote
handling also uses satoshis. Ambiguous invoice payment units fail closed.

An active customer must have verified spendable wallet funds. A canonical hold is
created before an unpaid supplier invoice; committed, single-use claims precede
invoice creation and payment. The exact unpaid invoice and order identities and
price are checked before payment. Status reads never repeat a supplier payment.
Only invoice complete plus one individually delivered unit with the exact product,
face value and recipient captures the wallet hold. Phone delivery does not require
a redemption code. Unknown outcomes remain held for reconciliation.

A fresh, numerically verified insufficient merchant balance stops invoice/payment
creation and releases an unpaid wallet hold. It creates a redacted Bitrefill warning
for active staff/admin in the existing warning dialog. Missing balance information
is treated as unknown, never as proof of insufficient funds.

Provider keys stay in Supabase secrets. Browser order history exposes only safe,
owner-scoped fields. Pricing/dispatch mutation RPCs are service-only, with a fixed
active-owner check for pricing changes. Customer requests cannot choose a provider
URL or configure pricing.

## Verification

- Source migrations 280/281/290/291: actual Supabase rollback probes, immutable quote,
  canonical wallet funding/reservation/capture/release, ACL and owner controls.
- Pricing: independent kinds, activation preserving legacy SMS, bounded batched
  service rules and immutable audit.
- Runtime: unpaid invoice identity/price, all-unit delivery, idempotency, uncertain
  outcomes, no repeat payment, and no Daisy allocation on invalid/low-wallet buys.
- Actual React browser fixtures at 390px: operator/package selection, exact request,
  explicit confirmation, uncertain request/account isolation, owner pricing edits.
- Read-only live provider checks used no invoice creation or paid order. No real
  customer purchase is represented as having been tested by those checks.

The existing unrelated app TypeScript diagnostics remain; focused lint, Edge
compilation and the production Vite/PWA build are the applicable successful gates.
