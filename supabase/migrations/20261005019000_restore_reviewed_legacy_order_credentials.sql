-- The wallet funding cutoff remains unchanged. Restore only this reviewed
-- snapshot of 31 historic purchases whose credentials and debit still exist.
-- This archive stores hashes and proof IDs, never account usernames/passwords.
SET LOCAL TIME ZONE 'UTC';
CREATE TABLE public.reviewed_legacy_order_credentials (
  order_id uuid PRIMARY KEY REFERENCES public.orders(id),
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  product_group_id uuid NOT NULL REFERENCES public.product_groups(id),
  order_amount numeric NOT NULL CHECK(order_amount>0),
  order_created_at timestamptz NOT NULL,
  payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[a-f0-9]{64}$'),
  debit_transaction_id uuid NOT NULL UNIQUE REFERENCES public.transactions(id),
  debit_created_at timestamptz NOT NULL,
  debit_description_sha256 text NOT NULL CHECK(debit_description_sha256 ~ '^[a-f0-9]{64}$'),
  sold_account_ids uuid[] NOT NULL CHECK(cardinality(sold_account_ids)>0),
  reviewed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.reviewed_legacy_order_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reviewed_legacy_order_credentials FROM PUBLIC,anon,authenticated,service_role;

CREATE TEMP TABLE reviewed_legacy_credential_candidates ON COMMIT DROP AS
WITH eligible AS (
  SELECT o.* FROM public.orders o
  WHERE o.status='completed' AND o.financial_authorization_status IS NULL
    AND o.wallet_reservation_id IS NULL AND o.fulfillment_outbox_id IS NULL
    AND o.financial_security_version IS NULL AND o.amount>0
    AND o.created_at>='2026-09-19 00:00:00+00'::timestamptz
    AND o.created_at<'2026-09-21 00:00:00+00'::timestamptz
    AND jsonb_typeof(o.account_details)='object'
    AND jsonb_typeof(o.account_details->'accounts')='array'
    AND jsonb_array_length(o.account_details->'accounts')>0
    AND CASE WHEN o.account_details->>'quantity' ~ '^[1-9][0-9]{0,5}$'
      THEN (o.account_details->>'quantity')::integer=jsonb_array_length(o.account_details->'accounts') ELSE false END
    AND CASE WHEN o.account_details->>'charged_amount_ngn' ~ '^[0-9]+([.][0-9]{1,2})?$'
      THEN (o.account_details->>'charged_amount_ngn')::numeric=o.amount ELSE false END
), debit_matches AS (
  SELECT o.id AS order_id,t.id AS debit_id,t.created_at AS debit_created_at,t.description,
    count(*) OVER(PARTITION BY o.id) AS order_match_count,
    count(*) OVER(PARTITION BY t.id) AS debit_match_count
  FROM eligible o JOIN public.transactions t
    ON t.user_id=o.user_id AND t.amount=-o.amount
    AND t.type='purchase' AND t.status='completed'
    AND t.description='Purchase: '||(o.account_details->>'quantity')||'x '||(o.account_details->>'product_name')
    AND abs(extract(epoch FROM(t.created_at-o.created_at)))<60
)
SELECT o.id AS order_id,o.user_id,o.product_group_id,o.amount AS order_amount,
  o.created_at AS order_created_at,
  encode(sha256(convert_to(o.account_details::text,'UTF8')),'hex') AS payload_sha256,
  d.debit_id AS debit_transaction_id,d.debit_created_at,
  encode(sha256(convert_to(d.description,'UTF8')),'hex') AS debit_description_sha256,
  inventory.sold_account_ids
FROM eligible o JOIN debit_matches d ON d.order_id=o.id
CROSS JOIN LATERAL (
  SELECT array_agg(DISTINCT a.id ORDER BY a.id) AS sold_account_ids,count(*) AS match_count
  FROM jsonb_array_elements(o.account_details->'accounts') item
  JOIN public.individual_accounts a ON a.product_group_id=o.product_group_id AND a.status='sold'
    AND NULLIF(item->>'username','') IS NOT NULL AND NULLIF(item->>'password','') IS NOT NULL
    AND a.username=item->>'username' AND a.password=item->>'password'
    AND abs(extract(epoch FROM(a.sold_at-o.created_at)))<60
) inventory
WHERE d.order_match_count=1 AND d.debit_match_count=1
  AND inventory.match_count=jsonb_array_length(o.account_details->'accounts')
  AND cardinality(inventory.sold_account_ids)=jsonb_array_length(o.account_details->'accounts');

DO $reviewed_snapshot$
DECLARE v_manifest text;
BEGIN
  IF (SELECT count(*) FROM public.orders WHERE status='completed'
      AND financial_authorization_status IS NULL
      AND created_at>='2026-09-19 00:00:00+00'::timestamptz
      AND created_at<'2026-09-21 00:00:00+00'::timestamptz)<>31
    OR (SELECT count(*) FROM reviewed_legacy_credential_candidates)<>31 THEN
    RAISE EXCEPTION 'reviewed_legacy_credential_snapshot_requires_31_verified_orders';
  END IF;
  IF (SELECT count(*) FROM reviewed_legacy_credential_candidates c CROSS JOIN LATERAL unnest(c.sold_account_ids) account_id)
    <> (SELECT count(DISTINCT account_id) FROM reviewed_legacy_credential_candidates c CROSS JOIN LATERAL unnest(c.sold_account_ids) account_id) THEN
    RAISE EXCEPTION 'reviewed_legacy_credential_inventory_cannot_be_reused';
  END IF;
  SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    jsonb_agg(to_jsonb(c) ORDER BY c.order_id)::text,'UTF8')),'hex') INTO v_manifest
    FROM reviewed_legacy_credential_candidates c;
  IF v_manifest <> '7b31d4eb2951b361e6e8ff64816affa00a639d98f34c0d213bb59124c76ba760' THEN
    RAISE EXCEPTION 'reviewed_legacy_credential_manifest_does_not_match';
  END IF;
END;
$reviewed_snapshot$;

INSERT INTO public.reviewed_legacy_order_credentials(
  order_id,user_id,product_group_id,order_amount,order_created_at,payload_sha256,
  debit_transaction_id,debit_created_at,debit_description_sha256,sold_account_ids
) SELECT order_id,user_id,product_group_id,order_amount,order_created_at,payload_sha256,
  debit_transaction_id,debit_created_at,debit_description_sha256,sold_account_ids
FROM reviewed_legacy_credential_candidates;

-- Neither browser nor service callers can append approvals or change them.
-- Any later review requires a separately audited database migration.
CREATE FUNCTION public.guard_reviewed_legacy_credential_archive()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'reviewed_legacy_credential_archive_is_immutable'; END;
$$;
CREATE TRIGGER reviewed_legacy_credential_archive_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON public.reviewed_legacy_order_credentials
  FOR EACH ROW EXECUTE FUNCTION public.guard_reviewed_legacy_credential_archive();
CREATE TRIGGER reviewed_legacy_credential_archive_no_truncate
  BEFORE TRUNCATE ON public.reviewed_legacy_order_credentials
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_reviewed_legacy_credential_archive();
REVOKE ALL ON FUNCTION public.guard_reviewed_legacy_credential_archive() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.is_reviewed_legacy_order_credential_access(p_order_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.reviewed_legacy_order_credentials reviewed
    JOIN public.orders o ON o.id=reviewed.order_id
    JOIN public.transactions debit ON debit.id=reviewed.debit_transaction_id
    WHERE o.id=p_order_id AND o.user_id=(SELECT auth.uid())
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
REVOKE ALL ON FUNCTION public.is_reviewed_legacy_order_credential_access(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.is_reviewed_legacy_order_credential_access(uuid) TO authenticated;

CREATE OR REPLACE VIEW public.orders_safe_history AS
SELECT o.id,o.user_id,o.product_group_id,o.amount,o.status,o.created_at,
  CASE WHEN o.user_id=(SELECT auth.uid()) AND lower(COALESCE(o.status,''))='completed'
    AND (o.created_at<'2026-09-19 00:00:00+00'::timestamptz
      OR o.financial_authorization_status='captured'
      OR public.is_reviewed_legacy_order_credential_access(o.id))
  THEN o.account_details ELSE jsonb_build_object(
    'product_name',o.account_details->>'product_name','category',o.account_details->>'category',
    'category_id',o.account_details->>'category_id','quantity',o.account_details->'quantity',
    'price_per_unit',o.account_details->'price_per_unit','original_total',o.account_details->'original_total'
  ) END AS account_details,
  CASE WHEN pg.id IS NULL THEN NULL ELSE jsonb_build_object(
    'name',pg.name,'price',pg.price,'category_id',pg.category_id,
    'categories',CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('name',c.name) END
  ) END AS product_groups
FROM public.orders o LEFT JOIN public.product_groups pg ON pg.id=o.product_group_id
LEFT JOIN public.categories c ON c.id=pg.category_id
WHERE o.user_id=(SELECT auth.uid()) OR public.is_admin_profile();
ALTER VIEW public.orders_safe_history SET(security_invoker=false,security_barrier=true);
REVOKE ALL ON public.orders_safe_history FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.orders_safe_history TO authenticated;
