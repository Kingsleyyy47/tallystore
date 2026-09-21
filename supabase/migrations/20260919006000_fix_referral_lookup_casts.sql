-- Make the referral lookup repair idempotent after partial/manual runs.
-- The public referral surface must not be a privileged view over profiles, and
-- referred_by must be stored as text because historical schemas have used both
-- uuid and text representations.

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

alter table public.referral_lookup
  alter column referred_by type text using referred_by::text;

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
