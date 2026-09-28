-- Surface a chronology clue without changing trusted principal or automatically
-- freezing historical customers whose provider records may be incomplete.
DO $patch$
DECLARE
  v_definition text;
  v_patched text;
  v_chronology text := $chronology$  legacy_chronology AS (
    SELECT
      min(t.created_at) FILTER (WHERE t.amount < 0) AS first_debit_at,
      min(t.created_at) FILTER (
        WHERE t.amount > 0
          AND t.movement_type IN (
            'topup', 'top_up', 'top-up', 'wallet_topup', 'wallet_deposit',
            'deposit', 'credit', 'admin_credit', 'staff_credit',
            'promotion_credit', 'correction_credit'
          )
          AND NOT (
            t.movement_type = 'admin_credit'
            AND (
              COALESCE(t.metadata->>'source', '') = 'admin-ledger-repair'
              OR COALESCE(t.metadata->>'balance_unchanged', '') = 'true'
              OR COALESCE(t.metadata->>'requires_owner_evidence', '') = 'true'
              OR COALESCE(t.balance_after, 0) <= COALESCE(t.balance_before, 0)
            )
          )
      ) AS first_funding_at
    FROM ledger t
    WHERE t.created_at < public.wallet_legacy_funding_cutoff()
      AND t.movement_status IN (
        'completed', 'success', 'successful', 'credited',
        'complete', 'paid', 'finished'
      )
  ),
$chronology$;
BEGIN
  IF to_regprocedure('public.wallet_financial_truth_internal(uuid)') IS NULL THEN
    RAISE EXCEPTION 'wallet_financial_truth_internal_missing_for_legacy_chronology';
  END IF;

  SELECT pg_get_functiondef('public.wallet_financial_truth_internal(uuid)'::regprocedure)
    INTO v_definition;

  IF strpos(v_definition, '''legacy_first_recorded_debit_at''') > 0 THEN
    RAISE EXCEPTION 'legacy_chronology_patch_already_present';
  END IF;
  IF strpos(v_definition, '  posted AS (') = 0
    OR strpos(v_definition, '    CROSS JOIN legacy l') = 0
    OR strpos(v_definition, '''legacy_approved_principal'', b.legacy_principal,') = 0
  THEN
    RAISE EXCEPTION 'wallet_financial_truth_unexpected_definition_for_legacy_chronology';
  END IF;

  v_patched := replace(v_definition, '  posted AS (', v_chronology || '  posted AS (');
  v_patched := replace(
    v_patched,
    '    CROSS JOIN legacy l',
    '    CROSS JOIN legacy l' || chr(10) || '    CROSS JOIN legacy_chronology c'
  );
  v_patched := replace(
    v_patched,
    'l.principal AS legacy_principal, l.baseline_rows,',
    'l.principal AS legacy_principal, l.baseline_rows,' || chr(10)
      || '      c.first_debit_at AS legacy_first_debit_at,' || chr(10)
      || '      c.first_funding_at AS legacy_first_funding_at,'
  );
  v_patched := replace(
    v_patched,
    '''legacy_approved_principal'', b.legacy_principal,',
    '''legacy_approved_principal'', b.legacy_principal,' || chr(10)
      || '    ''legacy_first_recorded_debit_at'', b.legacy_first_debit_at,' || chr(10)
      || '    ''legacy_first_recorded_funding_at'', b.legacy_first_funding_at,' || chr(10)
      || '    ''legacy_spend_before_recorded_funding'',' || chr(10)
      || '      b.legacy_first_debit_at IS NOT NULL' || chr(10)
      || '      AND (b.legacy_first_funding_at IS NULL' || chr(10)
      || '        OR b.legacy_first_debit_at < b.legacy_first_funding_at),'
  );

  IF strpos(v_patched, 'c.first_debit_at AS legacy_first_debit_at') = 0
    OR strpos(v_patched, '''legacy_spend_before_recorded_funding''') = 0
  THEN
    RAISE EXCEPTION 'legacy_chronology_patch_incomplete';
  END IF;
  EXECUTE v_patched;
END;
$patch$;
