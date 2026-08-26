-- Migration: Telegram Stars & Premium
-- Run in Supabase SQL editor

-- ── Products table (admin-configured NGN pricing) ─────────────────────────────
create table if not exists telegram_products (
  id           uuid primary key default gen_random_uuid(),
  product_type text    not null check (product_type in ('stars', 'premium')),
  label        text    not null,       -- e.g. "100 Stars", "3 Months Premium"
  quantity     integer,                -- stars: star count; null for premium
  months       integer,                -- premium: 3 / 6 / 12; null for stars
  price_ngn    numeric not null default 0,
  is_active    boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- ── Orders table ──────────────────────────────────────────────────────────────
create table if not exists telegram_orders (
  id               uuid    primary key default gen_random_uuid(),
  user_id          uuid    not null references auth.users(id),
  reference        text    unique not null,
  istar_order_id   text,
  order_type       text    not null check (order_type in ('stars', 'premium')),
  username         text    not null,   -- recipient Telegram username
  recipient_hash   text,               -- from iStar recipient/search
  recipient_name   text,
  quantity         integer,            -- stars
  months           integer,            -- premium months
  price_ngn        numeric not null,
  istar_amount     numeric,            -- TON or USDT charged by iStar
  wallet_type      text    not null default 'USDT',
  status           text    not null default 'pending'
                   check (status in ('pending','processing','completed','failed')),
  error_message    text,
  refunded_at      timestamptz,
  refund_amount_ngn numeric,
  refund_reference text,
  completed_at     timestamptz,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

-- ── Webhook logs ──────────────────────────────────────────────────────────────
create table if not exists istar_webhook_logs (
  id              uuid primary key default gen_random_uuid(),
  event_type      text,
  istar_order_id  text,
  payload         jsonb,
  error_message   text,
  created_at      timestamptz default now()
);

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table telegram_products enable row level security;
alter table telegram_orders   enable row level security;
alter table istar_webhook_logs enable row level security;

-- Products: anyone authenticated can read active products
create policy "read active telegram products"
  on telegram_products for select
  using (is_active = true);

-- Orders: users see only their own
create policy "users see own telegram orders"
  on telegram_orders for select
  using (auth.uid() = user_id);

-- Webhook logs: service role only (no anon/user policy)

-- ── Seed default products ─────────────────────────────────────────────────────
insert into telegram_products (product_type, label, quantity, price_ngn, sort_order) values
  ('stars', '50 Stars',      50,    0, 1),
  ('stars', '100 Stars',     100,   0, 2),
  ('stars', '250 Stars',     250,   0, 3),
  ('stars', '500 Stars',     500,   0, 4),
  ('stars', '1000 Stars',    1000,  0, 5),
  ('stars', '2500 Stars',    2500,  0, 6),
  ('stars', '5000 Stars',    5000,  0, 7)
on conflict do nothing;

insert into telegram_products (product_type, label, months, price_ngn, sort_order) values
  ('premium', '3 Months Premium',  3,  0, 1),
  ('premium', '6 Months Premium',  6,  0, 2),
  ('premium', '12 Months Premium', 12, 0, 3)
on conflict do nothing;
