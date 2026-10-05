-- Safe operational warnings. Provider error text, credentials and costs never enter this table.
CREATE TABLE public.supplier_balance_alerts (
  provider text PRIMARY KEY CHECK (provider IN ('muabanvia', 'shopclone', 'shopviaclone')),
  alert_code text NOT NULL DEFAULT 'insufficient_balance' CHECK (alert_code = 'insufficient_balance'),
  product_group_id uuid REFERENCES public.product_groups(id) ON DELETE SET NULL,
  source text NOT NULL CHECK (source IN ('process-purchase', 'auto-restock', 'manual-restock')),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  occurrence_count bigint NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  resolved_at timestamptz
);
ALTER TABLE public.supplier_balance_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.supplier_balance_alerts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.supplier_balance_alerts TO service_role;

CREATE FUNCTION public.record_supplier_balance_alert(p_provider text, p_product_group_id uuid, p_source text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO public.supplier_balance_alerts(provider, product_group_id, source)
  VALUES (p_provider, p_product_group_id, p_source)
  ON CONFLICT (provider) DO UPDATE SET
    product_group_id = EXCLUDED.product_group_id,
    source = EXCLUDED.source,
    first_seen_at = CASE WHEN supplier_balance_alerts.resolved_at IS NOT NULL THEN now() ELSE supplier_balance_alerts.first_seen_at END,
    last_seen_at = now(),
    occurrence_count = supplier_balance_alerts.occurrence_count + 1,
    resolved_at = NULL;
$$;
CREATE FUNCTION public.resolve_supplier_balance_alert(p_provider text, p_attempt_started_at timestamptz)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE public.supplier_balance_alerts SET resolved_at = now()
  WHERE provider = p_provider AND resolved_at IS NULL AND last_seen_at <= p_attempt_started_at;
$$;
REVOKE ALL ON FUNCTION public.record_supplier_balance_alert(text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_supplier_balance_alert(text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_supplier_balance_alert(text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_supplier_balance_alert(text, timestamptz) TO service_role;
