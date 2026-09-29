# Historical admin funding recovery

## Finding

An earlier repository version of `admin-adjust-balance` changed
`profiles.wallet_balance` before inserting a transaction. A failed transaction
insert was logged, but the function still returned success. This is a concrete
source path for an admin-approved balance addition with no ledger credit. It is
not proof that this version was deployed when a particular customer balance
changed; deployed function history or live logs are needed for attribution.

An older `manage-staff` balance-adjustment action had the same ordering:
profile balance first, transaction insert second. One version inserted
`type = 'adjustment'`, while a later checked transaction-type list omitted
`adjustment`. If those exact versions overlapped in deployment, the ledger
insert would fail after the balance changed. This is a conditional source-code
finding, not attribution for any account.

The current edge function uses `apply_wallet_transaction` for new adjustments.
The separate `record_ledger_credit` action is evidence-only: its balance-neutral
row is intentionally excluded from trusted principal and expected balance. It
cannot repair missing trusted funding.

## Owner evidence check

Run the following read-only queries in the SQL Editor, replacing the UUID for
one customer at a time. Preserve the result and query time before any repair.
Do not combine an owner Gmail account with any similarly named Boxfi account.

```sql
SELECT id, created_at, type, status, amount, balance_before, balance_after,
       reference, created_by, metadata->>'source' AS source,
       metadata->>'approval_reference' AS approval_reference
FROM public.transactions
WHERE user_id = 'REPLACE_WITH_EXACT_USER_UUID'::uuid
  AND COALESCE(balance_type, 'wallet') = 'wallet'
ORDER BY created_at, id;
```

This second query identifies where consecutive recorded balance snapshots stop
connecting. It does not identify the writer or prove the missing movement was
an admin credit. The first available row has no prior snapshot to compare.

```sql
WITH posted AS (
  SELECT t.id, t.created_at, t.type, t.amount, t.balance_before,
         t.balance_after,
         CASE
           WHEN t.amount < 0 OR lower(COALESCE(t.type, '')) IN (
             'purchase', 'admin_debit', 'staff_debit', 'debit',
             'withdrawal', 'chargeback', 'correction_debit'
           ) THEN -abs(t.amount)
           ELSE abs(t.amount)
         END AS signed_amount
  FROM public.transactions t
  WHERE t.user_id = 'REPLACE_WITH_EXACT_USER_UUID'::uuid
    AND COALESCE(t.balance_type, 'wallet') = 'wallet'
    AND lower(COALESCE(t.status, 'completed')) IN (
      'completed', 'success', 'successful', 'credited',
      'complete', 'paid', 'finished'
    )
), ordered AS (
  SELECT posted.*,
         lag(balance_after) OVER (ORDER BY created_at, id) AS previous_after
  FROM posted
)
SELECT id, created_at, type, amount, previous_after,
       COALESCE(balance_before, balance_after - signed_amount) AS implied_before,
       COALESCE(balance_before, balance_after - signed_amount) - previous_after
         AS unexplained_snapshot_jump
FROM ordered
WHERE previous_after IS NOT NULL
  AND balance_after IS NOT NULL
  AND abs(COALESCE(balance_before, balance_after - signed_amount)
          - previous_after) >= 0.01
ORDER BY created_at, id;
```

```sql
SELECT changed_at, old_wallet_balance, new_wallet_balance, changed_by,
       changed_role
FROM public.profile_balance_audit
WHERE profile_id = 'REPLACE_WITH_EXACT_USER_UUID'::uuid
ORDER BY changed_at, id;
```

The audit trigger was added after some historical balance changes. No audit
row is not evidence that an admin addition never happened. Compare account
history with owner records, older edge-function logs, and the profile/ledger
snapshots. A ledger gap is an investigation amount, not an automatic approval.

```sql
SELECT public.wallet_financial_truth_internal(
  'REPLACE_WITH_EXACT_USER_UUID'::uuid
) AS truth;
```

## Recovery sequence

1. Confirm each actual historical admin addition, its amount, recipient,
   approver, approximate time, and owner case/reference from independent
   evidence. Do not use `stored_wallet_balance - expected_ledger_balance` as
   the amount without that review.
2. Apply `20260928000000_record_approved_historical_admin_funding.sql` after
   the canonical financial-truth migrations, then apply
   `20260928001000_allow_reviewed_historical_wallet_deficits.sql`. Neither
   migration inserts customer funding or clears a wallet hold by itself.
3. The database owner inserts one row per confirmed old credit into
   `wallet_historical_admin_funding`. That table is not writable by customer,
   service, or edge-function roles. The row is an append-only recovery of value
   already present in the displayed balance; it must never update the balance
   again. Use a unique owner case reference and specific evidence note.
4. Re-run the canonical truth for the exact account. Recovered funding appears
   in both `approved_admin_credits` and the separate
   `approved_historical_admin_credits` field; compare these with pre-existing
   ledger admin-credit rows. Unlinked refunds remain outside trusted
   restoration. A positive unexplained difference still blocks review
   resolution. A negative difference is a stored-balance deficit that must be
   retained and investigated, not silently converted to an admin debit. Any
   purchase stays capped by the lower stored and backed balances, less holds.
5. Only after a separate review, call
   `resolve_reviewed_historical_admin_funding(user_id, approval_reference,
   review_note)` as the database owner. It requires an existing historical
   approval, an automatic wallet-review reason, complete canonical evidence,
   no positive unexplained gap or negative trusted book, and a fresh purchase-gate
   check. It does not clear manual account suspension. The resolution snapshot
   is retained in `wallet_historical_review_resolutions`.
6. Verify the exact account through the application and a no-cost/sandbox
   purchase path before reopening affected paid fulfillment. Inspect old queued
   orders separately; a released wallet is not authorization to replay them.

The production operator must separately verify that the deployed database
definition, edge-function build, grants, and active supplier routes match the
repository. No production customer record is changed by repository tests.
