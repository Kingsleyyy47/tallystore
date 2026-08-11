-- Global "Recent Activity" social-proof feed
-- Run this once in the Supabase SQL editor.
--
-- Exposes a SECURITY DEFINER function that returns a small, pre-masked slice of
-- recent site-wide activity (wallet top-ups + completed orders) for display on
-- every page. It deliberately does NOT expose raw user rows (email, ids, etc.)
-- to anon/authenticated roles directly -- callers only ever get back the masked
-- name, amount, a label, and a timestamp, which keeps this safe to call from
-- logged-out visitors on public pages too.

create or replace function public.get_recent_activity_feed(p_limit int default 12)
returns table (
  kind text,
  masked_name text,
  amount numeric,
  label text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  (
    select
      'deposit'::text as kind,
      coalesce(substring(split_part(p.email, '@', 1) from 1 for 3), 'Use') || '***' as masked_name,
      t.amount,
      case
        when t.description ilike '%pocketfi%' then 'via PocketFi'
        when t.description ilike '%ercas%' then 'via Ercas Pay'
        else 'via wallet top-up'
      end as label,
      t.created_at
    from transactions t
    join profiles p on p.id = t.user_id
    where t.type = 'topup'
      and t.status = 'completed'
    order by t.created_at desc
    limit p_limit
  )
  union all
  (
    select
      'order'::text as kind,
      coalesce(substring(split_part(p.email, '@', 1) from 1 for 3), 'Use') || '***' as masked_name,
      o.amount,
      coalesce(o.account_details->>'product_name', 'an account') as label,
      o.created_at
    from orders o
    join profiles p on p.id = o.user_id
    where o.status = 'completed'
    order by o.created_at desc
    limit p_limit
  )
  order by created_at desc
  limit p_limit
$$;

-- Callable by visitors (anon) and logged-in users alike, since this widget
-- shows on every page including pre-login pages.
revoke all on function public.get_recent_activity_feed(int) from public;
grant execute on function public.get_recent_activity_feed(int) to anon, authenticated;
