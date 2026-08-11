create table if not exists public.sms_rate_limits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  window_start timestamptz not null,
  count integer not null default 1 check (count > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, action, window_start)
);

create index if not exists idx_sms_rate_limits_window
  on public.sms_rate_limits (window_start);

create index if not exists idx_sms_rate_limits_user_action
  on public.sms_rate_limits (user_id, action, window_start desc);

alter table public.sms_rate_limits enable row level security;
