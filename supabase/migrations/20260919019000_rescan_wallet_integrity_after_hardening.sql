-- Re-evaluate existing customer wallets after the hardened trusted-principal
-- rules are installed. This migration can freeze/review unbacked wallets, but
-- it intentionally never auto-unsuspends a customer.

DO $$
DECLARE
  customer record;
  result jsonb;
  scanned_count integer := 0;
  suspended_count integer := 0;
  fail_closed_count integer := 0;
  error_count integer := 0;
BEGIN
  FOR customer IN
    SELECT id
    FROM public.profiles
    WHERE COALESCE(is_admin, false) = false
      AND COALESCE(is_staff, false) = false
  LOOP
    BEGIN
      scanned_count := scanned_count + 1;
      result := public.evaluate_customer_ledger_suspension(customer.id, 1);

      IF COALESCE((result->>'suspended')::boolean, false) THEN
        suspended_count := suspended_count + 1;
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        error_count := error_count + 1;
        PERFORM set_config('app.tally_profile_privileged_authorized', 'true', true);

        UPDATE public.profiles
          SET account_suspended = true,
              suspension_reason = 'Auto-suspended: wallet integrity could not be verified during hardening deployment; owner review required',
              suspended_at = COALESCE(suspended_at, now()),
              suspended_by = NULL,
              updated_at = now()
          WHERE id = customer.id
            AND COALESCE(account_suspended, false) = false;

        IF FOUND THEN
          fail_closed_count := fail_closed_count + 1;
        END IF;

        PERFORM set_config('app.tally_profile_privileged_authorized', 'false', true);

        RAISE WARNING 'wallet_integrity_rescan_failed profile_id=% sqlstate=% message=%',
          customer.id,
          SQLSTATE,
          SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE 'wallet_integrity_rescan_after_hardening scanned=% suspended_or_reviewed=% fail_closed=% errors=%',
    scanned_count,
    suspended_count,
    fail_closed_count,
    error_count;
END $$;
