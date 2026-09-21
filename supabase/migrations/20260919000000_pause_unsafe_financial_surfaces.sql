-- Pause legacy financial surfaces during the wallet security review.
-- These paths predate the wallet transaction engine and must not remain
-- callable while unsupported-value vectors are being closed.

-- The deployed legacy function may have a different return type. Drop the
-- exact signature first because CREATE OR REPLACE cannot change return types.
DROP FUNCTION IF EXISTS public.transfer_crypto_to_wallet(uuid, numeric);

CREATE OR REPLACE FUNCTION public.transfer_crypto_to_wallet(
  p_user_id uuid,
  p_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Crypto balance transfer is temporarily disabled during wallet security review';
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_crypto_to_wallet(uuid, numeric) FROM public, anon, authenticated;
