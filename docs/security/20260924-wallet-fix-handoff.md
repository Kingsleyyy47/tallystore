# Wallet accounting fix: 24 September 2026

## Source findings

- `apply_wallet_transaction` inserts a purchase ledger row before updating `profiles.wallet_balance`. The `trg_evaluate_customer_ledger_suspension_insert` trigger evaluated the wallet during this gap and could put a funded customer into wallet review.
- The wallet engine, transaction guard, fraud evaluator, and admin view capped gross debits at trusted principal before subtracting refunds. A refund could therefore make overspent funds appear spendable again.
- The admin fraud view recalculated historical funding from raw labels rather than reading the database's captured `wallet_legacy_funding` baseline. Its new admin credit check also lacked the database's approval metadata checks.
- The previous staging concurrency fixture expected an excess displayed balance to suspend the customer. It now expects an over-backed purchase to decline without posting a debit or suspending the independently backed portion. The real PostgreSQL fixture is still NOT RUN here.
- The wallet engine's fixed search path could not resolve `pgcrypto.digest` when pgcrypto lived in Supabase's `extensions` schema, interrupting Ercas and PocketFi credits.
- The former Fraud Review browser scan treated missing payment evidence as zero and could label an uncovered wallet hold "Review to unblock." The admin user-detail screen, Fraud Review, and purchase paths now have a shared database financial-truth contract; the web UI fails visibly if that evidence read fails.
- Owner-email-only authorization in `manage-staff` and `revenue-os-maintenance` could survive removal of the database admin role. Both now require the current admin role.
- The owner email was also embedded in current server source and an old manual SQL script. Current source now uses server-only `TALLYSTORE_OWNER_USER_ID` for the two owner-only functions while retaining a live admin-role check; the manual script requires an explicitly reviewed UUID. Old Git commits may still expose the former address, so this change does not erase historical exposure.
- Browser-written or header-derived `site_visits` could be mistaken for trusted IP evidence and converted into shared IP/device bans. New browser writes and automatic ban creation are closed; existing bans require review.
- Anonymous reads exposed the referral graph and internal `app_settings` values. New migrations replace the referral row read with a caller-bound count and restrict settings to required storefront keys.
- The public activity RPC exposed exact deposit/order amounts and timestamps despite masking names. Browser execution is revoked and the public feed is no longer mounted; customer-owned history is unchanged.
- Current-admin status is checked when old `admin_credit` rows are counted as trusted principal (`trusted_principal_for_user` and the admin scan). Revoking an approver's admin role later can remove an otherwise legitimate historical credit from the calculated principal. Preserve approval evidence and review affected credits before changing this rule; a current role flag is not historical authorization proof.

## Deployment order (owner)

1. Revoke and rotate every provider and supplier credential in the public `.env` immediately. The committed file contains the names `VITE_ERCASPAY_API_KEY`, `VITE_ERCASPAY_SECRET_KEY`, `VITE_POCKETFI_API_TOKEN`, `POCKETFI_SECRET_KEY`, and `MUABANVIA_API_KEY`; assess the other provider identifiers in that file as well. GitHub currently serves that file from the public main branch. Do not paste replacement values into the repository or a `VITE_` variable. Preserve incident evidence in a restricted location, then push the staged removal of `.env` and the deletion of the old preview HTML; confirm both public GitHub file URLs return 404. Old commits and clones still contain the old values, so rotation is mandatory.
2. Preserve affected profile, transaction, payment, review, webhook, and supplier records and note deployed versions.
3. Review and apply the eighteen `20260924` migrations in order through `17000_restrict_public_sales_aggregates`. The `06000` migration creates the canonical reader, `07000` routes principal/review through it, `08000` patches purchase/reservation/capture/release functions, `09000` routes the purchase insert trigger through it, `10000` adds admin-only investigation telemetry, `11000` removes email-based audit read exceptions, `12000` makes refund-to-debit matching strict and shared by the reader and writers, `13000` removes public policies from retired SQL Editor scripts, `14000` binds browser CRO decision rows to the caller, `15000` removes browser INSERT access to admin security alerts, `16000` keeps balance-neutral admin repair evidence out of posted ledger totals, and `17000` separates public order/popularity counts from staff revenue. The function-body patches abort on unexpected deployed definitions. Keep paid fulfillment paused throughout mixed-version deployment; confirm each migration in staging first. A commit alone deploys none of them.
4. Before deploying `admin-adjust-balance` and `manage-staff`, configure the server-only `TALLYSTORE_OWNER_USER_ID` as the reviewed owner's `auth.users.id` UUID. These owner-only actions fail closed when it is absent; they also require the current `profiles.is_admin` role. Do not put this ID in `VITE_` variables or commit it. Then deploy every changed function in `wallet-deployment-manifest.md`, including those two, `webhook-pocketfi`, `smm-check-status`, `smm-check-all-orders`, `smsbus`, `validate-bank-account`, `create-pocketfi-topup`, `revenue-os-maintenance`, `record-site-visit`, and `email`. Deploy the frontend and the Vercel API routes `webhook-istar` and `webhook-pocketfi`. Keep older workers and routes from serving orders during replacement.
5. Configure email broadcast cron with a service-role Authorization header, or a server-only `EMAIL_BROADCAST_CRON_SECRET` in `x-cron-secret` where the Edge gateway configuration allows that request through. A public anon JWT alone is not enough. Anonymous cron calls now fail closed. Configure PocketFi and SMS webhook verification using provider signatures or headers, never URL tokens. Rotate webhook secrets that may have appeared in request URLs or logs.
6. Before retrying failed gateway notifications, verify by canonical provider reference whether each payment was already credited. Retry only uncredited eligible payments through the provider's normal verified path. A failed webhook response alone does not establish whether an earlier delivery credited the same reference.
7. Verify a funded test account can buy without entering wallet review; a zero-funded account with an honest zero balance receives a normal decline; a zero-funded account with a fabricated displayed balance cannot buy; a displayed ₦100,000 with ₦70,000 independently backed can spend at most ₦70,000; and a correctly linked refund does not create principal. Check the public account view as anon and the activity RPC for identifiers, and verify direct inventory reads remain denied to ordinary customers.
8. Review existing active `fraud_device_bans` against independent evidence. New account suspensions no longer turn visit headers into shared IP/device bans, and the updated purchase guards apply a ban only to its recorded `banned_user_id`. Deploy all changed Edge routes before claiming this behavior is active. Do not bulk-delete historical ban evidence.

## Read-only production checks

```sql
SELECT wallet_review_required, account_suspended, count(*)
FROM public.profiles
GROUP BY 1, 2
ORDER BY 1, 2;

SELECT id, wallet_balance, wallet_review_required, wallet_review_reason
FROM public.profiles
WHERE wallet_review_required = true
ORDER BY updated_at DESC
LIMIT 50;

SELECT n.nspname AS digest_schema, p.proname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname = 'digest';

SELECT
  has_table_privilege('authenticated', 'public.wallet_legacy_funding', 'INSERT') AS customer_can_insert_baseline,
  has_table_privilege('authenticated', 'public.wallet_legacy_funding', 'UPDATE') AS customer_can_update_baseline,
  has_table_privilege('service_role', 'public.wallet_legacy_funding', 'UPDATE') AS service_can_update_baseline;

SELECT pg_get_functiondef(
  'public.evaluate_customer_ledger_suspension_from_transaction()'::regprocedure
);

SELECT
  has_table_privilege('anon', 'public.site_visits', 'INSERT') AS anon_can_insert_visits,
  has_table_privilege('authenticated', 'public.site_visits', 'INSERT') AS customer_can_insert_visits,
  has_table_privilege('anon', 'public.referral_lookup', 'SELECT') AS anon_can_read_referral_graph,
  has_table_privilege('authenticated', 'public.referral_lookup', 'SELECT') AS customer_can_read_referral_graph,
  has_function_privilege('authenticated', 'public.get_my_referral_count()', 'EXECUTE') AS customer_can_count_own_referrals;

SELECT policyname, roles, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('app_settings', 'site_visits', 'referral_lookup')
ORDER BY tablename, policyname;

SELECT count(*) AS active_historical_device_bans
FROM public.fraud_device_bans
WHERE active = true;

SELECT
  has_function_privilege('anon', 'public.get_recent_activity_feed(integer)', 'EXECUTE') AS anonymous_can_read_activity,
  has_function_privilege('authenticated', 'public.get_recent_activity_feed(integer)', 'EXECUTE') AS customer_can_read_activity;
-- Both values must be false after 20260924005000 is applied.

SELECT
  has_function_privilege('authenticated', 'public.wallet_financial_truth_internal(uuid)', 'EXECUTE') AS customer_can_call_internal_truth,
  has_function_privilege('authenticated', 'public.get_admin_wallet_financial_truth(uuid)', 'EXECUTE') AS signed_in_can_call_admin_wrapper;
-- Expected: false, true. The wrapper itself rejects non-admin auth.uid().

SELECT proname, pg_get_functiondef(oid) AS definition
FROM pg_proc
WHERE oid IN (
  'public.wallet_financial_truth_internal(uuid)'::regprocedure,
  'public.evaluate_customer_ledger_suspension(uuid,numeric)'::regprocedure,
  'public.apply_wallet_transaction(uuid,text,numeric,text,text,text,jsonb,text,text,text,uuid)'::regprocedure,
  'public.create_wallet_reservation(uuid,numeric,text,uuid,text,jsonb,text,integer,timestamptz)'::regprocedure
);
-- Review that each deployed financial decision calls wallet_financial_truth_internal.
```

## Limits

Repository checks do not prove these migrations are deployed. The legacy baseline is a historical snapshot of pre-cutoff wallet credit rows; it is not independent provider confirmation for every old payment. Accounts with unexplained funding still require individual evidence review. Existing holds outside the exact reconciled automatic class remain in place. The `12000` refund matcher can reclassify historical refunds that carry contradictory identifiers; run read-only query #19 in `wallet-readonly-query-pack.sql` on staging and review customer impact before applying it live. The product-authorization RPC still relies on its service-role caller for the discounted price; the current purchase route computes that price server-side, but an independent database price check remains unverified. Do not reopen alternate callers until staging tests prove they cannot undercharge.

Fraud Review pages include staff/admin financial anomalies in a read-only Internal filter; these are investigation signals, not grounds for automatic customer suspension. If an internal login was compromised or its role flag changed, inspect it individually. The activity feed remains callable on a live database until the owner applies the revoke migration; removing it from the frontend alone is insufficient. The local static tests do not compile or execute the dynamic `08000`/`09000`/`12000` function rewrites on PostgreSQL; keep affected routes paused until staging execution and owner verification pass.

Four old manual SQL Editor RLS repair scripts could reopen broad
`app_settings` reads, browser-written visit evidence, public CRO/chat
analytics access, and cross-user revenue-event writes. They are now no-ops.
Migration `13000` closes the known policies even if the old scripts were
previously run.
Run read-only query #20 in `wallet-readonly-query-pack.sql` on the deployed
database; repository source alone cannot show whether an older copy was run.
Run query #21 as well to confirm the unrestricted CRO decision INSERT policy
has been replaced; old browser decision rows remain unverified observations.

## Public exposure checked on 24 September 2026

- The GitHub repository was publicly readable, and its current branch returned `.env` and the old preview HTML. The first commit also contains the same live/production-marked provider and supplier credential values found in the local `.env`. Rotation is required even after the files are removed from the current branch.
- `https://tallystore.org/.env`, the old preview URL, and a source-file URL returned the normal SPA HTML shell, not those files. The website result does not mitigate the GitHub exposure.
- The live JavaScript contained the owner email in two browser-side constants. The fresh local build no longer contains it. The live bundle contained one public anon JWT and no exact match for the known committed provider keys or token-shaped server key in the patterns checked. This is not a complete secret scan of every historical deployment.
- Production database policies, Edge Function versions, authenticated responses, provider settings, and supplier accounts were not accessed or verified. Apply the reviewed migrations and deploy the patched server/frontend code before claiming the live leaks are closed.
