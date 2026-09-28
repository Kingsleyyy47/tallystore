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

-- 3. Full-history canonical wallet truth used by Fraud Review and purchase
-- authorization. This requires migration 20260924006000 and SQL Editor owner
-- privileges; an error means evidence is unavailable, not zero funding.
select
  truth->>'user_id' as user_id,
  truth->>'verified_gateway_deposits' as verified_gateway_deposits,
  truth->>'approved_admin_credits' as approved_admin_credits,
  truth->>'legacy_approved_principal' as legacy_approved_principal,
  truth->>'trusted_principal' as trusted_principal,
  truth->>'completed_debits' as completed_debits,
  truth->>'eligible_refunds' as eligible_refunds,
  truth->>'active_reservations' as active_reservations,
  truth->>'confirmed_spendable' as confirmed_spendable,
  truth->>'expected_ledger_balance' as expected_ledger_balance,
  truth->>'stored_wallet_balance' as stored_wallet_balance,
  truth->>'explained_difference' as explained_difference,
  truth->>'unexplained_difference' as unexplained_difference,
  truth->>'integrity_status' as integrity_status,
  truth->>'evidence_complete' as evidence_complete
from (
  select public.wallet_financial_truth_internal(:user_id::uuid) as truth
) canonical;

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
  pg_get_constraintdef(con.oid) as definition,
  regexp_replace(
    pg_get_constraintdef(con.oid),
    'ON[[:space:]]+DELETE[[:space:]]+CASCADE',
    ' ON DELETE RESTRICT',
    'i'
  ) = pg_get_constraintdef(con.oid) as restrict_rewrite_would_fail
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
-- individual_accounts_public is a narrow security-definer view that never
-- exposes inventory credentials; direct base-table access remains admin-only.
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

-- 13. Legacy chronology clue for one user. A debit before the first recorded
-- qualifying credit needs review; it does not prove a missing payment never
-- existed and must not automatically suspend or unfreeze anyone. This uses
-- ledger timestamps only, not provider settlement time.
with historical as (
  select t.created_at, t.amount, lower(coalesce(t.type, '')) as movement_type
  from public.transactions t
  where t.user_id = :user_id::uuid
    and coalesce(t.balance_type, 'wallet') = 'wallet'
    and t.created_at < public.wallet_legacy_funding_cutoff()
    and lower(coalesce(t.status, 'completed')) in (
      'completed', 'success', 'successful', 'credited', 'complete', 'paid', 'finished'
    )
), firsts as (
  select
    min(created_at) filter (where amount < 0) as first_recorded_debit_at,
    min(created_at) filter (
      where amount > 0 and movement_type in (
        'topup', 'top_up', 'top-up', 'wallet_topup', 'wallet_deposit',
        'deposit', 'credit', 'admin_credit', 'staff_credit',
        'promotion_credit', 'correction_credit'
      )
    ) as first_recorded_credit_at
  from historical
)
select
  :user_id::uuid as user_id,
  first_recorded_debit_at,
  first_recorded_credit_at,
  case
    when first_recorded_debit_at is null then 'NO_RECORDED_DEBIT'
    when first_recorded_credit_at is null then 'NO_RECORDED_CREDIT'
    when first_recorded_debit_at < first_recorded_credit_at
      then 'DEBIT_PRECEDES_RECORDED_CREDIT'
    else 'NO_EARLY_DEBIT_OBSERVED'
  end as chronology_signal
from firsts;

-- 14. Deployed financial-audit read policies. Expected: one authenticated
-- admin-only SELECT policy per table, with email_based_exception = false.
-- Review any additional policy rows; this query does not change permissions.
select
  tablename,
  policyname,
  cmd,
  roles,
  qual,
  coalesce(qual ~* '(p[.]email|email[[:space:]]*=)', false)
    as email_based_exception
from pg_policies
where schemaname = 'public'
  and tablename in (
    'transaction_ledger_blocked_attempts',
    'wallet_security_events'
  )
order by tablename, policyname;

-- 15. Provider payment identity deployment and historical collisions.
-- Expected: the global wallet-funding unique index is present and valid;
-- the second query returns no rows. A collision is a review finding, not
-- permission to freeze or rewrite the affected wallets automatically.
select
  idx.relname as index_name,
  i.indisvalid as index_valid,
  i.indisready as index_ready,
  pg_get_indexdef(idx.oid) as index_definition
from pg_class idx
join pg_namespace n on n.oid = idx.relnamespace
join pg_index i on i.indexrelid = idx.oid
where n.nspname = 'public'
  and idx.relname = 'idx_transactions_wallet_funding_external_payment_unique';

select
  btrim(t.external_payment_id) as payment_identity,
  count(*) as funding_rows,
  count(distinct t.user_id) as wallet_count,
  array_agg(distinct t.user_id) as wallet_ids
from public.transactions t
where nullif(btrim(coalesce(t.external_payment_id, '')), '') is not null
  and coalesce(t.balance_type, 'wallet') = 'wallet'
  and lower(coalesce(t.type, '')) in (
    'topup', 'top_up', 'top-up', 'wallet_topup', 'wallet_deposit', 'deposit'
  )
group by btrim(t.external_payment_id)
having count(*) > 1
order by funding_rows desc, payment_identity
limit 100;

-- 16. Effective runtime grants on historical trusted principal.
-- Expected: every can_write value is false; service_role can_select is true.
-- This reports effective grants, including role inheritance. It does not
-- inspect owner/superuser powers or change the table.
select
  role_name,
  has_table_privilege(role_name, 'public.wallet_legacy_funding', 'SELECT')
    as can_select,
  has_table_privilege(role_name, 'public.wallet_legacy_funding', 'INSERT')
    or has_table_privilege(role_name, 'public.wallet_legacy_funding', 'UPDATE')
    or has_table_privilege(role_name, 'public.wallet_legacy_funding', 'DELETE')
    or has_table_privilege(role_name, 'public.wallet_legacy_funding', 'TRUNCATE')
    as can_write
from (values ('anon'), ('authenticated'), ('service_role')) as roles(role_name);
select conname, pg_catalog.pg_get_constraintdef(oid) as status_constraint
from pg_catalog.pg_constraint
where conrelid = 'public.staff_pending_actions'::regclass
  and contype = 'c'
  and position('status' in lower(pg_catalog.pg_get_constraintdef(oid))) > 0;

-- 17. Public per-customer activity feed execution. Expected: function_exists
-- is true and browser_can_execute is false for both roles. Older deployed
-- builds may still try to call it, but the database must reject the call.
select
  role_name,
  to_regprocedure('public.get_recent_activity_feed(integer)') is not null
    as function_exists,
  case when to_regprocedure('public.get_recent_activity_feed(integer)') is not null
    then has_function_privilege(
      role_name, 'public.get_recent_activity_feed(integer)', 'EXECUTE'
    )
    else null
  end as browser_can_execute
from (values ('anon'), ('authenticated')) as roles(role_name);

-- 18. Inventory credential exposure after column-level grant cleanup.
-- Expected: anon_readable_base_columns returns zero rows; the base table has
-- RLS enabled and only the authenticated admin policy remains. The public
-- pointer view may be SELECT-able, but its username expression must be NULL.
select
  a.attname as anon_readable_base_column
from pg_attribute a
where a.attrelid = 'public.individual_accounts'::regclass
  and a.attnum > 0 and not a.attisdropped
  and has_column_privilege(
    'anon', 'public.individual_accounts', a.attname, 'SELECT'
  )
order by a.attname;

select
  c.relrowsecurity as base_rls_enabled,
  pg_get_viewdef('public.individual_accounts_public'::regclass, true)
    as public_view_definition
from pg_class c
where c.oid = 'public.individual_accounts'::regclass;

select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'individual_accounts'
order by policyname;

-- 19. Refunds with an explicit original-debit ID that disagrees with a
-- weaker purchase key. Run on staging before migration 12000 and review any
-- returned rows individually; do not create synthetic credits or bulk holds.
-- This query is an indicator, not an exhaustive refund-linkage audit.
select
  r.id as refund_id,
  r.user_id,
  r.created_at,
  r.amount,
  nullif(btrim(coalesce(r.metadata->>'source_debit_transaction_id', '')), '')
    as stated_debit_id,
  d.id as key_matched_debit_id,
  d.idempotency_key as matched_purchase_key
from public.transactions r
join public.transactions d
  on d.user_id = r.user_id
 and coalesce(d.balance_type, 'wallet') = 'wallet'
 and d.amount < 0
 and d.idempotency_key = nullif(btrim(coalesce(
   r.metadata->>'source_debit_idempotency_key',
   r.metadata->>'original_purchase_idempotency_key', ''
 )), '')
where coalesce(r.balance_type, 'wallet') = 'wallet'
  and lower(coalesce(r.type, '')) in ('refund', 'purchase_refund', 'auto_refund')
  and r.amount > 0
  and nullif(btrim(coalesce(r.metadata->>'source_debit_transaction_id', '')), '')
    is not null
  and lower(btrim(r.metadata->>'source_debit_transaction_id')) <> d.id::text
order by r.created_at desc, r.id
limit 100;

-- 20. Legacy SQL Editor policy reopen check. Expected: no rows from the
-- first query; browser direct access to optional CRO/chat tables and INSERT
-- on site_visits are false in the second. For revenue_events, browser UPDATE
-- is false; scoped SELECT and non-financial INSERT remain intentional. A
-- narrow app_settings SELECT grant is also intentional; inspect its
-- app_settings_public_keys RLS policy separately.
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and (
    (tablename = 'app_settings' and policyname = 'Anyone can read app settings')
    or (tablename = 'site_visits' and policyname = 'Anyone can insert site visits')
    or (tablename = 'cro_outcomes' and policyname like 'Clients can % cro outcomes')
    or (tablename = 'cro_interventions' and policyname like 'Clients can % cro interventions')
    or (tablename = 'chat_sessions' and policyname like 'Clients can % chat sessions')
    or (tablename = 'chat_interventions' and policyname like 'Clients can % chat interventions')
    or (tablename = 'revenue_events' and policyname in (
      'Clients can select own revenue events',
      'Clients can update non-financial revenue events'
    ))
  )
order by tablename, policyname;

select
  objects.object_name,
  roles.role_name,
  case when to_regclass('public.' || objects.object_name) is not null
    then has_table_privilege(roles.role_name, 'public.' || objects.object_name, 'SELECT')
    else null end as can_select,
  case when to_regclass('public.' || objects.object_name) is not null
    then has_table_privilege(roles.role_name, 'public.' || objects.object_name, 'INSERT')
    else null end as can_insert,
  case when to_regclass('public.' || objects.object_name) is not null
    then has_table_privilege(roles.role_name, 'public.' || objects.object_name, 'UPDATE')
    else null end as can_update
from (values ('site_visits'), ('cro_outcomes'), ('cro_interventions'),
  ('chat_sessions'), ('chat_interventions'), ('revenue_events'))
  as objects(object_name)
cross join (values ('anon'), ('authenticated')) as roles(role_name)
order by objects.object_name, roles.role_name;

-- 21. CRO decision evidence binding. Expected: no "Anyone can record cro
-- decisions" policy; browser INSERT policy requires auth.uid() = user_id
-- when user_id is present and client_observed=true. Browser UPDATE is false.
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'cro_decision_audit'
order by policyname;

select role_name,
  has_table_privilege(role_name, 'public.cro_decision_audit', 'INSERT')
    as can_insert,
  has_table_privilege(role_name, 'public.cro_decision_audit', 'UPDATE')
    as can_update
from (values ('anon'), ('authenticated')) as roles(role_name);

-- 22. Admin alert evidence authority. Expected: the old authenticated INSERT
-- policy is absent; anon/authenticated can_insert are false; service_role
-- can_insert is true. Admin SELECT/UPDATE policies remain for the UI.
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'admin_alerts'
order by policyname;

select role_name,
  case when to_regclass('public.admin_alerts') is not null
    then has_table_privilege(role_name, 'public.admin_alerts', 'INSERT')
    else null end as can_insert
from (values ('anon'), ('authenticated'), ('service_role'))
  as roles(role_name);

-- 23. Balance-neutral ledger-repair accounting. Expected after migration
-- 16000: reader_has_neutral_evidence_exclusion=true. Rows below are evidence,
-- not posted credits or approved principal. Review individually; do not bulk
-- clear wallet holds or infer that every historical repair was authorized.
select pg_catalog.strpos(
  pg_catalog.pg_get_functiondef(
    'public.wallet_financial_truth_internal(uuid)'::regprocedure
  ),
  't.balance_before = t.balance_after'
) > 0 as reader_has_neutral_evidence_exclusion;

select t.user_id, count(*) as evidence_rows,
  sum(t.amount) as nominal_evidence_amount,
  min(t.created_at) as first_seen, max(t.created_at) as last_seen
from public.transactions t
where lower(coalesce(t.type, '')) in ('admin_credit', 'correction_credit')
  and t.amount > 0
  and t.balance_before is not null
  and t.balance_after is not null
  and t.balance_before = t.balance_after
  and coalesce(t.metadata->>'source', '') = 'admin-ledger-repair'
  and coalesce(t.metadata->>'balance_unchanged', '') = 'true'
  and coalesce(t.metadata->>'requires_owner_evidence', '') = 'true'
group by t.user_id
order by last_seen desc
limit 100;

-- 24. Public sales aggregate exposure. Expected after migration 17000:
-- anon cannot execute either legacy exact-value RPC; authenticated can
-- execute revenue stats only after an internal admin/view_stats check. Both
-- bounded public replacements are callable anonymously. No revenue is read.
select function_name, role_name,
  has_function_privilege(role_name, function_name, 'EXECUTE') as can_execute
from (values
  ('public.get_customer_sales_stats()'),
  ('public.get_customer_top_product_groups(integer)'),
  ('public.get_public_customer_order_count()'),
  ('public.get_public_top_product_group_ids(integer)')
) as functions(function_name)
cross join (values ('anon'), ('authenticated')) as roles(role_name)
order by function_name, role_name;

select
  pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'public.get_customer_sales_stats()'::regprocedure
  ), 'sp.permission_key = ''view_stats''') > 0 as revenue_rpc_checks_staff_permission,
  pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'public.get_public_top_product_group_ids(integer)'::regprocedure
  ), 'LIMIT LEAST(GREATEST(COALESCE(p_limit, 8), 1), 12)') > 0
    as public_ranking_is_bounded;

select role_name,
  has_table_privilege(role_name, 'public.staff_permissions', 'INSERT')
    or has_table_privilege(role_name, 'public.staff_permissions', 'UPDATE')
    or has_table_privilege(role_name, 'public.staff_permissions', 'DELETE')
    or has_table_privilege(role_name, 'public.staff_permissions', 'TRUNCATE')
    as can_write_staff_permissions
from (values ('anon'), ('authenticated')) as roles(role_name);

-- 25. PocketFi payment evidence privileges. Expected after migration 18000:
-- no effective browser privilege, including TRUNCATE; service_role retains
-- SELECT/INSERT/UPDATE. This reads grants only and does not mutate evidence.
select role_name, privilege_name,
  case when to_regclass('public.pocketfi_webhook_logs') is not null
    then has_table_privilege(role_name, 'public.pocketfi_webhook_logs', privilege_name)
    else null end as has_privilege
from (values ('anon'), ('authenticated'), ('service_role')) as roles(role_name)
cross join (values
  ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
  ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
) as privileges(privilege_name)
order by role_name, privilege_name;

-- 26. Financial-history effective grants. Expected after migration 19000:
-- can_mutate is false for both browser roles on financial-history tables,
-- including TRUNCATE inherited through PUBLIC. Existing SELECT access is
-- unchanged. Profiles retain guarded edits but must deny TRUNCATE.
select t.table_name, r.role_name,
  case when to_regclass('public.' || t.table_name) is not null then
    has_table_privilege(r.role_name, 'public.' || t.table_name, 'INSERT')
    or has_table_privilege(r.role_name, 'public.' || t.table_name, 'UPDATE')
    or has_table_privilege(r.role_name, 'public.' || t.table_name, 'DELETE')
    or has_table_privilege(r.role_name, 'public.' || t.table_name, 'TRUNCATE')
    or has_table_privilege(r.role_name, 'public.' || t.table_name, 'REFERENCES')
    or has_table_privilege(r.role_name, 'public.' || t.table_name, 'TRIGGER')
  else null end as can_mutate
from (values
  ('transactions'), ('pending_payments'), ('orders'), ('bitrefill_orders'),
  ('crypto_transactions'), ('smm_orders'), ('telegram_orders'),
  ('bills_transactions')
) as t(table_name)
cross join (values ('anon'), ('authenticated')) as r(role_name)
order by t.table_name, r.role_name;

select role_name,
  has_table_privilege(role_name, 'public.profiles', 'TRUNCATE')
    as can_truncate_profiles
from (values ('anon'), ('authenticated')) as roles(role_name);

-- 27. Legacy balance-RPC overloads. Expected after migration 20000: every
-- listed signature has can_execute=false for both browser roles. A new or
-- forgotten overload must not be hidden by checking only one signature.
select p.oid::regprocedure::text as function_signature, roles.role_name,
  has_function_privilege(roles.role_name, p.oid, 'EXECUTE') as can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join (values ('anon'), ('authenticated')) as roles(role_name)
where n.nspname = 'public'
  and p.proname = any (array[
    'update_wallet_balance', 'credit_crypto_balance',
    'deduct_crypto_balance', 'transfer_crypto_to_wallet',
    'withdraw_referral_balance_to_wallet'
  ])
order by function_signature, roles.role_name;

-- 28. Locked unsuspension review. Expected after migration 21000: all three
-- definition checks true; anon/authenticated EXECUTE false. This does not
-- attempt to change any customer status.
select
  position('FOR UPDATE' in pg_get_functiondef(
    'public.set_customer_suspension_state(uuid,boolean,text,uuid)'::regprocedure
  )) > 0 as locks_customer_profile,
  position('public.wallet_financial_truth_internal(p_user_id)' in pg_get_functiondef(
    'public.set_customer_suspension_state(uuid,boolean,text,uuid)'::regprocedure
  )) > 0 as rechecks_canonical_truth,
  position('wallet_review_required_before_unsuspension' in pg_get_functiondef(
    'public.set_customer_suspension_state(uuid,boolean,text,uuid)'::regprocedure
  )) > 0 as denies_integrity_mismatch;

select role_name,
  has_function_privilege(role_name,
    'public.set_customer_suspension_state(uuid,boolean,text,uuid)', 'EXECUTE')
    as can_execute
from (values ('anon'), ('authenticated'), ('service_role')) as roles(role_name);

-- 29. Bitrefill customer history read boundary. Expected after migration
-- 22000: authenticated has no table-wide SELECT and cannot read redemption
-- or raw provider columns directly; only authenticated can call the history
-- RPC. Inspect the live SELECT policies as well: effective column grants do
-- not by themselves prove own-row isolation.
select role_name,
  has_table_privilege(role_name, 'public.bitrefill_orders', 'SELECT')
    as table_wide_select,
  has_column_privilege(role_name, 'public.bitrefill_orders',
    'product_name', 'SELECT') as safe_column_select,
  has_column_privilege(role_name, 'public.bitrefill_orders',
    'redemption_code', 'SELECT') as redemption_code_select,
  has_column_privilege(role_name, 'public.bitrefill_orders',
    'bitrefill_response', 'SELECT') as raw_response_select,
  has_function_privilege(role_name,
    'public.get_my_bitrefill_order_history()', 'EXECUTE') as history_rpc_execute
from (values ('anon'), ('authenticated')) as roles(role_name);

select policyname, roles, cmd, qual
from pg_policies
where schemaname = 'public' and tablename = 'bitrefill_orders'
order by policyname;

-- 30. Approved admin credit continuity. Expected after migrations 23000 and
-- 24000: both definition checks true. The count below identifies post-cutoff
-- admin-credit rows from sources outside the two reviewed posting routes;
-- review them individually rather than automatically trusting or deleting.
select
  position('direct_admin_adjustment' in pg_get_functiondef(
    'public.wallet_financial_truth_internal(uuid)'::regprocedure
  )) > 0 as recorded_admin_approval_used,
  position('v_refundable_remaining := GREATEST' in pg_get_functiondef(
    'public.guard_trusted_principal_transaction()'::regprocedure
  )) > 0 as refund_capacity_uses_canonical_truth;

select count(*) as unreviewed_post_cutoff_admin_credit_rows,
  coalesce(sum(t.amount), 0) as unreviewed_post_cutoff_admin_credit_amount
from public.transactions t
where lower(coalesce(t.type, '')) = 'admin_credit'
  and t.amount > 0
  and t.created_at >= public.wallet_legacy_funding_cutoff()
  and not (
    (coalesce(t.metadata->>'source', '') = 'admin-adjust-balance'
      and coalesce(t.metadata->>'approval_type', '') = 'direct_admin_adjustment')
    or (coalesce(t.metadata->>'source', '') = 'manage-staff'
      and coalesce(t.metadata->>'approval_type', '') = 'staff_action_review')
  );

-- 31. Customer product-order credential boundary. Expected after migration
-- 25000: authenticated cannot read any base-table column; the scoped
-- view is readable. Review the definition for owner/admin row filtering and
-- completed/captured credential reveal. This query does not read secrets.
select role_name,
  has_table_privilege(role_name, 'public.orders', 'SELECT') as base_table_select,
  has_column_privilege(role_name, 'public.orders', 'account_details', 'SELECT')
    as base_secret_select,
  has_column_privilege(role_name, 'public.orders', 'id', 'SELECT')
    as base_order_id_select,
  has_table_privilege(role_name, 'public.orders_safe_history', 'SELECT')
    as safe_history_select
from (values ('anon'), ('authenticated')) as roles(role_name);

select
  position('o.user_id' in pg_get_viewdef(
    'public.orders_safe_history'::regclass, true
  )) > 0 and position('auth.uid()' in pg_get_viewdef(
    'public.orders_safe_history'::regclass, true
  )) > 0 as owner_row_scope,
  position('financial_authorization_status' in pg_get_viewdef(
    'public.orders_safe_history'::regclass, true
  )) > 0 as captured_credential_gate;

-- 32. Bills provider-response boundary. Expected after migration 26000:
-- authenticated can read safe columns under the existing own/admin RLS
-- policies but not table-wide SELECT or sagecloud_response. Service role
-- keeps full SELECT for server-side idempotency and provider reconciliation.
select role_name,
  has_table_privilege(role_name, 'public.bills_transactions', 'SELECT')
    as table_wide_select,
  has_column_privilege(role_name, 'public.bills_transactions',
    'reference', 'SELECT') as summary_select,
  has_column_privilege(role_name, 'public.bills_transactions',
    'sagecloud_response', 'SELECT') as raw_provider_response_select
from (values ('anon'), ('authenticated'), ('service_role')) as roles(role_name);

select policyname, roles, cmd, qual
from pg_policies
where schemaname = 'public' and tablename = 'bills_transactions'
order by policyname;

-- 33. Effective paid-history browser write grants. Expected after migration
-- 27000: no rows have a browser table write or column INSERT/UPDATE/REFERENCES.
-- SELECT grants and own-row RLS must be checked separately; this query does
-- not assert that browser-readable rows belong to the requesting customer.
select c.relname as table_name, role_name,
  has_table_privilege(role_name, c.oid, 'INSERT') as table_insert,
  has_table_privilege(role_name, c.oid, 'UPDATE') as table_update,
  has_table_privilege(role_name, c.oid, 'DELETE') as table_delete,
  has_table_privilege(role_name, c.oid, 'TRUNCATE') as table_truncate,
  count(*) filter (where
    has_column_privilege(role_name, c.oid, a.attname, 'INSERT')
    or has_column_privilege(role_name, c.oid, a.attname, 'UPDATE')
    or has_column_privilege(role_name, c.oid, a.attname, 'REFERENCES')
  ) as writable_columns
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid
  and a.attnum > 0 and not a.attisdropped
cross join (values ('anon'), ('authenticated')) as roles(role_name)
where n.nspname = 'public'
  and c.relname in (
    'transactions', 'pending_payments', 'orders', 'bitrefill_orders',
    'crypto_transactions', 'crypto_withdrawals', 'smm_orders', 'sms_orders',
    'telegram_orders', 'bills_transactions'
  )
group by c.oid, c.relname, role_name
order by c.relname, role_name;

-- 34. Effective partner-table privilege closure. Expected after migration
-- 28000: each browser row has false for every table privilege and zero
-- readable/writable columns. Service-role reads/writes are verified separately
-- in staging; this does not test the paused partner API route itself.
select c.relname as table_name, role_name,
  has_table_privilege(role_name, c.oid, 'SELECT') as table_select,
  has_table_privilege(role_name, c.oid, 'INSERT') as table_insert,
  has_table_privilege(role_name, c.oid, 'UPDATE') as table_update,
  has_table_privilege(role_name, c.oid, 'DELETE') as table_delete,
  has_table_privilege(role_name, c.oid, 'TRUNCATE') as table_truncate,
  has_table_privilege(role_name, c.oid, 'REFERENCES') as table_references,
  has_table_privilege(role_name, c.oid, 'TRIGGER') as table_trigger,
  count(*) filter (where
    has_column_privilege(role_name, c.oid, a.attname, 'SELECT')
    or has_column_privilege(role_name, c.oid, a.attname, 'INSERT')
    or has_column_privilege(role_name, c.oid, a.attname, 'UPDATE')
    or has_column_privilege(role_name, c.oid, a.attname, 'REFERENCES')
  ) as accessible_columns
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid
  and a.attnum > 0 and not a.attisdropped
cross join (values ('anon'), ('authenticated')) as roles(role_name)
where n.nspname = 'public'
  and c.relname in (
    'api_partners', 'api_partner_keys', 'api_partner_orders',
    'api_partner_logs', 'api_partner_customers',
    'api_partner_webhook_deliveries'
  )
group by c.oid, c.relname, role_name
order by c.relname, role_name;

-- 35. Cross-wallet external payment identity review. Expected after migration
-- 29000: anon cannot execute; authenticated can call the RPC, whose body
-- checks a current admin profile. Service-role grants are internal and may
-- vary by deployment. A historical collision is a manual
-- provider-reconciliation signal, not proof of fraud or an auto-freeze rule.
select role_name,
  has_function_privilege(role_name,
    'public.get_admin_cross_wallet_payment_conflicts_page(text,integer)',
    'EXECUTE') as can_execute
from (values ('anon'), ('authenticated'), ('service_role')) as roles(role_name);

select count(*) as cross_wallet_payment_identities
from (
  select btrim(t.external_payment_id) as payment_identity
  from public.transactions t
  where nullif(btrim(coalesce(t.external_payment_id, '')), '') is not null
    and coalesce(t.balance_type, 'wallet') = 'wallet'
    and lower(coalesce(t.type, '')) in (
      'topup', 'top_up', 'top-up', 'wallet_topup', 'wallet_deposit', 'deposit'
    )
  group by btrim(t.external_payment_id)
  having count(distinct t.user_id) > 1
) collisions;

-- 36. Canonical gateway evidence deployment and reuse audit. Expected after
-- migration 30000: both function markers are true. The second query lists
-- candidate evidence reuse counts without changing wallets. Confirm each
-- candidate against the provider and full ledger before any correction.
select
  position(
    '''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'''
    in pg_get_functiondef('public.wallet_financial_truth_internal(uuid)'::regprocedure)
  ) = 0 as pocketfi_uuid_check_fixed,
  position(
    'ercas-evidence:'
    in pg_get_functiondef('public.wallet_financial_truth_internal(uuid)'::regprocedure)
  ) > 0 as reused_gateway_evidence_check_installed;

with claims as (
  select 'ercas'::text as provider, pp.id::text as evidence_id, t.id as transaction_id
  from public.transactions t
  join public.pending_payments pp on pp.user_id = t.user_id
    and round(pp.amount, 2) = round(t.amount, 2)
    and lower(coalesce(pp.status, 'pending')) = 'credited'
    and (
      pp.transaction_reference = nullif(btrim(coalesce(t.reference, '')), '')
      or pp.transaction_reference = nullif(btrim(coalesce(t.external_payment_id, '')), '')
      or pp.ercas_reference = nullif(btrim(coalesce(t.external_payment_id, '')), '')
    )
  where t.amount > 0
    and coalesce(t.balance_type, 'wallet') = 'wallet'
    and lower(coalesce(t.type, '')) in
      ('topup', 'top_up', 'top-up', 'wallet_topup', 'wallet_deposit', 'deposit')
    and lower(coalesce(t.status, 'completed')) in
      ('completed', 'success', 'successful', 'credited', 'complete', 'paid', 'finished')
    and lower(coalesce(t.metadata->>'provider', '')) in ('ercas', 'ercaspay')
    and t.created_at >= public.wallet_legacy_funding_cutoff()

  union all

  select 'pocketfi', pwl.id::text, t.id
  from public.transactions t
  join public.pocketfi_webhook_logs pwl
    on pwl.id::text = t.metadata->>'webhook_log_id'
    and pwl.matched_user_id = t.user_id
    and coalesce(pwl.processed, false)
    and round(coalesce(pwl.verified_amount_ngn, -1), 2) = round(t.amount, 2)
    and nullif(btrim(coalesce(pwl.verified_reference, '')), '') in (
      nullif(btrim(coalesce(t.reference, '')), ''),
      nullif(btrim(coalesce(t.external_payment_id, '')), '')
    )
  where t.amount > 0
    and coalesce(t.balance_type, 'wallet') = 'wallet'
    and lower(coalesce(t.type, '')) in
      ('topup', 'top_up', 'top-up', 'wallet_topup', 'wallet_deposit', 'deposit')
    and lower(coalesce(t.status, 'completed')) in
      ('completed', 'success', 'successful', 'credited', 'complete', 'paid', 'finished')
    and lower(coalesce(t.metadata->>'provider', '')) = 'pocketfi'
    and t.created_at >= public.wallet_legacy_funding_cutoff()
), reused as (
  select provider, evidence_id
  from claims
  group by provider, evidence_id
  having count(distinct transaction_id) > 1
)
select provider, count(*) as reused_evidence_records
from reused
group by provider
order by provider;

-- 37. Public product-catalog supplier configuration exposure. The earlier
-- catalog migration grants whole-row SELECT on active product_groups to anon
-- and authenticated, so these internal columns may be retrievable through
-- PostgREST even when the normal storefront does not render them. After
-- migration 31000, effective_column_select must be false for every listed
-- browser role/column; table_select must also be false. Verify separately
-- that approved public catalog columns and managed editor RPCs still work.
select roles.role_name, a.attname as column_name,
  has_table_privilege(roles.role_name, c.oid, 'SELECT') as table_select,
  has_column_privilege(roles.role_name, c.oid, a.attname, 'SELECT') as effective_column_select
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
cross join (values ('anon'), ('authenticated')) as roles(role_name)
where n.nspname = 'public'
  and c.relname = 'product_groups'
  and a.attname in (
    'muabanvia_product_id', 'shopclone_product_id',
    'shopviaclone_product_id', 'auto_fulfill_enabled',
    'auto_restock_enabled', 'restock_buffer_days'
  )
order by roles.role_name, a.attname;

-- 38. Public product-relationship behavioral metadata exposure. After
-- migration 31500, whole-row SELECT and these internal fields must be false
-- for both browser roles. Recommendation edge columns remain readable.
select roles.role_name, a.attname as column_name,
  has_table_privilege(roles.role_name, c.oid, 'SELECT') as table_select,
  has_column_privilege(roles.role_name, c.oid, a.attname, 'SELECT') as effective_column_select
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
cross join (values ('anon'), ('authenticated')) as roles(role_name)
where n.nspname = 'public'
  and c.relname = 'product_relationships'
  and a.attname in ('metadata', 'sample_size', 'source', 'last_updated')
order by roles.role_name, a.attname;

-- 39. Pending-payment evidence must not be directly readable by browser
-- roles after migration 32000, including inherited column grants. Existing
-- error_message values remain available to narrowly authorized operators.
select roles.role_name, a.attname as column_name,
  has_table_privilege(roles.role_name, c.oid, 'SELECT') as table_select,
  has_column_privilege(roles.role_name, c.oid, a.attname, 'SELECT') as effective_column_select
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
cross join (values ('anon'), ('authenticated')) as roles(role_name)
where n.nspname = 'public'
  and c.relname = 'pending_payments'
  and a.attname in ('status', 'transaction_reference', 'error_message')
order by roles.role_name, a.attname;

-- 40. After migration 20260925000000, all three refund calculations must
-- permit repeated spend/refund cycles. Run as the owner in the SQL editor.
-- All three columns should be true. This checks definitions, not payment
-- provenance, per-original-debit conservation, or live grant enforcement.
with definitions as (
  select
    pg_get_functiondef('public.wallet_financial_truth_internal(uuid)'::regprocedure) as canonical,
    regexp_replace(
      pg_get_functiondef('public.guard_trusted_principal_transaction()'::regprocedure),
      '[[:space:]]+', '', 'g'
    ) as refund_guard,
    regexp_replace(
      pg_get_functiondef('public.apply_wallet_transaction(uuid,text,numeric,text,text,text,jsonb,text,text,text,uuid)'::regprocedure),
      '[[:space:]]+', '', 'g'
    ) as wallet_engine
)
select
  strpos(canonical, 'LEAST(r.linked_eligible_refunds, m.completed_debits)') > 0
    as canonical_refund_cycle_fixed,
  strpos(refund_guard,
    'v_refundable_remaining:=GREATEST((v_financial_truth->>''completed_debits'')::numeric-(v_financial_truth->>''eligible_refunds'')::numeric,0)') > 0
    as refund_guard_cycle_fixed,
  strpos(wallet_engine,
    'v_refundable_remaining:=GREATEST((v_financial_truth->>''completed_debits'')::numeric-(v_financial_truth->>''eligible_refunds'')::numeric,0)') > 0
    as wallet_engine_cycle_fixed
from definitions;

-- 41. After migration 20260925001000, canonical funding and the wallet
-- writer must compare provider evidence amounts exactly. All columns should
-- be true. Definition inspection is not a provider or live-grant test.
with definitions as (
  select
    pg_get_functiondef('public.wallet_financial_truth_internal(uuid)'::regprocedure) as canonical,
    pg_get_functiondef('public.apply_wallet_transaction(uuid,text,numeric,text,text,text,jsonb,text,text,text,uuid)'::regprocedure) as writer
)
select
  strpos(canonical, '(t.metadata->>''verified_amount_ngn'')::numeric = t.amount') > 0
    and strpos(canonical, 'pp.amount = t.amount') > 0
    and strpos(canonical, 'pwl.verified_amount_ngn = t.amount') > 0
    as canonical_exact_gateway_amounts,
  strpos(writer, 'pp.amount = v_amount') > 0
    and strpos(writer, 'pwl.verified_amount_ngn = v_amount') > 0
    and strpos(writer, 'pp.amount = t.amount') > 0
    and strpos(writer, 'pwl.verified_amount_ngn = t.amount') > 0
    as writer_exact_gateway_amounts
from definitions;

-- 42. Fraud Review's admin-only page reader must prefer the current Auth
-- email, without granting browser roles direct access to auth.users.
select
  strpos(
    pg_get_functiondef('public.get_admin_wallet_financial_truth_page(uuid,integer)'::regprocedure),
    'LEFT JOIN auth.users au ON au.id = p.id'
  ) > 0 as admin_page_reads_auth_identity,
  strpos(
    pg_get_functiondef('public.get_admin_wallet_financial_truth_page(uuid,integer)'::regprocedure),
    'WHERE p.id = auth.uid() AND COALESCE(p.is_admin, false)'
  ) > 0 as admin_page_checks_current_role,
  has_function_privilege('anon',
    'public.get_admin_wallet_financial_truth_page(uuid,integer)', 'EXECUTE')
    as anon_can_execute,
  has_function_privilege('authenticated',
    'public.get_admin_wallet_financial_truth_page(uuid,integer)', 'EXECUTE')
    as authenticated_can_execute;

-- 43. Before migration 20260925003000, review post-cutoff provider references
-- claimed by more than one wallet. These are ambiguous claims, not proof of
-- customer wrongdoing. After migrations 03000/04000, both definition checks
-- should be true; this query does not prove the provider payment itself.
with gateway_credits as (
  select t.user_id,
    case when lower(coalesce(t.metadata->>'provider', '')) in ('ercas', 'ercaspay')
      then 'ercas' else lower(coalesce(t.metadata->>'provider', '')) end as provider,
    nullif(btrim(coalesce(t.reference, '')), '') as reference,
    nullif(btrim(coalesce(t.external_payment_id, '')), '') as external_payment_id
  from public.transactions t
  where t.created_at >= public.wallet_legacy_funding_cutoff()
    and coalesce(t.balance_type, 'wallet') = 'wallet'
    and lower(coalesce(t.type, '')) in
      ('topup', 'top_up', 'top-up', 'wallet_topup', 'wallet_deposit', 'deposit')
    and lower(coalesce(t.status, 'completed')) in
      ('completed', 'success', 'successful', 'credited', 'complete', 'paid', 'finished')
    and lower(coalesce(t.metadata->>'provider', '')) in ('ercas', 'ercaspay', 'pocketfi')
), claims as (
  select provider, reference as payment_reference, user_id
  from gateway_credits where reference is not null
  union
  select provider, external_payment_id as payment_reference, user_id
  from gateway_credits where external_payment_id is not null
)
select provider, payment_reference,
  count(distinct user_id) as wallets,
  array_agg(distinct user_id) as wallet_ids
from claims
group by provider, payment_reference
having count(distinct user_id) > 1
order by wallets desc, provider, payment_reference;

select
  strpos(
    pg_get_functiondef('public.wallet_financial_truth_internal(uuid)'::regprocedure),
    'cross-wallet-reference:'
  ) > 0 as canonical_cross_wallet_gate_installed,
  strpos(
    pg_get_functiondef('public.get_admin_cross_wallet_payment_conflicts_page(text,integer)'::regprocedure),
    'reference:'
  ) > 0 as admin_reference_review_installed;

-- 44. After SMM contract migration 20260925006000, ordinary browser roles
-- must not read supplier external IDs or mutate the catalog. This checks
-- effective grants (including PUBLIC); test RLS and RPC actor checks in
-- staging with real authenticated requests.
select role_name,
  has_column_privilege(role_name, 'public.smm_services', 'id', 'SELECT')
    as can_read_public_id,
  has_column_privilege(role_name, 'public.smm_services', 'name', 'SELECT')
    as can_read_name,
  has_column_privilege(role_name, 'public.smm_services', 'external_id', 'SELECT')
    as can_read_supplier_id,
  has_table_privilege(role_name, 'public.smm_services', 'UPDATE')
    as can_update_table,
  has_table_privilege(role_name, 'public.smm_services', 'TRUNCATE')
    as can_truncate_table,
  has_function_privilege(role_name,
    'public.get_admin_smm_services(text)', 'EXECUTE')
    as can_call_admin_reader,
  has_function_privilege(role_name,
    'public.set_admin_smm_service_active(bigint,text,boolean)', 'EXECUTE')
    as can_call_admin_toggle
from (values ('anon'), ('authenticated')) as roles(role_name);

-- 45. After SMM order privacy migration 20260925007000, browser roles must
-- not read raw provider responses or supplier cost. A true safe-column grant
-- does not imply a row is visible; verify customer/admin RLS separately.
select role_name,
  has_column_privilege(role_name, 'public.smm_orders', 'id', 'SELECT')
    as can_read_order_id,
  has_column_privilege(role_name, 'public.smm_orders', 'status', 'SELECT')
    as can_read_status,
  has_column_privilege(role_name, 'public.smm_orders', 'panel_response', 'SELECT')
    as can_read_panel_response,
  has_column_privilege(role_name, 'public.smm_orders', 'cost_usd', 'SELECT')
    as can_read_supplier_cost,
  has_table_privilege(role_name, 'public.smm_orders', 'UPDATE')
    as can_update_orders,
  has_table_privilege(role_name, 'public.smm_orders', 'TRUNCATE')
    as can_truncate_orders
from (values ('anon'), ('authenticated')) as roles(role_name);

-- Inspect the deployed SMM order status type and CHECK constraints before
-- enabling an Edge build that can record outcome_unknown. An enum must include
-- that label; any status CHECK must be reviewed against the new state.
select format_type(a.atttypid, a.atttypmod) as status_type,
  t.typtype,
  e.enumlabel as allowed_enum_label
from pg_catalog.pg_attribute a
join pg_catalog.pg_type t on t.oid = a.atttypid
left join pg_catalog.pg_enum e on e.enumtypid = t.oid
where a.attrelid = 'public.smm_orders'::regclass
  and a.attname = 'status' and a.attnum > 0 and not a.attisdropped
order by e.enumsortorder;

select c.conname, pg_get_constraintdef(c.oid) as status_constraint
from pg_catalog.pg_constraint c
where c.conrelid = 'public.smm_orders'::regclass
  and c.contype = 'c'
  and pg_get_constraintdef(c.oid) ilike '%status%'
order by c.conname;

-- 46. Post-cutoff admin credits with plausible approval metadata but an
-- unrecognized posting source. The effective canonical reader excludes these
-- credits even if the recorded approver is a current admin. This is a review
-- queue, not proof of approval or fraud: compare the original action and
-- owner authorization before any compensating entry or wallet review change.
select t.user_id, t.id as transaction_id, t.amount, t.created_at,
  t.created_by as recorded_approver_id,
  t.metadata->>'source' as recorded_source,
  t.metadata->>'approval_type' as recorded_approval_type,
  t.metadata->>'approval_reference' as approval_reference,
  t.metadata->>'reason' as recorded_reason
from public.transactions t
where t.created_at >= public.wallet_legacy_funding_cutoff()
  and coalesce(t.balance_type, 'wallet') = 'wallet'
  and lower(coalesce(t.type, '')) = 'admin_credit'
  and lower(coalesce(t.status, 'completed')) in
    ('completed', 'success', 'successful', 'credited', 'complete', 'paid', 'finished')
  and t.amount > 0
  and coalesce(t.balance_after, 0) > coalesce(t.balance_before, 0)
  and coalesce(t.metadata->>'source', '') <> 'admin-ledger-repair'
  and coalesce(t.metadata->>'balance_unchanged', '') <> 'true'
  and coalesce(t.metadata->>'requires_owner_evidence', '') <> 'true'
  and t.metadata->>'approved_by' = t.created_by::text
  and length(btrim(coalesce(t.metadata->>'approval_reference', ''))) >= 8
  and length(btrim(coalesce(t.metadata->>'reason', ''))) >= 3
  and not (
    (coalesce(t.metadata->>'source', '') = 'admin-adjust-balance'
      and coalesce(t.metadata->>'approval_type', '') = 'direct_admin_adjustment')
    or (coalesce(t.metadata->>'source', '') = 'manage-staff'
      and coalesce(t.metadata->>'approval_type', '') = 'staff_action_review')
  )
order by t.created_at desc, t.id;

-- 47. After SMS history contract 20260925008000, browser roles can read
-- customer-safe SMS fields but not historical raw errors/provider payloads.
-- SELECT privileges are only one layer; verify owner/admin row scope with
-- authenticated staging requests and inspect the deployed RLS definitions.
select role_name,
  has_column_privilege(role_name, 'public.sms_orders', 'id', 'SELECT')
    as can_read_order_id,
  has_column_privilege(role_name, 'public.sms_orders', 'messages', 'SELECT')
    as can_read_messages,
  has_column_privilege(role_name, 'public.sms_orders', 'error_message', 'SELECT')
    as can_read_raw_error,
  has_column_privilege(role_name, 'public.sms_orders', 'provider_payload', 'SELECT')
    as can_read_provider_payload,
  has_table_privilege(role_name, 'public.sms_orders', 'UPDATE')
    as can_update_orders
from (values ('anon'), ('authenticated')) as roles(role_name);

select policyname, roles, cmd, permissive, qual
from pg_catalog.pg_policies
where schemaname = 'public' and tablename = 'sms_orders'
order by policyname;

-- 48. Telegram customer history and retail catalog must be served by the
-- authenticated Edge Function, not direct PostgREST table grants. A browser
-- role should have no table or private-column privileges after migration
-- 20260925009000. Verify the deployed Edge response separately in staging.
select role_name,
  has_table_privilege(role_name, 'public.telegram_orders', 'SELECT')
    as can_read_orders,
  has_column_privilege(role_name, 'public.telegram_orders', 'recipient_hash', 'SELECT')
    as can_read_recipient_hash,
  has_column_privilege(role_name, 'public.telegram_orders', 'istar_amount', 'SELECT')
    as can_read_supplier_amount,
  has_table_privilege(role_name, 'public.telegram_products', 'SELECT')
    as can_read_products,
  has_table_privilege(role_name, 'public.telegram_products', 'UPDATE')
    as can_update_products
from (values ('anon'), ('authenticated')) as roles(role_name);

-- 49. After 20260925010000, queued staff actions must not be writable by
-- browser roles. Staff may read their own rows under RLS; manage-staff uses
-- service_role for submission and approval. Inspect effective column grants,
-- not only table grants or policy text.
select role_name,
  has_table_privilege(role_name, 'public.staff_pending_actions', 'SELECT') as table_select,
  has_table_privilege(role_name, 'public.staff_pending_actions', 'INSERT') as table_insert,
  has_table_privilege(role_name, 'public.staff_pending_actions', 'UPDATE') as table_update,
  has_table_privilege(role_name, 'public.staff_pending_actions', 'TRUNCATE') as table_truncate,
  exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid = 'public.staff_pending_actions'::regclass
      and a.attnum > 0 and not a.attisdropped
      and (has_column_privilege(role_name, 'public.staff_pending_actions', a.attname, 'INSERT')
        or has_column_privilege(role_name, 'public.staff_pending_actions', a.attname, 'UPDATE'))
  ) as effective_column_write
from (values ('anon'), ('authenticated'), ('service_role')) as roles(role_name);

-- NOWPayments signed-IPN identity or terminal-status review. Run after deploying the matching
-- Edge Function and wallet_security_events migration. A row here is evidence
-- requiring provider/payment lookup, not proof that the named wallet is bad.
select created_at, id, event_type, profile_id, operation_reference,
  denial_code, evidence->>'payment_id' as provider_payment_id,
  coalesce(evidence->>'reported_status', evidence->>'payment_status') as reported_status,
  evidence->>'provider_status' as verified_provider_status
from public.wallet_security_events
where event_type in (
  'CRYPTO_IPN_IDENTITY_REVIEW', 'CRYPTO_IPN_TERMINAL_REVIEW',
  'CRYPTO_IPN_FINISHED_REVIEW', 'CRYPTO_IPN_UNSUPPORTED_STATUS_REVIEW'
)
order by created_at desc, id desc
limit 100;

-- 50. Legacy chronology review after 20260925011000. This checks every wallet
-- with a recorded pre-cutoff debit; it does not cap financial history or
-- automatically change any account. A debit before the first recorded
-- credit is a chronology clue, not proof that no earlier payment existed.
-- Preserve first-seen provider and transaction evidence before corrections.
with candidate_wallets as (
  select distinct t.user_id
  from public.transactions t
  where t.created_at < public.wallet_legacy_funding_cutoff()
    and coalesce(t.balance_type, 'wallet') = 'wallet'
    and t.amount < 0
    and lower(coalesce(t.status, 'completed')) in (
      'completed', 'success', 'successful', 'credited',
      'complete', 'paid', 'finished'
    )
)
select p.id as user_id,
  truth->>'legacy_first_recorded_debit_at' as first_recorded_debit_at,
  truth->>'legacy_first_recorded_funding_at' as first_recorded_funding_at,
  (truth->>'legacy_approved_principal')::numeric as legacy_principal,
  (truth->>'confirmed_spendable')::numeric as confirmed_spendable,
  truth->>'integrity_status' as integrity_status,
  (truth->>'spending_blocked')::boolean as spending_blocked
from candidate_wallets c
join public.profiles p on p.id = c.user_id
cross join lateral public.wallet_financial_truth_internal(p.id) truth
where truth->>'legacy_spend_before_recorded_funding' = 'true'
order by p.id;

-- 51. Alert evidence must be immutable to browser sessions. An authenticated
-- admin may update only acknowledged; the trigger sets acknowledged_at/by.
-- The service role retains system resolution writes. This is read-only and
-- must be followed by an authenticated staging mutation test.
select role_name,
  has_table_privilege(role_name, 'public.admin_alerts', 'UPDATE') as table_update,
  has_column_privilege(role_name, 'public.admin_alerts', 'acknowledged', 'UPDATE')
    as can_acknowledge,
  has_column_privilege(role_name, 'public.admin_alerts', 'message', 'UPDATE')
    as can_rewrite_message,
  has_column_privilege(role_name, 'public.admin_alerts', 'severity', 'UPDATE')
    as can_rewrite_severity,
  has_column_privilege(role_name, 'public.admin_alerts', 'context', 'UPDATE')
    as can_rewrite_context
from (values ('anon'), ('authenticated'), ('service_role')) as roles(role_name);

select tgname, tgenabled
from pg_catalog.pg_trigger
where tgrelid = 'public.admin_alerts'::regclass
  and tgname = 'trg_guard_admin_alert_acknowledgement'
  and not tgisinternal;

-- 52. Deployed profile reader scope and recursion diagnosis. The named
-- policy should use auth.uid() for self and is_admin_profile() for admin;
-- its expression must not contain a nested SELECT from profiles. Review
-- every additional SELECT/ALL policy for unexpected broad reads. A policy
-- listing is not a substitute for authenticated customer/staff/admin probes.
select policyname, cmd, roles, permissive, qual,
  coalesce(qual ~* '(from|join)[[:space:]]+(public[.])?profiles', false)
    as directly_self_references_profiles
from pg_catalog.pg_policies
where schemaname = 'public' and tablename = 'profiles'
  and cmd in ('SELECT', 'ALL')
order by policyname;

select p.proname, p.prosecdef as security_definer,
  pg_catalog.pg_get_userbyid(p.proowner) as function_owner,
  p.proconfig as function_settings,
  c.relforcerowsecurity as profiles_force_rls,
  (p.proowner = c.relowner OR owner_role.rolbypassrls)
    as function_owner_can_bypass_profiles_rls,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE')
    as authenticated_can_execute
from pg_catalog.pg_proc p
join pg_catalog.pg_class c on c.oid = 'public.profiles'::regclass
join pg_catalog.pg_roles owner_role on owner_role.oid = p.proowner
where p.oid = 'public.is_admin_profile()'::regprocedure;

-- 53. Discount-code enumeration boundary after the expand/browser/contract
-- sequence. Only the current-admin policy should read rows directly;
-- authenticated has table SELECT for that policy but an ordinary JWT must
-- return zero rows. The scoped RPCs must be definer-owned and anon-denied.
-- Test preview, staff listing, and ordinary direct SELECT with real JWTs in
-- staging; grants and policy text alone do not prove behavior.
select policyname, cmd, roles, permissive, qual, with_check
from pg_catalog.pg_policies
where schemaname = 'public' and tablename = 'discount_codes'
order by policyname;

select role_name,
  has_table_privilege(role_name, 'public.discount_codes', 'SELECT') as table_select,
  has_table_privilege(role_name, 'public.discount_codes', 'INSERT') as table_insert,
  has_table_privilege(role_name, 'public.discount_codes', 'UPDATE') as table_update
from (values ('anon'), ('authenticated'), ('service_role')) as roles(role_name);

select p.oid::regprocedure as function_signature, p.prosecdef as security_definer,
  pg_catalog.pg_get_userbyid(p.proowner) as function_owner,
  p.proconfig as function_settings,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE')
    as authenticated_can_execute
from pg_catalog.pg_proc p
where p.oid in (
  'public.preview_discount_code(text,uuid,numeric)'::regprocedure,
  'public.get_managed_discount_codes()'::regprocedure
)
order by p.oid::regprocedure::text;

-- 54. Discount-code capacity boundary after 20260925016000. Both triggers
-- should be enabled and the readiness RPC executable only by service_role.
-- Capacity totals are diagnostic, not proof that two concurrent purchases
-- serialize; run the staged concurrency case with the matching Edge build.
select tgname, tgenabled, pg_catalog.pg_get_triggerdef(oid) as definition
from pg_catalog.pg_trigger
where tgrelid = 'public.orders'::regclass
  and tgname in ('guard_order_discount_capacity', 'post_completed_order_discount_use')
  and not tgisinternal
order by tgname;

select role_name,
  has_function_privilege(role_name,
    'public.discount_code_capacity_version()'::regprocedure, 'EXECUTE')
    as can_check_capacity_version
from (values ('anon'), ('authenticated'), ('service_role')) as roles(role_name);

select dc.id as discount_code_id, dc.max_uses, dc.used_count,
  count(o.id) filter (where lower(coalesce(o.status, '')) not in
    ('completed', 'failed', 'cancelled', 'canceled', 'refunded'))
    as active_order_uses,
  dc.used_count + count(o.id) filter (where lower(coalesce(o.status, '')) not in
    ('completed', 'failed', 'cancelled', 'canceled', 'refunded'))
    as committed_and_reserved_uses
from public.discount_codes dc
left join public.orders o on o.discount_code_id = dc.id
where dc.max_uses is not null
group by dc.id, dc.max_uses, dc.used_count
order by (dc.used_count + count(o.id) filter (where lower(coalesce(o.status, '')) not in
  ('completed', 'failed', 'cancelled', 'canceled', 'refunded')) > dc.max_uses) desc,
  dc.id
limit 100;

-- 55. Direct admin RPCs must reject a currently suspended administrator.
-- This definition check is not a substitute for old-session staging probes.
select p.oid::regprocedure as function_signature,
  p.prosecdef as security_definer,
  position('NOT COALESCE(p.account_suspended, false)' in
    pg_catalog.pg_get_functiondef(p.oid)) > 0 as checks_current_suspension,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE')
    as authenticated_can_execute
from pg_catalog.pg_proc p
where p.oid = any(array[
  to_regprocedure('public.get_admin_wallet_financial_truth(uuid)'),
  to_regprocedure('public.get_admin_wallet_financial_truth_page(uuid,integer)'),
  to_regprocedure('public.get_admin_fraud_latest_visits(uuid[])'),
  to_regprocedure('public.get_admin_cross_wallet_payment_conflicts_page(text,integer)'),
  to_regprocedure('public.get_admin_smm_services(text)'),
  to_regprocedure('public.set_admin_smm_service_active(bigint,text,boolean)')
])
order by p.oid::regprocedure::text;

-- 56. Financial-audit and SMS read policies after 20260925018000. Named
-- policies should use is_admin_profile(); inspect every extra SELECT/ALL
-- policy too, since permissive policies can widen access. Probe with real
-- staging JWTs; policy text alone does not prove effective privileges.
select tablename, policyname, cmd, roles, permissive, qual
from pg_catalog.pg_policies
where schemaname = 'public'
  and tablename in (
    'transaction_ledger_blocked_attempts', 'wallet_security_events',
    'sms_orders'
  )
  and cmd in ('SELECT', 'ALL')
order by tablename, policyname;

-- 57. Completed-order history must preserve owner reads but scope the admin
-- branch through the current active-admin helper. Verify with real JWTs;
-- a view definition cannot prove its effective caller behavior on its own.
select pg_catalog.pg_get_viewdef('public.orders_safe_history'::regclass, true)
  as safe_order_history_definition;

select c.relname, c.reloptions, pg_catalog.pg_get_userbyid(c.relowner)
  as view_owner
from pg_catalog.pg_class c
where c.oid = 'public.orders_safe_history'::regclass;

-- 58. Admin alert access after 20260925020000. The restrictive FOR ALL
-- policy should use is_admin_profile(); inspect any other SELECT/UPDATE/ALL
-- policies that might affect effective access. Test with real staging JWTs.
select policyname, cmd, roles, permissive, qual, with_check
from pg_catalog.pg_policies
where schemaname = 'public' and tablename = 'admin_alerts'
  and cmd in ('SELECT', 'UPDATE', 'ALL')
order by policyname;

select role_name,
  has_table_privilege(role_name, 'public.admin_alerts', 'SELECT') as table_select,
  has_table_privilege(role_name, 'public.admin_alerts', 'UPDATE') as table_update,
  has_column_privilege(role_name, 'public.admin_alerts', 'acknowledged', 'UPDATE')
    as can_acknowledge_column
from (values ('anon'), ('authenticated'), ('service_role')) as roles(role_name);

-- 59. Seven forensic tables must have an active-admin restrictive read
-- policy. Inspect any extra SELECT/ALL policies and effective table grants;
-- verify with real active/suspended/customer JWTs in staging.
select tablename, policyname, cmd, roles, permissive, qual
from pg_catalog.pg_policies
where schemaname = 'public'
  and tablename in (
    'fraud_device_bans', 'profile_delete_audit',
    'auth_user_delete_audit', 'profile_balance_audit',
    'auth_user_identity_audit', 'profile_identity_audit',
    'profile_balance_blocked_attempts'
  )
  and cmd in ('SELECT', 'ALL')
order by tablename, policyname;

-- 60. Settings policies after 20260925022000. Public SELECT on named
-- storefront keys should remain; authenticated INSERT/UPDATE must require
-- the current active-admin helper. Review all extra policies and use real
-- staging JWTs to prove the effective result.
select tablename, policyname, cmd, roles, permissive, qual, with_check
from pg_catalog.pg_policies
where schemaname = 'public'
  and tablename in ('app_settings', 'sms_product_settings')
order by tablename, policyname;

select roles.role_name, settings.table_name,
  has_table_privilege(roles.role_name, settings.table_name, 'SELECT') as can_select,
  has_table_privilege(roles.role_name, settings.table_name, 'INSERT') as can_insert,
  has_table_privilege(roles.role_name, settings.table_name, 'UPDATE') as can_update
from (values ('anon'), ('authenticated'), ('service_role')) as roles(role_name)
cross join (values ('public.app_settings'), ('public.sms_product_settings'))
  as settings(table_name)
order by settings.table_name, roles.role_name;

-- 61. Telemetry read scope after 20260925023000. Site visits should be
-- active-admin only; revenue identity links should allow only active admins
-- or the owning customer. Check extra SELECT/ALL policies and run real-JWT
-- staging probes, including customer INSERT ... RETURNING.
select tablename, policyname, cmd, roles, permissive, qual
from pg_catalog.pg_policies
where schemaname = 'public'
  and tablename in ('site_visits', 'revenue_identity_links')
  and cmd in ('SELECT', 'ALL')
order by tablename, policyname;

-- 62. Base financial-history read scope after 20260925024000. Customer
-- self-history and active-admin investigation are allowed, while a
-- suspended admin must not read another customer. Check extra policies,
-- effective grants, and real staging JWT behavior, including base-order
-- account_details denial and the safe history view.
select tablename, policyname, cmd, roles, permissive, qual
from pg_catalog.pg_policies
where schemaname = 'public' and tablename in ('orders', 'transactions')
  and cmd in ('SELECT', 'ALL')
order by tablename, policyname;

select roles.role_name, tables.table_name,
  has_table_privilege(roles.role_name, tables.table_name, 'SELECT')
    as table_select,
  has_column_privilege(roles.role_name, tables.table_name, 'user_id', 'SELECT')
    as user_id_select
from (values ('anon'), ('authenticated'), ('service_role')) as roles(role_name)
cross join (values ('public.orders'), ('public.transactions'))
  as tables(table_name)
order by tables.table_name, roles.role_name;

-- 63. Raw Revenue OS read boundary after 20260925025000. In addition to
-- these definitions, test actual old-session JWTs and anonymous requests
-- in staging. Anonymous table and column SELECT must both be false.
select tablename, policyname, cmd, roles, permissive, qual
from pg_catalog.pg_policies
where schemaname = 'public'
  and tablename in ('revenue_events', 'cro_decision_audit')
  and cmd in ('SELECT', 'ALL')
order by tablename, policyname;

select roles.role_name, tables.table_name,
  has_table_privilege(roles.role_name, tables.table_name, 'SELECT')
    as table_select,
  has_column_privilege(roles.role_name, tables.table_name, 'id', 'SELECT')
    as id_select
from (values ('anon'), ('authenticated'), ('service_role')) as roles(role_name)
cross join (values ('public.revenue_events'), ('public.cro_decision_audit'))
  as tables(table_name)
order by tables.table_name, roles.role_name;
