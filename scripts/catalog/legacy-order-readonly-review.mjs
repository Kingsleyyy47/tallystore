import { readFileSync,writeFileSync } from 'node:fs'
const line=readFileSync('.env','utf8').split(/\r?\n/).find(line=>line.startsWith('SUPABASE_ACCESS_TOKEN='))
const token=line.slice(line.indexOf('=')+1).trim().replace(/^["']|["']$/g,'')
const reviewEmail=process.env.TALLY_REVIEW_CUSTOMER_EMAIL?.trim().toLowerCase()
if(!reviewEmail) throw new Error('Authorized review customer email environment variable is required')
const sqlEmail=reviewEmail.replaceAll("'","''")
async function query(sql) {
    const response=await fetch('https://api.supabase.com/v1/projects/dssvvswvqnxanyzfhixf/database/query',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:`BEGIN READ ONLY; SET LOCAL TIME ZONE 'UTC'; ${sql}; COMMIT;`}),signal:AbortSignal.timeout(30000)})
  if(!response.ok) throw new Error(`Read-only review HTTP ${response.status}`)
  return response.json()
}
const match=`o.user_id=(SELECT id FROM public.profiles WHERE lower(email)='${sqlEmail}') AND o.created_at>='2026-09-18' AND o.created_at<'2026-09-21' AND o.amount=2000 AND (coalesce(pg.name,'') ILIKE '%THAILAND%' OR coalesce(o.account_details->>'product_name','') ILIKE '%THAILAND%')`
const restoration=readFileSync('supabase/migrations/20261005019000_restore_reviewed_legacy_order_credentials.sql','utf8')
const candidateSelect=restoration.match(/CREATE TEMP TABLE reviewed_legacy_credential_candidates ON COMMIT DROP AS\n([\s\S]*?);\n\nDO \$reviewed_snapshot\$/)?.[1]
if(!candidateSelect) throw new Error('Reviewed restoration candidate query unavailable')
console.log(JSON.stringify({exactMigrationProof:await query(`SELECT count(*) AS verified_candidates FROM (${candidateSelect}) verified`)}))
const manifest=await query(`WITH candidates AS (${candidateSelect}) SELECT encode(sha256(convert_to(jsonb_agg(to_jsonb(c) ORDER BY c.order_id)::text,'UTF8')),'hex') AS manifest_sha256,
  count(*) AS candidates,(SELECT count(*)=count(DISTINCT account_id) FROM candidates c CROSS JOIN LATERAL unnest(c.sold_account_ids) account_id) AS no_reused_inventory FROM candidates c`)
if(process.argv.includes('--pin-reviewed-manifest')) {
  if(manifest[0]?.candidates!==31 || manifest[0]?.no_reused_inventory!==true || !/^[a-f0-9]{64}$/.test(manifest[0]?.manifest_sha256||'')) throw new Error('Reviewed manifest proof does not match')
  const pinned=restoration.replace('REVIEWED_MANIFEST_PENDING',manifest[0].manifest_sha256)
  if(pinned===restoration) throw new Error('Reviewed manifest is already pinned')
  writeFileSync('supabase/migrations/20261005019000_restore_reviewed_legacy_order_credentials.sql',pinned)
  console.log(JSON.stringify({reviewedManifestPinned:true,noReusedInventory:true,candidates:31}))
}
console.log(JSON.stringify({orderMetadata:await query(`SELECT o.status,o.financial_authorization_status,o.created_at<public.wallet_legacy_funding_cutoff() AS before_legacy_cutoff,jsonb_typeof(o.account_details) AS details_type,
  ARRAY(SELECT jsonb_object_keys(CASE WHEN jsonb_typeof(o.account_details)='object' THEN o.account_details ELSE '{}'::jsonb END)) AS detail_keys,
  jsonb_typeof(o.account_details->'accounts') AS accounts_type,
  CASE WHEN jsonb_typeof(o.account_details->'accounts')='array' THEN jsonb_array_length(o.account_details->'accounts') ELSE 0 END AS account_count,
  ARRAY(SELECT DISTINCT key FROM jsonb_array_elements(CASE WHEN jsonb_typeof(o.account_details->'accounts')='array' THEN o.account_details->'accounts' ELSE '[]'::jsonb END) account CROSS JOIN LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(account)='object' THEN account ELSE '{}'::jsonb END) key) AS nested_account_keys,
  o.account_details ? 'account_id' AS has_account_id,o.account_details ? 'account_ids' AS has_account_ids,o.account_details ? 'reserved_account_ids' AS has_reserved_ids,
  o.account_details ? 'username' AS has_top_username,o.account_details ? 'password' AS has_top_password,
  CASE WHEN jsonb_typeof(o.account_details->'account_ids')='array' THEN jsonb_array_length(o.account_details->'account_ids') ELSE 0 END AS account_id_count
  FROM public.orders o LEFT JOIN public.product_groups pg ON pg.id=o.product_group_id WHERE ${match}`)}))
console.log(JSON.stringify({schemaAndVisibility:await query(`SELECT jsonb_build_object(
  'transaction_columns',(SELECT jsonb_agg(column_name) FROM information_schema.columns WHERE table_schema='public' AND table_name='transactions'),
  'account_columns',(SELECT jsonb_agg(column_name) FROM information_schema.columns WHERE table_schema='public' AND table_name='individual_accounts'),
  'order_columns',(SELECT jsonb_agg(column_name) FROM information_schema.columns WHERE table_schema='public' AND table_name='orders'),
  'view_has_legacy_cutoff',strpos(pg_get_viewdef('public.orders_safe_history'::regclass),'wallet_legacy_funding_cutoff')>0,
  'view_has_capture_check',strpos(pg_get_viewdef('public.orders_safe_history'::regclass),'financial_authorization_status')>0,
  'view_owner_scoped',strpos(pg_get_viewdef('public.orders_safe_history'::regclass),'auth.uid()')>0,
  'inventory_policies',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',policyname,'roles',roles,'command',cmd,'has_ownership_uid',strpos(coalesce(qual,''),'auth.uid()')>0,'uses_completed_order',strpos(coalesce(qual,''),'completed')>0,'uses_capture',strpos(coalesce(qual,''),'financial_authorization_status')>0)),'[]'::jsonb) FROM pg_policies WHERE schemaname='public' AND tablename='individual_accounts')
) AS evidence`)}))
console.log(JSON.stringify({legacyCounts:await query(`SELECT status,financial_authorization_status,count(*) AS order_count,min(created_at)::date AS earliest_day,max(created_at)::date AS latest_day,
  count(*) FILTER(WHERE created_at>='2026-09-19 00:00:00+00') AS cutoff_redacted_count,
  count(*) FILTER(WHERE account_id IS NOT NULL) AS account_id_link_count,
  count(*) FILTER(WHERE wallet_reservation_id IS NOT NULL) AS wallet_reservation_link_count,
  count(*) FILTER(WHERE idempotency_key IS NOT NULL) AS idempotency_count,
  count(*) FILTER(WHERE jsonb_typeof(account_details->'accounts')='array' AND jsonb_array_length(account_details->'accounts')>0) AS payload_accounts_count
  FROM public.orders WHERE status='completed' GROUP BY status,financial_authorization_status`)}))
console.log(JSON.stringify({targetLinkage:await query(`SELECT o.account_id IS NOT NULL AS account_linked,o.wallet_reservation_id IS NOT NULL AS reservation_linked,o.fulfillment_outbox_id IS NOT NULL AS outbox_linked,o.idempotency_key IS NOT NULL AS idempotency_present,o.financial_security_version IS NOT NULL AS financial_security_version_present,
  EXISTS(SELECT 1 FROM public.individual_accounts a WHERE a.id=o.account_id AND a.status='sold') AS linked_account_sold,
  (o.account_details->>'charged_amount_ngn')::numeric=o.amount AS charged_matches_amount,
  EXISTS(SELECT 1 FROM public.individual_accounts a CROSS JOIN LATERAL jsonb_array_elements(o.account_details->'accounts') item WHERE a.product_group_id=o.product_group_id AND a.status='sold' AND a.username=item->>'username' AND a.password=item->>'password') AS stored_credential_matches_sold_inventory
  FROM public.orders o LEFT JOIN public.product_groups pg ON pg.id=o.product_group_id WHERE ${match}`)}))
console.log(JSON.stringify({targetDebitCandidates:await query(`SELECT t.type,t.status,abs(t.amount)=o.amount AS amount_matches,
  abs(extract(epoch FROM(t.created_at-o.created_at)))<60 AS within_one_minute,
  t.idempotency_key=o.idempotency_key AS idempotency_exact,
  t.reference='PUR-'||left(o.idempotency_key,24) AS reference_idempotency_matches,
  t.metadata->>'order_id'=o.id::text AS metadata_order_match,
  t.amount<0 AS debit_amount_negative,
  abs(extract(epoch FROM(t.created_at-o.created_at)))<1 AS within_one_second,
  position(o.id::text IN coalesce(t.reference,''))>0 AS reference_contains_order_id,
  position(coalesce(o.idempotency_key,'impossible') IN coalesce(t.reference,''))>0 AS reference_contains_full_idempotency,
  t.description='Purchase: '||coalesce(o.account_details->>'quantity','1')||'x '||coalesce(o.account_details->>'product_name','') AS description_exact,
  ARRAY(SELECT jsonb_object_keys(CASE WHEN jsonb_typeof(t.metadata)='object' THEN t.metadata ELSE '{}'::jsonb END)) AS metadata_keys
  FROM public.orders o LEFT JOIN public.product_groups pg ON pg.id=o.product_group_id JOIN public.transactions t ON t.user_id=o.user_id AND abs(t.amount)=o.amount AND t.created_at BETWEEN o.created_at-interval '5 minutes' AND o.created_at+interval '5 minutes' WHERE ${match}`)}))
console.log(JSON.stringify({redactedDebitProof:await query(`SELECT count(*) AS redacted_orders,
  count(*) FILTER(WHERE EXISTS(SELECT 1 FROM public.transactions t WHERE t.user_id=o.user_id AND abs(t.amount)=o.amount AND t.type='purchase' AND t.status='completed' AND (t.idempotency_key=o.idempotency_key OR t.reference='PUR-'||left(o.idempotency_key,24) OR t.metadata->>'order_id'=o.id::text))) AS exact_debit_match,
  count(*) FILTER(WHERE EXISTS(SELECT 1 FROM public.transactions t WHERE t.user_id=o.user_id AND abs(t.amount)=o.amount AND t.type='purchase' AND t.status='completed' AND t.created_at BETWEEN o.created_at-interval '1 minute' AND o.created_at+interval '1 minute')) AS nearby_debit_match,
  count(*) FILTER(WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(o.account_details->'accounts')='array' THEN o.account_details->'accounts' ELSE '[]'::jsonb END) item WHERE NOT EXISTS(SELECT 1 FROM public.individual_accounts a WHERE a.product_group_id=o.product_group_id AND a.status='sold' AND a.username=item->>'username' AND a.password=item->>'password'))) AS all_accounts_sold_match
  FROM public.orders o WHERE o.status='completed' AND o.financial_authorization_status IS NULL AND o.created_at>='2026-09-19 00:00:00+00'`)}))
console.log(JSON.stringify({strictHistoricalProof:await query(`WITH eligible AS (
  SELECT o.* FROM public.orders o WHERE o.status='completed' AND o.financial_authorization_status IS NULL AND o.created_at>='2026-09-19 00:00:00+00'
), candidates AS (
  SELECT o.id,count(t.id) AS debit_count,min(abs(extract(epoch FROM(t.created_at-o.created_at)))) AS smallest_time_difference,
    bool_and(t.description='Purchase: '||coalesce(o.account_details->>'quantity','1')||'x '||coalesce(o.account_details->>'product_name','')) AS description_match
  FROM eligible o LEFT JOIN public.transactions t ON t.user_id=o.user_id AND abs(t.amount)=o.amount AND t.type='purchase' AND t.status='completed' AND abs(extract(epoch FROM(t.created_at-o.created_at)))<1 GROUP BY o.id
) SELECT count(*) AS orders,count(*) FILTER(WHERE debit_count=1) AS unique_debit_within_second,count(*) FILTER(WHERE debit_count>1) AS ambiguous_debit_within_second,count(*) FILTER(WHERE description_match) AS exact_description_count,count(*) FILTER(WHERE smallest_time_difference=0) AS same_timestamp_count FROM candidates`)}))
console.log(JSON.stringify({archiveProof:await query(`WITH eligible AS (
  SELECT o.* FROM public.orders o WHERE o.status='completed' AND o.financial_authorization_status IS NULL AND o.created_at>='2026-09-19 00:00:00+00'
), candidates AS (
  SELECT o.id AS order_id,t.id AS transaction_id FROM eligible o JOIN public.transactions t ON t.user_id=o.user_id AND t.amount=-o.amount AND t.type='purchase' AND t.status='completed'
    AND t.description='Purchase: '||coalesce(o.account_details->>'quantity','1')||'x '||coalesce(o.account_details->>'product_name','')
    AND abs(extract(epoch FROM(t.created_at-o.created_at)))<60
), per_order AS (SELECT order_id,count(*) AS debit_count FROM candidates GROUP BY order_id), per_transaction AS (SELECT transaction_id,count(*) AS reuse_count FROM candidates GROUP BY transaction_id)
SELECT count(*) AS orders,count(*) FILTER(WHERE p.debit_count=1) AS uniquely_matched_debit_count,
  count(*) FILTER(WHERE EXISTS(SELECT 1 FROM candidates c JOIN per_transaction pt USING(transaction_id) WHERE c.order_id=o.id AND pt.reuse_count>1)) AS reused_debit_count,
  count(*) FILTER(WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(o.account_details->'accounts') item WHERE NOT EXISTS(SELECT 1 FROM public.individual_accounts a WHERE a.product_group_id=o.product_group_id AND a.status='sold' AND a.username=item->>'username' AND a.password=item->>'password' AND abs(extract(epoch FROM(a.sold_at-o.created_at)))<60))) AS all_inventory_sold_within_minute,
  count(*) FILTER(WHERE (o.account_details->>'quantity')::integer=jsonb_array_length(o.account_details->'accounts')) AS quantity_payload_matches,
  count(*) FILTER(WHERE (o.account_details->>'charged_amount_ngn')::numeric=o.amount) AS charged_amount_matches
  FROM eligible o LEFT JOIN per_order p ON p.order_id=o.id`)}))
const users=await query(`SELECT id FROM public.profiles WHERE lower(email)='${sqlEmail}'`)
if(users.length!==1||! /^[a-f0-9-]{36}$/i.test(users[0].id)) throw new Error('Expected owned customer not found')
const userId=users[0].id
console.log(JSON.stringify({customerSafeView:await query(`SELECT set_config('request.jwt.claim.sub','${userId}',true); SET LOCAL ROLE authenticated;
  SELECT status,jsonb_typeof(account_details) AS details_type,ARRAY(SELECT jsonb_object_keys(CASE WHEN jsonb_typeof(account_details)='object' THEN account_details ELSE '{}'::jsonb END)) AS detail_keys,
    CASE WHEN jsonb_typeof(account_details->'accounts')='array' THEN jsonb_array_length(account_details->'accounts') ELSE 0 END AS account_count
  FROM public.orders_safe_history WHERE user_id='${userId}'::uuid AND created_at>='2026-09-18' AND created_at<'2026-09-21' AND amount=2000 AND coalesce(account_details->>'product_name','') ILIKE '%THAILAND%'`)}))
