-- Gift-card launch remains gated. Every new wallet reservation must consume one
-- server-owned, invoice-backed quote. An uncertain provider create is never retried.
-- Pin the exact local 20261005034000 baseline before changing financial RPCs.
-- Hash pg_proc.prosrc, not pg_get_functiondef: the latter varies across PG versions.
DO $$
DECLARE v record; v_shape text;
BEGIN
 FOR v IN SELECT * FROM (VALUES
  ('private.customer_giftcard_capture_valid(private.customer_giftcard_dispatch)','a9189d7b4559aa685d2ddf76956fc9608bf52a2bfd3f6f6f83135ba781e858b1'),
  ('private.customer_giftcard_evidence_valid(private.customer_giftcard_dispatch,jsonb)','24618e4e723c4a226a56e3f65e2f779695cfa561dab17a76763ab6dbb5725f0b'),
  ('private.customer_giftcard_hold_valid(private.customer_giftcard_dispatch)','abba8bef4c52ff66427fe1ee2907ad95b5b556b82e54ca077071dc59d212fdf3'),
  ('private.customer_giftcard_proof_hash(private.customer_giftcard_dispatch,jsonb)','76b02cb3021066dc9bfcc1a5aeef05723f0328563a2275571f4aa1deb972b9f5'),
  ('private.customer_giftcard_quote_valid(jsonb,jsonb)','d8de378fac40d06aeaca2ea86918a1fe799eb791167d1b265241e114a0d93332'),
  ('private.customer_giftcard_request_valid(jsonb)','6940d4ea5815388ada4356399cd3e2066d12edfae4139a06e4765adbceb5e653'),
  ('private.customer_giftcard_text_valid(jsonb,integer)','e4d68ba594c946db6510a47352ddfe5444b04e94cba774af72fecf9ad800f968'),
  ('private.guard_customer_giftcard_binding()','b0fbf4c9cef262a283ebe89050d90c46c4abc2203f71fba310bbbbbd34408597'),
  ('private.lock_customer_giftcard_order(uuid,uuid)','f728d23f0e667d429a9fba426374d23bcc6ed004976f281d9abd05f34a426cfa'),
  ('public.authorize_customer_giftcard_purchase(uuid,text,jsonb,jsonb,numeric)','b1520e6e12bb8581cf1fecc5fe3a827aa6d9892e3588b2f495f6732eb031b7ff'),
  ('public.bind_customer_giftcard_invoice(uuid,uuid,text,jsonb,text)','e0a3be57fe1d31d501fcfeb0a5283cf6493447701f41d390f98f096d904b8cd7'),
  ('public.claim_customer_giftcard_dispatch(uuid,uuid)','854f5e9ef3a6bc58bfd7e42c18f420e8acf97d1148012096864980a9b1b4b7eb'),
  ('public.claim_customer_giftcard_payment(uuid,uuid,text)','2ef6cd6f317d478c0aa858345f0e2f1f6a009392d93ec36efb1ce73b8935a869'),
  ('public.get_customer_giftcard_order(uuid,uuid)','449d407d2b1e1cf97e12e63be0e714e05b93f6ba8a313aa546ae274ad0b5f6e1'),
  ('public.get_customer_giftcard_reconciliation(uuid,uuid)','b1ecd0a7174acfe2107c09302c8be3862b9015a43a779d7f2f24c66e0e5d8784'),
  ('public.get_customer_giftcard_replay(uuid,text,jsonb)','d812c61d3806a51ff755513d4b2bfb101dcf96a8bb54ee5969332a016fb1c410'),
  ('public.get_my_customer_giftcard_history()','f948b9874956d5d80428de075d4a9264e40ca489a7dfd8e0b9dfd7ccfc83bf5c'),
  ('public.get_my_customer_giftcard_order(uuid)','4e26fecdccd0cbdcf4ade6f552a16c09f7cd7aa587c98e58c51bd25458c684b8'),
  ('public.record_customer_giftcard_outcome(uuid,uuid,text,jsonb)','a16422614989c27aa99c604efe8d4b9ea1a0aa88c13403bfb3ef65119a839743')
 ) AS expected(signature,body_hash) LOOP
  IF (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')
   FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure(v.signature)) IS DISTINCT FROM v.body_hash THEN
   RAISE EXCEPTION 'customer_giftcard_baseline_function_drift: %',v.signature;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
   WHERE p.oid=pg_catalog.to_regprocedure(v.signature)
   AND p.proowner='postgres'::regrole AND p.proconfig=ARRAY['search_path=""']::text[]
   AND p.prosecdef=(v.signature LIKE 'public.%' OR v.signature IN (
    'private.customer_giftcard_hold_valid(private.customer_giftcard_dispatch)',
    'private.lock_customer_giftcard_order(uuid,uuid)',
    'private.customer_giftcard_capture_valid(private.customer_giftcard_dispatch)'))
   AND p.provolatile=CASE WHEN v.signature IN (
    'private.customer_giftcard_evidence_valid(private.customer_giftcard_dispatch,jsonb)',
    'private.customer_giftcard_proof_hash(private.customer_giftcard_dispatch,jsonb)',
    'private.customer_giftcard_quote_valid(jsonb,jsonb)',
    'private.customer_giftcard_request_valid(jsonb)',
    'private.customer_giftcard_text_valid(jsonb,integer)') THEN 'i' ELSE 'v' END
   AND NOT p.proleakproof AND NOT p.proisstrict AND p.proparallel='u' AND p.prokind='f') THEN
   RAISE EXCEPTION 'customer_giftcard_baseline_function_security_drift: %',v.signature;
  END IF;
 END LOOP;
 IF (SELECT relowner FROM pg_catalog.pg_class WHERE oid='private.customer_giftcard_dispatch'::regclass) IS DISTINCT FROM 'postgres'::regrole
 OR (SELECT relowner FROM pg_catalog.pg_class WHERE oid='public.customer_giftcard_orders'::regclass) IS DISTINCT FROM 'postgres'::regrole THEN
  RAISE EXCEPTION 'customer_giftcard_baseline_owner_drift'; END IF;
 SELECT pg_catalog.string_agg(a.attname||':'||pg_catalog.format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull,',' ORDER BY a.attnum)
 INTO v_shape FROM pg_catalog.pg_attribute a WHERE a.attrelid='private.customer_giftcard_dispatch'::regclass AND a.attnum>0 AND NOT a.attisdropped;
 IF v_shape IS DISTINCT FROM 'order_id:uuid:true,user_id:uuid:true,idempotency_key:text:true,request_payload:jsonb:true,request_hash:text:true,quote:jsonb:true,quote_hash:text:true,reservation_id:uuid:true,financial_security_version:integer:true,state:text:true,invoice_id:text:false,creation_claimed_at:timestamp with time zone:false,payment_claimed_at:timestamp with time zone:false,delivery_evidence:jsonb:false,evidence_proof_hash:text:false,capture_transaction_id:uuid:false,rejection_reason:text:false,settled_at:timestamp with time zone:false' THEN
  RAISE EXCEPTION 'customer_giftcard_dispatch_columns_drift'; END IF;
 SELECT pg_catalog.string_agg(a.attname||':'||pg_catalog.format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull,',' ORDER BY a.attnum)
 INTO v_shape FROM pg_catalog.pg_attribute a WHERE a.attrelid='public.customer_giftcard_orders'::regclass AND a.attnum>0 AND NOT a.attisdropped;
 IF v_shape IS DISTINCT FROM 'id:uuid:true,user_id:uuid:true,product_id:text:true,product_name:text:true,package_id:text:false,unit_value:numeric:true,currency:text:true,quantity:integer:true,amount_ngn:numeric(18,2):true,status:text:true,created_at:timestamp with time zone:true,completed_at:timestamp with time zone:false' THEN
  RAISE EXCEPTION 'customer_giftcard_orders_columns_drift'; END IF;
 SELECT pg_catalog.string_agg(con.conname||':'||con.contype::text,',' ORDER BY con.conname)
 INTO v_shape FROM pg_catalog.pg_constraint con WHERE con.conrelid='private.customer_giftcard_dispatch'::regclass AND con.contype<>'n';
 IF v_shape IS DISTINCT FROM 'customer_giftcard_dispatch_capture_transaction_id_fkey:f,customer_giftcard_dispatch_financial_security_version_check:c,customer_giftcard_dispatch_invoice_id_key:u,customer_giftcard_dispatch_order_id_fkey:f,customer_giftcard_dispatch_pkey:p,customer_giftcard_dispatch_quote_hash_check:c,customer_giftcard_dispatch_request_hash_check:c,customer_giftcard_dispatch_reservation_id_fkey:f,customer_giftcard_dispatch_reservation_id_key:u,customer_giftcard_dispatch_state_check:c,customer_giftcard_dispatch_user_id_fkey:f,customer_giftcard_dispatch_user_id_idempotency_key_key:u' THEN
  RAISE EXCEPTION 'customer_giftcard_dispatch_constraints_drift'; END IF;
 SELECT pg_catalog.string_agg(con.conname||':'||con.contype::text,',' ORDER BY con.conname)
 INTO v_shape FROM pg_catalog.pg_constraint con WHERE con.conrelid='public.customer_giftcard_orders'::regclass AND con.contype<>'n';
 IF v_shape IS DISTINCT FROM 'customer_giftcard_orders_amount_ngn_check:c,customer_giftcard_orders_pkey:p,customer_giftcard_orders_quantity_check:c,customer_giftcard_orders_status_check:c,customer_giftcard_orders_user_id_fkey:f' THEN
  RAISE EXCEPTION 'customer_giftcard_orders_constraints_drift'; END IF;
 IF (SELECT pg_catalog.pg_get_constraintdef(oid) FROM pg_catalog.pg_constraint
  WHERE conrelid='private.customer_giftcard_dispatch'::regclass AND conname='customer_giftcard_dispatch_user_id_idempotency_key_key')
  IS DISTINCT FROM 'UNIQUE (user_id, idempotency_key)'
 OR (SELECT pg_catalog.pg_get_constraintdef(oid) FROM pg_catalog.pg_constraint
  WHERE conrelid='private.customer_giftcard_dispatch'::regclass AND conname='customer_giftcard_dispatch_reservation_id_key')
  IS DISTINCT FROM 'UNIQUE (reservation_id)'
 OR (SELECT pg_catalog.pg_get_constraintdef(oid) FROM pg_catalog.pg_constraint
  WHERE conrelid='private.customer_giftcard_dispatch'::regclass AND conname='customer_giftcard_dispatch_invoice_id_key')
  IS DISTINCT FROM 'UNIQUE (invoice_id)'
 OR (SELECT pg_catalog.pg_get_constraintdef(oid) FROM pg_catalog.pg_constraint
  WHERE conrelid='private.customer_giftcard_dispatch'::regclass AND conname='customer_giftcard_dispatch_state_check')
  IS DISTINCT FROM $constraint$CHECK ((state = ANY (ARRAY['prepared'::text, 'creating'::text, 'bound'::text, 'paying'::text, 'unknown'::text, 'completed'::text, 'rejected'::text])))$constraint$
 OR (SELECT pg_catalog.pg_get_constraintdef(oid) FROM pg_catalog.pg_constraint
  WHERE conrelid='public.customer_giftcard_orders'::regclass AND conname='customer_giftcard_orders_status_check')
  IS DISTINCT FROM $constraint$CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text, 'review_required'::text])))$constraint$
 OR (SELECT pg_catalog.pg_get_constraintdef(oid) FROM pg_catalog.pg_constraint
  WHERE conrelid='public.customer_giftcard_orders'::regclass AND conname='customer_giftcard_orders_quantity_check')
  IS DISTINCT FROM 'CHECK (((quantity >= 1) AND (quantity <= 20)))'
 OR (SELECT pg_catalog.pg_get_constraintdef(oid) FROM pg_catalog.pg_constraint
  WHERE conrelid='public.customer_giftcard_orders'::regclass AND conname='customer_giftcard_orders_amount_ngn_check')
  IS DISTINCT FROM 'CHECK ((amount_ngn > (0)::numeric))'
 OR (SELECT pg_catalog.pg_get_constraintdef(oid) FROM pg_catalog.pg_constraint
  WHERE conrelid='private.customer_giftcard_dispatch'::regclass AND conname='customer_giftcard_dispatch_financial_security_version_check')
  IS DISTINCT FROM 'CHECK ((financial_security_version > 0))'
 OR (SELECT pg_catalog.pg_get_constraintdef(oid) FROM pg_catalog.pg_constraint
  WHERE conrelid='private.customer_giftcard_dispatch'::regclass AND conname='customer_giftcard_dispatch_request_hash_check')
  IS DISTINCT FROM $constraint$CHECK ((request_hash ~ '^[a-f0-9]{64}$'::text))$constraint$
 OR (SELECT pg_catalog.pg_get_constraintdef(oid) FROM pg_catalog.pg_constraint
  WHERE conrelid='private.customer_giftcard_dispatch'::regclass AND conname='customer_giftcard_dispatch_quote_hash_check')
  IS DISTINCT FROM $constraint$CHECK ((quote_hash ~ '^[a-f0-9]{64}$'::text))$constraint$ THEN
  RAISE EXCEPTION 'customer_giftcard_baseline_constraint_definition_drift'; END IF;
 FOR v IN SELECT * FROM (VALUES
  ('private.customer_giftcard_dispatch','customer_giftcard_dispatch_capture_transaction_id_fkey','FOREIGN KEY (capture_transaction_id) REFERENCES transactions(id) ON DELETE RESTRICT'),
  ('private.customer_giftcard_dispatch','customer_giftcard_dispatch_order_id_fkey','FOREIGN KEY (order_id) REFERENCES customer_giftcard_orders(id) ON DELETE RESTRICT'),
  ('private.customer_giftcard_dispatch','customer_giftcard_dispatch_pkey','PRIMARY KEY (order_id)'),
  ('private.customer_giftcard_dispatch','customer_giftcard_dispatch_reservation_id_fkey','FOREIGN KEY (reservation_id) REFERENCES wallet_reservations(id) ON DELETE RESTRICT'),
  ('private.customer_giftcard_dispatch','customer_giftcard_dispatch_user_id_fkey','FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE RESTRICT'),
  ('public.customer_giftcard_orders','customer_giftcard_orders_pkey','PRIMARY KEY (id)'),
  ('public.customer_giftcard_orders','customer_giftcard_orders_user_id_fkey','FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE RESTRICT')
 ) AS expected(relation_name,constraint_name,definition) LOOP
  IF (SELECT pg_catalog.pg_get_constraintdef(c.oid) FROM pg_catalog.pg_constraint c
   WHERE c.conrelid=v.relation_name::regclass AND c.conname=v.constraint_name) IS DISTINCT FROM v.definition THEN
   RAISE EXCEPTION 'customer_giftcard_baseline_constraint_definition_drift: %',v.constraint_name;
  END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_catalog.pg_trigger WHERE tgrelid='private.customer_giftcard_dispatch'::regclass AND NOT tgisinternal)<>2
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='private.customer_giftcard_dispatch'::regclass
  AND tgname='customer_giftcard_binding_immutable' AND tgenabled='O' AND tgtype=27
  AND tgfoid='private.guard_customer_giftcard_binding()'::regprocedure)
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='private.customer_giftcard_dispatch'::regclass
  AND tgname='customer_giftcard_binding_no_truncate' AND tgenabled='O' AND tgtype=34
  AND tgfoid='private.guard_customer_giftcard_binding()'::regprocedure) THEN
  RAISE EXCEPTION 'customer_giftcard_dispatch_trigger_drift'; END IF;
 IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='private.customer_giftcard_dispatch'::regclass)
 OR NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='public.customer_giftcard_orders'::regclass)
 OR has_table_privilege('anon','private.customer_giftcard_dispatch','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
 OR has_table_privilege('authenticated','private.customer_giftcard_dispatch','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
 OR has_table_privilege('service_role','private.customer_giftcard_dispatch','INSERT,UPDATE,DELETE,TRUNCATE')
 OR NOT has_table_privilege('service_role','private.customer_giftcard_dispatch','SELECT')
 OR has_table_privilege('anon','public.customer_giftcard_orders','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
 OR has_table_privilege('authenticated','public.customer_giftcard_orders','INSERT,UPDATE,DELETE,TRUNCATE')
 OR NOT has_table_privilege('authenticated','public.customer_giftcard_orders','SELECT')
 OR NOT has_table_privilege('service_role','public.customer_giftcard_orders','SELECT')
 OR has_table_privilege('service_role','public.customer_giftcard_orders','INSERT,UPDATE,DELETE,TRUNCATE')
 OR NOT has_function_privilege('service_role','public.authorize_customer_giftcard_purchase(uuid,text,jsonb,jsonb,numeric)','EXECUTE')
 OR has_function_privilege('authenticated','public.authorize_customer_giftcard_purchase(uuid,text,jsonb,jsonb,numeric)','EXECUTE')
 OR has_function_privilege('anon','public.authorize_customer_giftcard_purchase(uuid,text,jsonb,jsonb,numeric)','EXECUTE') THEN
  RAISE EXCEPTION 'customer_giftcard_baseline_acl_drift'; END IF;
 FOR v IN SELECT unnest(ARRAY[
  'public.get_customer_giftcard_replay(uuid,text,jsonb)',
  'public.authorize_customer_giftcard_purchase(uuid,text,jsonb,jsonb,numeric)',
  'public.claim_customer_giftcard_dispatch(uuid,uuid)',
  'public.bind_customer_giftcard_invoice(uuid,uuid,text,jsonb,text)',
  'public.claim_customer_giftcard_payment(uuid,uuid,text)',
  'public.record_customer_giftcard_outcome(uuid,uuid,text,jsonb)',
  'public.get_customer_giftcard_order(uuid,uuid)',
  'public.get_customer_giftcard_reconciliation(uuid,uuid)']) AS signature LOOP
  IF NOT has_function_privilege('service_role',v.signature,'EXECUTE')
  OR has_function_privilege('anon',v.signature,'EXECUTE')
  OR has_function_privilege('authenticated',v.signature,'EXECUTE') THEN
   RAISE EXCEPTION 'customer_giftcard_baseline_rpc_acl_drift: %',v.signature; END IF;
 END LOOP;
 FOR v IN SELECT unnest(ARRAY[
  'public.get_my_customer_giftcard_order(uuid)',
  'public.get_my_customer_giftcard_history()']) AS signature LOOP
  IF NOT has_function_privilege('authenticated',v.signature,'EXECUTE')
  OR has_function_privilege('anon',v.signature,'EXECUTE')
  OR has_function_privilege('service_role',v.signature,'EXECUTE') THEN
   RAISE EXCEPTION 'customer_giftcard_baseline_own_rpc_acl_drift: %',v.signature; END IF;
 END LOOP;
 FOR v IN SELECT unnest(ARRAY[
  'private.guard_customer_giftcard_binding()',
  'private.customer_giftcard_text_valid(jsonb,integer)',
  'private.customer_giftcard_request_valid(jsonb)',
  'private.customer_giftcard_quote_valid(jsonb,jsonb)',
  'private.customer_giftcard_hold_valid(private.customer_giftcard_dispatch)',
  'private.lock_customer_giftcard_order(uuid,uuid)',
  'private.customer_giftcard_evidence_valid(private.customer_giftcard_dispatch,jsonb)',
  'private.customer_giftcard_proof_hash(private.customer_giftcard_dispatch,jsonb)',
  'private.customer_giftcard_capture_valid(private.customer_giftcard_dispatch)']) AS signature LOOP
  IF has_function_privilege('anon',v.signature,'EXECUTE')
  OR has_function_privilege('authenticated',v.signature,'EXECUTE')
  OR has_function_privilege('service_role',v.signature,'EXECUTE') THEN
   RAISE EXCEPTION 'customer_giftcard_baseline_private_acl_drift: %',v.signature; END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_catalog.pg_policy WHERE polrelid='public.customer_giftcard_orders'::regclass)<>1
 OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid='public.customer_giftcard_orders'::regclass
  AND polname='customer_giftcard_own_read' AND polcmd='r'
  AND pg_catalog.pg_get_expr(polqual,polrelid) LIKE '%auth.uid()%') THEN
  RAISE EXCEPTION 'customer_giftcard_baseline_policy_drift'; END IF;
END $$;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM public.customer_giftcard_orders)
 OR EXISTS (SELECT 1 FROM private.customer_giftcard_dispatch) THEN
  RAISE EXCEPTION 'customer_giftcard_invoice_quote_migration_requires_review_of_existing_orders';
 END IF;
END $$;

CREATE TABLE private.customer_giftcard_invoice_quotes (
 quote_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 intent_key text NOT NULL CHECK (intent_key ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{9,119}$'),
 selection jsonb NOT NULL,
 request_payload jsonb,
 quote jsonb,
 invoice_id text UNIQUE,
 child_order_ids jsonb,
 child_order_ids_hash text CHECK (child_order_ids_hash ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz,
 status text NOT NULL DEFAULT 'creating' CHECK (status IN ('creating','finalized','consumed')),
 order_id uuid UNIQUE REFERENCES public.customer_giftcard_orders(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 finalized_at timestamptz,
 consumed_at timestamptz,
 UNIQUE (user_id,intent_key),
 CHECK ((status='creating' AND request_payload IS NULL AND quote IS NULL AND invoice_id IS NULL
  AND child_order_ids IS NULL AND child_order_ids_hash IS NULL AND expires_at IS NULL AND order_id IS NULL
  AND finalized_at IS NULL AND consumed_at IS NULL)
  OR (status='finalized' AND request_payload IS NOT NULL AND quote IS NOT NULL AND invoice_id IS NOT NULL
  AND child_order_ids IS NOT NULL AND child_order_ids_hash IS NOT NULL AND expires_at IS NOT NULL
  AND order_id IS NULL AND finalized_at IS NOT NULL AND consumed_at IS NULL)
  OR (status='consumed' AND request_payload IS NOT NULL AND quote IS NOT NULL AND invoice_id IS NOT NULL
  AND child_order_ids IS NOT NULL AND child_order_ids_hash IS NOT NULL AND expires_at IS NOT NULL
  AND order_id IS NOT NULL AND finalized_at IS NOT NULL AND consumed_at IS NOT NULL))
);
ALTER TABLE private.customer_giftcard_invoice_quotes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.customer_giftcard_invoice_quotes FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE private.customer_giftcard_dispatch ADD COLUMN quote_id uuid UNIQUE REFERENCES private.customer_giftcard_invoice_quotes(quote_id) ON DELETE RESTRICT;
ALTER TABLE private.customer_giftcard_dispatch ALTER COLUMN quote_id SET NOT NULL;

CREATE FUNCTION private.customer_giftcard_selection_valid(v jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF v IS NULL OR jsonb_typeof(v)<>'object' OR octet_length(v::text)>1024
 OR (SELECT count(*) FROM jsonb_object_keys(v))<>4
 OR EXISTS (SELECT 1 FROM jsonb_object_keys(v) k WHERE k NOT IN ('product_id','package_id','unit_value','quantity'))
 OR private.customer_giftcard_text_valid(v->'product_id',180) IS DISTINCT FROM true
 OR v->>'product_id' !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$'
 OR jsonb_typeof(v->'package_id') NOT IN ('null','string')
 OR (jsonb_typeof(v->'package_id')='string' AND (
 private.customer_giftcard_text_valid(v->'package_id',180) IS DISTINCT FROM true
 OR v->>'package_id' !~ '^[ -~]+$' OR strpos(v->>'package_id','"')>0
 OR strpos(v->>'package_id',chr(39))>0 OR strpos(v->>'package_id',chr(92))>0))
 OR jsonb_typeof(v->'unit_value') IS DISTINCT FROM 'number'
 OR jsonb_typeof(v->'quantity') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
 RETURN (v->>'unit_value')::numeric>0 AND (v->>'unit_value')::numeric<=1000000000
 AND (v->>'unit_value')::numeric=round((v->>'unit_value')::numeric,2)
 AND (v->>'quantity')::numeric BETWEEN 1 AND 20
 AND (v->>'quantity')::numeric=trunc((v->>'quantity')::numeric);
END;
$$;

-- The original five-argument authorization and three-argument replay cannot
-- prove an invoice-backed quote. Revoke them permanently before adding overloads.
CREATE OR REPLACE FUNCTION public.authorize_customer_giftcard_purchase(p_user_id uuid,p_idempotency_key text,p_request jsonb,p_quote jsonb,p_expected_amount_ngn numeric)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('success',false,'code','INVOICE_QUOTE_REQUIRED');
$$;
CREATE OR REPLACE FUNCTION public.get_customer_giftcard_replay(p_user_id uuid,p_idempotency_key text,p_request jsonb)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('success',false,'code','INVOICE_QUOTE_REQUIRED');
$$;

CREATE OR REPLACE FUNCTION private.customer_giftcard_quote_valid(q jsonb,r jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF private.customer_giftcard_request_valid(r) IS DISTINCT FROM true OR q IS NULL
 OR jsonb_typeof(q)<>'object' OR octet_length(q::text)>4096 THEN RETURN false; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(q))<>9 OR EXISTS(SELECT 1 FROM jsonb_object_keys(q) k WHERE k NOT IN
 ('product_id','product_name','package_id','unit_value','currency','quantity','amount_ngn','provider_price','billing_currency')) THEN RETURN false; END IF;
 IF q->'product_id' IS DISTINCT FROM r->'product_id' OR q->'package_id' IS DISTINCT FROM r->'package_id'
 OR q->'unit_value' IS DISTINCT FROM r->'unit_value' OR q->'quantity' IS DISTINCT FROM r->'quantity'
 OR q->'amount_ngn' IS DISTINCT FROM r->'expected_amount_ngn'
 OR private.customer_giftcard_text_valid(q->'product_name',120) IS DISTINCT FROM true
 OR jsonb_typeof(q->'currency') IS DISTINCT FROM 'string' OR q->>'currency' !~ '^[A-Z]{3}$'
 OR jsonb_typeof(q->'billing_currency') IS DISTINCT FROM 'string' OR q->>'billing_currency' NOT IN ('USD','EUR','NGN','BTC')
 OR jsonb_typeof(q->'provider_price') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
 RETURN (q->>'provider_price')::numeric>0 AND (q->>'provider_price')::numeric<=1000000000
 AND (q->>'billing_currency'<>'BTC' OR (q->>'provider_price')::numeric=trunc((q->>'provider_price')::numeric));
END;
$$;

CREATE FUNCTION private.customer_giftcard_child_ids_valid(v jsonb,n integer) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF v IS NULL OR jsonb_typeof(v)<>'array' OR jsonb_array_length(v)<>n
 OR octet_length(v::text)>4096 THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(v) e WHERE jsonb_typeof(e)<>'string'
 OR e#>>'{}' !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$') THEN RETURN false; END IF;
 RETURN (SELECT count(DISTINCT e#>>'{}') FROM jsonb_array_elements(v) e)=n;
END;
$$;

CREATE OR REPLACE FUNCTION private.customer_giftcard_hold_valid(j private.customer_giftcard_dispatch)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT private.customer_giftcard_quote_valid(j.quote,j.request_payload)
 AND j.request_hash=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(j.request_payload::text,'UTF8')),'hex')
 AND j.quote_hash=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(j.quote::text,'UTF8')),'hex')
 AND EXISTS(SELECT 1 FROM private.customer_giftcard_invoice_quotes q
  WHERE q.quote_id=j.quote_id AND q.user_id=j.user_id AND q.status='consumed' AND q.order_id=j.order_id
  AND q.request_payload=j.request_payload AND q.quote=j.quote
  AND q.invoice_id IS NOT NULL AND q.invoice_id=coalesce(j.invoice_id,q.invoice_id)
  AND q.child_order_ids_hash=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(q.child_order_ids::text,'UTF8')),'hex')
  AND private.customer_giftcard_child_ids_valid(q.child_order_ids,(j.quote->>'quantity')::integer))
 AND EXISTS(SELECT 1 FROM public.wallet_reservations r WHERE r.id=j.reservation_id AND r.user_id=j.user_id
 AND r.order_table='customer_giftcard_orders' AND r.order_id=j.order_id AND r.currency='NGN'
 AND r.amount=(j.quote->>'amount_ngn')::numeric AND r.financial_security_version=j.financial_security_version
 AND r.metadata->>'giftcard_quote_hash'=j.quote_hash AND r.metadata->>'giftcard_request_hash'=j.request_hash
 AND r.metadata->>'giftcard_invoice_quote_id'=j.quote_id::text AND r.expires_at IS NULL)
 AND EXISTS(SELECT 1 FROM public.customer_giftcard_orders o WHERE o.id=j.order_id AND o.user_id=j.user_id
 AND to_jsonb(o.product_id)=j.quote->'product_id' AND to_jsonb(o.product_name)=j.quote->'product_name'
 AND coalesce(to_jsonb(o.package_id),'null'::jsonb)=j.quote->'package_id' AND to_jsonb(o.unit_value)=j.quote->'unit_value'
 AND to_jsonb(o.currency)=j.quote->'currency' AND to_jsonb(o.quantity)=j.quote->'quantity' AND to_jsonb(o.amount_ngn)=j.quote->'amount_ngn');
$$;

CREATE FUNCTION public.get_customer_giftcard_replay(p_user_id uuid,p_idempotency_key text,p_request jsonb,p_quote_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j private.customer_giftcard_dispatch;
BEGIN
 IF p_quote_id IS NULL OR p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{9,119}$'
 OR private.customer_giftcard_request_valid(p_request) IS DISTINCT FROM true THEN
  RETURN jsonb_build_object('success',false,'code','INVALID_REQUEST'); END IF;
 SELECT * INTO j FROM private.customer_giftcard_dispatch WHERE user_id=p_user_id AND idempotency_key=p_idempotency_key;
 IF NOT FOUND THEN RETURN jsonb_build_object('success',true,'existing',false); END IF;
 IF j.request_payload IS DISTINCT FROM p_request OR j.quote_id IS DISTINCT FROM p_quote_id THEN
  RETURN jsonb_build_object('success',false,'code','IDEMPOTENCY_REQUEST_CONFLICT'); END IF;
 IF private.customer_giftcard_hold_valid(j) IS DISTINCT FROM true THEN
  RETURN jsonb_build_object('success',false,'code','BINDING_REQUIRES_REVIEW'); END IF;
 RETURN jsonb_build_object('success',true,'existing',true,'order_id',j.order_id,'state',j.state,'idempotent_replay',true);
END;
$$;

CREATE FUNCTION public.authorize_customer_giftcard_purchase(p_user_id uuid,p_idempotency_key text,p_request jsonb,p_quote jsonb,
 p_expected_amount_ngn numeric,p_quote_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles%ROWTYPE; j private.customer_giftcard_dispatch;
 q private.customer_giftcard_invoice_quotes%ROWTYPE; r jsonb; oid uuid; qhash text; rhash text;
BEGIN
 IF p_quote_id IS NULL OR p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{9,119}$'
 OR private.customer_giftcard_request_valid(p_request) IS DISTINCT FROM true OR p_expected_amount_ngn IS NULL
 OR to_jsonb(p_expected_amount_ngn) IS DISTINCT FROM p_request->'expected_amount_ngn' THEN
  RETURN jsonb_build_object('success',false,'code','INVALID_REQUEST'); END IF;
 SELECT * INTO p FROM public.profiles WHERE id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','PROFILE_NOT_FOUND'); END IF;
 IF p.is_admin IS TRUE OR p.is_staff IS TRUE THEN RETURN jsonb_build_object('success',false,'code','CUSTOMER_ONLY'); END IF;
 IF p.account_suspended IS TRUE THEN RETURN jsonb_build_object('success',false,'code','WALLET_NOT_ACTIVE'); END IF;
 SELECT * INTO j FROM private.customer_giftcard_dispatch
 WHERE user_id=p_user_id AND idempotency_key=p_idempotency_key FOR UPDATE;
 IF FOUND THEN
  IF j.request_payload IS DISTINCT FROM p_request OR j.quote_id IS DISTINCT FROM p_quote_id THEN
   RETURN jsonb_build_object('success',false,'code','IDEMPOTENCY_REQUEST_CONFLICT'); END IF;
  IF private.customer_giftcard_hold_valid(j) IS DISTINCT FROM true THEN
   RETURN jsonb_build_object('success',false,'code','BINDING_REQUIRES_REVIEW'); END IF;
  RETURN jsonb_build_object('success',true,'order_id',j.order_id,'reservation_id',j.reservation_id,
   'state',j.state,'idempotent_replay',true);
 END IF;
 SELECT * INTO q FROM private.customer_giftcard_invoice_quotes
 WHERE quote_id=p_quote_id AND user_id=p_user_id FOR UPDATE;
 IF NOT FOUND OR q.status<>'finalized' OR q.expires_at<=clock_timestamp() THEN
  RETURN jsonb_build_object('success',false,'code','INVOICE_QUOTE_NOT_AVAILABLE'); END IF;
 IF p_request IS DISTINCT FROM q.request_payload OR p_quote IS DISTINCT FROM q.quote
 OR private.customer_giftcard_quote_valid(q.quote,q.request_payload) IS DISTINCT FROM true
 OR q.child_order_ids_hash IS DISTINCT FROM pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(q.child_order_ids::text,'UTF8')),'hex')
 OR private.customer_giftcard_child_ids_valid(q.child_order_ids,(q.request_payload->>'quantity')::integer) IS DISTINCT FROM true THEN
  RETURN jsonb_build_object('success',false,'code','INVOICE_QUOTE_MISMATCH'); END IF;
 oid:=gen_random_uuid();
 qhash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(q.quote::text,'UTF8')),'hex');
 rhash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(q.request_payload::text,'UTF8')),'hex');
 r:=public.create_wallet_reservation(p_user_id,p_expected_amount_ngn,'customer_giftcard_orders',oid,
 'giftcard:hold:'||p_user_id::text||':'||p_idempotency_key,
 jsonb_build_object('giftcard_quote_hash',qhash,'giftcard_request_hash',rhash,'giftcard_invoice_quote_id',p_quote_id),
 'NGN',p.financial_security_version,NULL);
 IF r->>'success' IS DISTINCT FROM 'true' THEN
  RETURN jsonb_build_object('success',false,'code',coalesce(r->>'code','WALLET_AUTHORIZATION_FAILED')); END IF;
 INSERT INTO public.customer_giftcard_orders(id,user_id,product_id,product_name,package_id,unit_value,currency,quantity,amount_ngn,status)
 VALUES(oid,p_user_id,q.quote->>'product_id',q.quote->>'product_name',q.quote->>'package_id',
  (q.quote->>'unit_value')::numeric,q.quote->>'currency',(q.quote->>'quantity')::integer,p_expected_amount_ngn,'pending');
 UPDATE private.customer_giftcard_invoice_quotes SET status='consumed',order_id=oid,consumed_at=clock_timestamp()
 WHERE quote_id=p_quote_id;
 INSERT INTO private.customer_giftcard_dispatch(order_id,user_id,idempotency_key,request_payload,request_hash,quote,
  quote_hash,reservation_id,financial_security_version,state,quote_id)
 VALUES(oid,p_user_id,p_idempotency_key,p_request,rhash,p_quote,qhash,(r->>'reservation_id')::uuid,
  p.financial_security_version,'prepared',p_quote_id);
 RETURN jsonb_build_object('success',true,'order_id',oid,'reservation_id',(r->>'reservation_id')::uuid,
  'state','prepared','idempotent_replay',false);
END;
$$;

CREATE FUNCTION private.guard_customer_giftcard_invoice_quote() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'customer_giftcard_invoice_quote_immutable'; END IF;
 IF NEW.quote_id IS DISTINCT FROM OLD.quote_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
 OR NEW.intent_key IS DISTINCT FROM OLD.intent_key OR NEW.selection IS DISTINCT FROM OLD.selection
 OR NEW.created_at IS DISTINCT FROM OLD.created_at OR
 (OLD.status='creating' AND NEW.status NOT IN ('creating','finalized')) OR
 (OLD.status='finalized' AND NEW.status NOT IN ('finalized','consumed')) OR
 (OLD.status='consumed' AND NEW IS DISTINCT FROM OLD) OR
 (OLD.status<>'creating' AND (NEW.request_payload IS DISTINCT FROM OLD.request_payload
 OR NEW.quote IS DISTINCT FROM OLD.quote OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
 OR NEW.child_order_ids IS DISTINCT FROM OLD.child_order_ids
 OR NEW.child_order_ids_hash IS DISTINCT FROM OLD.child_order_ids_hash
 OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.finalized_at IS DISTINCT FROM OLD.finalized_at)) OR
 (OLD.status='finalized' AND NEW.status='consumed' AND
 (NEW.order_id IS NULL OR NEW.consumed_at IS NULL)) THEN
  RAISE EXCEPTION 'customer_giftcard_invoice_quote_immutable';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER customer_giftcard_invoice_quote_immutable BEFORE UPDATE OR DELETE
 ON private.customer_giftcard_invoice_quotes FOR EACH ROW EXECUTE FUNCTION private.guard_customer_giftcard_invoice_quote();
ALTER TABLE private.customer_giftcard_invoice_quotes ENABLE ALWAYS TRIGGER customer_giftcard_invoice_quote_immutable;
CREATE FUNCTION private.guard_customer_giftcard_quote_id() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.quote_id IS DISTINCT FROM OLD.quote_id THEN RAISE EXCEPTION 'customer_giftcard_quote_id_immutable'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER customer_giftcard_quote_id_immutable BEFORE UPDATE
 ON private.customer_giftcard_dispatch FOR EACH ROW EXECUTE FUNCTION private.guard_customer_giftcard_quote_id();

CREATE FUNCTION public.begin_customer_giftcard_quote(p_user_id uuid,p_intent_key text,p_selection jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles%ROWTYPE; q private.customer_giftcard_invoice_quotes%ROWTYPE;
BEGIN
 IF p_intent_key IS NULL OR p_intent_key !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{9,119}$'
 OR private.customer_giftcard_selection_valid(p_selection) IS DISTINCT FROM true THEN
  RETURN jsonb_build_object('success',false,'code','INVALID_REQUEST'); END IF;
 SELECT * INTO p FROM public.profiles WHERE id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','PROFILE_NOT_FOUND'); END IF;
 IF p.is_admin IS TRUE OR p.is_staff IS TRUE THEN RETURN jsonb_build_object('success',false,'code','CUSTOMER_ONLY'); END IF;
 IF p.account_suspended IS TRUE THEN RETURN jsonb_build_object('success',false,'code','WALLET_NOT_ACTIVE'); END IF;
 SELECT * INTO q FROM private.customer_giftcard_invoice_quotes
 WHERE user_id=p_user_id AND intent_key=p_intent_key FOR UPDATE;
 IF FOUND THEN
  IF q.selection IS DISTINCT FROM p_selection THEN RETURN jsonb_build_object('success',false,'code','QUOTE_INTENT_CONFLICT'); END IF;
  IF q.status='finalized' AND q.expires_at>clock_timestamp() THEN
   RETURN jsonb_build_object('success',true,'quote_id',q.quote_id,'create_allowed',false,
    'finalized',true,'quote',q.quote,'expires_at',q.expires_at);
  END IF;
  RETURN jsonb_build_object('success',false,'code',CASE WHEN q.status='creating' THEN 'QUOTE_OUTCOME_UNKNOWN' ELSE 'QUOTE_NOT_AVAILABLE' END,'create_allowed',false);
 END IF;
 -- The profile row lock serializes all intents for this user. A lost provider
 -- create acknowledgement stays unresolved; no second unpaid invoice is sent.
 IF EXISTS(SELECT 1 FROM private.customer_giftcard_invoice_quotes
  WHERE user_id=p_user_id AND status='creating' AND created_at>clock_timestamp()-interval '10 minutes') THEN
  RETURN jsonb_build_object('success',false,'code','QUOTE_OUTCOME_UNKNOWN','create_allowed',false);
 END IF;
 IF (SELECT count(*) FROM private.customer_giftcard_invoice_quotes
  WHERE user_id=p_user_id AND created_at>clock_timestamp()-interval '1 hour')>=6 THEN
  RETURN jsonb_build_object('success',false,'code','QUOTE_RATE_LIMITED','create_allowed',false);
 END IF;
 INSERT INTO private.customer_giftcard_invoice_quotes(user_id,intent_key,selection)
 VALUES(p_user_id,p_intent_key,p_selection) RETURNING * INTO q;
 RETURN jsonb_build_object('success',true,'quote_id',q.quote_id,'create_allowed',true,'finalized',false);
END;
$$;

CREATE FUNCTION public.get_customer_giftcard_invoice_quote(p_user_id uuid,p_quote_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q private.customer_giftcard_invoice_quotes%ROWTYPE;
BEGIN
 SELECT * INTO q FROM private.customer_giftcard_invoice_quotes
 WHERE quote_id=p_quote_id AND user_id=p_user_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','QUOTE_NOT_FOUND'); END IF;
 IF q.status='creating' THEN RETURN jsonb_build_object('success',false,'code','QUOTE_OUTCOME_UNKNOWN'); END IF;
 IF q.status='finalized' AND q.expires_at<=clock_timestamp() THEN
  RETURN jsonb_build_object('success',false,'code','QUOTE_EXPIRED'); END IF;
 IF private.customer_giftcard_quote_valid(q.quote,q.request_payload) IS DISTINCT FROM true
 OR private.customer_giftcard_child_ids_valid(q.child_order_ids,(q.request_payload->>'quantity')::integer) IS DISTINCT FROM true
 OR q.child_order_ids_hash IS DISTINCT FROM pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(q.child_order_ids::text,'UTF8')),'hex') THEN
  RETURN jsonb_build_object('success',false,'code','QUOTE_REQUIRES_REVIEW'); END IF;
 RETURN jsonb_build_object('success',true,'quote_id',q.quote_id,'quote',q.quote,'request',q.request_payload,
  'invoice_id',q.invoice_id,'child_order_ids',q.child_order_ids,'expires_at',q.expires_at,'status',q.status);
END;
$$;

CREATE FUNCTION public.finalize_customer_giftcard_quote(p_user_id uuid,p_quote_id uuid,p_request jsonb,p_quote jsonb,
 p_invoice_id text,p_child_order_ids jsonb,p_expires_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q private.customer_giftcard_invoice_quotes%ROWTYPE; v_now timestamptz:=clock_timestamp();
BEGIN
 PERFORM 1 FROM public.profiles WHERE id=p_user_id FOR UPDATE;
 SELECT * INTO q FROM private.customer_giftcard_invoice_quotes
 WHERE quote_id=p_quote_id AND user_id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','QUOTE_NOT_FOUND'); END IF;
 IF q.status<>'creating' THEN RETURN jsonb_build_object('success',false,'code','QUOTE_ALREADY_FINALIZED'); END IF;
 IF q.created_at+interval '10 minutes'<=v_now OR p_expires_at IS NULL OR p_expires_at<=v_now
 OR p_expires_at>q.created_at+interval '10 minutes'
 OR private.customer_giftcard_quote_valid(p_quote,p_request) IS DISTINCT FROM true
 OR jsonb_build_object('product_id',p_request->'product_id','package_id',p_request->'package_id',
  'unit_value',p_request->'unit_value','quantity',p_request->'quantity') IS DISTINCT FROM q.selection
 OR p_invoice_id IS NULL OR p_invoice_id !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
 OR private.customer_giftcard_child_ids_valid(p_child_order_ids,(p_request->>'quantity')::integer) IS DISTINCT FROM true
 THEN RETURN jsonb_build_object('success',false,'code','INVALID_INVOICE_QUOTE'); END IF;
 UPDATE private.customer_giftcard_invoice_quotes SET request_payload=p_request,quote=p_quote,
 invoice_id=p_invoice_id,child_order_ids=p_child_order_ids,
 child_order_ids_hash=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_child_order_ids::text,'UTF8')),'hex'),
 expires_at=p_expires_at,finalized_at=v_now,status='finalized' WHERE quote_id=p_quote_id;
 RETURN jsonb_build_object('success',true,'quote_id',p_quote_id,'expires_at',p_expires_at);
END;
$$;

-- Binding may only attach the invoice already verified and stored in the
-- consumed quote. No new provider invoice is created after wallet reservation.
CREATE OR REPLACE FUNCTION public.bind_customer_giftcard_invoice(p_user_id uuid,p_order_id uuid,p_invoice_id text,p_quote jsonb,p_provider_status text DEFAULT 'unpaid')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j private.customer_giftcard_dispatch; q private.customer_giftcard_invoice_quotes%ROWTYPE;
BEGIN
 j:=private.lock_customer_giftcard_order(p_user_id,p_order_id);
 IF j.order_id IS NULL THEN RETURN jsonb_build_object('success',false,'code','ORDER_NOT_FOUND'); END IF;
 SELECT * INTO q FROM private.customer_giftcard_invoice_quotes WHERE quote_id=j.quote_id AND user_id=p_user_id;
 IF p_invoice_id IS NULL OR p_invoice_id !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
 OR p_provider_status IS DISTINCT FROM 'unpaid' OR p_quote IS DISTINCT FROM j.quote
 OR q.invoice_id IS DISTINCT FROM p_invoice_id OR q.order_id IS DISTINCT FROM p_order_id
 OR q.status<>'consumed' OR private.customer_giftcard_hold_valid(j) IS DISTINCT FROM true THEN
  RETURN jsonb_build_object('success',false,'code','INVOICE_BINDING_MISMATCH'); END IF;
 IF j.invoice_id IS NOT NULL THEN
  IF j.invoice_id IS DISTINCT FROM p_invoice_id THEN RETURN jsonb_build_object('success',false,'code','INVOICE_BINDING_CONFLICT'); END IF;
  RETURN jsonb_build_object('success',true,'bound',true,'idempotent_replay',true,'state',j.state);
 END IF;
 IF j.state<>'creating' OR j.creation_claimed_at IS NULL
 OR NOT EXISTS(SELECT 1 FROM public.wallet_reservations WHERE id=j.reservation_id AND status='active') THEN
  RETURN jsonb_build_object('success',false,'code','DISPATCH_NOT_ELIGIBLE'); END IF;
 UPDATE private.customer_giftcard_dispatch SET invoice_id=p_invoice_id,state='bound' WHERE order_id=p_order_id;
 RETURN jsonb_build_object('success',true,'bound',true,'idempotent_replay',false,'state','bound');
END;
$$;

REVOKE ALL ON FUNCTION private.customer_giftcard_selection_valid(jsonb),
 private.customer_giftcard_child_ids_valid(jsonb,integer),private.guard_customer_giftcard_invoice_quote(),
 private.guard_customer_giftcard_quote_id() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.get_customer_giftcard_replay(uuid,text,jsonb),
 public.authorize_customer_giftcard_purchase(uuid,text,jsonb,jsonb,numeric)
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.begin_customer_giftcard_quote(uuid,text,jsonb),
 public.finalize_customer_giftcard_quote(uuid,uuid,jsonb,jsonb,text,jsonb,timestamptz),
 public.get_customer_giftcard_invoice_quote(uuid,uuid),
 public.get_customer_giftcard_replay(uuid,text,jsonb,uuid),
 public.authorize_customer_giftcard_purchase(uuid,text,jsonb,jsonb,numeric,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.begin_customer_giftcard_quote(uuid,text,jsonb),
 public.finalize_customer_giftcard_quote(uuid,uuid,jsonb,jsonb,text,jsonb,timestamptz),
 public.get_customer_giftcard_invoice_quote(uuid,uuid),
 public.get_customer_giftcard_replay(uuid,text,jsonb,uuid),
 public.authorize_customer_giftcard_purchase(uuid,text,jsonb,jsonb,numeric,uuid) TO service_role;
