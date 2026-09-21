-- Financial ledger rows are append-only and wallet-engine-authoritative.
-- Normal app code must use public.apply_wallet_transaction(); direct writes are
-- skipped and audited even for service-role callers unless they are explicitly
-- marked as a balance-neutral admin evidence repair.

CREATE TABLE IF NOT EXISTS public.transaction_ledger_blocked_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempted_at timestamptz NOT NULL DEFAULT now(),
  operation text NOT NULL,
  request_role text,
  actor_id uuid,
  row_user_id uuid,
  row_type text,
  row_amount numeric,
  row_reference text,
  row_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.transaction_ledger_blocked_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read transaction ledger blocked attempts" ON public.transaction_ledger_blocked_attempts;
CREATE POLICY "Admins can read transaction ledger blocked attempts"
ON public.transaction_ledger_blocked_attempts
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (p.is_admin = true OR p.email = 'admin@tallystore.org')
  )
);

CREATE OR REPLACE FUNCTION public.guard_transaction_ledger_authority()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  request_role text := COALESCE(auth.role(), current_user);
  is_wallet_engine boolean := COALESCE(current_setting('app.tally_wallet_engine_authorized', true), '') = 'true';
  is_balance_neutral_admin_repair boolean := false;
  attempted_row public.transactions%ROWTYPE;
BEGIN
  IF is_wallet_engine THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    attempted_row := NEW;
    is_balance_neutral_admin_repair :=
      COALESCE(NEW.metadata->>'source', '') = 'admin-ledger-repair'
      AND NEW.created_by IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = NEW.created_by
          AND COALESCE(p.is_admin, false) = true
      )
      AND lower(COALESCE(NEW.type, '')) IN ('admin_credit', 'correction_credit')
      AND COALESCE(NEW.status, 'completed') = 'completed'
      AND COALESCE(NEW.amount, 0) > 0
      AND COALESCE(NEW.balance_before, 0) = COALESCE(NEW.balance_after, 0)
      AND COALESCE(NEW.metadata->>'balance_unchanged', '') = 'true'
      AND COALESCE(NEW.metadata->>'requires_owner_evidence', '') = 'true';

    IF is_balance_neutral_admin_repair THEN
      RETURN NEW;
    END IF;
  ELSE
    attempted_row := OLD;
  END IF;

  INSERT INTO public.transaction_ledger_blocked_attempts (
    operation,
    request_role,
    actor_id,
    row_user_id,
    row_type,
    row_amount,
    row_reference,
    row_id,
    metadata
  )
  VALUES (
    TG_OP,
    request_role,
    auth.uid(),
    attempted_row.user_id,
    attempted_row.type,
    attempted_row.amount,
    attempted_row.reference,
    attempted_row.id,
    jsonb_build_object(
      'reason', 'direct_transaction_ledger_write_blocked',
      'balance_type', attempted_row.balance_type,
      'idempotency_key_present', attempted_row.idempotency_key IS NOT NULL,
      'external_payment_id_present', attempted_row.external_payment_id IS NOT NULL
    )
  );

  RAISE WARNING 'transactions_direct_write_blocked';

  -- Return NULL instead of raising so the audit row survives. In a BEFORE row
  -- trigger, NULL skips the attempted INSERT/UPDATE/DELETE row.
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_transaction_ledger_authority ON public.transactions;
CREATE TRIGGER trg_guard_transaction_ledger_authority
BEFORE INSERT OR UPDATE OR DELETE ON public.transactions
FOR EACH ROW
EXECUTE FUNCTION public.guard_transaction_ledger_authority();
