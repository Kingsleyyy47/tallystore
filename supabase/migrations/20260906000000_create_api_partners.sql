create table if not exists public.api_partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_email text,
  is_active boolean not null default true,
  allowed_sections text[] not null default array[
    'products',
    'sms',
    'social_boost',
    'bills_airtime',
    'giftcards',
    'crypto',
    'telegram_stars'
  ],
  markup_percent numeric not null default 0,
  balance_ngn numeric not null default 0,
  webhook_url text,
  webhook_secret text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint api_partners_markup_nonnegative check (markup_percent >= 0),
  constraint api_partners_balance_nonnegative check (balance_ngn >= 0)
);

create table if not exists public.api_partner_keys (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.api_partners(id) on delete cascade,
  key_name text not null default 'Default key',
  key_prefix text not null,
  key_hash text not null unique,
  scopes text[] not null default array[
    'catalogue:read',
    'orders:create',
    'orders:read',
    'wallet:read'
  ],
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.api_partner_orders (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.api_partners(id) on delete restrict,
  partner_reference text,
  idempotency_key text not null,
  item_type text not null,
  item_id text not null,
  item_name text,
  quantity integer not null default 1,
  amount_ngn numeric not null default 0,
  currency text not null default 'NGN',
  status text not null default 'pending',
  customer_email text,
  customer_phone text,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  fulfillment_source text,
  fulfillment_id text,
  error_message text,
  refunded_at timestamptz,
  refund_amount_ngn numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint api_partner_orders_unique_idempotency unique (partner_id, idempotency_key),
  constraint api_partner_orders_amount_nonnegative check (amount_ngn >= 0),
  constraint api_partner_orders_quantity_positive check (quantity > 0)
);

create table if not exists public.api_partner_logs (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid references public.api_partners(id) on delete set null,
  key_id uuid references public.api_partner_keys(id) on delete set null,
  action text,
  method text,
  status_code integer,
  success boolean not null default false,
  error_message text,
  ip_address text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_api_partner_keys_partner on public.api_partner_keys(partner_id);
create index if not exists idx_api_partner_keys_hash on public.api_partner_keys(key_hash);
create index if not exists idx_api_partner_orders_partner_created on public.api_partner_orders(partner_id, created_at desc);
create index if not exists idx_api_partner_orders_idempotency on public.api_partner_orders(partner_id, idempotency_key);
create index if not exists idx_api_partner_logs_partner_created on public.api_partner_logs(partner_id, created_at desc);

alter table public.api_partners enable row level security;
alter table public.api_partner_keys enable row level security;
alter table public.api_partner_orders enable row level security;
alter table public.api_partner_logs enable row level security;

drop policy if exists "api_partners_admin_all" on public.api_partners;
create policy "api_partners_admin_all"
  on public.api_partners
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

drop policy if exists "api_partner_keys_admin_all" on public.api_partner_keys;
create policy "api_partner_keys_admin_all"
  on public.api_partner_keys
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

drop policy if exists "api_partner_orders_admin_all" on public.api_partner_orders;
create policy "api_partner_orders_admin_all"
  on public.api_partner_orders
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

drop policy if exists "api_partner_logs_admin_all" on public.api_partner_logs;
create policy "api_partner_logs_admin_all"
  on public.api_partner_logs
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

revoke all on public.api_partners from anon;
revoke all on public.api_partner_keys from anon;
revoke all on public.api_partner_orders from anon;
revoke all on public.api_partner_logs from anon;

grant select, insert, update, delete on public.api_partners to authenticated;
grant select, insert, update, delete on public.api_partner_keys to authenticated;
grant select, insert, update, delete on public.api_partner_orders to authenticated;
grant select, insert, update, delete on public.api_partner_logs to authenticated;
