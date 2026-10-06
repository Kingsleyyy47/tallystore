-- Give individual API keys the same credential decision as orders_safe_history.
-- The browser view is unchanged. This RPC is service-only and always scopes an
-- order to the already-authenticated customer ID supplied by customer-api.
DO $preflight$
BEGIN
  IF to_regclass('public.reviewed_legacy_order_credentials') IS NULL
    OR to_regclass('public.orders_safe_history') IS NULL
    OR to_regprocedure('public.is_reviewed_legacy_order_credential_access(uuid)') IS NULL
    OR to_regnamespace('private') IS NULL THEN
    RAISE EXCEPTION 'customer_api_product_history_baseline_missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='is_reviewed_legacy_order_credential_access'
      AND pg_get_function_identity_arguments(p.oid)='p_order_id uuid'
      AND p.prosecdef AND p.provolatile='s'
  ) OR position('is_reviewed_legacy_order_credential_access' IN
      pg_get_viewdef('public.orders_safe_history'::regclass))=0
    OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.pg_get_functiondef('public.is_reviewed_legacy_order_credential_access(uuid)'::regprocedure),'UTF8')),'hex')
      <> '5f47d582d9afdd3d8064ca2312ad30f1220dfc9c03f31ec48742f7e8dc4a60fe' THEN
    RAISE EXCEPTION 'customer_api_product_history_baseline_changed';
  END IF;
END $preflight$;

-- Exact migration-190 immutable archive proof, parameterized by an explicitly
-- bound user instead of relying on auth.uid(). Neither browser nor service
-- callers receive EXECUTE on this private implementation.
CREATE FUNCTION private.reviewed_legacy_order_credential_proof_for_user(
  p_user_id uuid, p_order_id uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.reviewed_legacy_order_credentials reviewed
    JOIN public.orders o ON o.id=reviewed.order_id
    JOIN public.transactions debit ON debit.id=reviewed.debit_transaction_id
    WHERE o.id=p_order_id AND o.user_id=p_user_id
      AND o.user_id=reviewed.user_id AND o.product_group_id=reviewed.product_group_id
      AND o.amount=reviewed.order_amount AND o.created_at=reviewed.order_created_at
      AND o.status='completed' AND o.financial_authorization_status IS NULL
      AND o.wallet_reservation_id IS NULL AND o.fulfillment_outbox_id IS NULL
      AND o.financial_security_version IS NULL
      AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(o.account_details::text,'UTF8')),'hex')=reviewed.payload_sha256
      AND debit.user_id=reviewed.user_id AND debit.type='purchase' AND debit.status='completed'
      AND debit.amount=-reviewed.order_amount AND debit.created_at=reviewed.debit_created_at
      AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(debit.description,'UTF8')),'hex')=reviewed.debit_description_sha256
  );
$$;
REVOKE ALL ON FUNCTION private.reviewed_legacy_order_credential_proof_for_user(uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;

-- Existing authenticated view calls this signature. Keep its auth.uid()
-- boundary and ACL intact while sharing the one archive proof predicate.
CREATE OR REPLACE FUNCTION public.is_reviewed_legacy_order_credential_access(p_order_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT private.reviewed_legacy_order_credential_proof_for_user((SELECT auth.uid()),p_order_id);
$$;
REVOKE ALL ON FUNCTION public.is_reviewed_legacy_order_credential_access(uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.is_reviewed_legacy_order_credential_access(uuid)
  TO authenticated;

CREATE FUNCTION public.get_customer_api_product_order_detail(
  p_user_id uuid, p_order_id uuid
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT COALESCE((
    SELECT jsonb_build_object('success',true,'order',jsonb_build_object(
      'id',o.id,'status',o.status,'amount',o.amount,'created_at',o.created_at,
      'product_group_id',o.product_group_id,
      'account_details',CASE WHEN lower(COALESCE(o.status,''))='completed'
        AND (o.created_at<'2026-09-19 00:00:00+00'::timestamptz
          OR o.financial_authorization_status='captured'
          OR private.reviewed_legacy_order_credential_proof_for_user(p_user_id,o.id))
        THEN o.account_details ELSE jsonb_build_object(
          'product_name',o.account_details->>'product_name',
          'category',o.account_details->>'category',
          'category_id',o.account_details->>'category_id',
          'quantity',o.account_details->'quantity',
          'price_per_unit',o.account_details->'price_per_unit',
          'original_total',o.account_details->'original_total') END))
    FROM public.orders o JOIN public.profiles p ON p.id=o.user_id
    WHERE o.id=p_order_id AND o.user_id=p_user_id
      AND p.account_suspended IS DISTINCT FROM true
      AND p.is_admin IS DISTINCT FROM true AND p.is_staff IS DISTINCT FROM true
  ),jsonb_build_object('success',false,'code','not_found'));
$$;
REVOKE ALL ON FUNCTION public.get_customer_api_product_order_detail(uuid,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_api_product_order_detail(uuid,uuid)
  TO service_role;
