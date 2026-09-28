-- An administrator's later role change must not retroactively un-fund a
-- credit accepted by the wallet engine while that administrator had access.
-- Historical credits from unknown paths remain excluded pending review.
DO $patch$
DECLARE
  v_definition text;
  v_old text := $old$
        AND EXISTS (
          SELECT 1 FROM public.profiles approver
          WHERE approver.id = t.created_by AND COALESCE(approver.is_admin, false)
        )$old$;
  v_new text := $new$
        AND (
          (COALESCE(t.metadata->>'source', '') = 'admin-adjust-balance'
            AND COALESCE(t.metadata->>'approval_type', '') = 'direct_admin_adjustment')
          OR (COALESCE(t.metadata->>'source', '') = 'manage-staff'
            AND COALESCE(t.metadata->>'approval_type', '') = 'staff_action_review')
        )$new$;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.wallet_financial_truth_internal(uuid)'::regprocedure
  ) INTO v_definition;
  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'Unexpected canonical admin-credit approval gate';
  END IF;
  EXECUTE pg_catalog.replace(v_definition, v_old, v_new);
END;
$patch$;
