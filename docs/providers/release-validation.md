# Provider release validation — 19 November 2026

## Deployment targets

- Supabase project: `ktmlojvchkmzcdbjdyjx` (the newer project identified by the owner).
- Vercel project: `tally-store`, production alias `tally-store-steel.vercel.app`.
- Connected repository: `Kingsleyyy47/TALLY-STORE`, production branch `main`.
- Supplier credentials remain in Supabase secrets; Vercel receives only the public browser backend settings for this release.

The release was prepared from current TallyStore source in an isolated worktree.
Existing unrelated local security changes were preserved outside this release.
The target repository receives a snapshot commit whose parent is its existing
main branch; the other repository's historical environment-file commits are not
introduced into the target's ancestry.

## Applied database changes

These three migrations were applied in one transaction, with preconditions for
the existing canonical wallet functions and a five-second lock timeout:

1. `20261119000000_supplier_product_routing.sql`
2. `20261119001000_korapay_verified_wallet_credit.sql`
3. `20261119002000_sms_rental_dispatch.sql`

No historical wallet transaction, customer balance or purchase row was changed.
Existing purchase feature flags were preserved. New Kora and rental activation
flags default to disabled until their merchant acceptance checks are completed.

## Edge Functions

`provider-integrations`, `korapay-wallet`, `korapay-webhook`, `smsbus`,
`smm-sync-services`, `smm-create-order`, `smm-check-status`,
`smm-check-all-orders`, `partner-api`, and `telegram-stars`.

The supplier API adapters run in these functions. Browser code cannot access
supplier route tables or keys. The administrative integration page checks key
presence, displays matches, and runs explicit catalogue syncs. The internal
`smoke_readonly` action requires service credentials, makes no paid calls, and
does not write to the database.

## Verification

- `npm run providers:check`: eleven suites pass, including nineteen adapter,
  matching, cache and transport fixtures; real Kora and rental SQL executed in
  PGlite; SMM concurrency and existing SMS authorization/evidence/cancellation
  and polling budget tests retained.
- Frontend TypeScript check and production build pass.
- Changed Edge Function entrypoints pass Deno checks.
- Service worker cache lifecycle test passes.
- Source/build credential scan passes. The scanner now normalizes Windows line
  endings before matching SQL test coverage. Historical source-repository key
  warnings remain historical evidence; this release does not rotate unrelated
  provider keys or copy that source history into the deployment repository.
- Built browser assets contain none of the local access-token/secret values.
- Live unauthenticated SMS/SMM purchase and provider-admin requests return 401.
- Live Kora wallet rejects an absent user session; unsigned callbacks return 401.
- Live read-only supplier probe verified the deployed database connection,
  DaisySMS `.io`, SMSBus OTP and the Lord of Panels USD account.
- At the probe, 599 Daisy offers and 191 SMSBus offers formed 685 products,
  including 105 exact matched fallback groups. Counts change with supplier stock.

No supplier stock was purchased, payment initialized, customer wallet funded or
customer balance mutated during acceptance testing. Full purchase/delivery and
refund acceptance for each merchant account requires its credentials and a
separate funded test; mock fixtures are not evidence of a live purchase.

## Activation limits

Missing supplier keys remain visibly unconfigured. PVACodes is blocked pending
its private endpoint reference. The coverage table in `integration-guide.md`
explicitly identifies the additional rental/service variants that are not wired
into this release. Bitrefill retains the existing Personal API integration;
Business API credentials are a different contract. Equivalent products receive
fallbacks; unrelated regions, denominations, rental terms or payment instruments
are not substituted.

The existing legacy iStar webhook ingress is not reconfigured by this release.
The current FragmentAPI integration uses authenticated order polling; migration
webhook ingress settings must not be pointed at a different database casually.
