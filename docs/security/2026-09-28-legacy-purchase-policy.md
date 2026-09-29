# Legacy Purchase Policy Change (28 September 2026)

This is an owner-controlled operational change, not evidence that every old
wallet balance was verified. No production SQL, Edge deployment, or Vercel
deployment was performed by the repository work.

## Rule

- An account with no recorded gateway deposit, approved admin credit, or
  reviewed legacy funding has zero purchase capacity, regardless of its
  displayed wallet balance. An attempt declines before supplier dispatch.
- A customer created on or after the legacy cutoff uses canonical confirmed
  funds, less active holds. A positive balance alone does not authorize it.
- A customer with protected pre-cutoff wallet activity or profile history and
  recorded funding may buy up to the stored wallet balance, less active holds.
  This deliberately tolerates incomplete historical
  credit records. It does **not** prove every portion of that balance was paid.
- An ordinary insufficient-funds attempt declines without suspending the
  account or hiding order, deposit, and transaction history.
- Existing manual account suspensions and reviewer-set wallet holds remain
  effective. Automatic wallet-review writes stop; system-generated
  wallet-review flags are cleared. No balance,
  ledger, payment, refund, or supplier record is deleted or modified.
- Partner API and unrelated fulfillment pause switches remain paused.

This policy trades some historic balance-provenance protection for avoiding
false customer blocks. A pre-cutoff account with any recorded principal and an
inflated stored balance could spend that inflated value. Monitor that risk and
do not describe the resulting purchase limit as fully verified funding.

## Owner rollout

1. Preserve a read-only export of current profile hold counts, wallet balances,
   financial truth for affected users, and supplier/queue exposure.
2. Review migration `20260928002000_stop_automatic_fraud_holds.sql` and all
   preceding unapplied migrations in timestamp order. Apply in Supabase SQL
   Editor only after checking the deployed definitions and backup. The patch
   aborts if its canonical function anchors are different.
3. Deploy matching Supabase Edge Functions, including product, SMM, SMS,
   Telegram, bills, Bitrefill, and crypto-sell routes. Retire old versions that
   still call device-ban or wallet-review gates. Deploy the matching Vercel UI.
4. Check an owner-controlled old funded account, an owner-controlled new
   unfunded account, an old no-funding account, and a manually suspended
   account. Do not create a fake funded wallet in production. Use staging for
   hostile balance tests and supplier-call assertions.
5. Keep product fulfillment paused until the purchase/dispatch gates and
   supplier outcomes are verified for each route. Do not blindly replay old
   queue messages or release unknown-outcome holds.

Read-only post-migration checks:

```sql
SELECT count(*) FILTER (WHERE wallet_review_required) AS review_flags_remaining,
       count(*) FILTER (WHERE account_suspended) AS manual_or_unresolved_suspensions,
       count(*) FILTER (
         WHERE wallet_review_required
           AND wallet_reviewed_by IS NULL
           AND (
             wallet_review_reason LIKE 'Auto-suspended:%'
             OR wallet_review_reason LIKE 'Wallet frozen:%'
             OR wallet_review_reason LIKE 'Wallet financial review:%'
             OR wallet_review_reason LIKE 'Wallet integrity review:%'
           )
       ) AS automatic_review_flags_remaining
FROM public.profiles;
```

```sql
SELECT p.id, p.email, p.created_at, p.wallet_balance,
       t.truth->>'authorization_basis' AS authorization_basis,
       (t.truth->>'trusted_principal')::numeric AS recorded_principal,
       (t.truth->>'active_reservations')::numeric AS active_holds,
       (t.truth->>'confirmed_spendable')::numeric AS purchase_limit,
       (t.truth->>'spending_blocked')::boolean AS spending_blocked,
       p.account_suspended, p.wallet_review_required
FROM public.profiles p
CROSS JOIN LATERAL (
  SELECT public.wallet_financial_truth_internal(p.id) AS truth
) t
WHERE p.id = 'REPLACE_WITH_ONE_OWNER_CONTROLLED_USER_ID'::uuid;
```

The two owner-controlled accounts are not silently exempted by email or role.
One has recorded legacy principal and can use the legacy rule after the
migration. The other had no recorded principal in the supplied read-only
result; the owner's admin-funding attestation must be recorded as an approved
credit before this no-funding rule permits spending. Do not include the
separately identified abusive account in that approval. The guarded private
owner-attested recovery SQL is not part of this migration and must not be run
without reviewing its exact account IDs, amounts, and preflight output.
