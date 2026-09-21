-- Wallet incident read-only query pack.
-- Replace :user_id, :email, and time windows in the Supabase SQL editor.
-- Do not run corrective UPDATE/DELETE statements as part of evidence gathering.

-- 1. Find a customer by email/id and compare stored balances to profile flags.
select
  p.id,
  p.email,
  p.full_name,
  p.wallet_balance,
  p.crypto_balance,
  p.referral_balance,
  p.is_admin,
  p.is_staff,
  p.account_suspended,
  p.suspension_reason,
  p.suspended_at,
  p.created_at,
  p.updated_at
from public.profiles p
where lower(p.email) = lower(:email)
   or p.id::text = :user_id;

-- 2. Full wallet ledger for one user, newest first.
select
  t.id,
  t.created_at,
  t.type,
  t.status,
  t.amount,
  t.balance_before,
  t.balance_after,
  t.balance_type,
  t.currency,
  t.reference,
  t.external_payment_id,
  t.idempotency_key,
  t.description,
  t.created_by,
  t.metadata
from public.transactions t
where t.user_id = :user_id::uuid
order by t.created_at desc, t.id desc;

-- 3. Authoritative wallet backing calculation used by the P0 purchase gate.
with wallet_tx as (
  select *
  from public.transactions
  where user_id = :user_id::uuid
    and coalesce(balance_type, 'wallet') = 'wallet'
    and coalesce(status, 'completed') = 'completed'
),
calc as (
  select
    coalesce(sum(t.amount) filter (
      where t.amount > 0
        and (
          (
            t.type in (
              'topup', 'top_up', 'top-up', 'wallet_topup', 'wallet_deposit',
              'deposit'
            )
            and nullif(trim(coalesce(t.external_payment_id, '')), '') is not null
            and coalesce(t.metadata->>'verified_amount_ngn', '') ~ '^[0-9]+(\.[0-9]{1,2})?$'
            and round((t.metadata->>'verified_amount_ngn')::numeric, 2) = round(t.amount, 2)
            and (
              (
                lower(coalesce(t.metadata->>'provider', '')) in ('ercaspay', 'ercas')
                and exists (
                  select 1
                  from public.pending_payments pp
                  where pp.user_id = t.user_id
                    and round(pp.amount, 2) = round(t.amount, 2)
                    and lower(coalesce(pp.status, 'pending')) = 'credited'
                    and (
                      pp.transaction_reference = nullif(trim(coalesce(t.reference, '')), '')
                      or pp.transaction_reference = nullif(trim(coalesce(t.external_payment_id, '')), '')
                      or pp.ercas_reference = nullif(trim(coalesce(t.external_payment_id, '')), '')
                    )
                )
              )
              or (
                lower(coalesce(t.metadata->>'provider', '')) = 'pocketfi'
                and coalesce(t.metadata->>'webhook_log_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                and exists (
                  select 1
                  from public.pocketfi_webhook_logs pwl
                  where pwl.id = (t.metadata->>'webhook_log_id')::uuid
                    and pwl.matched_user_id = t.user_id
                    and coalesce(pwl.processed, false) = true
                    and round(coalesce(pwl.verified_amount_ngn, -1), 2) = round(t.amount, 2)
                    and nullif(trim(coalesce(pwl.verified_reference, '')), '') in (
                      nullif(trim(coalesce(t.reference, '')), ''),
                      nullif(trim(coalesce(t.external_payment_id, '')), '')
                    )
                )
              )
            )
          )
          or (
            t.type = 'admin_credit'
            and coalesce(t.balance_after, 0) > coalesce(t.balance_before, 0)
            and coalesce(t.metadata->>'source', '') <> 'admin-ledger-repair'
            and coalesce(t.metadata->>'balance_unchanged', '') <> 'true'
            and coalesce(t.metadata->>'requires_owner_evidence', '') <> 'true'
            and coalesce(t.metadata->>'approved_by', '') = t.created_by::text
            and length(btrim(coalesce(t.metadata->>'approval_reference', ''))) >= 8
            and length(btrim(coalesce(t.metadata->>'reason', ''))) >= 3
            and t.created_by in (
              select id
              from public.profiles
              where coalesce(is_admin, false) = true
            )
          )
        )
    ), 0) as trusted_credits,
    coalesce(sum(abs(t.amount)) filter (
      where t.type in (
          'purchase', 'admin_debit', 'staff_debit', 'debit',
          'withdrawal', 'chargeback', 'correction_debit'
        )
    ), 0) as wallet_debits
  from wallet_tx t
),
eligible_refund_matches as (
  select distinct on (r.id)
    r.id as refund_id,
    r.amount as refund_amount,
    d.id as debit_id,
    least(
      abs(coalesce(d.amount, 0)),
      case
        when coalesce(d.metadata->>'trusted_principal_debit_amount', '') ~ '^[0-9]+(\.[0-9]{1,2})?$'
        then (d.metadata->>'trusted_principal_debit_amount')::numeric
        else 0
      end
    ) as debit_amount
  from wallet_tx r
  join wallet_tx d
    on d.user_id = r.user_id
   and d.amount < 0
   and d.type in (
     'purchase', 'admin_debit', 'staff_debit', 'debit',
     'withdrawal', 'chargeback', 'correction_debit'
   )
   and coalesce(d.metadata->>'trusted_principal_authorized', '') = 'true'
   and coalesce(d.metadata->>'trusted_principal_debit_amount', '') ~ '^[0-9]+(\.[0-9]{1,2})?$'
   and (d.metadata->>'trusted_principal_debit_amount')::numeric > 0
   and (
     nullif(trim(coalesce(r.metadata->>'source_debit_transaction_id', '')), '') = d.id::text
     or (
       nullif(trim(coalesce(d.idempotency_key, '')), '') is not null
       and nullif(trim(coalesce(
         r.metadata->>'source_debit_idempotency_key',
         r.metadata->>'original_purchase_idempotency_key',
         ''
       )), '') = d.idempotency_key
     )
     or (
       nullif(trim(coalesce(
         r.metadata->>'source_order_id',
         r.metadata->>'order_id',
         r.metadata->>'transaction_id',
         ''
       )), '') is not null
       and nullif(trim(coalesce(
         r.metadata->>'source_order_id',
         r.metadata->>'order_id',
         r.metadata->>'transaction_id',
         ''
       )), '') in (
         nullif(trim(coalesce(d.metadata->>'source_order_id', '')), ''),
         nullif(trim(coalesce(d.metadata->>'order_id', '')), ''),
         nullif(trim(coalesce(d.metadata->>'transaction_id', '')), '')
       )
       and (
         nullif(trim(coalesce(r.metadata->>'source_order_table', '')), '') is null
         or nullif(trim(coalesce(r.metadata->>'source_order_table', '')), '') = nullif(trim(coalesce(d.metadata->>'source_order_table', '')), '')
       )
     )
     or (
       nullif(trim(coalesce(r.metadata->>'original_reference', '')), '') is not null
       and nullif(trim(coalesce(r.metadata->>'original_reference', '')), '') = nullif(trim(coalesce(d.reference, '')), '')
     )
   )
  where r.amount > 0
    and r.type in ('refund', 'purchase_refund', 'auto_refund')
  order by
    r.id,
    case
      when nullif(trim(coalesce(r.metadata->>'source_debit_transaction_id', '')), '') = d.id::text then 0
      when nullif(trim(coalesce(d.idempotency_key, '')), '') is not null
        and nullif(trim(coalesce(
          r.metadata->>'source_debit_idempotency_key',
          r.metadata->>'original_purchase_idempotency_key',
          ''
        )), '') = d.idempotency_key then 1
      else 2
    end,
    d.created_at desc,
    d.id desc
),
capped_refunds_by_debit as (
  select
    debit_id,
    debit_amount,
    sum(refund_amount) as refund_amount
  from eligible_refund_matches
  group by debit_id, debit_amount
),
refund_calc as (
  select coalesce(sum(least(refund_amount, debit_amount)), 0) as linked_eligible_refunds
  from capped_refunds_by_debit
)
select
  p.id as user_id,
  p.wallet_balance as stored_wallet_balance,
  c.trusted_credits,
  c.wallet_debits,
  r.linked_eligible_refunds,
  least(c.wallet_debits, c.trusted_credits) as trusted_debit_capacity,
  least(r.linked_eligible_refunds, least(c.wallet_debits, c.trusted_credits)) as eligible_refunds,
  greatest(least(c.wallet_debits, c.trusted_credits) - least(r.linked_eligible_refunds, least(c.wallet_debits, c.trusted_credits)), 0) as trusted_consumed_spend,
  greatest(c.trusted_credits - greatest(least(c.wallet_debits, c.trusted_credits) - least(r.linked_eligible_refunds, least(c.wallet_debits, c.trusted_credits)), 0), 0) as backed_available
from public.profiles p
cross join calc c
cross join refund_calc r
where p.id = :user_id::uuid;

-- 4. Duplicate payment/reference checks.
select
  reference,
  type,
  count(*) as rows,
  array_agg(user_id order by created_at) as user_ids,
  min(created_at) as first_seen,
  max(created_at) as last_seen,
  sum(amount) as total_amount
from public.transactions
where reference is not null
group by reference, type
having count(*) > 1
order by last_seen desc;

select
  idempotency_key,
  count(*) as rows,
  array_agg(user_id order by created_at) as user_ids,
  count(distinct concat_ws('|',
    user_id::text,
    coalesce(type, ''),
    coalesce(balance_type, 'wallet'),
    coalesce(amount, 0)::text,
    coalesce(reference, ''),
    coalesce(currency, 'NGN'),
    coalesce(external_payment_id, '')
  )) as distinct_financial_shapes,
  min(created_at) as first_seen,
  max(created_at) as last_seen
from public.transactions
where idempotency_key is not null
group by idempotency_key
having count(*) > 1
order by last_seen desc;

-- 4b. Idempotency keys reused with different financial shapes are unsafe.
select
  idempotency_key,
  count(*) as rows,
  count(distinct concat_ws('|',
    user_id::text,
    coalesce(type, ''),
    coalesce(balance_type, 'wallet'),
    coalesce(amount, 0)::text,
    coalesce(reference, ''),
    coalesce(currency, 'NGN'),
    coalesce(external_payment_id, '')
  )) as distinct_financial_shapes,
  array_agg(id order by created_at, id) as transaction_ids,
  min(created_at) as first_seen,
  max(created_at) as last_seen
from public.transactions
where idempotency_key is not null
group by idempotency_key
having count(distinct concat_ws('|',
    user_id::text,
    coalesce(type, ''),
    coalesce(balance_type, 'wallet'),
    coalesce(amount, 0)::text,
    coalesce(reference, ''),
    coalesce(currency, 'NGN'),
    coalesce(external_payment_id, '')
  )) > 1
order by last_seen desc;

-- 5. Orders completed without an obvious matching purchase ledger entry.
select
  o.id as order_id,
  o.user_id,
  o.created_at,
  o.amount,
  o.status,
  o.idempotency_key
from public.orders o
left join public.transactions t
  on t.user_id = o.user_id
 and t.type = 'purchase'
 and coalesce(t.status, 'completed') = 'completed'
 and (
      t.idempotency_key = 'purchase:' || o.idempotency_key
      or abs(abs(t.amount) - coalesce(o.amount, 0)) < 0.01
    )
where o.status = 'completed'
  and t.id is null
order by o.created_at desc
limit 500;

-- 5b. Purchase ledger debits that have no matching order. These are blocked
-- from checkout retry because a failed order rollback may already have refunded
-- the debit; each row needs owner/admin review before any delivery.
select
  t.id as transaction_id,
  t.user_id,
  t.created_at,
  t.amount,
  t.status,
  t.balance_after,
  t.reference,
  t.idempotency_key,
  t.description
from public.transactions t
left join public.orders o
  on o.user_id = t.user_id
 and o.idempotency_key = regexp_replace(t.idempotency_key, '^purchase:', '')
where t.type = 'purchase'
  and coalesce(t.status, 'completed') = 'completed'
  and t.idempotency_key like 'purchase:%'
  and o.id is null
order by t.created_at desc
limit 500;

-- 5c. SMM/social purchase ledger debits that have no matching SMM order.
-- These are blocked from retrying into a fresh provider order.
select
  t.id as transaction_id,
  t.user_id,
  t.created_at,
  t.amount,
  t.status,
  t.balance_after,
  t.reference,
  t.idempotency_key,
  t.description
from public.transactions t
left join public.smm_orders o
  on o.user_id = t.user_id
 and o.idempotency_key = regexp_replace(t.idempotency_key, '^smm:purchase:', '')
where t.type = 'purchase'
  and coalesce(t.status, 'completed') = 'completed'
  and t.idempotency_key like 'smm:purchase:%'
  and o.id is null
order by t.created_at desc
limit 500;

-- 5d. SMS purchase ledger debits that have no matching SMS order.
-- These are blocked from retrying into a fresh DaisySMS provider acquisition.
select
  t.id as transaction_id,
  t.user_id,
  t.created_at,
  t.amount,
  t.status,
  t.balance_after,
  t.reference,
  t.idempotency_key,
  t.description
from public.transactions t
left join public.sms_orders o
  on o.user_id = t.user_id
 and o.idempotency_key = regexp_replace(t.idempotency_key, '^sms:purchase:', '')
where t.type = 'purchase'
  and coalesce(t.status, 'completed') = 'completed'
  and t.idempotency_key like 'sms:purchase:%'
  and o.id is null
order by t.created_at desc
limit 500;

-- 5e. Bills purchase ledger debits that have no matching bills transaction.
-- Bills currently creates the local transaction before debiting, so rows here
-- indicate legacy damage, manual database edits, or a failed/partial migration.
select
  t.id as transaction_id,
  t.user_id,
  t.created_at,
  t.amount,
  t.status,
  t.balance_after,
  t.reference,
  t.idempotency_key,
  t.description
from public.transactions t
left join public.bills_transactions b
  on b.user_id = t.user_id
 and b.idempotency_key = regexp_replace(t.idempotency_key, '^bills:purchase:', '')
where t.type = 'purchase'
  and coalesce(t.status, 'completed') = 'completed'
  and t.idempotency_key like 'bills:purchase:%'
  and b.id is null
order by t.created_at desc
limit 500;

-- 5f. Bitrefill gift card/eSIM purchase debits that have no matching order.
select
  t.id as transaction_id,
  t.user_id,
  t.created_at,
  t.amount,
  t.status,
  t.balance_after,
  t.reference,
  t.idempotency_key,
  t.description
from public.transactions t
left join public.bitrefill_orders b
  on b.user_id = t.user_id
 and b.idempotency_key = regexp_replace(t.idempotency_key, '^bitrefill:purchase:', '')
where t.type = 'purchase'
  and coalesce(t.status, 'completed') = 'completed'
  and t.idempotency_key like 'bitrefill:purchase:%'
  and b.id is null
order by t.created_at desc
limit 500;

-- 5g. Withdrawal debit ledger rows that have no matching withdrawal record.
select
  t.id as transaction_id,
  t.user_id,
  t.created_at,
  t.amount,
  t.status,
  t.balance_after,
  t.reference,
  t.idempotency_key,
  t.description
from public.transactions t
left join public.crypto_withdrawals w
  on w.user_id = t.user_id
 and 'withdrawal:' || w.id::text = t.idempotency_key
where t.type = 'withdrawal'
  and coalesce(t.status, 'completed') = 'completed'
  and t.idempotency_key like 'withdrawal:%'
  and w.id is null
order by t.created_at desc
limit 500;

-- 5h. Failed/cancelled/refunded product orders that still have posted purchase
-- debits. A posted debit can be legitimate if a matching refund exists; rows
-- with unresolved_debit_amount > 0 need review before any retry or delivery.
select
  o.id as order_id,
  o.user_id,
  o.created_at,
  o.status,
  o.amount as order_amount,
  o.idempotency_key,
  d.posted_debits,
  r.posted_refunds,
  greatest(d.posted_debits - r.posted_refunds, 0) as unresolved_debit_amount,
  d.debit_transaction_ids,
  r.refund_transaction_ids
from public.orders o
left join lateral (
  select
    coalesce(sum(abs(d.amount)), 0) as posted_debits,
    array_remove(array_agg(d.id), null) as debit_transaction_ids
  from public.transactions d
  where d.user_id = o.user_id
    and d.type = 'purchase'
    and coalesce(d.status, 'completed') = 'completed'
    and d.idempotency_key = 'purchase:' || o.idempotency_key
) d on true
left join lateral (
  select
    coalesce(sum(abs(r.amount)), 0) as posted_refunds,
    array_remove(array_agg(r.id), null) as refund_transaction_ids
  from public.transactions r
  where r.user_id = o.user_id
    and r.type in ('refund', 'purchase_refund', 'auto_refund')
    and coalesce(r.status, 'completed') = 'completed'
    and r.metadata->>'source_order_table' = 'orders'
    and r.metadata->>'source_order_id' = o.id::text
) r on true
where lower(coalesce(o.status, '')) in ('failed', 'cancelled', 'canceled', 'refunded', 'refund_posted', 'refund_pending')
  and d.posted_debits > 0
order by unresolved_debit_amount desc, o.created_at desc
limit 500;

-- 5i. Failed/cancelled/refunded SMM orders with posted purchase debits.
select
  o.id as smm_order_id,
  o.user_id,
  o.created_at,
  o.status,
  o.amount_ngn as order_amount,
  o.idempotency_key,
  d.posted_debits,
  r.posted_refunds,
  greatest(d.posted_debits - r.posted_refunds, 0) as unresolved_debit_amount,
  d.debit_transaction_ids,
  r.refund_transaction_ids
from public.smm_orders o
left join lateral (
  select
    coalesce(sum(abs(d.amount)), 0) as posted_debits,
    array_remove(array_agg(d.id), null) as debit_transaction_ids
  from public.transactions d
  where d.user_id = o.user_id
    and d.type = 'purchase'
    and coalesce(d.status, 'completed') = 'completed'
    and d.idempotency_key = 'smm:purchase:' || o.idempotency_key
) d on true
left join lateral (
  select
    coalesce(sum(abs(r.amount)), 0) as posted_refunds,
    array_remove(array_agg(r.id), null) as refund_transaction_ids
  from public.transactions r
  where r.user_id = o.user_id
    and r.type in ('refund', 'purchase_refund', 'auto_refund')
    and coalesce(r.status, 'completed') = 'completed'
    and r.metadata->>'source_order_table' = 'smm_orders'
    and r.metadata->>'source_order_id' = o.id::text
) r on true
where lower(coalesce(o.status, '')) in ('failed', 'cancelled', 'canceled', 'refunded', 'refund_posted', 'refund_pending')
  and d.posted_debits > 0
order by unresolved_debit_amount desc, o.created_at desc
limit 500;

-- 5j. Failed/cancelled/refunded SMS orders with posted purchase debits.
select
  o.id as sms_order_id,
  o.user_id,
  o.created_at,
  o.status,
  o.charged_price_ngn as order_amount,
  o.idempotency_key,
  d.posted_debits,
  r.posted_refunds,
  greatest(d.posted_debits - r.posted_refunds, 0) as unresolved_debit_amount,
  d.debit_transaction_ids,
  r.refund_transaction_ids
from public.sms_orders o
left join lateral (
  select
    coalesce(sum(abs(d.amount)), 0) as posted_debits,
    array_remove(array_agg(d.id), null) as debit_transaction_ids
  from public.transactions d
  where d.user_id = o.user_id
    and d.type = 'purchase'
    and coalesce(d.status, 'completed') = 'completed'
    and d.idempotency_key = 'sms:purchase:' || o.idempotency_key
) d on true
left join lateral (
  select
    coalesce(sum(abs(r.amount)), 0) as posted_refunds,
    array_remove(array_agg(r.id), null) as refund_transaction_ids
  from public.transactions r
  where r.user_id = o.user_id
    and r.type in ('refund', 'purchase_refund', 'auto_refund')
    and coalesce(r.status, 'completed') = 'completed'
    and r.metadata->>'source_order_table' = 'sms_orders'
    and r.metadata->>'source_order_id' = o.id::text
) r on true
where lower(coalesce(o.status, '')) in ('failed', 'cancelled', 'canceled', 'refunded', 'refund_posted', 'refund_pending')
  and d.posted_debits > 0
order by unresolved_debit_amount desc, o.created_at desc
limit 500;

-- 6. Recent protected profile balance attempts caught by the DB guard.
select *
from public.profile_balance_blocked_attempts
order by created_at desc
limit 500;

-- 7. Recent blocked direct ledger write attempts.
select *
from public.transaction_ledger_blocked_attempts
order by attempted_at desc
limit 500;

-- 8. Standard wallet/security forensic event timeline.
select
  id,
  created_at,
  event_type,
  severity,
  profile_id,
  wallet_user_id,
  actor_user_id,
  actor_role,
  source,
  route,
  db_function,
  request_id,
  idempotency_key,
  operation_reference,
  ip_address,
  user_agent,
  device_fingerprint,
  financial_snapshot,
  result,
  denial_code,
  metadata
from public.wallet_security_events
order by created_at desc
limit 500;

-- 9. Recent profile/account deletion and identity-change audit evidence.
select *
from public.profile_delete_audit
order by attempted_at desc
limit 200;

select *
from public.profile_identity_audit
order by changed_at desc
limit 200;

select *
from public.auth_user_identity_audit
order by changed_at desc
limit 200;

-- 10. Wallet engine function grants. Expected: apply_wallet_transaction and
-- withdraw_referral_balance_to_wallet executable by service_role, not anon or
-- authenticated.
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_arguments(p.oid) as arguments,
  r.rolname as role_name,
  has_function_privilege(r.rolname, p.oid, 'EXECUTE') as can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join (
  select unnest(array['anon', 'authenticated', 'service_role']) as rolname
) r
where n.nspname = 'public'
  and p.proname in (
    'apply_wallet_transaction',
    'withdraw_referral_balance_to_wallet',
    'transfer_crypto_to_wallet',
    'update_wallet_balance',
    'credit_crypto_balance',
    'deduct_crypto_balance'
  )
order by function_name, role_name;

-- 11. Effective table write grants on financial tables for browser roles.
-- Expected: no INSERT/UPDATE/DELETE/TRUNCATE for anon/authenticated on
-- transactions; no direct UPDATE capability on protected profile columns in
-- practice, with triggers also installed as backstop.
select
  grantee,
  table_schema,
  table_name,
  privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'profiles',
    'transactions',
    'individual_accounts',
    'crypto_transactions',
    'crypto_withdrawals',
    'pending_payments',
    'api_partners',
    'api_partner_keys',
    'api_partner_orders',
    'api_partner_logs',
    'api_partner_customers',
    'api_partner_webhook_deliveries'
  )
  and grantee in ('anon', 'authenticated')
  and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
order by table_name, grantee, privilege_type;

-- 10b. Partner tables should not be directly readable or writable by browser
-- roles during the security review. Admin partner management and audit access
-- go through the partner-api Edge Function with service-role access.
select
  table_name,
  has_table_privilege('anon', 'public.' || table_name, 'SELECT') as anon_select,
  has_table_privilege('anon', 'public.' || table_name, 'INSERT') as anon_insert,
  has_table_privilege('anon', 'public.' || table_name, 'UPDATE') as anon_update,
  has_table_privilege('anon', 'public.' || table_name, 'DELETE') as anon_delete,
  has_table_privilege('authenticated', 'public.' || table_name, 'SELECT') as authenticated_select,
  has_table_privilege('authenticated', 'public.' || table_name, 'INSERT') as authenticated_insert,
  has_table_privilege('authenticated', 'public.' || table_name, 'UPDATE') as authenticated_update,
  has_table_privilege('authenticated', 'public.' || table_name, 'DELETE') as authenticated_delete
from unnest(array[
  'api_partners',
  'api_partner_keys',
  'api_partner_orders',
  'api_partner_logs',
  'api_partner_customers',
  'api_partner_webhook_deliveries',
  'pending_payments'
]) as table_name
where to_regclass('public.' || table_name) is not null
order by table_name;

-- 10c. Pending payment evidence constraints. Expected: positive amount and
-- nonblank transaction reference constraints exist. NOT VALID constraints still
-- protect new rows; owner may validate them after historical cleanup.
select
  conname,
  convalidated,
  pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.pending_payments'::regclass
  and conname in (
    'pending_payments_amount_positive',
    'pending_payments_transaction_reference_not_blank'
  )
order by conname;

-- 10d. Evidence-erasing cascade checks. Expected: zero rows. Any returned row
-- means a deployed foreign key can still erase incident evidence when an auth
-- user or partner/API record is deleted.
select
  nsp.nspname as table_schema,
  rel.relname as table_name,
  con.conname as constraint_name,
  refnsp.nspname as referenced_schema,
  refrel.relname as referenced_table,
  pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace nsp on nsp.oid = rel.relnamespace
join pg_class refrel on refrel.oid = con.confrelid
join pg_namespace refnsp on refnsp.oid = refrel.relnamespace
where con.contype = 'f'
  and con.confdeltype = 'c'
  and nsp.nspname = 'public'
  and (
    (refnsp.nspname = 'auth' and refrel.relname = 'users')
    or (
      refnsp.nspname = 'public'
      and refrel.relname in (
        'api_partners',
        'api_partner_keys',
        'api_partner_orders',
        'api_partner_logs',
        'api_partner_customers',
        'api_partner_webhook_deliveries'
      )
    )
  )
order by table_schema, table_name, constraint_name;

-- 10e. Reserve-first order authorization columns. Expected: zero rows. Any
-- returned row means an existing order table is missing the additive columns,
-- status constraint, or indexes needed before route-specific reserve/outbox
-- migration can be verified.
with existing_order_tables as (
  select table_name
  from unnest(array[
    'orders',
    'smm_orders',
    'sms_orders',
    'telegram_orders',
    'bitrefill_orders',
    'bills_transactions',
    'api_partner_orders'
  ]) as table_name
  where to_regclass('public.' || table_name) is not null
),
missing_columns as (
  select
    t.table_name,
    c.column_name as missing_name,
    'column' as missing_kind
  from existing_order_tables t
  cross join unnest(array[
    'wallet_reservation_id',
    'fulfillment_outbox_id',
    'financial_authorization_status',
    'financial_security_version',
    'financial_authorization_reference'
  ]) as c(column_name)
  where not exists (
    select 1
    from information_schema.columns cols
    where cols.table_schema = 'public'
      and cols.table_name = t.table_name
      and cols.column_name = c.column_name
  )
),
missing_constraints as (
  select
    t.table_name,
    t.table_name || '_financial_authorization_status_check' as missing_name,
    'constraint' as missing_kind
  from existing_order_tables t
  where not exists (
    select 1
    from pg_constraint con
    where con.conrelid = ('public.' || quote_ident(t.table_name))::regclass
      and con.conname = t.table_name || '_financial_authorization_status_check'
  )
),
missing_indexes as (
  select
    t.table_name,
    i.index_name as missing_name,
    'index' as missing_kind
  from existing_order_tables t
  cross join lateral (
    values
      ('idx_' || t.table_name || '_wallet_reservation_id'),
      ('idx_' || t.table_name || '_fulfillment_outbox_id')
  ) as i(index_name)
  where not exists (
    select 1
    from pg_class idx
    join pg_namespace nsp on nsp.oid = idx.relnamespace
    where nsp.nspname = 'public'
      and idx.relkind = 'i'
      and idx.relname = i.index_name
  )
)
select *
from missing_columns
union all
select *
from missing_constraints
union all
select *
from missing_indexes
order by table_name, missing_kind, missing_name;

-- 11. Public lookup surface safety. Expected:
-- individual_accounts_public is a view with security_invoker=true;
-- referral_lookup is a table, not a view over profiles.
select
  n.nspname as schema_name,
  c.relname,
  c.relkind,
  c.reloptions
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('individual_accounts_public', 'referral_lookup');

-- 12. Guard triggers installed. Expected: all rows present and enabled.
select
  event_object_schema,
  event_object_table,
  trigger_name,
  action_timing,
  event_manipulation,
  action_statement
from information_schema.triggers
where event_object_schema in ('public', 'auth')
  and trigger_name in (
    'trg_guard_transaction_ledger_authority',
    'guard_profile_privileged_fields_insert',
    'guard_profile_privileged_fields_update',
    'guard_profile_balance_insert',
    'guard_profile_balance_update',
    'prevent_profile_delete',
    'prevent_auth_user_delete',
    'prevent_auth_user_identity_change',
    'prevent_profile_identity_change',
    'sync_referral_lookup_insert_update',
    'sync_referral_lookup_delete'
  )
order by event_object_schema, event_object_table, trigger_name, event_manipulation;
