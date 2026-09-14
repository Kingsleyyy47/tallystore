-- Deposit credits must be idempotent at the database layer, not only in code.
-- Provider webhooks and manual verify calls can retry or arrive concurrently.
-- These indexes make one provider reference creditable only once.

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_topup_reference_unique
  ON public.transactions (reference)
  WHERE reference IS NOT NULL AND type = 'topup';

CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_payments_transaction_reference_unique
  ON public.pending_payments (transaction_reference)
  WHERE transaction_reference IS NOT NULL;
