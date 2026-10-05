-- Source-only synthetic proof. Requires explicit BEGIN; always rolls its own
-- fixtures back. No provider/DNS/HTTP calls or usable API token is created.
SAVEPOINT partner_webhook_outbox_probe;
DO $probe$
DECLARE p uuid:='9a300000-0000-4000-8000-000000000001'; k uuid:='9a300000-0000-4000-8000-000000000011';
 o uuid; old_order uuid; refund_order uuid; unknown_order uuid; ev uuid; r jsonb; c jsonb; b numeric;
BEGIN
 IF EXISTS(SELECT 1 FROM public.api_partners WHERE id=p) OR EXISTS(SELECT 1 FROM public.api_partner_keys WHERE id=k OR key_hash=repeat('9',64))
 THEN RAISE EXCEPTION 'partner_webhook_probe_collision'; END IF;
 INSERT INTO public.api_partners(id,name,contact_email,is_active,allowed_sections,markup_percent,balance_ngn,unlimited_credit,owner_reviewed_at,webhook_url,webhook_secret)
 VALUES(p,'Synthetic Webhook Probe','webhook-probe@example.invalid',true,ARRAY['sms'],0,1000,false,clock_timestamp(),
  'https://callbacks.example.com/tally','tly_whsec_'||repeat('a',64));
 INSERT INTO public.api_partner_keys(id,partner_id,key_name,key_prefix,key_hash,scopes)
 VALUES(k,p,'Transaction-only unusable webhook fixture','fixture-only',repeat('9',64),ARRAY['orders:create','orders:read']);
 r:=public.reserve_api_partner_external_order(k,'sms','sms','test-service','Synthetic SMS',1,10,10,'outbox-probe-completed',repeat('a',64),'{}',NULL,NULL,NULL);
 o:=(r->>'order_id')::uuid;
 UPDATE public.api_partner_orders SET created_at=clock_timestamp() WHERE id=o;
 r:=public.claim_api_partner_external_dispatch(o,k);
 IF r->>'send_allowed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'partner_webhook_probe_dispatch'; END IF;
 r:=public.record_api_partner_external_outcome(o,'accepted','daisy','TEST-OUTBOX-DELIVERY','{}','active',NULL);
 IF r->>'success' IS DISTINCT FROM 'true' OR EXISTS(SELECT 1 FROM private.partner_webhook_events WHERE order_id=o)
 THEN RAISE EXCEPTION 'partner_webhook_probe_active_not_terminal'; END IF;
 r:=public.update_api_partner_external_status(k,o,'daisy','TEST-OUTBOX-DELIVERY','completed','{"code":"TEST-ONLY-CODE"}');
 IF r->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'partner_webhook_probe_completion'; END IF;
 SELECT event_id INTO ev FROM private.partner_webhook_events WHERE order_id=o AND event_type='partner.order.completed';
 IF ev IS NULL OR (SELECT count(*) FROM private.partner_webhook_events WHERE order_id=o)<>1
 THEN RAISE EXCEPTION 'partner_webhook_probe_queue'; END IF;
 -- Order modifications cannot enqueue another copy of the same event.
 UPDATE public.api_partner_orders SET updated_at=now() WHERE id=o;
 IF (SELECT count(*) FROM private.partner_webhook_events WHERE order_id=o)<>1 THEN RAISE EXCEPTION 'partner_webhook_probe_duplicate'; END IF;
 b:=(SELECT balance_ngn FROM public.api_partners WHERE id=p);
 c:=public.claim_api_partner_webhook_event(ev);
 IF c->>'send_allowed' IS DISTINCT FROM 'true' OR c->>'event_id' IS DISTINCT FROM ev::text
  OR c->>'event_type' IS DISTINCT FROM 'partner.order.completed' OR c->'order'->>'id' IS DISTINCT FROM o::text
  OR c->'order' ? 'response_payload' OR c->'order' ? 'request_payload'
  OR (SELECT count(*) FROM public.api_partner_webhook_deliveries WHERE id=ev AND attempts=1 AND response_body IS NULL)<>1
 THEN RAISE EXCEPTION 'partner_webhook_probe_claim'; END IF;
 r:=public.claim_api_partner_webhook_event(ev);
 IF r->>'send_allowed' IS DISTINCT FROM 'false' OR r ? 'partner' OR r ? 'claim_nonce' THEN RAISE EXCEPTION 'partner_webhook_probe_reclaim'; END IF;
 r:=public.finish_api_partner_webhook_event(ev,gen_random_uuid(),'delivered','WEBHOOK_DELIVERED',200);
 IF r->>'code' IS DISTINCT FROM 'INVALID_CLAIM' THEN RAISE EXCEPTION 'partner_webhook_probe_nonce'; END IF;
 r:=public.finish_api_partner_webhook_event(ev,(c->>'claim_nonce')::uuid,'outcome_unknown','WEBHOOK_TRANSPORT_UNAVAILABLE',NULL);
 IF r->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'partner_webhook_probe_finish'; END IF;
 r:=public.finish_api_partner_webhook_event(ev,(c->>'claim_nonce')::uuid,'outcome_unknown','WEBHOOK_TRANSPORT_UNAVAILABLE',NULL);
 IF r->>'idempotent_replay' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'partner_webhook_probe_finish_replay'; END IF;
 r:=public.finish_api_partner_webhook_event(ev,(c->>'claim_nonce')::uuid,'delivered','WEBHOOK_DELIVERED',200);
 IF r->>'code' IS DISTINCT FROM 'OUTCOME_CONFLICT' THEN RAISE EXCEPTION 'partner_webhook_probe_ambiguous_final'; END IF;
 IF b IS DISTINCT FROM(SELECT balance_ngn FROM public.api_partners WHERE id=p)
 THEN RAISE EXCEPTION 'partner_webhook_probe_financial_side_effect'; END IF;
 -- A completed old order must never be retroactively queued.
 r:=public.reserve_api_partner_external_order(k,'sms','sms','test-service','Synthetic SMS',1,10,10,'outbox-probe-historical',repeat('b',64),'{}',NULL,NULL,NULL);
 old_order:=(r->>'order_id')::uuid;
 UPDATE public.api_partner_orders SET created_at=(SELECT started_at FROM private.partner_webhook_start)-interval '1 second' WHERE id=old_order;
 PERFORM public.claim_api_partner_external_dispatch(old_order,k);
 PERFORM public.record_api_partner_external_outcome(old_order,'accepted','daisy','TEST-OUTBOX-OLD','{"code":"TEST-ONLY-CODE"}','completed',NULL);
 IF EXISTS(SELECT 1 FROM private.partner_webhook_events WHERE order_id=old_order) THEN RAISE EXCEPTION 'partner_webhook_probe_backfill'; END IF;
 -- Prepared prepaid release queues a refund; unknown provider outcome does not.
 r:=public.reserve_api_partner_external_order(k,'sms','sms','test-service','Synthetic SMS',1,10,10,'outbox-probe-refunded',repeat('c',64),'{}',NULL,NULL,NULL);
 refund_order:=(r->>'order_id')::uuid;
 UPDATE public.api_partner_orders SET created_at=clock_timestamp() WHERE id=refund_order;
 PERFORM public.cancel_prepared_api_partner_external_order(refund_order,k);
 SELECT event_id INTO ev FROM private.partner_webhook_events WHERE order_id=refund_order AND event_type='partner.order.refunded';
 IF ev IS NULL THEN RAISE EXCEPTION 'partner_webhook_probe_refund'; END IF;
 UPDATE public.api_partner_keys SET revoked_at=now() WHERE id=k;
 r:=public.claim_api_partner_webhook_event(ev);
 IF r->>'send_allowed' IS DISTINCT FROM 'false' OR r->>'code' IS DISTINCT FROM 'WEBHOOK_NOT_AUTHORIZED'
  OR r ? 'partner' OR EXISTS(SELECT 1 FROM public.api_partner_webhook_deliveries WHERE id=ev)
 THEN RAISE EXCEPTION 'partner_webhook_probe_revocation'; END IF;
 UPDATE public.api_partner_keys SET revoked_at=NULL WHERE id=k;
 r:=public.reserve_api_partner_external_order(k,'sms','sms','test-service','Synthetic SMS',1,10,10,'outbox-probe-unknown-held',repeat('d',64),'{}',NULL,NULL,NULL);
 unknown_order:=(r->>'order_id')::uuid;
 UPDATE public.api_partner_orders SET created_at=clock_timestamp() WHERE id=unknown_order;
 PERFORM public.claim_api_partner_external_dispatch(unknown_order,k);
 PERFORM public.record_api_partner_external_outcome(unknown_order,'unknown',NULL,NULL,'{}',NULL,NULL);
 IF EXISTS(SELECT 1 FROM private.partner_webhook_events WHERE order_id=unknown_order)
 THEN RAISE EXCEPTION 'partner_webhook_probe_unknown_held'; END IF;
 r:=public.list_queued_api_partner_webhook_events(21);
 IF r->>'code' IS DISTINCT FROM 'INVALID_LIMIT' THEN RAISE EXCEPTION 'partner_webhook_probe_limit'; END IF;
END $probe$;
SET LOCAL ROLE authenticated;
DO $$ DECLARE n integer:=0; BEGIN
 BEGIN PERFORM * FROM private.partner_webhook_events; EXCEPTION WHEN insufficient_privilege THEN n:=n+1; END;
 BEGIN PERFORM public.list_queued_api_partner_webhook_events(20); EXCEPTION WHEN insufficient_privilege THEN n:=n+1; END;
 BEGIN PERFORM public.claim_api_partner_webhook_event(gen_random_uuid()); EXCEPTION WHEN insufficient_privilege THEN n:=n+1; END;
 BEGIN PERFORM public.finish_api_partner_webhook_event(gen_random_uuid(),gen_random_uuid(),'outcome_unknown','WEBHOOK_TRANSPORT_UNAVAILABLE',NULL);
 EXCEPTION WHEN insufficient_privilege THEN n:=n+1; END;
 IF n<>4 THEN RAISE EXCEPTION 'partner_webhook_probe_browser'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$ DECLARE n integer:=0; BEGIN
 BEGIN UPDATE private.partner_webhook_events SET state='queued'; EXCEPTION WHEN insufficient_privilege THEN n:=n+1; END;
 BEGIN DELETE FROM public.api_partner_webhook_deliveries; EXCEPTION WHEN insufficient_privilege THEN n:=n+1; END;
 BEGIN UPDATE private.partner_webhook_start SET started_at=now(); EXCEPTION WHEN insufficient_privilege THEN n:=n+1; END;
 IF n<>3 THEN RAISE EXCEPTION 'partner_webhook_probe_direct_mutation'; END IF;
END $$;
RESET ROLE;
ROLLBACK TO SAVEPOINT partner_webhook_outbox_probe;
RELEASE SAVEPOINT partner_webhook_outbox_probe;
SELECT true passed,true future_terminal_proof_only,true original_key_revocation_denied,
 true claim_once_before_http,true ambiguous_never_retried,true minimal_order_summary,
 true no_callback_money_changes,true browser_denied,true direct_service_mutations_denied,true fixtures_rolled_back;
