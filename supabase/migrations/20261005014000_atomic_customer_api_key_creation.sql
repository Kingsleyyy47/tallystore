-- Keep the 12-active-key cap and section override atomic across concurrent
-- sessions. Raw keys are generated once in the Edge Function and never stored.
CREATE FUNCTION public.customer_api_create_key(
  p_user_id uuid, p_section text, p_label text, p_hash text, p_prefix text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_access public.customer_api_access%ROWTYPE;
  v_count integer;
  v_key public.customer_api_keys%ROWTYPE;
BEGIN
  IF p_section NOT IN ('products','sms','social_boost')
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
REVOKE ALL ON FUNCTION public.customer_api_create_key(uuid,text,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_api_create_key(uuid,text,text,text,text)
  TO service_role;
