-- Add idempotency_key column to orders table to prevent duplicate purchases
-- Run this migration in Supabase SQL Editor

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS idempotency_key text NULL;

-- Create unique index on user_id + idempotency_key to enforce uniqueness per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_user_idempotency 
ON public.orders USING btree (user_id, idempotency_key) 
WHERE idempotency_key IS NOT NULL;

-- Add index for faster lookups by idempotency_key
CREATE INDEX IF NOT EXISTS idx_orders_idempotency_key 
ON public.orders USING btree (idempotency_key) 
WHERE idempotency_key IS NOT NULL;
