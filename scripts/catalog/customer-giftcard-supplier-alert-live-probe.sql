-- Caller wraps this source-only synthetic probe in BEGIN ... ROLLBACK.
-- No provider request, actual customer fixture, financial mutation or secret output.
SAVEPOINT giftcard_supplier_alert_probe;
CREATE TEMP TABLE giftcard_probe_alert_before ON COMMIT DROP AS
  SELECT count(*) n, coalesce(max(occurrence_count) FILTER (WHERE provider='bitrefill'),0) occurrences,
    md5(coalesce(string_agg(to_jsonb(a)::text,'' ORDER BY provider),'')) digest
  FROM public.supplier_balance_alerts a;
SET LOCAL ROLE service_role;
SELECT public.record_supplier_balance_alert('bitrefill',NULL,'customer-giftcards');
RESET ROLE;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.supplier_balance_alerts a CROSS JOIN giftcard_probe_alert_before b
   WHERE a.provider='bitrefill' AND a.product_group_id IS NULL AND a.source='customer-giftcards'
   AND a.alert_code='insufficient_balance' AND a.resolved_at IS NULL AND a.occurrence_count=b.occurrences+1)
 THEN RAISE EXCEPTION 'giftcard_probe_alert_record'; END IF;
END $$;
SET LOCAL ROLE service_role;
SELECT public.record_supplier_balance_alert('bitrefill',NULL,'customer-giftcards');
SELECT public.resolve_supplier_balance_alert('bitrefill',now()-interval '1 second');
RESET ROLE;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.supplier_balance_alerts a CROSS JOIN giftcard_probe_alert_before b
   WHERE a.provider='bitrefill' AND a.resolved_at IS NULL AND a.occurrence_count=b.occurrences+2)
 THEN RAISE EXCEPTION 'giftcard_probe_alert_stale_resolve'; END IF;
END $$;
SET LOCAL ROLE service_role;
SELECT public.resolve_supplier_balance_alert('bitrefill',now()+interval '1 second');
RESET ROLE;
DO $$ DECLARE denials integer:=0; BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.supplier_balance_alerts WHERE provider='bitrefill' AND resolved_at IS NOT NULL)
 THEN RAISE EXCEPTION 'giftcard_probe_alert_resolve'; END IF;
 BEGIN PERFORM public.record_supplier_balance_alert('daisy',NULL,'customer-giftcards');
 EXCEPTION WHEN check_violation THEN denials:=denials+1; END;
 BEGIN PERFORM public.record_supplier_balance_alert('bitrefill',NULL,'smsbus');
 EXCEPTION WHEN check_violation THEN denials:=denials+1; END;
 IF denials<>2 THEN RAISE EXCEPTION 'giftcard_probe_alert_unknown_values'; END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$ DECLARE denials integer:=0; BEGIN
 BEGIN PERFORM public.record_supplier_balance_alert('bitrefill',NULL,'customer-giftcards');
 EXCEPTION WHEN insufficient_privilege THEN denials:=denials+1; END;
 BEGIN PERFORM public.resolve_supplier_balance_alert('bitrefill',now());
 EXCEPTION WHEN insufficient_privilege THEN denials:=denials+1; END;
 BEGIN PERFORM count(*) FROM public.supplier_balance_alerts;
 EXCEPTION WHEN insufficient_privilege THEN denials:=denials+1; END;
 IF denials<>3 THEN RAISE EXCEPTION 'giftcard_probe_alert_browser_access'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ DECLARE denials integer:=0; BEGIN
 BEGIN PERFORM public.record_supplier_balance_alert('bitrefill',NULL,'customer-giftcards');
 EXCEPTION WHEN insufficient_privilege THEN denials:=denials+1; END;
 BEGIN PERFORM count(*) FROM public.supplier_balance_alerts;
 EXCEPTION WHEN insufficient_privilege THEN denials:=denials+1; END;
 IF denials<>2 THEN RAISE EXCEPTION 'giftcard_probe_alert_anon_access'; END IF;
END $$;
RESET ROLE;
ROLLBACK TO SAVEPOINT giftcard_supplier_alert_probe;
RELEASE SAVEPOINT giftcard_supplier_alert_probe;
SELECT true passed, true service_warning_recorded, true repeated_warning_counted,
 true stale_success_cannot_clear_new_warning, true fresh_success_resolves,
 true unsupported_values_denied, true browser_and_anon_denied, true fixtures_rolled_back;
