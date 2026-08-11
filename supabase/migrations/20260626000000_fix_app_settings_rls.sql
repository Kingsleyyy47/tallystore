-- app_settings is the key/value store the Admin Dashboard's "Referral
-- Settings" and "Exchange Rate Settings" cards write to (referral_commission_pct,
-- ngn_usd_rate). Both Save buttons fail with "Failed to save" the same way,
-- which points to either the table missing entirely or RLS blocking the
-- write - this migration is idempotent and fixes both possibilities.

create table if not exists public.app_settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

-- Everyone (including anon, since useExchangeRate reads ngn_usd_rate for
-- logged-out storefront visitors too) can read settings.
drop policy if exists "app_settings_select_all" on public.app_settings;
create policy "app_settings_select_all"
  on public.app_settings
  for select
  to anon, authenticated
  using (true);

-- Only admins can write settings. Checks the requesting user's own
-- profiles.is_admin flag.
drop policy if exists "app_settings_admin_write" on public.app_settings;
create policy "app_settings_admin_write"
  on public.app_settings
  for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.is_admin = true
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.is_admin = true
    )
  );

grant select on public.app_settings to anon, authenticated;
grant insert, update on public.app_settings to authenticated;
