CREATE INDEX IF NOT EXISTS idx_orders_user_created_at
ON public.orders (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_user_completed_amount
ON public.orders (user_id)
INCLUDE (amount)
WHERE status = 'completed';

CREATE INDEX IF NOT EXISTS idx_transactions_user_created_at
ON public.transactions (user_id, created_at DESC);
