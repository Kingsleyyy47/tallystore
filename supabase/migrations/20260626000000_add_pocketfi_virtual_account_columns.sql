-- PocketFi was originally wired up assuming a hosted-checkout flow (like Ercas Pay),
-- but PocketFi's real API has no such endpoint. PocketFi instead issues a PERMANENT
-- virtual bank account per user: the user transfers money into it from their own
-- banking app, and PocketFi notifies us via webhook when the transfer lands.
--
-- These columns cache that account so we only ever call PocketFi's
-- /virtual-accounts/create endpoint once per user.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pocketfi_account_number TEXT,
  ADD COLUMN IF NOT EXISTS pocketfi_account_name TEXT,
  ADD COLUMN IF NOT EXISTS pocketfi_bank TEXT;

-- The webhook looks up "which user does this account number belong to" on every
-- inward transfer notification, so this needs to be fast.
CREATE INDEX IF NOT EXISTS idx_profiles_pocketfi_account_number
  ON public.profiles (pocketfi_account_number)
  WHERE pocketfi_account_number IS NOT NULL;

-- Debugging aid: PocketFi's webhook payload shape isn't publicly documented, so we
-- log every raw webhook delivery here. Once a real transfer lands you can inspect
-- this table to see PocketFi's actual field names and refine the parsing logic in
-- api/webhook-pocketfi.ts if needed.
CREATE TABLE IF NOT EXISTS public.pocketfi_webhook_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  raw_payload jsonb NOT NULL,
  matched_user_id uuid NULL,
  matched_account_number TEXT NULL,
  processed BOOLEAN NOT NULL DEFAULT false,
  error_message TEXT NULL,
  created_at TIMESTAMP WITH TIME ZONE NULL DEFAULT now(),
  CONSTRAINT pocketfi_webhook_logs_pkey PRIMARY KEY (id)
) TABLESPACE pg_default;

ALTER TABLE public.pocketfi_webhook_logs ENABLE ROW LEVEL SECURITY;

-- Service role only (the webhook uses the service role key) — no anon/authenticated access.
CREATE POLICY "Service role has full access" ON public.pocketfi_webhook_logs
  FOR ALL
  USING (true)
  WITH CHECK (true);
