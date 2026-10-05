-- Owner-reviewed partner provisioning. Historical partners remain unreviewed and
-- inactive; a key can only be issued to a partner created through this RPC.
ALTER TABLE public.api_partners
  ADD COLUMN IF NOT EXISTS owner_reviewed_at timestamptz;

CREATE FUNCTION public.create_api_partner_owner(
  p_name text, p_webhook_url text, p_sections text[], p_unlimited boolean,
  p_reason text, p_actor_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_partner public.api_partners%ROWTYPE;
BEGIN
  IF p_actor_id IS DISTINCT FROM 'c1396bda-86e2-4dfc-94bb-0d95469d1d36'::uuid
    OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_actor_id
      AND p.is_admin IS TRUE AND p.account_suspended IS DISTINCT FROM true) THEN
    RAISE EXCEPTION 'partner_owner_required';
  END IF;
  IF length(btrim(coalesce(p_name, ''))) < 2 OR length(p_name) > 120
    OR p_sections IS NULL OR cardinality(p_sections) = 0
    OR p_sections <@ ARRAY['products','sms','social_boost','bills_airtime','giftcards','crypto','telegram_stars']::text[] IS NOT TRUE THEN
    RAISE EXCEPTION 'partner_invalid_input';
  END IF;
  IF p_webhook_url IS NOT NULL AND (length(p_webhook_url) > 500
    OR p_webhook_url !~ '^https://[^[:space:]]+$') THEN
    RAISE EXCEPTION 'partner_invalid_webhook_url';
  END IF;
  IF p_unlimited IS NULL OR (p_unlimited AND length(btrim(coalesce(p_reason,''))) < 10) THEN
    RAISE EXCEPTION 'partner_credit_decision_requires_reason';
  END IF;
  INSERT INTO public.api_partners(name, webhook_url, allowed_sections,
    is_active, owner_reviewed_at, balance_ngn, unlimited_credit,
    credit_granted_by, credit_granted_at)
  VALUES (btrim(p_name), nullif(btrim(p_webhook_url), ''), p_sections,
    true, now(), 0, p_unlimited,
    CASE WHEN p_unlimited THEN p_actor_id ELSE NULL END,
    CASE WHEN p_unlimited THEN now() ELSE NULL END) RETURNING * INTO v_partner;
  INSERT INTO public.api_partner_logs(partner_id, action, method, status_code,
    success, metadata) VALUES (v_partner.id, 'admin_create_partner', 'POST', 200,
    true, jsonb_build_object('actor_user_id', p_actor_id,
      'sections', p_sections, 'owner_reviewed_at', v_partner.owner_reviewed_at,
      'unlimited_credit', p_unlimited, 'credit_reason', left(coalesce(p_reason,''),500)));
  RETURN jsonb_build_object('id', v_partner.id, 'name', v_partner.name,
    'is_active', v_partner.is_active, 'allowed_sections', v_partner.allowed_sections,
    'balance_ngn', v_partner.balance_ngn, 'unlimited_credit', v_partner.unlimited_credit,
    'owner_reviewed_at', v_partner.owner_reviewed_at);
END;
$$;

CREATE FUNCTION public.create_api_partner_key_owner(
  p_partner_id uuid, p_key_name text, p_key_prefix text, p_key_hash text,
  p_scopes text[], p_webhook_secret text, p_actor_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_partner public.api_partners%ROWTYPE; v_key public.api_partner_keys%ROWTYPE;
BEGIN
  IF p_actor_id IS DISTINCT FROM 'c1396bda-86e2-4dfc-94bb-0d95469d1d36'::uuid
    OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_actor_id
      AND p.is_admin IS TRUE AND p.account_suspended IS DISTINCT FROM true) THEN
    RAISE EXCEPTION 'partner_owner_required';
  END IF;
  IF length(btrim(coalesce(p_key_name,''))) < 2 OR length(p_key_name) > 120
    OR p_key_prefix !~ '^tly_live_[0-9a-f]{7}$'
    OR p_key_hash !~ '^[0-9a-f]{64}$'
    OR p_webhook_secret !~ '^tly_whsec_[0-9a-f]{64}$'
    OR p_scopes IS NULL OR cardinality(p_scopes) = 0
    OR p_scopes <@ ARRAY['catalogue:read','orders:create','orders:read','wallet:read']::text[] IS NOT TRUE THEN
    RAISE EXCEPTION 'partner_invalid_key_input';
  END IF;
  SELECT * INTO v_partner FROM public.api_partners WHERE id = p_partner_id FOR UPDATE;
  IF NOT FOUND OR v_partner.owner_reviewed_at IS NULL THEN
    RAISE EXCEPTION 'partner_not_owner_reviewed';
  END IF;
  INSERT INTO public.api_partner_keys(partner_id, key_name, key_prefix, key_hash, scopes)
  VALUES (p_partner_id, btrim(p_key_name), p_key_prefix, p_key_hash, p_scopes)
  RETURNING * INTO v_key;
  UPDATE public.api_partners SET webhook_secret = p_webhook_secret,
    updated_at = now() WHERE id = p_partner_id;
  INSERT INTO public.api_partner_logs(partner_id, key_id, action, method,
    status_code, success, metadata) VALUES (p_partner_id, v_key.id,
    'admin_generate_key', 'POST', 200, true,
    jsonb_build_object('actor_user_id', p_actor_id, 'scopes', p_scopes));
  RETURN jsonb_build_object('id', v_key.id, 'partner_id', v_key.partner_id,
    'key_name', v_key.key_name, 'key_prefix', v_key.key_prefix,
    'scopes', v_key.scopes, 'created_at', v_key.created_at);
END;
$$;

CREATE FUNCTION public.revoke_api_partner_key_owner(
  p_key_id uuid, p_actor_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_key public.api_partner_keys%ROWTYPE;
BEGIN
  IF p_actor_id IS DISTINCT FROM 'c1396bda-86e2-4dfc-94bb-0d95469d1d36'::uuid
    OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_actor_id
      AND p.is_admin IS TRUE AND p.account_suspended IS DISTINCT FROM true) THEN
    RAISE EXCEPTION 'partner_owner_required';
  END IF;
  UPDATE public.api_partner_keys SET revoked_at = coalesce(revoked_at, now())
    WHERE id = p_key_id RETURNING * INTO v_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'partner_key_not_found'; END IF;
  INSERT INTO public.api_partner_logs(partner_id, key_id, action, method,
    status_code, success, metadata) VALUES (v_key.partner_id, v_key.id,
    'admin_revoke_key', 'POST', 200, true,
    jsonb_build_object('actor_user_id', p_actor_id));
  RETURN jsonb_build_object('id', v_key.id, 'revoked_at', v_key.revoked_at);
END;
$$;

REVOKE ALL ON FUNCTION public.create_api_partner_owner(text,text,text[],boolean,text,uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_api_partner_key_owner(uuid,text,text,text,text[],text,uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_api_partner_key_owner(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_api_partner_owner(text,text,text[],boolean,text,uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.create_api_partner_key_owner(uuid,text,text,text,text[],text,uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_api_partner_key_owner(uuid,uuid)
  TO service_role;
