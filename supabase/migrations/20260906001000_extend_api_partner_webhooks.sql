alter table public.api_partners
  add column if not exists webhook_secret text,
  alter column allowed_sections set default array[
    'products',
    'sms',
    'social_boost',
    'bills_airtime',
    'giftcards',
    'crypto',
    'telegram_stars'
  ]::text[];

update public.api_partners
set allowed_sections = array_append(allowed_sections, 'telegram_stars')
where not ('telegram_stars' = any(coalesce(allowed_sections, array[]::text[])));

alter table public.api_partner_orders
  add column if not exists completed_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists payment_provider text,
  add column if not exists payment_reference text,
  add column if not exists payment_transaction_reference text,
  add column if not exists payment_account_number text,
  add column if not exists payment_amount_ngn numeric,
  add column if not exists paid_at timestamptz;

create unique index if not exists idx_api_partner_orders_payment_transaction_reference
  on public.api_partner_orders(payment_transaction_reference)
  where payment_transaction_reference is not null;

create index if not exists idx_api_partner_orders_payment_account_pending
  on public.api_partner_orders(payment_account_number, created_at)
  where payment_account_number is not null and status in ('awaiting_bank_transfer', 'payment_pending', 'payment_partial');

create table if not exists public.api_partner_customers (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.api_partners(id) on delete cascade,
  customer_reference text not null,
  customer_email text,
  customer_phone text,
  customer_name text,
  pocketfi_account_number text not null unique,
  pocketfi_account_name text,
  pocketfi_bank text,
  raw_provider_response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint api_partner_customers_unique_reference unique (partner_id, customer_reference)
);

create index if not exists idx_api_partner_customers_partner
  on public.api_partner_customers(partner_id, created_at desc);

alter table public.api_partner_customers enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'api_partner_customers'
      and policyname = 'Admins can manage API partner customers'
  ) then
    create policy "Admins can manage API partner customers"
      on public.api_partner_customers
      for all
      using (exists (
        select 1 from public.profiles
        where profiles.id = auth.uid()
          and profiles.is_admin = true
      ))
      with check (exists (
        select 1 from public.profiles
        where profiles.id = auth.uid()
          and profiles.is_admin = true
      ));
  end if;
end $$;

grant select, insert, update on public.api_partner_customers to authenticated;

create table if not exists public.api_partner_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.api_partners(id) on delete cascade,
  order_id uuid references public.api_partner_orders(id) on delete set null,
  event_type text not null,
  target_url text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed')),
  status_code integer,
  response_body text,
  error_message text,
  attempts integer not null default 0,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_api_partner_webhook_deliveries_partner
  on public.api_partner_webhook_deliveries(partner_id, created_at desc);

create index if not exists idx_api_partner_webhook_deliveries_order
  on public.api_partner_webhook_deliveries(order_id);

alter table public.api_partner_webhook_deliveries enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'api_partner_webhook_deliveries'
      and policyname = 'Admins can manage API partner webhook deliveries'
  ) then
    create policy "Admins can manage API partner webhook deliveries"
      on public.api_partner_webhook_deliveries
      for all
      using (exists (
        select 1 from public.profiles
        where profiles.id = auth.uid()
          and profiles.is_admin = true
      ))
      with check (exists (
        select 1 from public.profiles
        where profiles.id = auth.uid()
          and profiles.is_admin = true
      ));
  end if;
end $$;

grant select, insert, update on public.api_partner_webhook_deliveries to authenticated;
