-- Caller: BEGIN; pending migration290; this probe; ROLLBACK. All owner-config
-- mutations are synthetic and uncommitted. No wallet/provider requests occur.
SAVEPOINT customer_bitrefill_pricing_probe;
CREATE TEMP TABLE customer_bitrefill_pricing_probe_results (
 passed boolean, separate_kinds boolean, global_modes boolean,
 exact_override_precedence boolean, product_fallback boolean, owner_only boolean,
 bounded_values boolean, immutable_audit boolean, browser_denied boolean,
 replay_no_extra_audit boolean
) ON COMMIT DROP;
DO $probe$
DECLARE
 owner_id uuid := 'c1396bda-86e2-4dfc-94bb-0d95469d1d36';
 product text := 'TEST_ONLY_PRICING_PRODUCT_290';
 package text := 'test-package<&>25';
 result jsonb; gift_global jsonb; global_value numeric; audit_before integer;
 sms_active boolean; sms_mode text; sms_selector jsonb;
 denials integer:=0; browser_denials integer:=0; immutable_denials integer:=0;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=owner_id AND is_admin IS TRUE AND account_suspended IS DISTINCT FROM true)
 OR EXISTS(SELECT 1 FROM private.customer_bitrefill_pricing_overrides WHERE product_id=product)
 THEN RAISE EXCEPTION 'bitrefill_pricing_probe_precondition_failed'; END IF;
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 SELECT count(*) INTO audit_before FROM private.customer_bitrefill_pricing_audit;
 gift_global:=(public.list_customer_bitrefill_pricing(owner_id,'gift_card'))->'global';
 global_value:=CASE WHEN gift_global->>'value'='17' THEN 18 ELSE 17 END;
 IF (public.set_customer_bitrefill_pricing('00000000-0000-4000-8000-000000000001','airtime','global',NULL,NULL,NULL,NULL,'amount',10,false))->>'code'='OWNER_DENIED' THEN denials:=denials+1; END IF;
 IF (public.set_customer_bitrefill_pricing(owner_id,'airtime','global',NULL,NULL,NULL,NULL,'percent',1000.01,false))->>'code'='INVALID_PRICING' THEN denials:=denials+1; END IF;
 IF (public.set_customer_bitrefill_pricing(owner_id,'airtime','global',NULL,NULL,NULL,NULL,'amount',-1,false))->>'code'='INVALID_PRICING' THEN denials:=denials+1; END IF;
 IF (public.set_customer_bitrefill_pricing(owner_id,'airtime','global',NULL,NULL,NULL,NULL,'amount',1.001,false))->>'code'='INVALID_PRICING' THEN denials:=denials+1; END IF;
 IF (public.set_customer_bitrefill_pricing(owner_id,'airtime','denomination',product,package,0,'GBP','amount',1,false))->>'code'='INVALID_PRICING' THEN denials:=denials+1; END IF;
 IF (public.set_customer_bitrefill_pricing(owner_id,'airtime','denomination',product,package,25,'gbp','amount',1,false))->>'code'='INVALID_PRICING' THEN denials:=denials+1; END IF;
 result:=public.set_customer_bitrefill_pricing(owner_id,'airtime','global',NULL,NULL,NULL,NULL,'amount',12,false);
 IF result->>'success' IS DISTINCT FROM 'true'
 OR (public.list_customer_bitrefill_pricing(owner_id,'gift_card'))->'global' IS DISTINCT FROM gift_global
 THEN RAISE EXCEPTION 'bitrefill_pricing_probe_kind_isolation_failed'; END IF;
 result:=public.set_customer_bitrefill_pricing(owner_id,'gift_card','global',NULL,NULL,NULL,NULL,'percent',global_value,false);
 IF result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'bitrefill_pricing_probe_gift_global_failed'; END IF;
 result:=public.get_customer_bitrefill_pricing('airtime',product,package,25,'GBP');
 IF result IS DISTINCT FROM jsonb_build_object('success',true,'mode','amount','value',12,'source','global') THEN RAISE EXCEPTION 'bitrefill_pricing_probe_global_amount_failed'; END IF;
 result:=public.get_customer_bitrefill_pricing('gift_card',product,package,25,'GBP');
 IF result IS DISTINCT FROM jsonb_build_object('success',true,'mode','percent','value',global_value,'source','global') THEN RAISE EXCEPTION 'bitrefill_pricing_probe_global_percent_failed'; END IF;
 result:=public.set_customer_bitrefill_pricing(owner_id,'airtime','product',product,NULL,NULL,NULL,'percent',50,false);
 IF result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'bitrefill_pricing_probe_product_failed'; END IF;
 result:=public.set_customer_bitrefill_pricing(owner_id,'airtime','denomination',product,package,25,'GBP','amount',2.5,false);
 IF result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'bitrefill_pricing_probe_denomination_failed'; END IF;
 result:=public.set_customer_bitrefill_pricing(owner_id,'gift_card','denomination',product,package,25,'GBP','percent',25,false);
 IF result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'bitrefill_pricing_probe_gift_override_failed'; END IF;
 result:=public.get_customer_bitrefill_pricing('airtime',product,package,25,'GBP');
 IF result IS DISTINCT FROM jsonb_build_object('success',true,'mode','amount','value',2.5,'source','denomination')
 OR public.get_customer_bitrefill_pricing('gift_card',product,package,25,'GBP') IS DISTINCT FROM jsonb_build_object('success',true,'mode','percent','value',25,'source','denomination')
 OR public.get_customer_bitrefill_pricing('airtime',product,package,26,'GBP') IS DISTINCT FROM jsonb_build_object('success',true,'mode','percent','value',50,'source','product')
 OR public.get_customer_bitrefill_pricing('airtime',product,package,25,'EUR') IS DISTINCT FROM jsonb_build_object('success',true,'mode','percent','value',50,'source','product')
 THEN RAISE EXCEPTION 'bitrefill_pricing_probe_precedence_failed'; END IF;
 result:=public.set_customer_bitrefill_pricing(owner_id,'airtime','denomination',product,package,25,'GBP','amount',2.5,false);
 IF result->>'changed' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'bitrefill_pricing_probe_replay_changed'; END IF;
 result:=public.set_customer_bitrefill_pricing(owner_id,'airtime','denomination',product,package,25,'GBP',NULL,NULL,true);
 IF result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'bitrefill_pricing_probe_remove_failed'; END IF;
 result:=public.get_customer_bitrefill_pricing('airtime',product,package,25,'GBP');
 IF result IS DISTINCT FROM jsonb_build_object('success',true,'mode','percent','value',50,'source','product')
 OR (SELECT count(*) FROM private.customer_bitrefill_pricing_audit)<>audit_before+6
 OR NOT EXISTS(SELECT 1 FROM private.customer_bitrefill_pricing_audit WHERE owner_user_id=owner_id AND kind='airtime'
 AND selector->>'product_id'=product AND old_config=jsonb_build_object('mode','amount','value',2.5) AND new_config IS NULL)
 THEN RAISE EXCEPTION 'bitrefill_pricing_probe_audit_or_fallback_failed'; END IF;
 SELECT owner_configured,CASE WHEN mode='percent' THEN 'amount' ELSE 'percent' END INTO sms_active,sms_mode FROM private.customer_bitrefill_pricing_global WHERE kind='sms';
 sms_selector:=jsonb_build_object('product_id',product,'package_id',NULL,'unit_value',0.1,'currency','USD');
 result:=public.get_customer_bitrefill_pricing_batch('sms',jsonb_build_array(sms_selector));
 IF result->>'success' IS DISTINCT FROM 'true' OR (result#>>'{prices,0,legacy_pricing}')::boolean IS DISTINCT FROM NOT sms_active
 OR result#>'{prices,0}' ? 'unit_value' THEN RAISE EXCEPTION 'sms_pricing_probe_legacy_or_redaction_failed'; END IF;
 IF (public.get_customer_bitrefill_pricing_batch('sms',jsonb_build_array(sms_selector,sms_selector)))->>'success'='false' THEN denials:=denials+1; END IF;
 IF (public.get_customer_bitrefill_pricing_batch('sms',jsonb_build_array(sms_selector||'{"secret":true}'::jsonb)))->>'success'='false' THEN denials:=denials+1; END IF;
 result:=public.set_customer_bitrefill_pricing(owner_id,'sms','product',product,NULL,NULL,NULL,'percent',11,false);
 IF result->>'changed' IS DISTINCT FROM 'true'
 OR (public.get_customer_bitrefill_pricing('sms',product,NULL,0.1,'USD'))->>'legacy_pricing' IS DISTINCT FROM 'false'
 OR ((public.get_customer_bitrefill_pricing('sms','OTHER_TEST_SMS_290',NULL,0.1,'USD'))->>'legacy_pricing')::boolean IS DISTINCT FROM NOT sms_active
 THEN RAISE EXCEPTION 'sms_pricing_probe_individual_activation_failed'; END IF;
 result:=public.set_customer_bitrefill_pricing(owner_id,'sms','product',product,NULL,NULL,NULL,NULL,NULL,true);
 IF result->>'changed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'sms_pricing_probe_remove_failed'; END IF;
 result:=public.set_customer_bitrefill_pricing(owner_id,'sms','global',NULL,NULL,NULL,NULL,sms_mode,20,false);
 IF result->>'changed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'sms_pricing_probe_global_activation_failed'; END IF;
 result:=public.get_customer_bitrefill_pricing_batch('sms',jsonb_build_array(sms_selector));
 IF result#>>'{prices,0,legacy_pricing}' IS DISTINCT FROM 'false'
 OR (SELECT count(*) FROM private.customer_bitrefill_pricing_audit)<>audit_before+9 THEN RAISE EXCEPTION 'sms_pricing_probe_audit_failed'; END IF;
 BEGIN UPDATE private.customer_bitrefill_pricing_audit SET old_config=NULL;
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'customer_airtime_pricing_audit_immutable' AND SQLERRM<>'customer_bitrefill_pricing_audit_immutable' THEN RAISE; END IF; immutable_denials:=immutable_denials+1; END;
 BEGIN TRUNCATE private.customer_bitrefill_pricing_audit;
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'customer_airtime_pricing_audit_immutable' AND SQLERRM<>'customer_bitrefill_pricing_audit_immutable' THEN RAISE; END IF; immutable_denials:=immutable_denials+1; END;
 EXECUTE 'SET LOCAL ROLE authenticated';
 BEGIN PERFORM public.get_customer_bitrefill_pricing('airtime',product,package,25,'GBP'); EXCEPTION WHEN insufficient_privilege THEN browser_denials:=browser_denials+1; END;
 BEGIN PERFORM public.set_customer_bitrefill_pricing(owner_id,'airtime','global',NULL,NULL,NULL,NULL,'amount',1,false); EXCEPTION WHEN insufficient_privilege THEN browser_denials:=browser_denials+1; END;
 BEGIN PERFORM public.list_customer_bitrefill_pricing(owner_id,'airtime'); EXCEPTION WHEN insufficient_privilege THEN browser_denials:=browser_denials+1; END;
 BEGIN PERFORM public.get_customer_bitrefill_pricing_batch('sms',jsonb_build_array(sms_selector)); EXCEPTION WHEN insufficient_privilege THEN browser_denials:=browser_denials+1; END;
 BEGIN PERFORM 1 FROM private.customer_bitrefill_pricing_audit; EXCEPTION WHEN insufficient_privilege THEN browser_denials:=browser_denials+1; END;
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 IF denials<>8 OR browser_denials<>5 OR immutable_denials<>2 THEN RAISE EXCEPTION 'bitrefill_pricing_probe_auth_or_immutability_failed'; END IF;
 INSERT INTO customer_bitrefill_pricing_probe_results VALUES(true,true,true,true,true,true,true,true,true,true);
END;
$probe$;
SELECT * FROM customer_bitrefill_pricing_probe_results;
ROLLBACK TO SAVEPOINT customer_bitrefill_pricing_probe;
RELEASE SAVEPOINT customer_bitrefill_pricing_probe;
