-- Admin/staff balance adjustments need an idempotency key so a retried request
-- cannot create duplicate adjustment ledger rows.

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_idempotency_key_unique
  ON public.transactions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
