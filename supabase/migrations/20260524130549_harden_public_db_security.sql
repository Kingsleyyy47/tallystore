drop policy if exists "Service role has full access" on public.pending_payments;
drop policy if exists "Service role can manage sms rate limits" on public.sms_rate_limits;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;
revoke execute on function public.update_wallet_balance(uuid, numeric, text, text, text) from public, anon, authenticated;

alter function public.credit_crypto_balance(uuid, numeric) set search_path = public;
alter function public.deduct_crypto_balance(uuid, numeric) set search_path = public;
alter function public.handle_new_user() set search_path = public;
alter function public.transfer_crypto_to_wallet(uuid, numeric) set search_path = public;
alter function public.update_daily_limit(uuid, numeric, date) set search_path = public;
alter function public.update_sms_orders_updated_at() set search_path = public;
alter function public.update_stock_count() set search_path = public;
alter function public.update_wallet_balance(uuid, numeric, text, text, text) set search_path = public;
