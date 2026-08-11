-- Add idempotency_key column to bills_transactions to prevent double-charges
-- This column stores a unique key per purchase attempt

ALTER TABLE public.bills_transactions ADD COLUMN IF NOT EXISTS idempotency_key text NULL;

-- Create unique index on user_id + idempotency_key to enforce uniqueness per user
-- This ensures the same user can't reuse an idempotency key
CREATE UNIQUE INDEX IF NOT EXISTS idx_bills_transactions_user_idempotency 
ON public.bills_transactions USING btree (user_id, idempotency_key) 
TABLESPACE pg_default
WHERE idempotency_key IS NOT NULL;

-- Add index for faster lookups by idempotency_key
CREATE INDEX IF NOT EXISTS idx_bills_transactions_idempotency_key 
ON public.bills_transactions USING btree (idempotency_key) 
TABLESPACE pg_default
WHERE idempotency_key IS NOT NULL;
