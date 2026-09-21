-- Convert durable wallet guard/audit writes into standard forensic events.
--
-- These triggers do not authorize, credit, debit, or deliver value. They copy
-- already committed security/audit facts into wallet_security_events so owner
-- review has one standard incident timeline.

CREATE OR REPLACE FUNCTION public.capture_transaction_ledger_blocked_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.record_wallet_security_event(
    'DIRECT_LEDGER_WRITE_BLOCKED',
    'critical',
    NEW.row_user_id,
    NEW.row_user_id,
    NEW.actor_id,
    NEW.request_role,
    'database_trigger',
    NULL,
    'guard_transaction_ledger_authority',
    NULL,
    NEW.metadata->>'idempotency_key',
    NEW.row_reference,
    NULL,
    NULL,
    NULL,
    '{}'::jsonb,
    jsonb_build_object(
      'operation', NEW.operation,
      'row_id', NEW.row_id,
      'row_user_id', NEW.row_user_id,
      'row_type', NEW.row_type,
      'row_amount', NEW.row_amount,
      'row_reference', NEW.row_reference
    ),
    jsonb_build_object(
      'attempted_at', NEW.attempted_at,
      'balance_type', NEW.metadata->>'balance_type',
      'idempotency_key_present', NEW.metadata->>'idempotency_key_present',
      'external_payment_id_present', NEW.metadata->>'external_payment_id_present'
    ),
    jsonb_build_object('blocked_attempt_id', NEW.id),
    'denied',
    'DIRECT_LEDGER_WRITE_BLOCKED',
    COALESCE(NEW.metadata, '{}'::jsonb)
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_transaction_ledger_blocked_event() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_capture_transaction_ledger_blocked_event ON public.transaction_ledger_blocked_attempts;
CREATE TRIGGER trg_capture_transaction_ledger_blocked_event
AFTER INSERT ON public.transaction_ledger_blocked_attempts
FOR EACH ROW
EXECUTE FUNCTION public.capture_transaction_ledger_blocked_event();

CREATE OR REPLACE FUNCTION public.capture_profile_balance_blocked_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.record_wallet_security_event(
    'PROFILE_BALANCE_WRITE_BLOCKED',
    'critical',
    NEW.profile_id,
    NEW.profile_id,
    NEW.attempted_by,
    NEW.attempted_role,
    'database_trigger',
    NULL,
    'guard_profile_balance_authority',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    jsonb_build_object(
      'wallet_balance', NEW.old_wallet_balance,
      'crypto_balance', NEW.old_crypto_balance,
      'referral_balance', NEW.old_referral_balance
    ),
    jsonb_build_object(
      'wallet_balance', NEW.attempted_wallet_balance,
      'crypto_balance', NEW.attempted_crypto_balance,
      'referral_balance', NEW.attempted_referral_balance
    ),
    jsonb_build_object(
      'attempted_at', NEW.attempted_at,
      'database_role', NEW.database_role
    ),
    jsonb_build_object('blocked_attempt_id', NEW.id),
    'denied',
    'PROFILE_BALANCE_WRITE_BLOCKED',
    jsonb_build_object(
      'reason', NEW.reason,
      'email', NEW.email
    )
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_profile_balance_blocked_event() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_capture_profile_balance_blocked_event ON public.profile_balance_blocked_attempts;
CREATE TRIGGER trg_capture_profile_balance_blocked_event
AFTER INSERT ON public.profile_balance_blocked_attempts
FOR EACH ROW
EXECUTE FUNCTION public.capture_profile_balance_blocked_event();

CREATE OR REPLACE FUNCTION public.capture_profile_financial_freeze_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  event_type text := 'WALLET_FINANCIAL_FREEZE';
  denial text := 'WALLET_REVIEW_REQUIRED';
  request_forensics jsonb := '{}'::jsonb;
BEGIN
  BEGIN
    request_forensics := COALESCE(NULLIF(current_setting('app.tally_request_forensics', true), '')::jsonb, '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    request_forensics := '{}'::jsonb;
  END;

  IF COALESCE(NEW.suspension_reason, '') ILIKE '%unbacked%'
    OR COALESCE(NEW.suspension_reason, '') ILIKE '%backed available%'
    OR COALESCE(NEW.suspension_reason, '') ILIKE '%trusted%'
  THEN
    denial := 'WALLET_UNBACKED_FUNDS';
  ELSIF COALESCE(NEW.suspension_reason, '') ILIKE '%debt%'
    OR COALESCE(NEW.suspension_reason, '') ILIKE '%chargeback%'
  THEN
    denial := 'WALLET_DEBT_REVIEW_REQUIRED';
  ELSIF COALESCE(NEW.suspension_reason, '') ILIKE 'Auto-suspended:%' THEN
    denial := 'AUTO_LEDGER_REVIEW_REQUIRED';
  END IF;

  PERFORM public.record_wallet_security_event(
    event_type,
    'critical',
    NEW.id,
    NEW.id,
    COALESCE(NEW.suspended_by, auth.uid()),
    COALESCE(auth.role(), current_setting('request.jwt.claim.role', true), current_user),
    'database_trigger',
    request_forensics->>'route',
    'profiles_account_suspension',
    request_forensics->>'request_id',
    NULL,
    NULL,
    request_forensics->>'ip_address',
    request_forensics->>'user_agent',
    request_forensics->>'device_fingerprint',
    jsonb_build_object(
      'account_suspended', OLD.account_suspended,
      'suspension_reason', OLD.suspension_reason,
      'wallet_balance', OLD.wallet_balance,
      'crypto_balance', OLD.crypto_balance,
      'referral_balance', OLD.referral_balance
    ),
    jsonb_build_object(
      'account_suspended', NEW.account_suspended,
      'suspension_reason', NEW.suspension_reason,
      'wallet_balance', NEW.wallet_balance,
      'crypto_balance', NEW.crypto_balance,
      'referral_balance', NEW.referral_balance
    ),
    jsonb_build_object(
      'suspended_at', NEW.suspended_at,
      'updated_at', NEW.updated_at,
      'suspension_reason', NEW.suspension_reason
    ),
    jsonb_build_object('profile_id', NEW.id),
    'denied',
    denial,
    jsonb_build_object(
      'email', NEW.email,
      'request_forensics', request_forensics,
      'user_agent_hash', request_forensics->>'user_agent_hash',
      'cf_ray', request_forensics->>'cf_ray',
      'vercel_id', request_forensics->>'vercel_id'
    )
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_profile_financial_freeze_event() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_capture_profile_financial_freeze_event ON public.profiles;
CREATE TRIGGER trg_capture_profile_financial_freeze_event
AFTER UPDATE OF account_suspended, suspension_reason ON public.profiles
FOR EACH ROW
WHEN (
  NEW.account_suspended = true
  AND (
    OLD.account_suspended IS DISTINCT FROM NEW.account_suspended
    OR OLD.suspension_reason IS DISTINCT FROM NEW.suspension_reason
  )
)
EXECUTE FUNCTION public.capture_profile_financial_freeze_event();
