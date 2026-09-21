-- Reserve-first wallet and durable dispatch foundation.
--
-- This migration is additive infrastructure only. It does not move any active
-- route onto reserve-first processing yet, and it does not reopen paused
-- fulfillment. Browser roles receive no direct write access.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS financial_security_version integer NOT NULL DEFAULT 1;

UPDATE public.profiles
   SET financial_security_version = 1
 WHERE financial_security_version IS NULL OR financial_security_version < 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_financial_security_version_positive'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_financial_security_version_positive
      CHECK (financial_security_version >= 1) NOT VALID;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.wallet_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  amount numeric NOT NULL,
  currency text NOT NULL DEFAULT 'NGN',
  status text NOT NULL DEFAULT 'active',
  order_table text,
  order_id uuid,
  idempotency_key text NOT NULL,
  financial_security_version integer NOT NULL DEFAULT 1,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz,
  captured_at timestamptz,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wallet_reservations_amount_positive CHECK (amount > 0 AND amount = round(amount, 2)),
  CONSTRAINT wallet_reservations_currency_bounds CHECK (currency ~ '^[A-Z]{3,8}$'),
  CONSTRAINT wallet_reservations_status_valid CHECK (
    status IN ('active', 'captured', 'released', 'expired', 'canceled', 'review_required')
  ),
  CONSTRAINT wallet_reservations_terminal_timestamp CHECK (
    (status = 'captured' AND captured_at IS NOT NULL)
    OR (status IN ('released', 'expired', 'canceled') AND released_at IS NOT NULL)
    OR status IN ('active', 'review_required')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_reservations_idempotency_key_unique
  ON public.wallet_reservations (idempotency_key);

CREATE INDEX IF NOT EXISTS idx_wallet_reservations_user_status
  ON public.wallet_reservations (user_id, status);

CREATE INDEX IF NOT EXISTS idx_wallet_reservations_order
  ON public.wallet_reservations (order_table, order_id)
  WHERE order_table IS NOT NULL AND order_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.fulfillment_dispatch_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route text NOT NULL,
  order_table text NOT NULL,
  order_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reservation_id uuid REFERENCES public.wallet_reservations(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending',
  idempotency_key text NOT NULL,
  financial_security_version integer NOT NULL DEFAULT 1,
  claimed_by text,
  claim_expires_at timestamptz,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  attempts integer NOT NULL DEFAULT 0,
  sent_at timestamptz,
  blocked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fulfillment_dispatch_route_not_blank CHECK (btrim(route) <> ''),
  CONSTRAINT fulfillment_dispatch_order_table_not_blank CHECK (btrim(order_table) <> ''),
  CONSTRAINT fulfillment_dispatch_status_valid CHECK (
    status IN ('pending', 'claimed', 'sent', 'blocked', 'failed', 'canceled')
  ),
  CONSTRAINT fulfillment_dispatch_attempts_nonnegative CHECK (attempts >= 0),
  CONSTRAINT fulfillment_dispatch_claim_consistency CHECK (
    (status = 'claimed' AND claimed_by IS NOT NULL AND claim_expires_at IS NOT NULL)
    OR status <> 'claimed'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fulfillment_dispatch_outbox_idempotency_unique
  ON public.fulfillment_dispatch_outbox (idempotency_key);

CREATE INDEX IF NOT EXISTS idx_fulfillment_dispatch_outbox_pending
  ON public.fulfillment_dispatch_outbox (status, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_fulfillment_dispatch_outbox_order
  ON public.fulfillment_dispatch_outbox (order_table, order_id);

ALTER TABLE public.wallet_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fulfillment_dispatch_outbox ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.wallet_reservations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.fulfillment_dispatch_outbox FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wallet_reservations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fulfillment_dispatch_outbox TO service_role;

DROP POLICY IF EXISTS "Service role can manage wallet reservations" ON public.wallet_reservations;
CREATE POLICY "Service role can manage wallet reservations"
  ON public.wallet_reservations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can manage fulfillment dispatch outbox" ON public.fulfillment_dispatch_outbox;
CREATE POLICY "Service role can manage fulfillment dispatch outbox"
  ON public.fulfillment_dispatch_outbox
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.wallet_reservations IS
  'Service-role-only reserve-first wallet holds. This table is infrastructure for future route migration; browser roles cannot write it directly.';

COMMENT ON TABLE public.fulfillment_dispatch_outbox IS
  'Service-role-only durable fulfillment dispatch messages. Workers must re-check wallet/security state before sending supplier requests.';

COMMENT ON COLUMN public.profiles.financial_security_version IS
  'Database-owned authorization epoch. It increments whenever a customer financial suspension state changes and invalidates older reservations and dispatch messages.';
