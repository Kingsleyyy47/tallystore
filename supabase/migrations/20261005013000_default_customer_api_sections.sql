-- Ordinary active customers may self-create a key for each individual section.
-- An explicit owner-managed access row restricts or disables that default.
CREATE OR REPLACE FUNCTION public.customer_api_authorize(
  p_hash text, p_section text, p_limit integer DEFAULT 60
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_key public.customer_api_keys%ROWTYPE;
  v_access public.customer_api_access%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_window timestamptz;
  v_count integer;
BEGIN
  IF p_hash !~ '^[a-f0-9]{64}$' OR p_section NOT IN ('products','sms','social_boost')
    OR p_limit < 1 OR p_limit > 120 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_key');
  END IF;
  SELECT * INTO v_key FROM public.customer_api_keys
    WHERE key_hash = p_hash AND section = p_section FOR UPDATE;
  IF NOT FOUND OR v_key.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_key');
  END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_key.user_id;
  IF NOT FOUND OR v_profile.account_suspended IS TRUE
    OR v_profile.is_admin IS TRUE OR v_profile.is_staff IS TRUE THEN
    RETURN jsonb_build_object('ok', false, 'code', 'access_disabled');
  END IF;
  SELECT * INTO v_access FROM public.customer_api_access WHERE user_id = v_key.user_id;
  IF FOUND AND (v_access.is_active IS DISTINCT FROM true
    OR NOT (p_section = ANY(v_access.allowed_sections))) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'access_disabled');
  END IF;
  v_window := date_trunc('minute', now());
  v_count := CASE WHEN v_key.rate_window = v_window THEN v_key.rate_count ELSE 0 END;
  IF v_count >= p_limit THEN
    RETURN jsonb_build_object('ok', false, 'code', 'rate_limited');
  END IF;
  UPDATE public.customer_api_keys SET rate_window = v_window,
    rate_count = v_count + 1, last_used_at = now() WHERE id = v_key.id;
  RETURN jsonb_build_object('ok', true, 'key_id', v_key.id,
    'user_id', v_key.user_id, 'section', v_key.section);
END;
$$;

CREATE OR REPLACE FUNCTION public.customer_api_consume_capability(
  p_key_id uuid, p_user_id uuid, p_section text, p_nonce uuid
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_key public.customer_api_keys%ROWTYPE;
BEGIN
  SELECT * INTO v_key FROM public.customer_api_keys WHERE id = p_key_id FOR UPDATE;
  IF NOT FOUND OR v_key.revoked_at IS NOT NULL OR v_key.user_id IS DISTINCT FROM p_user_id
    OR v_key.section IS DISTINCT FROM p_section THEN RETURN false; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    LEFT JOIN public.customer_api_access a ON a.user_id = p.id
    WHERE p.id = p_user_id AND p.account_suspended IS DISTINCT FROM true
      AND p.is_admin IS DISTINCT FROM true AND p.is_staff IS DISTINCT FROM true
      AND (a.user_id IS NULL OR (a.is_active = true AND p_section = ANY(a.allowed_sections)))
  ) THEN RETURN false; END IF;
  INSERT INTO public.customer_api_capability_nonces(nonce, key_id)
    VALUES (p_nonce, p_key_id) ON CONFLICT DO NOTHING;
  RETURN FOUND;
END;
$$;
