-- Transaction-only, synthetic partner fixtures. No provider calls or usable key.
-- Caller: BEGIN ISOLATION LEVEL REPEATABLE READ; pending migrations 210 and 211;
-- this probe. The wallet checksum then shares one stable snapshot even if other
-- customers deposit during verification. Applied 200 stays
-- unchanged. SAVEPOINT requires an explicit transaction; final ROLLBACK removes
-- schema changes, keys, partners, orders, events and obligations together.
SAVEPOINT partner_reads_live_probe;
SET LOCAL TIME ZONE 'UTC';
CREATE TEMP TABLE partner_reads_probe_results (
  passed boolean, scoped_authorization boolean, authorization_contains_no_hash boolean,
  admitted_before_limit integer, minute_counter integer, rate_limited boolean,
  revoked_key_denied boolean, fresh_review_and_scope_denials integer,
  foreign_partner_snapshot_denied boolean, accepted_status_changes_no_money boolean,
  prepared_release_exactly_once boolean, release_rows integer,
  claimed_and_unknown_cancellation_denied boolean, send_claims integer,
  capture_rows integer, obligation_rows integer, customer_wallets_unchanged boolean,
  gift_cards_delivered integer, gift_incomplete_or_duplicate_denials integer,
  gift_status_changes_no_money boolean,
  lock_order_consistent boolean, authenticated_denials integer
) ON COMMIT DROP;

DO $probe$
DECLARE
  v_prepaid uuid := '9a210000-0000-4000-8000-000000000001';
  v_foreign uuid := '9a210000-0000-4000-8000-000000000002';
  v_key uuid := '9a210000-0000-4000-8000-000000000011';
  v_foreign_key uuid := '9a210000-0000-4000-8000-000000000012';
  v_hash text := repeat('c',64);
  v_foreign_hash text := repeat('d',64);
  v_fingerprint text := repeat('e',64);
  v_accepted uuid;
  v_prepared uuid;
  v_sending uuid;
  v_gift uuid;
  v_gift_cards jsonb := '[{"order_id":"TEST-GIFT-UNIT-A","code":"TEST-ONLY-CARD-A"},{"order_id":"TEST-GIFT-UNIT-B","code":"TEST-ONLY-CARD-B"}]'::jsonb;
  v_gift_denials integer := 0;
  v_result jsonb;
  v_keys text[];
  v_admitted integer := 0;
  v_fresh_denials integer := 0;
  v_auth_denials integer := 0;
  v_balance numeric;
  v_counter integer;
  v_wallet_before text;
  v_wallet_after text;
  v_claim_definition text;
  v_outcome_definition text;
  v_status_definition text;
  v_cancel_definition text;
  v_rate_definition text;
  v_lock_order boolean;
  v_i integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public.api_partners WHERE id IN (v_prepaid,v_foreign))
    OR EXISTS (SELECT 1 FROM public.api_partner_keys WHERE id IN (v_key,v_foreign_key)
      OR key_hash IN (v_hash,v_foreign_hash))
  THEN RAISE EXCEPTION 'partner_reads_probe_fixture_collision'; END IF;

  SELECT encode(sha256(convert_to(COALESCE(jsonb_agg(jsonb_build_array(id,wallet_balance)
    ORDER BY id),'[]'::jsonb)::text,'UTF8')),'hex') INTO v_wallet_before FROM public.profiles;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
  INSERT INTO public.api_partners(id,name,contact_email,is_active,allowed_sections,markup_percent,
    balance_ngn,unlimited_credit,owner_reviewed_at,rate_limit_per_minute)
  VALUES (v_prepaid,'Synthetic Partner Read Probe','partner-probe-a@example.invalid',true,
    ARRAY['sms'],0,1000,false,clock_timestamp(),2),
    (v_foreign,'Synthetic Foreign Partner Read Probe','partner-probe-b@example.invalid',true,
      ARRAY['sms'],0,0,true,clock_timestamp(),2);
  -- Fixed synthetic digests have no issued/plaintext API token. They exist only
  -- inside the transaction and cannot call the deployed gateway from this probe.
  INSERT INTO public.api_partner_keys(id,partner_id,key_name,key_prefix,key_hash,scopes)
  VALUES (v_key,v_prepaid,'Transaction-only read probe','fixture-only',v_hash,
    ARRAY['catalogue:read','orders:create','orders:read','wallet:read']),
    (v_foreign_key,v_foreign,'Transaction-only foreign probe','fixture-only',v_foreign_hash,
      ARRAY['orders:create','orders:read']);

  FOR v_i IN 1..2 LOOP
    v_result := public.authorize_api_partner_request(v_hash,'orders:read');
    SELECT array_agg(key ORDER BY key) INTO v_keys FROM jsonb_object_keys(v_result) key;
    IF v_result->>'ok' IS DISTINCT FROM 'true'
      OR v_keys IS DISTINCT FROM ARRAY['key_id','ok','partner_id']::text[]
      OR v_result->>'key_id' IS DISTINCT FROM v_key::text
      OR v_result->>'partner_id' IS DISTINCT FROM v_prepaid::text
      OR position(v_hash IN v_result::text)>0
    THEN RAISE EXCEPTION 'partner_reads_probe_authorization_or_hash_leak'; END IF;
    v_admitted:=v_admitted+1;
  END LOOP;
  v_result := public.authorize_api_partner_request(v_hash,'orders:read');
  SELECT request_count INTO v_counter FROM public.api_partner_keys WHERE id=v_key;
  IF v_result->>'code' IS DISTINCT FROM 'RATE_LIMITED' OR v_counter<>2
  THEN RAISE EXCEPTION 'partner_reads_probe_rate_limit_failed'; END IF;
  UPDATE public.api_partner_keys SET request_window=now()-interval '2 minutes' WHERE id=v_key;
  v_result := public.authorize_api_partner_request(v_hash,'orders:read');
  IF v_result->>'ok' IS DISTINCT FROM 'true'
    OR (SELECT request_count FROM public.api_partner_keys WHERE id=v_key)<>1
  THEN RAISE EXCEPTION 'partner_reads_probe_minute_rollover_failed'; END IF;

  UPDATE public.api_partner_keys SET scopes=ARRAY['catalogue:read'] WHERE id=v_key;
  v_result:=public.authorize_api_partner_request(v_hash,'orders:read');
  IF v_result->>'code' IS DISTINCT FROM 'SCOPE_DENIED'
  THEN RAISE EXCEPTION 'partner_reads_probe_scope_admitted'; END IF;
  v_fresh_denials:=v_fresh_denials+1;
  UPDATE public.api_partner_keys SET scopes=ARRAY['catalogue:read','orders:create','orders:read','wallet:read'],
    revoked_at=now() WHERE id=v_key;
  v_result:=public.authorize_api_partner_request(v_hash,'orders:read');
  IF v_result->>'code' IS DISTINCT FROM 'INVALID_KEY'
  THEN RAISE EXCEPTION 'partner_reads_probe_revoked_key_admitted'; END IF;
  UPDATE public.api_partner_keys SET revoked_at=NULL WHERE id=v_key;
  UPDATE public.api_partners SET is_active=false WHERE id=v_prepaid;
  v_result:=public.authorize_api_partner_request(v_hash,'orders:read');
  IF v_result->>'code' IS DISTINCT FROM 'PARTNER_DISABLED'
  THEN RAISE EXCEPTION 'partner_reads_probe_inactive_partner_admitted'; END IF;
  v_fresh_denials:=v_fresh_denials+1;
  UPDATE public.api_partners SET is_active=true,owner_reviewed_at=NULL WHERE id=v_prepaid;
  v_result:=public.authorize_api_partner_request(v_hash,'orders:read');
  IF v_result->>'code' IS DISTINCT FROM 'PARTNER_DISABLED'
  THEN RAISE EXCEPTION 'partner_reads_probe_unreviewed_partner_admitted'; END IF;
  v_fresh_denials:=v_fresh_denials+1;
  UPDATE public.api_partners SET owner_reviewed_at=clock_timestamp() WHERE id=v_prepaid;

  -- SQL journal claims only: never invoke a provider or perform an external send.
  v_result:=public.reserve_api_partner_external_order(v_key,'sms','sms','fixture-service',
    'Synthetic accepted SMS',1,10,10,'partner-read-probe-accepted-001',v_fingerprint,'{}',NULL,NULL,NULL);
  IF v_result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'partner_reads_probe_reserve_failed'; END IF;
  v_accepted:=(v_result->>'order_id')::uuid;
  v_result:=public.claim_api_partner_external_dispatch(v_accepted,v_key);
  IF v_result->>'send_allowed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'partner_reads_probe_claim_failed'; END IF;
  v_result:=public.claim_api_partner_external_dispatch(v_accepted,v_key);
  IF v_result->>'code' IS DISTINCT FROM 'DISPATCH_ALREADY_CLAIMED'
  THEN RAISE EXCEPTION 'partner_reads_probe_duplicate_send_claim'; END IF;
  v_result:=public.record_api_partner_external_outcome(v_accepted,'accepted','daisy',
    'TEST-ONLY-PARTNER-READ-DELIVERY-210','{}','active',NULL);
  IF v_result->>'success' IS DISTINCT FROM 'true'
  THEN RAISE EXCEPTION 'partner_reads_probe_acceptance_failed'; END IF;
  SELECT balance_ngn INTO v_balance FROM public.api_partners WHERE id=v_prepaid;
  v_result:=public.update_api_partner_external_status(v_foreign_key,v_accepted,'daisy',
    'TEST-ONLY-PARTNER-READ-DELIVERY-210','completed','{"code":"TEST-ONLY-CODE"}');
  IF v_result->>'code' IS DISTINCT FROM 'ORDER_NOT_FOUND' OR v_result ? 'data'
  THEN RAISE EXCEPTION 'partner_reads_probe_foreign_snapshot_exposed'; END IF;
  UPDATE public.api_partner_keys SET scopes=ARRAY['orders:create'] WHERE id=v_key;
  v_result:=public.update_api_partner_external_status(v_key,v_accepted,'daisy',
    'TEST-ONLY-PARTNER-READ-DELIVERY-210','completed','{"code":"TEST-ONLY-CODE"}');
  IF v_result->>'code' IS DISTINCT FROM 'SCOPE_DENIED' OR v_result ? 'data'
  THEN RAISE EXCEPTION 'partner_reads_probe_unscoped_snapshot_exposed'; END IF;
  v_fresh_denials:=v_fresh_denials+1;
  UPDATE public.api_partner_keys SET scopes=ARRAY['orders:create','orders:read'] WHERE id=v_key;
  UPDATE public.api_partners SET allowed_sections=ARRAY['social_boost'] WHERE id=v_prepaid;
  v_result:=public.update_api_partner_external_status(v_key,v_accepted,'daisy',
    'TEST-ONLY-PARTNER-READ-DELIVERY-210','completed','{"code":"TEST-ONLY-CODE"}');
  IF v_result->>'code' IS DISTINCT FROM 'ORDER_NOT_FOUND' OR v_result ? 'data'
  THEN RAISE EXCEPTION 'partner_reads_probe_section_snapshot_exposed'; END IF;
  v_fresh_denials:=v_fresh_denials+1;
  UPDATE public.api_partners SET allowed_sections=ARRAY['sms'] WHERE id=v_prepaid;
  v_result:=public.update_api_partner_external_status(v_key,v_accepted,'daisy',
    'TEST-ONLY-PARTNER-READ-DELIVERY-210','completed','{}');
  IF v_result->>'code' IS DISTINCT FROM 'COMPLETION_EVIDENCE_REQUIRED'
  THEN RAISE EXCEPTION 'partner_reads_probe_completion_without_evidence'; END IF;
  v_result:=public.update_api_partner_external_status(v_key,v_accepted,'daisy',
    'TEST-ONLY-PARTNER-READ-DELIVERY-210','completed','{"code":"TEST-ONLY-CODE"}');
  IF v_result->>'success' IS DISTINCT FROM 'true' OR v_result->'data'->>'status' IS DISTINCT FROM 'completed'
    OR position(v_hash IN v_result::text)>0
    OR (SELECT balance_ngn FROM public.api_partners WHERE id=v_prepaid) IS DISTINCT FROM v_balance
    OR (SELECT count(*) FROM public.api_partner_external_events WHERE order_id=v_accepted)<>2
    OR (SELECT count(*) FROM public.api_partner_obligations WHERE order_id=v_accepted)<>1
  THEN RAISE EXCEPTION 'partner_reads_probe_status_snapshot_or_money_failed'; END IF;
  v_result:=public.update_api_partner_external_status(v_key,v_accepted,'daisy',
    'TEST-ONLY-PARTNER-READ-DELIVERY-210','active','{}');
  IF v_result->>'code' IS DISTINCT FROM 'TERMINAL_STATUS'
  THEN RAISE EXCEPTION 'partner_reads_probe_completed_status_downgraded'; END IF;

  v_result:=public.reserve_api_partner_external_order(v_key,'sms','sms','fixture-service',
    'Synthetic prepared SMS',1,20,20,'partner-read-probe-prepared-002',v_fingerprint,'{}',NULL,NULL,NULL);
  IF v_result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'partner_reads_probe_prepared_reserve_failed'; END IF;
  v_prepared:=(v_result->>'order_id')::uuid;
  SELECT balance_ngn INTO v_balance FROM public.api_partners WHERE id=v_prepaid;
  v_result:=public.cancel_prepared_api_partner_external_order(v_prepared,v_foreign_key);
  IF v_result->>'code' IS DISTINCT FROM 'ORDER_NOT_FOUND'
  THEN RAISE EXCEPTION 'partner_reads_probe_foreign_cancel_allowed'; END IF;
  UPDATE public.api_partner_keys SET revoked_at=now() WHERE id=v_key;
  v_result:=public.update_api_partner_external_status(v_key,v_accepted,'daisy',
    'TEST-ONLY-PARTNER-READ-DELIVERY-210','completed','{"code":"TEST-ONLY-CODE"}');
  IF v_result->>'code' IS DISTINCT FROM 'INVALID_KEY'
  THEN RAISE EXCEPTION 'partner_reads_probe_revoked_status_allowed'; END IF;
  v_result:=public.cancel_prepared_api_partner_external_order(v_prepared,v_key);
  IF v_result->>'success' IS DISTINCT FROM 'true' OR v_result->>'idempotent_replay' IS DISTINCT FROM 'false'
  THEN RAISE EXCEPTION 'partner_reads_probe_prepared_cancel_failed'; END IF;
  v_result:=public.cancel_prepared_api_partner_external_order(v_prepared,v_key);
  IF v_result->>'idempotent_replay' IS DISTINCT FROM 'true'
    OR (SELECT balance_ngn FROM public.api_partners WHERE id=v_prepaid) IS DISTINCT FROM v_balance+20
    OR (SELECT count(*) FROM public.api_partner_external_events WHERE order_id=v_prepared AND event_type='release')<>1
    OR NOT EXISTS (SELECT 1 FROM public.api_partner_external_events WHERE order_id=v_prepared
      AND event_type='release' AND amount_ngn=20 AND balance_before=v_balance AND balance_after=v_balance+20)
  THEN RAISE EXCEPTION 'partner_reads_probe_cancel_not_exactly_once'; END IF;
  UPDATE public.api_partner_keys SET revoked_at=NULL WHERE id=v_key;

  v_result:=public.reserve_api_partner_external_order(v_key,'sms','sms','fixture-service',
    'Synthetic unknown SMS',1,30,30,'partner-read-probe-sending-003',v_fingerprint,'{}',NULL,NULL,NULL);
  IF v_result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'partner_reads_probe_sending_reserve_failed'; END IF;
  v_sending:=(v_result->>'order_id')::uuid;
  v_result:=public.claim_api_partner_external_dispatch(v_sending,v_key);
  IF v_result->>'send_allowed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'partner_reads_probe_sending_claim_failed'; END IF;
  SELECT balance_ngn INTO v_balance FROM public.api_partners WHERE id=v_prepaid;
  v_result:=public.cancel_prepared_api_partner_external_order(v_sending,v_key);
  IF v_result->>'code' IS DISTINCT FROM 'DISPATCH_ALREADY_CLAIMED'
  THEN RAISE EXCEPTION 'partner_reads_probe_sending_released'; END IF;
  v_result:=public.record_api_partner_external_outcome(v_sending,'unknown',NULL,NULL,'{}','processing',NULL);
  IF v_result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'partner_reads_probe_unknown_record_failed'; END IF;
  v_result:=public.cancel_prepared_api_partner_external_order(v_sending,v_key);
  IF v_result->>'code' IS DISTINCT FROM 'DISPATCH_ALREADY_CLAIMED'
    OR (SELECT balance_ngn FROM public.api_partners WHERE id=v_prepaid) IS DISTINCT FROM v_balance
    OR EXISTS (SELECT 1 FROM public.api_partner_external_events WHERE order_id=v_sending AND event_type='release')
  THEN RAISE EXCEPTION 'partner_reads_probe_unknown_released'; END IF;

  -- A two-card purchase must deliver both reviewed provider units. Partial or
  -- duplicated redemption evidence cannot mark the order complete.
  UPDATE public.api_partners SET allowed_sections=ARRAY['sms','giftcards'] WHERE id=v_prepaid;
  v_result:=public.reserve_api_partner_external_order(v_key,'giftcards','giftcards','fixture-gift',
    'Synthetic two-card purchase',2,40,40,'partner-read-probe-gifts-004',v_fingerprint,'{}',NULL,NULL,NULL);
  IF v_result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'partner_reads_probe_gifts_reserve_failed'; END IF;
  v_gift:=(v_result->>'order_id')::uuid;
  v_result:=public.claim_api_partner_external_dispatch(v_gift,v_key);
  IF v_result->>'send_allowed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'partner_reads_probe_gifts_claim_failed'; END IF;
  v_result:=public.record_api_partner_external_outcome(v_gift,'accepted','bitrefill',
    'TEST-ONLY-PARTNER-GIFT-DELIVERY-210','{}','processing',NULL);
  IF v_result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'partner_reads_probe_gifts_acceptance_failed'; END IF;
  SELECT balance_ngn INTO v_balance FROM public.api_partners WHERE id=v_prepaid;
  v_result:=public.update_api_partner_external_status(v_key,v_gift,'bitrefill',
    'TEST-ONLY-PARTNER-GIFT-DELIVERY-210','completed',jsonb_build_object('redemptions',jsonb_build_array(v_gift_cards->0)));
  IF v_result->>'code' IS DISTINCT FROM 'COMPLETION_EVIDENCE_REQUIRED'
  THEN RAISE EXCEPTION 'partner_reads_probe_partial_gift_completed'; END IF;
  v_gift_denials:=v_gift_denials+1;
  v_result:=public.update_api_partner_external_status(v_key,v_gift,'bitrefill',
    'TEST-ONLY-PARTNER-GIFT-DELIVERY-210','completed',jsonb_build_object('redemptions',jsonb_build_array(v_gift_cards->0,v_gift_cards->0)));
  IF v_result->>'success' IS DISTINCT FROM 'false'
  THEN RAISE EXCEPTION 'partner_reads_probe_duplicate_gift_completed'; END IF;
  v_gift_denials:=v_gift_denials+1;
  v_result:=public.update_api_partner_external_status(v_key,v_gift,'bitrefill',
    'TEST-ONLY-PARTNER-GIFT-DELIVERY-210','completed',jsonb_build_object('redemptions',
      jsonb_build_array(v_gift_cards->0,jsonb_build_object('order_id','TEST-GIFT-UNIT-B','code',''))));
  IF v_result->>'success' IS DISTINCT FROM 'false'
  THEN RAISE EXCEPTION 'partner_reads_probe_blank_gift_completed'; END IF;
  v_gift_denials:=v_gift_denials+1;
  v_result:=public.update_api_partner_external_status(v_key,v_gift,'bitrefill',
    'TEST-ONLY-PARTNER-GIFT-DELIVERY-210','completed',jsonb_build_object('redemptions',v_gift_cards));
  IF v_result->>'success' IS DISTINCT FROM 'true' OR v_result->'data'->>'status' IS DISTINCT FROM 'completed'
    OR v_result->'data'->'response_payload'->'redemptions' IS DISTINCT FROM v_gift_cards
    OR (SELECT response_payload->'redemptions' FROM public.api_partner_orders WHERE id=v_gift) IS DISTINCT FROM v_gift_cards
    OR (SELECT balance_ngn FROM public.api_partners WHERE id=v_prepaid) IS DISTINCT FROM v_balance
    OR (SELECT count(*) FROM public.api_partner_external_events WHERE order_id=v_gift)<>2
    OR (SELECT count(*) FROM public.api_partner_obligations WHERE order_id=v_gift)<>1
  THEN RAISE EXCEPTION 'partner_reads_probe_gift_codes_missing_or_money_changed'; END IF;

  -- One session cannot race its own uncommitted fixtures. Verify the fresh
  -- minute behavior above and inspect the installed serialization/lock order.
  v_rate_definition:=pg_get_functiondef('public.authorize_api_partner_request(text,text)'::regprocedure);
  v_claim_definition:=pg_get_functiondef('public.claim_api_partner_external_dispatch(uuid,uuid)'::regprocedure);
  v_outcome_definition:=pg_get_functiondef('public.record_api_partner_external_outcome(uuid,text,text,text,jsonb,text,text)'::regprocedure);
  v_status_definition:=pg_get_functiondef('public.update_api_partner_external_status(uuid,uuid,text,text,text,jsonb)'::regprocedure);
  v_cancel_definition:=pg_get_functiondef('public.cancel_prepared_api_partner_external_order(uuid,uuid)'::regprocedure);
  v_lock_order:=position('WHERE key_hash=p_hash FOR UPDATE' IN v_rate_definition)>0
    AND position('WHERE id=p_key_id FOR SHARE' IN v_claim_definition)>0
    AND position('WHERE id=p_key_id FOR SHARE' IN v_status_definition)>0
    AND position('FROM public.api_partners' IN v_outcome_definition)>0
    AND position('WHERE order_id=p_order_id FOR UPDATE' IN v_outcome_definition)>0
    AND position('FROM public.api_partners' IN v_cancel_definition)>0
    AND position('WHERE order_id=p_order_id FOR UPDATE' IN v_cancel_definition)>0
    AND position('FROM public.api_partner_keys' IN v_claim_definition)<position('FROM public.api_partners' IN v_claim_definition)
    AND position('FROM public.api_partners' IN v_claim_definition)<position('FROM public.api_partner_external_orders' IN v_claim_definition)
    AND position('FROM public.api_partner_external_orders' IN v_claim_definition)<position('FROM public.api_partner_orders' IN v_claim_definition)
    AND position('FROM public.api_partner_keys' IN v_status_definition)<position('FROM public.api_partners' IN v_status_definition)
    AND position('FROM public.api_partners' IN v_status_definition)<position('FROM public.api_partner_external_orders' IN v_status_definition)
    AND position('FROM public.api_partners' IN v_outcome_definition)<position('WHERE order_id=p_order_id FOR UPDATE' IN v_outcome_definition)
    AND position('FROM public.api_partners' IN v_cancel_definition)<position('WHERE order_id=p_order_id FOR UPDATE' IN v_cancel_definition)
    AND position('nowait' IN lower(v_claim_definition||v_outcome_definition||v_status_definition||v_cancel_definition))=0;
  IF v_lock_order IS DISTINCT FROM true THEN RAISE EXCEPTION 'partner_reads_probe_lock_order_not_211'; END IF;

  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claims','{"role":"authenticated"}',true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.authorize_api_partner_request(v_hash,'orders:read');
    RAISE EXCEPTION 'partner_reads_probe_authenticated_authorization_allowed';
  EXCEPTION WHEN insufficient_privilege THEN v_auth_denials:=v_auth_denials+1; END;
  BEGIN
    PERFORM public.update_api_partner_external_status(v_key,v_accepted,'daisy',
      'TEST-ONLY-PARTNER-READ-DELIVERY-210','completed','{"code":"TEST-ONLY-CODE"}');
    RAISE EXCEPTION 'partner_reads_probe_authenticated_status_allowed';
  EXCEPTION WHEN insufficient_privilege THEN v_auth_denials:=v_auth_denials+1; END;
  BEGIN
    PERFORM public.cancel_prepared_api_partner_external_order(v_prepared,v_key);
    RAISE EXCEPTION 'partner_reads_probe_authenticated_cancellation_allowed';
  EXCEPTION WHEN insufficient_privilege THEN v_auth_denials:=v_auth_denials+1; END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
  SELECT encode(sha256(convert_to(COALESCE(jsonb_agg(jsonb_build_array(id,wallet_balance)
    ORDER BY id),'[]'::jsonb)::text,'UTF8')),'hex') INTO v_wallet_after FROM public.profiles;
  IF v_wallet_before IS DISTINCT FROM v_wallet_after OR v_auth_denials<>3
  THEN RAISE EXCEPTION 'partner_reads_probe_customer_wallet_or_auth_boundary_failed'; END IF;

  INSERT INTO partner_reads_probe_results VALUES (true,true,true,v_admitted,v_counter,true,true,
    v_fresh_denials,true,true,true,
    (SELECT count(*) FROM public.api_partner_external_events WHERE partner_id=v_prepaid AND event_type='release'),
    true,(SELECT count(*) FROM public.api_partner_external_orders WHERE partner_id=v_prepaid AND claimed_at IS NOT NULL),
    (SELECT count(*) FROM public.api_partner_external_events WHERE partner_id=v_prepaid AND event_type='capture'),
    (SELECT count(*) FROM public.api_partner_obligations WHERE partner_id=v_prepaid),true,
    jsonb_array_length(v_gift_cards),v_gift_denials,true,v_lock_order,v_auth_denials);
END;
$probe$;
SELECT * FROM partner_reads_probe_results;
ROLLBACK;
