-- Supabase Advisor flags normal Postgres views as SECURITY DEFINER because
-- they run with the view owner's privileges by default. Keep the same public
-- read surfaces without relying on privileged views.

-- The storefront only needs safe, non-credential columns for pre-purchase
-- browsing. Run this view as the caller and expose only available stock.
create or replace view public.individual_accounts_public
with (security_invoker = true) as
select
  id,
  product_group_id,
  username,
  status,
  created_at
from public.individual_accounts
where status = 'available';

grant select on public.individual_accounts_public to anon, authenticated;
grant select (id, product_group_id, username, status, created_at)
  on public.individual_accounts to anon, authenticated;

do $$
begin
  if to_regclass('public.individual_accounts') is not null then
    execute 'alter table public.individual_accounts enable row level security';

    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'individual_accounts'
        and policyname = 'Public can read available account pointers'
    ) then
      execute $policy$
        create policy "Public can read available account pointers"
        on public.individual_accounts
        for select
        to anon, authenticated
        using (status = 'available')
      $policy$;
    end if;
  end if;
end $$;

-- Referral lookup used to be a view over profiles. Do not make that an invoker
-- view because it would require loosening profiles RLS for cross-user reads.
-- Instead, keep a tiny public lookup table containing only referral-safe fields.
do $$
begin
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'referral_lookup'
      and c.relkind = 'v'
  ) then
    execute 'drop view public.referral_lookup';
  end if;
end $$;

create table if not exists public.referral_lookup (
  id uuid primary key,
  referral_code text,
  referred_by text,
  updated_at timestamptz not null default now()
);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'referral_lookup'
      and column_name = 'referred_by'
      and data_type <> 'text'
  ) then
    alter table public.referral_lookup
      alter column referred_by type text using referred_by::text;
  end if;
end $$;

insert into public.referral_lookup (id, referral_code, referred_by, updated_at)
select id, referral_code, referred_by::text, now()
from public.profiles
on conflict (id) do update set
  referral_code = excluded.referral_code,
  referred_by = excluded.referred_by,
  updated_at = now();

create unique index if not exists referral_lookup_referral_code_idx
  on public.referral_lookup (referral_code)
  where referral_code is not null;

create index if not exists referral_lookup_referred_by_idx
  on public.referral_lookup (referred_by)
  where referred_by is not null;

alter table public.referral_lookup enable row level security;

drop policy if exists "Anyone can read referral lookup" on public.referral_lookup;
create policy "Anyone can read referral lookup"
on public.referral_lookup
for select
to anon, authenticated
using (true);

grant select on public.referral_lookup to anon, authenticated;

create or replace function public.sync_referral_lookup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.referral_lookup (id, referral_code, referred_by, updated_at)
  values (new.id, new.referral_code, new.referred_by::text, now())
  on conflict (id) do update set
    referral_code = excluded.referral_code,
    referred_by = excluded.referred_by,
    updated_at = now();

  return new;
end;
$$;

create or replace function public.delete_referral_lookup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.referral_lookup
  where id = old.id;

  return old;
end;
$$;

drop trigger if exists sync_referral_lookup_insert_update on public.profiles;
create trigger sync_referral_lookup_insert_update
after insert or update of referral_code, referred_by on public.profiles
for each row
execute function public.sync_referral_lookup();

drop trigger if exists sync_referral_lookup_delete on public.profiles;
create trigger sync_referral_lookup_delete
after delete on public.profiles
for each row
execute function public.delete_referral_lookup();
