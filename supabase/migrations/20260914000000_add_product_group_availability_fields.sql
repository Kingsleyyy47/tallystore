alter table public.product_groups
  add column if not exists availability_status text default 'UNKNOWN',
  add column if not exists is_sellable boolean default true;

alter table public.product_groups
  alter column availability_status set default 'UNKNOWN',
  alter column is_sellable set default true;

update public.product_groups
set
  availability_status = case
    when coalesce(is_active, false) = false then 'PAUSED'
    when coalesce(stock_count, 0) > 3 then 'AVAILABLE'
    when coalesce(stock_count, 0) > 0 then 'LOW_STOCK'
    else 'UNAVAILABLE'
  end,
  is_sellable = coalesce(is_active, false) = true and coalesce(stock_count, 0) > 0
where availability_status is null
  or availability_status = 'UNKNOWN'
  or is_sellable is null;

alter table public.product_groups
  alter column availability_status set not null,
  alter column is_sellable set not null;

create index if not exists idx_product_groups_sellable
  on public.product_groups(is_active, is_sellable, availability_status);
