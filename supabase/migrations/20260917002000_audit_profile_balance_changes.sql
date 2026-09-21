-- Forensics for any direct or indirect customer balance movement.
-- This records profile balance changes even when they are made by service-role
-- code, webhooks, staff tools, or the Supabase dashboard.

CREATE TABLE IF NOT EXISTS public.profile_balance_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  email text,
  changed_by uuid,
  changed_role text,
  changed_at timestamptz NOT NULL DEFAULT now(),
  old_wallet_balance numeric,
  new_wallet_balance numeric,
  old_crypto_balance numeric,
  new_crypto_balance numeric,
  old_referral_balance numeric,
  new_referral_balance numeric,
  row_snapshot_old jsonb NOT NULL,
  row_snapshot_new jsonb NOT NULL
);

ALTER TABLE public.profile_balance_audit ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE ON public.profile_balance_audit FROM anon, authenticated;

DROP POLICY IF EXISTS "Admins can read profile balance audit" ON public.profile_balance_audit;
CREATE POLICY "Admins can read profile balance audit"
ON public.profile_balance_audit
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
  )
);

CREATE OR REPLACE FUNCTION public.audit_profile_balance_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(OLD.wallet_balance, 0) IS DISTINCT FROM COALESCE(NEW.wallet_balance, 0)
    OR COALESCE(OLD.crypto_balance, 0) IS DISTINCT FROM COALESCE(NEW.crypto_balance, 0)
    OR COALESCE(OLD.referral_balance, 0) IS DISTINCT FROM COALESCE(NEW.referral_balance, 0)
  THEN
    INSERT INTO public.profile_balance_audit (
      profile_id,
      email,
      changed_by,
      changed_role,
      old_wallet_balance,
      new_wallet_balance,
      old_crypto_balance,
      new_crypto_balance,
      old_referral_balance,
      new_referral_balance,
      row_snapshot_old,
      row_snapshot_new
    )
    VALUES (
      NEW.id,
      NEW.email,
      auth.uid(),
      current_user,
      OLD.wallet_balance,
      NEW.wallet_balance,
      OLD.crypto_balance,
      NEW.crypto_balance,
      OLD.referral_balance,
      NEW.referral_balance,
      to_jsonb(OLD),
      to_jsonb(NEW)
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_profile_balance_change() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS audit_profile_balance_update ON public.profiles;
CREATE TRIGGER audit_profile_balance_update
AFTER UPDATE OF wallet_balance, crypto_balance, referral_balance ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.audit_profile_balance_change();
