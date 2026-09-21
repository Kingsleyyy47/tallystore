-- Reconcile automatic wallet-review holds after legacy funding is grandfathered.
--
-- The prior review migration correctly moved automatic freezes out of
-- account_suspended, but it did not know about the later legacy funding
-- baseline. Once that baseline exists, qualifying legacy customers whose
-- current ledger is covered must not remain purchase-blocked.
--
-- This is deliberately narrow:
--   * only users present in wallet_legacy_funding are considered;
--   * the existing evaluator decides whether spend/displayed balance is covered;
--   * users without legacy funding evidence remain in review;
--   * manual account suspensions are not changed here.

DO $reconcile$
DECLARE
  v_reconciled_count integer := 0;
BEGIN
  PERFORM set_config('app.tally_profile_privileged_authorized', 'true', true);

  WITH evaluated AS (
    SELECT
      p.id,
      public.evaluate_customer_ledger_suspension(p.id, 1) AS result
    FROM public.profiles p
    JOIN public.wallet_legacy_funding f
      ON f.user_id = p.id
    WHERE COALESCE(p.wallet_review_required, false) = true
      AND COALESCE(p.account_suspended, false) = false
      AND COALESCE(p.is_admin, false) = false
      AND COALESCE(p.is_staff, false) = false
  ),
  eligible AS (
    SELECT id
    FROM evaluated
    WHERE COALESCE(NULLIF(result->>'spend_exposure', '')::numeric, 0) <= 1
      AND COALESCE(NULLIF(result->>'displayed_balance_exposure', '')::numeric, 0) <= 1
  )
  UPDATE public.profiles p
     SET wallet_review_required = false,
         wallet_review_reason = NULL,
         wallet_reviewed_at = now(),
         wallet_reviewed_by = NULL,
         updated_at = now()
   WHERE p.id IN (SELECT id FROM eligible);

  GET DIAGNOSTICS v_reconciled_count = ROW_COUNT;

  PERFORM set_config('app.tally_profile_privileged_authorized', 'false', true);

  RAISE NOTICE 'Cleared % grandfathered wallet-review holds with covered funds', v_reconciled_count;
EXCEPTION
  WHEN OTHERS THEN
    PERFORM set_config('app.tally_profile_privileged_authorized', 'false', true);
    RAISE;
END;
$reconcile$;

COMMENT ON TABLE public.wallet_legacy_funding IS
  'Immutable-by-policy baseline of qualifying wallet credits recorded before backed-funding enforcement. Legacy review reconciliation only clears covered automatic holds.';
