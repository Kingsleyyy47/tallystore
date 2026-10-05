-- Partner credit is isolated from customer wallets. These admin-only controls
-- do not reopen partner purchase or supplier dispatch paths.
ALTER TABLE public.api_partners
  ADD COLUMN IF NOT EXISTS unlimited_credit boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS credit_granted_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS credit_granted_at timestamptz;

CREATE FUNCTION public.adjust_api_partner_balance_atomic(
  p_partner_id uuid, p_amount numeric, p_reason text, p_actor_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_partner public.api_partners%ROWTYPE;
BEGIN
  IF p_amount IS NULL OR p_amount = 0 OR p_amount <> round(p_amount, 2)
    OR abs(p_amount) > 1000000000 THEN
    RAISE EXCEPTION 'partner_adjustment_invalid_amount';
  END IF;
  IF p_actor_id IS DISTINCT FROM 'c1396bda-86e2-4dfc-94bb-0d95469d1d36'::uuid
    OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_actor_id
    AND p.is_admin IS TRUE AND p.account_suspended IS DISTINCT FROM true) THEN
    RAISE EXCEPTION 'partner_adjustment_admin_required';
  END IF;
  SELECT * INTO v_partner FROM public.api_partners WHERE id = p_partner_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'partner_not_found'; END IF;
  IF v_partner.balance_ngn + p_amount < 0 THEN RAISE EXCEPTION 'partner_adjustment_negative_balance'; END IF;
  UPDATE public.api_partners SET balance_ngn = v_partner.balance_ngn + p_amount,
    updated_at = now() WHERE id = p_partner_id RETURNING * INTO v_partner;
  INSERT INTO public.api_partner_logs(partner_id, action, method, status_code,
    success, metadata) VALUES (p_partner_id, 'admin_adjust_balance', 'POST', 200, true,
    jsonb_build_object('amount_ngn', p_amount, 'reason', left(coalesce(p_reason,''),500),
      'actor_user_id', p_actor_id, 'balance_after', v_partner.balance_ngn));
  RETURN jsonb_build_object('id', v_partner.id, 'name', v_partner.name,
    'balance_ngn', v_partner.balance_ngn, 'unlimited_credit', v_partner.unlimited_credit,
    'is_active', v_partner.is_active, 'allowed_sections', v_partner.allowed_sections);
END;
$$;

CREATE FUNCTION public.set_api_partner_unlimited_credit(
  p_partner_id uuid, p_enabled boolean, p_actor_id uuid, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_partner public.api_partners%ROWTYPE;
BEGIN
  IF p_enabled IS NULL OR length(btrim(coalesce(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'partner_credit_decision_requires_reason';
  END IF;
  IF p_actor_id IS DISTINCT FROM 'c1396bda-86e2-4dfc-94bb-0d95469d1d36'::uuid
    OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_actor_id
    AND p.is_admin IS TRUE AND p.account_suspended IS DISTINCT FROM true) THEN
    RAISE EXCEPTION 'partner_credit_admin_required';
  END IF;
  SELECT * INTO v_partner FROM public.api_partners WHERE id = p_partner_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'partner_not_found'; END IF;
  UPDATE public.api_partners SET unlimited_credit = p_enabled,
    credit_granted_by = CASE WHEN p_enabled THEN p_actor_id ELSE NULL END,
    credit_granted_at = CASE WHEN p_enabled THEN now() ELSE NULL END,
    updated_at = now() WHERE id = p_partner_id RETURNING * INTO v_partner;
  INSERT INTO public.api_partner_logs(partner_id, action, method, status_code,
    success, metadata) VALUES (p_partner_id, 'admin_set_unlimited_credit', 'POST', 200, true,
    jsonb_build_object('enabled', p_enabled, 'reason', left(p_reason,500),
      'actor_user_id', p_actor_id));
  RETURN jsonb_build_object('id', v_partner.id, 'unlimited_credit', v_partner.unlimited_credit,
    'credit_granted_at', v_partner.credit_granted_at);
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_api_partner_balance_atomic(uuid,numeric,text,uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_api_partner_unlimited_credit(uuid,boolean,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_api_partner_balance_atomic(uuid,numeric,text,uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.set_api_partner_unlimited_credit(uuid,boolean,uuid,text)
  TO service_role;
