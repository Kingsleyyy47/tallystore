-- Staff payment checks are evidence readers, never a payment/credit mechanism.
-- Existing logs intentionally receive no authenticity backfill: the historical
-- verified_* parsing fields are not a persisted webhook-authentication receipt.
DO $$ BEGIN
  IF to_regclass('public.wallet_provider_confirmations') IS NULL
    OR to_regprocedure('public.wallet_legacy_funding_cutoff()') IS NULL THEN
    RAISE EXCEPTION 'Existing PocketFi financial evidence is required for payment checks';
  END IF;
END $$;
ALTER TABLE public.pocketfi_webhook_logs
  ADD COLUMN webhook_verified_at timestamptz,
  ADD COLUMN webhook_verification_method text;
ALTER TABLE public.pocketfi_webhook_logs ADD CONSTRAINT pocketfi_webhook_auth_receipt_shape
  CHECK ((webhook_verified_at IS NULL AND webhook_verification_method IS NULL)
    OR (webhook_verified_at IS NOT NULL AND webhook_verification_method IS NOT NULL
      AND webhook_verification_method IN ('hmac_sha512','shared_secret')));
REVOKE ALL ON public.pocketfi_webhook_logs FROM PUBLIC, anon, authenticated;

CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE private.staff_pocketfi_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  search_type text NOT NULL CHECK (search_type IN ('reference','email','account_number')),
  search_value text NOT NULL CHECK (length(search_value) BETWEEN 1 AND 256),
  results jsonb NOT NULL DEFAULT '[]'::jsonb,
  check_state text NOT NULL DEFAULT 'started' CHECK (check_state IN ('started','complete','unavailable')),
  truncated boolean NOT NULL DEFAULT false
);
CREATE INDEX staff_pocketfi_checks_actor_time ON private.staff_pocketfi_checks(actor_id,checked_at DESC);
CREATE TABLE private.staff_pocketfi_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id uuid NOT NULL REFERENCES private.staff_pocketfi_checks(id),
  payment_identity text NOT NULL CHECK (length(payment_identity)=32),
  flagged_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  note text NOT NULL CHECK (length(btrim(note)) BETWEEN 3 AND 1000),
  snapshot jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reviewed')),
  reviewed_at timestamptz,
  reviewed_by uuid,
  review_note text CHECK (length(btrim(review_note)) BETWEEN 3 AND 1000),
  CHECK ((status='pending' AND reviewed_at IS NULL AND reviewed_by IS NULL AND review_note IS NULL)
    OR (status='reviewed' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL AND review_note IS NOT NULL))
);
CREATE UNIQUE INDEX staff_pocketfi_one_pending_review
  ON private.staff_pocketfi_reviews(payment_identity) WHERE status='pending';
CREATE TABLE private.staff_pocketfi_review_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES private.staff_pocketfi_reviews(id),
  actor_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('flagged','duplicate_flag','reviewed')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  note text NOT NULL CHECK (length(btrim(note)) BETWEEN 3 AND 1000)
);
ALTER TABLE private.staff_pocketfi_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.staff_pocketfi_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.staff_pocketfi_review_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.staff_pocketfi_checks,private.staff_pocketfi_reviews,
  private.staff_pocketfi_review_audit FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.require_pocketfi_checker(p_admin_only boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid();
BEGIN
  IF v_actor IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' OR NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id=v_actor
      AND NOT COALESCE(p.account_suspended,false)
      AND (COALESCE(p.is_admin,false) OR (NOT p_admin_only AND COALESCE(p.is_staff,false)
        AND EXISTS (SELECT 1 FROM public.staff_permissions sp WHERE sp.user_id=p.id
          AND sp.permission_key='view_pocketfi_payments' AND sp.is_enabled)))
  ) THEN RAISE EXCEPTION 'PocketFi payment check is not authorized' USING ERRCODE='42501'; END IF;
  RETURN v_actor;
END $$;

CREATE FUNCTION private.pocketfi_check_reference(p_verified text,p_payload jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT NULLIF(btrim(COALESCE(NULLIF(btrim(p_verified),''),NULLIF(p_payload#>>'{transaction,reference}',''),
   NULLIF(p_payload#>>'{data,transaction,reference}',''),NULLIF(p_payload->>'reference',''),NULLIF(p_payload->>'transaction_reference',''),
   NULLIF(p_payload->>'transactionReference',''),NULLIF(p_payload#>>'{data,reference}',''),NULLIF(p_payload#>>'{data,transaction_reference}',''))),'');
$$;

CREATE INDEX pocketfi_staff_reference_lookup ON public.pocketfi_webhook_logs
  ((left(NULLIF(btrim(COALESCE(NULLIF(btrim(verified_reference),''),NULLIF(raw_payload#>>'{transaction,reference}',''),
    NULLIF(raw_payload#>>'{data,transaction,reference}',''),NULLIF(raw_payload->>'reference',''),NULLIF(raw_payload->>'transaction_reference',''),
    NULLIF(raw_payload->>'transactionReference',''),NULLIF(raw_payload#>>'{data,reference}',''),NULLIF(raw_payload#>>'{data,transaction_reference}',''))),''),256)));
CREATE INDEX pocketfi_staff_customer_lookup ON public.pocketfi_webhook_logs(matched_user_id,created_at DESC);
CREATE INDEX pocketfi_staff_account_lookup ON public.pocketfi_webhook_logs(matched_account_number,created_at DESC);
CREATE INDEX pocketfi_staff_ledger_reference ON public.transactions(reference) WHERE amount>0;
CREATE INDEX pocketfi_staff_ledger_external_reference ON public.transactions(external_payment_id) WHERE amount>0;
CREATE INDEX pocketfi_staff_ledger_verified_reference ON public.transactions((metadata->>'verified_reference')) WHERE amount>0;

CREATE FUNCTION private.pocketfi_payment_check_row(p_reference text,p_customer_id uuid,p_account text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_logs integer:=0; v_attested integer:=0; v_success integer:=0; v_failed integer:=0; v_pending integer:=0;
  v_bad integer:=0; v_users integer:=0; v_accounts integer:=0; v_amounts integer:=0;
  v_candidates integer:=0; v_exact integer:=0; v_partner integer:=0;
  v_customer uuid:=p_customer_id; v_account text:=NULLIF(btrim(p_account),''); v_email text;
  v_amount numeric; v_received timestamptz; v_transaction uuid; v_credited_at timestamptz; v_credit_amount numeric;
  v_webhook text:='not_found'; v_credit text:='not_found'; v_status text:='no_webhook';
  v_reasons jsonb:='[]'::jsonb; v_conflict boolean:=false; v_trust_available boolean:=true;
  v_trusted_success boolean:=false; v_owner_count integer:=0;
BEGIN
  -- A check reads one MVCC snapshot. It never observes the present wallet balance.
  WITH logs AS (
    SELECT w.*,
      (w.webhook_verified_at IS NOT NULL
        AND w.webhook_verification_method IN ('hmac_sha512','shared_secret')
        AND w.webhook_verified_at BETWEEN COALESCE(w.created_at,w.webhook_verified_at)-interval '5 minutes'
          AND COALESCE(w.created_at,w.webhook_verified_at)+interval '5 minutes') AS attested,
      lower(COALESCE(w.verified_status,'')) AS event_status,
      (w.raw_payload @? '$.**.migration_probe ? (@ == true || @ == "true")'
        OR EXISTS (SELECT 1 FROM (VALUES (w.raw_payload->>'currency'),(w.raw_payload#>>'{order,currency}'),
          (w.raw_payload#>>'{data,currency}'),(w.raw_payload#>>'{data,order,currency}'),
          (w.raw_payload#>>'{transaction,currency}')) c(value)
          WHERE NULLIF(btrim(c.value),'') IS NOT NULL AND upper(btrim(c.value))<>'NGN')) AS invalid_payload
    FROM public.pocketfi_webhook_logs w
    WHERE p_reference IS NOT NULL
      AND left(NULLIF(btrim(COALESCE(NULLIF(btrim(w.verified_reference),''),NULLIF(w.raw_payload#>>'{transaction,reference}',''),
        NULLIF(w.raw_payload#>>'{data,transaction,reference}',''),NULLIF(w.raw_payload->>'reference',''),NULLIF(w.raw_payload->>'transaction_reference',''),
        NULLIF(w.raw_payload->>'transactionReference',''),NULLIF(w.raw_payload#>>'{data,reference}',''),NULLIF(w.raw_payload#>>'{data,transaction_reference}',''))),''),256)=p_reference
      AND private.pocketfi_check_reference(w.verified_reference,w.raw_payload)=p_reference
  )
  SELECT count(*)::integer,count(*) FILTER (WHERE attested AND NOT invalid_payload)::integer,
    count(*) FILTER (WHERE attested AND NOT invalid_payload AND event_status ~ '^(success|successful|completed|paid|credit|(transfer|payment|collection)[._-](success|successful|completed|paid))$')::integer,
    count(*) FILTER (WHERE attested AND NOT invalid_payload AND event_status ~ '^(failed|failure|declined|cancelled|canceled|rejected|reversed|(transfer|payment|collection)[._-](failed|failure|declined|cancelled|canceled|rejected|reversed))$')::integer,
    count(*) FILTER (WHERE attested AND NOT invalid_payload AND event_status ~ '^(pending|processing|initiated|created|queued|(transfer|payment|collection)[._-](pending|processing|initiated|created|queued))$')::integer,
    count(*) FILTER (WHERE invalid_payload)::integer,
    count(DISTINCT matched_user_id)::integer,count(DISTINCT NULLIF(btrim(matched_account_number),''))::integer,
    count(DISTINCT verified_amount_ngn)::integer,
    (array_agg(matched_user_id ORDER BY created_at DESC) FILTER (WHERE matched_user_id IS NOT NULL))[1],
    (array_agg(NULLIF(btrim(matched_account_number),'') ORDER BY created_at DESC) FILTER (WHERE NULLIF(btrim(matched_account_number),'') IS NOT NULL))[1],
    (array_agg(verified_amount_ngn ORDER BY created_at DESC) FILTER (WHERE verified_amount_ngn>0))[1],max(created_at)
  INTO v_logs,v_attested,v_success,v_failed,v_pending,v_bad,v_users,v_accounts,v_amounts,
    v_customer,v_account,v_amount,v_received FROM logs;
  v_customer:=COALESCE(v_customer,p_customer_id); v_account:=COALESCE(v_account,NULLIF(btrim(p_account),''));
  IF v_customer IS NOT NULL THEN
    SELECT COALESCE(NULLIF(btrim(p.email),''),u.email),COALESCE(v_account,p.pocketfi_account_number)
      INTO v_email,v_account FROM public.profiles p LEFT JOIN auth.users u ON u.id=p.id WHERE p.id=v_customer;
  ELSIF v_account IS NOT NULL THEN
    SELECT count(*)::integer,(array_agg(p.id))[1] INTO v_users,v_customer FROM public.profiles p
      WHERE p.pocketfi_account_number=v_account;
    IF v_users=1 THEN SELECT COALESCE(NULLIF(btrim(p.email),''),u.email) INTO v_email
      FROM public.profiles p LEFT JOIN auth.users u ON u.id=p.id WHERE p.id=v_customer; ELSE v_customer:=NULL; END IF;
  END IF;
  IF v_account IS NOT NULL AND to_regclass('public.api_partner_customers') IS NOT NULL THEN
    EXECUTE 'SELECT count(*)::integer FROM public.api_partner_customers WHERE pocketfi_account_number=$1'
      INTO v_partner USING v_account;
  END IF;
  v_conflict:=v_bad>0 OR v_users>1 OR v_accounts>1 OR v_amounts>1 OR v_partner>0
    OR (v_success>0 AND v_failed>0) OR (v_failed>0 AND v_pending>0)
    OR (p_customer_id IS NOT NULL AND v_customer IS DISTINCT FROM p_customer_id)
    OR (p_account IS NOT NULL AND v_account IS DISTINCT FROM p_account);
  IF v_logs>0 THEN
    v_webhook:=CASE WHEN v_success>0 THEN 'verified_success' WHEN v_failed>0 THEN 'verified_failed'
      WHEN v_pending>0 THEN 'verified_pending' ELSE 'unverified' END;
    IF v_attested=0 THEN v_reasons:=v_reasons||jsonb_build_array('Webhook authenticity was not recorded for these historical records.'); END IF;
    IF v_bad>0 THEN v_reasons:=v_reasons||jsonb_build_array('A test event or a non-NGN currency requires review.'); END IF;
  END IF;
  SELECT count(*)::integer INTO v_owner_count FROM public.profiles WHERE pocketfi_account_number=v_account;
  IF v_account IS NOT NULL AND (v_owner_count<>1 OR NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id=v_customer AND p.pocketfi_account_number=v_account
      AND NOT COALESCE(p.is_staff,false) AND NOT COALESCE(p.is_admin,false)
  )) THEN v_conflict:=true; v_reasons:=v_reasons||jsonb_build_array('Receiving account does not uniquely match an eligible customer.'); END IF;
  -- Never combine an authenticated but malformed event with amount/account/user
  -- fields from an unauthenticated historical delivery to manufacture success.
  SELECT EXISTS (SELECT 1 FROM public.pocketfi_webhook_logs w
    WHERE w.verified_reference=p_reference AND w.matched_account_number=v_account
      AND (w.matched_user_id IS NULL OR w.matched_user_id=v_customer)
      AND w.verified_amount_ngn=v_amount AND w.verified_amount_ngn>0
      AND w.verified_amount_ngn<=999999999999.99 AND w.verified_amount_ngn=round(w.verified_amount_ngn,2)
      AND w.webhook_verification_method IN ('hmac_sha512','shared_secret') AND w.webhook_verified_at IS NOT NULL
      AND w.webhook_verified_at BETWEEN COALESCE(w.created_at,w.webhook_verified_at)-interval '5 minutes'
        AND COALESCE(w.created_at,w.webhook_verified_at)+interval '5 minutes'
      AND lower(COALESCE(w.verified_status,'')) ~ '^(success|successful|completed|paid|credit|(transfer|payment|collection)[._-](success|successful|completed|paid))$'
      AND NOT (w.raw_payload @? '$.**.migration_probe ? (@ == true || @ == "true")')
      AND NOT EXISTS (SELECT 1 FROM (VALUES (w.raw_payload->>'currency'),(w.raw_payload#>>'{order,currency}'),
        (w.raw_payload#>>'{data,currency}'),(w.raw_payload#>>'{data,order,currency}'),(w.raw_payload#>>'{transaction,currency}')) c(value)
        WHERE NULLIF(btrim(c.value),'') IS NOT NULL AND upper(btrim(c.value))<>'NGN'))
    INTO v_trusted_success;
  IF v_amount>999999999999.99 THEN v_amount:=NULL; v_conflict:=true; END IF;
  IF v_partner>0 THEN v_reasons:=v_reasons||jsonb_build_array('This receiving account belongs to the partner payment flow and needs admin review.'); END IF;

  -- The exact ledger predicate follows wallet_financial_truth_internal's PocketFi
  -- evidence chain, with additional source, NGN, posted balance-delta and duplicate
  -- checks. A historical match proves a recorded wallet credit, not a historical
  -- cryptographic signature. No new funding authority or write path is introduced.
  BEGIN
    SELECT count(*)::integer INTO v_candidates FROM public.transactions t
      WHERE p_reference IS NOT NULL AND COALESCE(t.balance_type,'wallet')='wallet'
        AND t.amount>0 AND lower(COALESCE(t.type,'')) IN ('topup','top_up','top-up','wallet_topup','wallet_deposit','deposit')
        AND (t.reference=p_reference OR t.external_payment_id=p_reference
          OR t.metadata->>'verified_reference'=p_reference);
    SELECT count(*)::integer,(array_agg(t.id))[1],max(t.created_at),max(t.amount)
      INTO v_exact,v_transaction,v_credited_at,v_credit_amount FROM public.transactions t
      WHERE p_reference IS NOT NULL AND t.user_id=v_customer AND t.amount>0
        AND COALESCE(t.balance_type,'wallet')='wallet' AND t.currency='NGN'
        AND lower(COALESCE(t.type,'')) IN ('topup','top_up','top-up','wallet_topup','wallet_deposit','deposit')
        AND lower(COALESCE(t.status,'')) IN ('completed','success','successful','credited','complete','paid','finished')
        AND t.reference=p_reference
        AND t.balance_before IS NOT NULL AND t.balance_after IS NOT NULL AND t.balance_after-t.balance_before=t.amount
        AND (
          (t.external_payment_id=p_reference
            AND lower(COALESCE(t.metadata->>'provider',''))='pocketfi'
            AND t.metadata->>'source'='webhook-pocketfi'
            AND t.metadata->>'verified_reference'=p_reference
            AND length(COALESCE(t.metadata->>'verified_amount_ngn',''))<=32
            AND CASE WHEN COALESCE(t.metadata->>'verified_amount_ngn','') ~ '^[0-9]+([.][0-9]{1,2})?$'
              THEN (t.metadata->>'verified_amount_ngn')::numeric=t.amount ELSE false END
            AND EXISTS (SELECT 1 FROM public.pocketfi_webhook_logs w
              WHERE w.id::text=t.metadata->>'webhook_log_id' AND w.matched_user_id=t.user_id
                AND w.processed AND w.verified_amount_ngn=t.amount AND w.verified_reference=p_reference
                AND w.matched_account_number=v_account
                AND NOT (w.raw_payload @? '$.**.migration_probe ? (@ == true || @ == "true")')))
          OR (
            -- Exact historical recovery authority already used by wallet truth.
            -- A recorded confirmation does not manufacture old signature receipts.
            t.created_at>=public.wallet_legacy_funding_cutoff()
            AND t.created_at<'2026-09-24 00:00:00+00'::timestamptz
            AND NULLIF(btrim(COALESCE(t.external_payment_id,'')),'') IS NULL
            AND EXISTS (SELECT 1 FROM public.wallet_provider_confirmations c
              WHERE c.transaction_id=t.id AND c.user_id=t.user_id AND c.provider_reference=t.reference
                AND c.confirmed_amount=t.amount AND c.provider='pocketfi' AND c.provider_status='completed'
                AND c.provider_checked_at>=t.created_at)
            AND EXISTS (SELECT 1 FROM public.pocketfi_webhook_logs w
              WHERE w.matched_user_id=t.user_id AND w.matched_account_number=v_account
                AND w.processed AND w.error_message IS NULL
                AND w.raw_payload#>>'{transaction,reference}'=t.reference
                AND length(COALESCE(w.raw_payload#>>'{order,amount}',''))<=32
                AND CASE WHEN COALESCE(w.raw_payload#>>'{order,amount}','') ~ '^[0-9]+([.][0-9]{1,2})?$'
                  THEN (w.raw_payload#>>'{order,amount}')::numeric=t.amount ELSE false END
                AND NOT (w.raw_payload @? '$.**.migration_probe ? (@ == true || @ == "true")'))
          )
        );
    IF v_exact=1 AND v_candidates=1 THEN v_credit:='credited';
    ELSIF v_candidates>0 THEN v_credit:='review'; v_conflict:=true;
      v_transaction:=NULL; v_credited_at:=NULL; v_credit_amount:=NULL;
      v_reasons:=v_reasons||jsonb_build_array('Recorded credit evidence is duplicated or does not exactly match this payment.');
    ELSE v_transaction:=NULL; v_credited_at:=NULL; v_credit_amount:=NULL; END IF;
  EXCEPTION WHEN OTHERS THEN
    v_trust_available:=false; v_credit:='unavailable'; v_conflict:=true;
    v_transaction:=NULL; v_credited_at:=NULL; v_credit_amount:=NULL;
    v_reasons:=v_reasons||jsonb_build_array('Wallet credit evidence is temporarily unavailable. Recheck before taking action.');
  END;
  IF v_logs=0 THEN v_status:=CASE WHEN v_candidates>0 THEN 'needs_review' ELSE 'no_webhook' END;
    v_reasons:=v_reasons||jsonb_build_array('No matching webhook was found. This does not prove that the payment failed.');
  ELSIF v_conflict THEN v_status:='needs_review';
  ELSIF v_webhook='verified_success' THEN
    IF NOT v_trusted_success OR v_customer IS NULL OR v_account IS NULL OR v_amount IS NULL OR v_amount<=0 OR v_amount<>round(v_amount,2) THEN
      v_status:='needs_review'; v_reasons:=v_reasons||jsonb_build_array('Successful event is missing a unique customer, receiving account or valid amount.');
    ELSIF v_credit='credited' AND v_credit_amount=v_amount THEN v_status:='paid_and_credited';
    ELSIF v_credit='not_found' AND v_trust_available THEN v_status:='paid_credit_missing';
    ELSE v_status:='needs_review'; END IF;
  ELSIF v_webhook='verified_failed' THEN v_status:=CASE WHEN v_credit='credited' THEN 'needs_review' ELSE 'failed' END;
  ELSIF v_webhook='verified_pending' THEN v_status:=CASE WHEN v_credit='credited' THEN 'needs_review' ELSE 'pending' END;
  ELSE v_status:='needs_review'; END IF;
  IF v_conflict THEN v_reasons:=v_reasons||jsonb_build_array('Conflicting payment, customer or credit records require admin review.'); END IF;
  IF v_credit='credited' THEN v_reasons:=v_reasons||jsonb_build_array('A matching posted wallet credit is recorded. Later spending does not change this result.'); END IF;
  RETURN jsonb_build_object('result_key',md5(COALESCE(p_reference,'')||'|'||COALESCE(v_customer::text,'')||'|'||COALESCE(v_account,'')),
    'reference',p_reference,'customer_id',v_customer,'customer_email',v_email,
    'account_number',CASE WHEN v_account IS NULL THEN NULL ELSE '••••'||right(v_account,4) END,
    'received_at',v_received,'amount_ngn',v_amount,
    'expected_credit_ngn',CASE WHEN v_webhook='verified_success' AND v_trusted_success AND NOT v_conflict THEN v_amount ELSE NULL END,
    'fee_ngn',NULL,'fee_note','Wallet credit uses the verified transfer amount. No additional fee is inferred from the payload.',
    'webhook_state',v_webhook,'credit_state',v_credit,'status',v_status,
    'transaction_id',v_transaction,'credited_at',v_credited_at,'credited_amount_ngn',v_credit_amount,
    'reasons',v_reasons,'can_flag',v_status IN ('paid_credit_missing','needs_review') AND p_reference IS NOT NULL);
END $$;

CREATE FUNCTION public.staff_check_pocketfi_payments(p_search_type text,p_search text,p_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='8s' AS $$
DECLARE v_actor uuid; v_id uuid; v_time timestamptz; v_query text:=btrim(p_search);
  v_limit integer:=LEAST(GREATEST(COALESCE(p_limit,25),1),50); v_results jsonb:='[]'::jsonb;
  v_row record; v_customer uuid; v_account text; v_n integer:=0; v_truncated boolean:=false; v_customer_count integer:=0;
BEGIN
  v_actor:=private.require_pocketfi_checker(false);
  IF p_search_type IS NULL OR p_search_type NOT IN ('reference','email','account_number') OR v_query IS NULL
    OR v_query ~ '[[:cntrl:]]' OR length(v_query) NOT BETWEEN 3 AND 256
    OR (p_search_type='email' AND (length(v_query)>254 OR v_query !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'))
    OR (p_search_type='account_number' AND v_query !~ '^[0-9]{6,24}$') THEN
    RAISE EXCEPTION 'Enter an exact reference, customer email or receiving account number' USING ERRCODE='22023'; END IF;
  IF p_search_type='email' THEN v_query:=lower(v_query); END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pocketfi-check-rate:'||v_actor::text,0));
  IF (SELECT count(*) FROM private.staff_pocketfi_checks WHERE actor_id=v_actor AND checked_at>clock_timestamp()-interval '1 minute')>=30 THEN
    RAISE EXCEPTION 'Too many payment checks. Please wait a minute' USING ERRCODE='P0001'; END IF;
  INSERT INTO private.staff_pocketfi_checks(actor_id,search_type,search_value) VALUES(v_actor,p_search_type,v_query)
    RETURNING id,checked_at INTO v_id,v_time;
  BEGIN
    IF p_search_type='reference' THEN
      v_results:=jsonb_build_array(private.pocketfi_payment_check_row(v_query,NULL,NULL));
    ELSE
      IF p_search_type='account_number' THEN v_account:=v_query;
        SELECT CASE WHEN count(*)=1 THEN (array_agg(id))[1] ELSE NULL END INTO v_customer
          FROM public.profiles WHERE pocketfi_account_number=v_query;
      ELSE
        SELECT CASE WHEN count(*)=1 THEN (array_agg(p.id))[1] ELSE NULL END,
          CASE WHEN count(*)=1 THEN (array_agg(p.pocketfi_account_number))[1] ELSE NULL END,count(*)::integer
          INTO v_customer,v_account,v_customer_count
          FROM public.profiles p LEFT JOIN auth.users u ON u.id=p.id
          WHERE lower(COALESCE(NULLIF(btrim(p.email),''),u.email))=v_query;
        IF v_customer_count>1 THEN
          UPDATE private.staff_pocketfi_checks SET check_state='unavailable' WHERE id=v_id;
          RETURN jsonb_build_object('error','POCKETFI_CUSTOMER_AMBIGUOUS',
            'message','More than one customer matches this email. Check the exact payment reference or receiving account number.');
        END IF;
      END IF;
      FOR v_row IN
        WITH candidate_refs AS (
          SELECT private.pocketfi_check_reference(w.verified_reference,w.raw_payload) AS reference,w.created_at
            FROM public.pocketfi_webhook_logs w WHERE (v_customer IS NOT NULL AND w.matched_user_id=v_customer)
              OR (v_account IS NOT NULL AND w.matched_account_number=v_account)
          UNION ALL
          SELECT COALESCE(NULLIF(btrim(t.external_payment_id),''),NULLIF(btrim(t.reference),'')),t.created_at
            FROM public.transactions t WHERE t.user_id=v_customer AND t.amount>0
              AND lower(COALESCE(t.metadata->>'provider',''))='pocketfi'
              AND lower(COALESCE(t.type,'')) IN ('topup','top_up','top-up','wallet_topup','wallet_deposit','deposit')
        ) SELECT reference,max(created_at) AS received_at FROM candidate_refs
          WHERE reference IS NOT NULL AND length(reference)<=256 GROUP BY reference
          ORDER BY max(created_at) DESC NULLS LAST,reference LIMIT v_limit+1
      LOOP
        v_n:=v_n+1; IF v_n>v_limit THEN v_truncated:=true; EXIT; END IF;
        v_results:=v_results||jsonb_build_array(private.pocketfi_payment_check_row(v_row.reference,v_customer,v_account));
      END LOOP;
      IF v_n=0 THEN v_results:=jsonb_build_array(private.pocketfi_payment_check_row(NULL,v_customer,v_account)); END IF;
    END IF;
    UPDATE private.staff_pocketfi_checks SET results=v_results,check_state='complete',truncated=v_truncated WHERE id=v_id;
  EXCEPTION WHEN OTHERS THEN
    UPDATE private.staff_pocketfi_checks SET check_state='unavailable' WHERE id=v_id;
    RETURN jsonb_build_object('error','POCKETFI_CHECK_UNAVAILABLE','message','Payment evidence is temporarily unavailable. Recheck before taking action.');
  END;
  RETURN jsonb_build_object('check_id',v_id,'checked_at',v_time,'search_type',p_search_type,'search',v_query,
    'results',v_results,'truncated',v_truncated);
END $$;

CREATE FUNCTION public.staff_flag_pocketfi_payment(p_check_id uuid,p_result_key text,p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='8s' AS $$
DECLARE v_actor uuid; v_saved jsonb; v_fresh jsonb; v_id uuid; v_old boolean:=false; v_identity text;
BEGIN
  v_actor:=private.require_pocketfi_checker(false);
  IF p_note IS NULL OR length(btrim(p_note)) NOT BETWEEN 3 AND 1000 OR p_result_key IS NULL OR length(p_result_key)<>32 THEN
    RAISE EXCEPTION 'Add a review note between 3 and 1000 characters' USING ERRCODE='22023'; END IF;
  SELECT r.value INTO v_saved FROM private.staff_pocketfi_checks c CROSS JOIN LATERAL jsonb_array_elements(c.results) r(value)
    WHERE c.id=p_check_id AND c.actor_id=v_actor AND c.check_state='complete'
      AND c.checked_at>clock_timestamp()-interval '24 hours' AND r.value->>'result_key'=p_result_key;
  IF v_saved IS NULL OR COALESCE((v_saved->>'can_flag')::boolean,false)=false THEN
    RAISE EXCEPTION 'Run a fresh payment check before flagging this payment' USING ERRCODE='22023'; END IF;
  -- Re-evaluate on the server; an old screen cannot flag a now-credited payment as missing.
  v_fresh:=private.pocketfi_payment_check_row(v_saved->>'reference',NULL,NULL);
  IF COALESCE((v_fresh->>'can_flag')::boolean,false)=false
    OR (v_saved->>'status'='paid_credit_missing' AND v_fresh->>'credit_state'='credited') THEN
    RAISE EXCEPTION 'Payment evidence changed. Recheck this payment before flagging it' USING ERRCODE='22023'; END IF;
  v_identity:=md5('pocketfi|'||(v_fresh->>'reference'));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pocketfi-review:'||v_identity,0));
  INSERT INTO private.staff_pocketfi_reviews(check_id,payment_identity,flagged_by,note,snapshot)
    VALUES(p_check_id,v_identity,v_actor,btrim(p_note),v_fresh)
    ON CONFLICT(payment_identity) WHERE status='pending' DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    v_old:=true; SELECT id INTO v_id FROM private.staff_pocketfi_reviews WHERE payment_identity=v_identity AND status='pending';
  END IF;
  INSERT INTO private.staff_pocketfi_review_audit(review_id,actor_id,action,note)
    VALUES(v_id,v_actor,CASE WHEN v_old THEN 'duplicate_flag' ELSE 'flagged' END,btrim(p_note));
  RETURN jsonb_build_object('review_id',v_id,'status','pending','already_flagged',v_old);
END $$;

CREATE FUNCTION public.admin_list_pocketfi_payment_reviews(p_status text DEFAULT 'pending',p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid; v_results jsonb; v_limit integer:=LEAST(GREATEST(COALESCE(p_limit,50),1),50); v_count integer;
BEGIN
  v_actor:=private.require_pocketfi_checker(true);
  IF p_status NOT IN ('pending','reviewed') OR p_status IS NULL THEN RAISE EXCEPTION 'Choose pending or reviewed' USING ERRCODE='22023'; END IF;
  SELECT count(*)::integer INTO v_count FROM (SELECT id FROM private.staff_pocketfi_reviews WHERE status=p_status LIMIT v_limit+1) q;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',r.id,'created_at',r.created_at,'flagged_by',r.flagged_by,
    'flagged_by_email',p.email,'note',r.note,'status',r.status,'snapshot',r.snapshot,
    'reviewed_at',r.reviewed_at,'reviewed_by',r.reviewed_by,'review_note',r.review_note) ORDER BY r.created_at DESC),'[]'::jsonb)
    INTO v_results FROM (SELECT * FROM private.staff_pocketfi_reviews WHERE status=p_status ORDER BY created_at DESC,id LIMIT v_limit) r
      LEFT JOIN public.profiles p ON p.id=r.flagged_by;
  RETURN jsonb_build_object('reviews',v_results,'truncated',v_count>v_limit);
END $$;

CREATE FUNCTION public.admin_resolve_pocketfi_payment_review(p_review_id uuid,p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid; v_review private.staff_pocketfi_reviews%ROWTYPE; v_identity text;
BEGIN
  v_actor:=private.require_pocketfi_checker(true);
  IF p_note IS NULL OR length(btrim(p_note)) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'Add a review note between 3 and 1000 characters' USING ERRCODE='22023'; END IF;
  SELECT payment_identity INTO v_identity FROM private.staff_pocketfi_reviews WHERE id=p_review_id;
  IF v_identity IS NULL THEN RAISE EXCEPTION 'Review was not found' USING ERRCODE='22023'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pocketfi-review:'||v_identity,0));
  SELECT * INTO v_review FROM private.staff_pocketfi_reviews WHERE id=p_review_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Review was not found' USING ERRCODE='22023'; END IF;
  IF v_review.status='reviewed' THEN RETURN jsonb_build_object('review_id',p_review_id,'status','reviewed'); END IF;
  UPDATE private.staff_pocketfi_reviews SET status='reviewed',reviewed_at=clock_timestamp(),reviewed_by=v_actor,review_note=btrim(p_note)
    WHERE id=p_review_id;
  INSERT INTO private.staff_pocketfi_review_audit(review_id,actor_id,action,note) VALUES(p_review_id,v_actor,'reviewed',btrim(p_note));
  RETURN jsonb_build_object('review_id',p_review_id,'status','reviewed');
END $$;

REVOKE ALL ON FUNCTION private.require_pocketfi_checker(boolean),private.pocketfi_check_reference(text,jsonb),
  private.pocketfi_payment_check_row(text,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.staff_check_pocketfi_payments(text,text,integer),
  public.staff_flag_pocketfi_payment(uuid,text,text),public.admin_list_pocketfi_payment_reviews(text,integer),
  public.admin_resolve_pocketfi_payment_review(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.staff_check_pocketfi_payments(text,text,integer),
  public.staff_flag_pocketfi_payment(uuid,text,text),public.admin_list_pocketfi_payment_reviews(text,integer),
  public.admin_resolve_pocketfi_payment_review(uuid,text) TO authenticated;
