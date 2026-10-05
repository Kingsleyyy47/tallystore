-- Customer developer API. Grants are chosen by active admins; users can only mint
-- section keys for grants already assigned to them. No partner credit is involved.
CREATE TABLE public.customer_api_access (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  allowed_sections text[] NOT NULL DEFAULT '{}'::text[],
  is_active boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_api_sections_valid CHECK (
    allowed_sections <@ ARRAY['products','sms','social_boost']::text[]
  )
);

CREATE TABLE public.customer_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  section text NOT NULL CHECK (section IN ('products','sms','social_boost')),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
  key_hash text NOT NULL UNIQUE CHECK (key_hash ~ '^[a-f0-9]{64}$'),
  key_prefix text NOT NULL CHECK (key_prefix ~ '^tlyc_[a-z_]+_[a-f0-9]{8}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  rate_window timestamptz,
  rate_count integer NOT NULL DEFAULT 0 CHECK (rate_count >= 0)
);
CREATE INDEX customer_api_keys_user_created_idx ON public.customer_api_keys(user_id, created_at DESC);

CREATE TABLE public.customer_api_capability_nonces (
  nonce uuid PRIMARY KEY,
  key_id uuid NOT NULL REFERENCES public.customer_api_keys(id) ON DELETE CASCADE,
  used_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_api_capability_nonces_used_idx ON public.customer_api_capability_nonces(used_at);

ALTER TABLE public.customer_api_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_api_capability_nonces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_api_access, public.customer_api_keys,
  public.customer_api_capability_nonces FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.customer_api_access, public.customer_api_keys,
  public.customer_api_capability_nonces TO service_role;

-- Serialize rate decisions on the key row. A revoked key or withdrawn admin
-- grant immediately stops both reads and purchase delegation.
CREATE FUNCTION public.customer_api_authorize(
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
  SELECT * INTO v_access FROM public.customer_api_access WHERE user_id = v_key.user_id;
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_key.user_id;
  IF NOT FOUND OR v_access.is_active IS DISTINCT FROM true
    OR NOT (p_section = ANY(v_access.allowed_sections))
    OR v_profile.account_suspended IS TRUE
    OR v_profile.is_admin IS TRUE OR v_profile.is_staff IS TRUE THEN
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

CREATE FUNCTION public.customer_api_consume_capability(
  p_key_id uuid, p_user_id uuid, p_section text, p_nonce uuid
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_key public.customer_api_keys%ROWTYPE;
BEGIN
  SELECT * INTO v_key FROM public.customer_api_keys WHERE id = p_key_id FOR UPDATE;
  IF NOT FOUND OR v_key.revoked_at IS NOT NULL OR v_key.user_id IS DISTINCT FROM p_user_id
    OR v_key.section IS DISTINCT FROM p_section THEN RETURN false; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.customer_api_access a JOIN public.profiles p ON p.id = a.user_id
    WHERE a.user_id = p_user_id AND a.is_active = true
      AND p_section = ANY(a.allowed_sections)
      AND p.account_suspended IS DISTINCT FROM true
      AND p.is_admin IS DISTINCT FROM true AND p.is_staff IS DISTINCT FROM true
  ) THEN RETURN false; END IF;
  INSERT INTO public.customer_api_capability_nonces(nonce, key_id)
    VALUES (p_nonce, p_key_id) ON CONFLICT DO NOTHING;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.customer_api_authorize(text,text,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.customer_api_consume_capability(uuid,uuid,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_api_authorize(text,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.customer_api_consume_capability(uuid,uuid,text,uuid) TO service_role;
