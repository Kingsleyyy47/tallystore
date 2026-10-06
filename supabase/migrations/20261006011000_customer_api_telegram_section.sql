-- Extend ordinary customer keys to Telegram without changing the
-- customer API launch gate or granting partner credit/checkout authority.
-- Existing explicit allowed_sections rows are not widened.
-- Pin the exact post-gift-card authorization definitions from the local fixture.
-- No existing allowed_sections row, key, nonce or wallet record is rewritten.
DO $$
BEGIN
  IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.pg_get_functiondef('public.customer_api_authorize(text,text,integer)'::regprocedure), 'UTF8')), 'hex')
      IS DISTINCT FROM '310d7ec2390b0b66fcd141690ed534c9ec9d0c2fdf8556b0e16336b85a950a4e'
    OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.pg_get_functiondef('public.customer_api_consume_capability(uuid,uuid,text,uuid)'::regprocedure), 'UTF8')), 'hex')
      IS DISTINCT FROM 'b867d976a19c1d52b92c569a9d04d4e52c31fd9e04b1fea6818412df14f621b2'
    OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.pg_get_functiondef('public.customer_api_create_key(uuid,text,text,text,text)'::regprocedure), 'UTF8')), 'hex')
      IS DISTINCT FROM '93096b1f9d000fbb46be1e5bba911e9b7c9f0448647f9ba1c8aab57e52db945f' THEN
    RAISE EXCEPTION 'customer_api_authorization_baseline_changed';
  END IF;
END $$;

ALTER TABLE public.customer_api_access DROP CONSTRAINT customer_api_sections_valid;
ALTER TABLE public.customer_api_access ADD CONSTRAINT customer_api_sections_valid
  CHECK (allowed_sections <@ ARRAY['products','sms','social_boost','airtime','giftcards','telegram']::text[]);
ALTER TABLE public.customer_api_keys DROP CONSTRAINT customer_api_keys_section_check;
ALTER TABLE public.customer_api_keys ADD CONSTRAINT customer_api_keys_section_check
  CHECK (section IN ('products','sms','social_boost','airtime','giftcards','telegram'));

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
  IF p_hash !~ '^[a-f0-9]{64}$' OR p_section NOT IN ('products','sms','social_boost','airtime','giftcards','telegram')
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

CREATE OR REPLACE FUNCTION public.customer_api_create_key(
  p_user_id uuid, p_section text, p_label text, p_hash text, p_prefix text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_access public.customer_api_access%ROWTYPE;
  v_count integer;
  v_key public.customer_api_keys%ROWTYPE;
BEGIN
  IF p_section NOT IN ('products','sms','social_boost','airtime','giftcards','telegram')
    OR length(btrim(coalesce(p_label,''))) NOT BETWEEN 1 AND 60
    OR p_hash !~ '^[a-f0-9]{64}$'
    OR p_prefix !~ '^tlyc_[a-z_]+_[a-f0-9]{8}$'
    OR left(p_prefix, length('tlyc_' || p_section || '_')) IS DISTINCT FROM
      'tlyc_' || p_section || '_' THEN
    RETURN jsonb_build_object('success',false,'code','INVALID_REQUEST');
  END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND OR v_profile.account_suspended IS TRUE
    OR v_profile.is_admin IS TRUE OR v_profile.is_staff IS TRUE THEN
    RETURN jsonb_build_object('success',false,'code','CUSTOMER_REQUIRED');
  END IF;
  SELECT * INTO v_access FROM public.customer_api_access WHERE user_id = p_user_id;
  IF FOUND AND (v_access.is_active IS DISTINCT FROM true
    OR NOT (p_section = ANY(v_access.allowed_sections))) THEN
    RETURN jsonb_build_object('success',false,'code','SECTION_NOT_GRANTED');
  END IF;
  SELECT count(*) INTO v_count FROM public.customer_api_keys
    WHERE user_id = p_user_id AND revoked_at IS NULL;
  IF v_count >= 12 THEN RETURN jsonb_build_object('success',false,'code','KEY_LIMIT'); END IF;
  INSERT INTO public.customer_api_keys(user_id,section,label,key_hash,key_prefix)
    VALUES(p_user_id,p_section,btrim(p_label),p_hash,p_prefix) RETURNING * INTO v_key;
  RETURN jsonb_build_object('success',true,'id',v_key.id,'section',v_key.section,
    'label',v_key.label,'prefix',v_key.key_prefix,'created_at',v_key.created_at);
END;
$$;

REVOKE ALL ON FUNCTION public.customer_api_authorize(text,text,integer),
  public.customer_api_consume_capability(uuid,uuid,text,uuid),
  public.customer_api_create_key(uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.customer_api_authorize(text,text,integer),
  public.customer_api_consume_capability(uuid,uuid,text,uuid),
  public.customer_api_create_key(uuid,text,text,text,text) TO service_role;
