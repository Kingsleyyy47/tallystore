create table if not exists public.sms_product_settings (
  service_code text primary key,
  service_name text,
  is_enabled boolean not null default true,
  is_favorite boolean not null default false,
  price_override_ngn integer,
  auto_markup_enabled boolean not null default true,
  margin_ngn integer,
  provider_cost_usd numeric,
  exchange_rate numeric,
  available_count integer,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sms_product_settings_price_override_nonnegative check (
    price_override_ngn is null or price_override_ngn >= 0
  ),
  constraint sms_product_settings_margin_nonnegative check (
    margin_ngn is null or margin_ngn >= 0
  )
);

alter table public.sms_product_settings enable row level security;

drop policy if exists "sms_product_settings_admin_select" on public.sms_product_settings;
create policy "sms_product_settings_admin_select"
  on public.sms_product_settings
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.is_admin = true
    )
  );

drop policy if exists "sms_product_settings_admin_write" on public.sms_product_settings;
create policy "sms_product_settings_admin_write"
  on public.sms_product_settings
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

grant select, insert, update on public.sms_product_settings to authenticated;
