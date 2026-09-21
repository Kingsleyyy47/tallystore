-- Add route-level idempotency to Telegram Stars/Premium orders so a retried
-- checkout request cannot create a second local order, wallet debit, or iStar
-- dispatch for the same customer operation.

ALTER TABLE public.telegram_orders
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_orders_user_idempotency_key_unique
  ON public.telegram_orders (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND idempotency_key <> '';

CREATE INDEX IF NOT EXISTS idx_telegram_orders_idempotency_key
  ON public.telegram_orders (idempotency_key)
  WHERE idempotency_key IS NOT NULL AND idempotency_key <> '';
