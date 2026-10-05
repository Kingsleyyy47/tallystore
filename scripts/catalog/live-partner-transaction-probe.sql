-- Run after reviewed partner migrations in a transaction ending ROLLBACK.
-- Never calls any paid supplier. Does not reveal product credentials.
CREATE TEMP TABLE partner_transaction_probe (owner_provisioned boolean, local_purchase boolean, replayed boolean, revoked_key_rejected boolean, customer_wallets_unchanged boolean);
DO $$
DECLARE
  v_owner uuid;
  v_partner jsonb;
  v_key jsonb;
  v_result jsonb;
  v_replay jsonb;
  v_rejected jsonb;
  v_product public.product_groups%ROWTYPE;
  v_amount numeric;
  v_request text := 'partner-rollback-'||gen_random_uuid()::text;
  v_before text;
  v_after text;
  v_hex text := md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text);
BEGIN
  SELECT id INTO v_owner FROM public.profiles WHERE is_admin=true AND account_suspended IS DISTINCT FROM true;
  SELECT md5(string_agg(id::text||':'||COALESCE(wallet_balance::text,'')||':'||COALESCE(referral_balance::text,''),',' ORDER BY id)) INTO v_before FROM public.profiles;
  SELECT public.create_api_partner_owner('Rollback verification',NULL,ARRAY['products'],true,'Rollback verification only',v_owner) INTO v_partner;
  SELECT public.create_api_partner_key_owner((v_partner->>'id')::uuid,'Rollback key','tly_live_'||left(v_hex,7),v_hex,
    ARRAY['catalogue:read','orders:create','orders:read','wallet:read'],'tly_whsec_'||v_hex,v_owner) INTO v_key;
  SELECT pg.* INTO v_product FROM public.product_groups pg WHERE pg.is_active=true AND pg.is_sellable=true AND pg.stock_count>0 AND pg.price>0 ORDER BY pg.price LIMIT 1;
  IF v_product.id IS NULL THEN RAISE EXCEPTION 'No local-stock fixture'; END IF;
  SELECT ceil(v_product.price*(1+GREATEST(COALESCE(markup_percent,0),0)/100)) INTO v_amount FROM public.api_partners WHERE id=(v_partner->>'id')::uuid;
  SELECT public.purchase_api_partner_local_product((v_key->>'id')::uuid,v_product.id,1,v_amount,v_request,'rollback') INTO v_result;
  IF (v_result->>'success')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Partner local purchase failed: %',v_result->>'code'; END IF;
  SELECT public.purchase_api_partner_local_product((v_key->>'id')::uuid,v_product.id,1,v_amount,v_request,'rollback') INTO v_replay;
  IF (v_replay->>'idempotency_hit')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Partner replay failed'; END IF;
  PERFORM public.revoke_api_partner_key_owner((v_key->>'id')::uuid,v_owner);
  SELECT public.purchase_api_partner_local_product((v_key->>'id')::uuid,v_product.id,1,v_amount,v_request||':revoked','rollback') INTO v_rejected;
  IF v_rejected->>'code'<>'INVALID_KEY' THEN RAISE EXCEPTION 'Revoked partner key accepted'; END IF;
  SELECT md5(string_agg(id::text||':'||COALESCE(wallet_balance::text,'')||':'||COALESCE(referral_balance::text,''),',' ORDER BY id)) INTO v_after FROM public.profiles;
  IF v_before IS DISTINCT FROM v_after THEN RAISE EXCEPTION 'Partner credit affected customer wallets'; END IF;
  INSERT INTO partner_transaction_probe VALUES(true,true,true,true,true);
END;
$$;
SELECT * FROM partner_transaction_probe;
