import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {randomUUID} from 'node:crypto'

// Importable native PostgreSQL tests. The caller supplies two clients connected
// to a disposable, synthetic-only loopback database; this file never loads .env.
export async function runPocketfiPaymentCheckDatabaseTests(db, second) {
  for (const c of [db, second]) {
    const {rows:[r]}=await c.query("SELECT host(inet_server_addr()) host,current_database() name")
    assert.equal(r.host,'127.0.0.1')
    assert.match(r.name,/^tallystore_migration_fixture_pocketfi_check_[a-z0-9_]+$/)
  }
  const ids={admin:randomUUID(),staff:randomUUID(),customer:randomUUID(),other:randomUUID()}
  let passed=0
  const check=(name,fn)=>async()=>{await fn();passed++;console.log(`PASS ${name}`)}
  const as=async (who,sql,params=[],client=db,role='authenticated')=>{
    await client.query('SELECT set_config($1,$2,false),set_config($3,$4,false)',
      ['request.jwt.claim.sub',who??'','request.jwt.claim.role',role])
    await client.query(`SET ROLE ${role}`)
    try{return await client.query(sql,params)}finally{await client.query('RESET ROLE')}
  }
  const search=async (reference,who=ids.staff,kind='reference',client=db)=>
    (await as(who,'SELECT public.staff_check_pocketfi_payments($1,$2,25) value',[kind,reference],client)).rows[0].value
  const row=async(ref)=>{const result=await search(ref);assert.equal(result.error,undefined);return result.results[0]}
  const addLog=async(ref,options={})=>{
    const id=randomUUID(),attested=options.attested!==false
    await db.query(`INSERT INTO public.pocketfi_webhook_logs(id,raw_payload,matched_user_id,matched_account_number,
      verified_reference,verified_amount_ngn,verified_status,processed,created_at,webhook_verified_at,webhook_verification_method)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,now(),CASE WHEN $9 THEN now() ELSE NULL END,CASE WHEN $9 THEN 'hmac_sha512' ELSE NULL END)`,
    [id,JSON.stringify(options.payload??{currency:'NGN',transaction:{reference:ref},order:{amount:1000}}),
      options.user===undefined?ids.customer:options.user,options.account===undefined?'0011223344':options.account,
      ref,options.amount===undefined?1000:options.amount,options.status??'success',options.processed??false,attested])
    return id
  }
  const addCredit=async(ref,log,options={})=>{
    const id=randomUUID(),amount=options.amount??1000
    await db.query(`INSERT INTO public.transactions(id,user_id,type,status,amount,currency,balance_type,balance_before,balance_after,
      reference,external_payment_id,metadata,created_at)
      VALUES($1,$2,'topup',$3,$4,'NGN','wallet',0,$4,$5,CASE WHEN $7 THEN NULL ELSE $5 END,$6,COALESCE($8::timestamptz,now()))`,
    [id,options.user??ids.customer,options.status??'completed',amount,ref,
      JSON.stringify(options.legacy?{}:{source:'webhook-pocketfi',provider:'pocketfi',verified_amount_ngn:amount,verified_reference:ref,webhook_log_id:log}),
      options.legacy??false,options.createdAt??null])
    await db.query('UPDATE public.pocketfi_webhook_logs SET processed=true WHERE id=$1',[log])
    return id
  }
  const deny=async(fn,code='42501')=>assert.rejects(fn,error=>error.code===code)
  await db.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF; END $$;
    CREATE SCHEMA auth; CREATE SCHEMA private;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.role',true),'') $$;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
    CREATE TABLE public.profiles(id uuid PRIMARY KEY,email text,is_admin boolean DEFAULT false,is_staff boolean DEFAULT false,
      account_suspended boolean DEFAULT false,pocketfi_account_number text,wallet_balance numeric DEFAULT 0);
    CREATE TABLE public.staff_permissions(user_id uuid,permission_key text,is_enabled boolean,PRIMARY KEY(user_id,permission_key));
    CREATE TABLE public.api_partner_customers(id uuid DEFAULT gen_random_uuid(),pocketfi_account_number text);
    CREATE TABLE public.transactions(id uuid PRIMARY KEY,user_id uuid,type text,status text,amount numeric,currency text,balance_type text,
      balance_before numeric,balance_after numeric,reference text,external_payment_id text,metadata jsonb,created_at timestamptz);
    CREATE TABLE public.wallet_provider_confirmations(transaction_id uuid,user_id uuid,provider text,provider_reference text,
      confirmed_amount numeric,provider_status text,provider_checked_at timestamptz);
    CREATE FUNCTION public.wallet_legacy_funding_cutoff() RETURNS timestamptz LANGUAGE sql IMMUTABLE
      AS $$ SELECT '2026-09-19 00:00:00+00'::timestamptz $$;
    CREATE TABLE public.pocketfi_webhook_logs(id uuid PRIMARY KEY,raw_payload jsonb NOT NULL,matched_user_id uuid,
      matched_account_number text,verified_reference text,verified_amount_ngn numeric,verified_status text,processed boolean,
      error_message text,created_at timestamptz);
    REVOKE ALL ON public.profiles,public.transactions,public.staff_permissions,public.pocketfi_webhook_logs FROM PUBLIC,anon,authenticated;
    GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;`)
  for (const [name,id] of Object.entries(ids)) {
    await db.query('INSERT INTO auth.users VALUES($1,$2)',[id,`${name}@example.invalid`])
    await db.query('INSERT INTO public.profiles(id,email,is_admin,is_staff,pocketfi_account_number) VALUES($1,$2,$3,$4,$5)',
      [id,`${name}@example.invalid`,name==='admin',name==='staff',name==='customer'?'0011223344':name==='other'?'0099887766':null])
  }
  await db.query(readFileSync(new URL('../supabase/migrations/20261022090000_staff_pocketfi_payment_check.sql',import.meta.url),'utf8'))

  const tests=[
    check('anonymous, ordinary customer and unpermissioned staff denied',async()=>{
      await deny(()=>as(null,'SELECT public.staff_check_pocketfi_payments(\'reference\',\'missing\',25)',[],db,'anon'))
      await deny(()=>search('missing',ids.customer));await deny(()=>search('missing'))
    }),
    check('disabled explicit permission denied, enabled explicit permission accepted',async()=>{
      await db.query("INSERT INTO public.staff_permissions VALUES($1,'view_pocketfi_payments',false)",[ids.staff]);await deny(()=>search('missing'))
      await db.query("UPDATE public.staff_permissions SET is_enabled=true WHERE user_id=$1",[ids.staff]);assert.equal((await row('missing')).status,'no_webhook')
    }),
    check('suspended or removed staff and service JWT cannot bypass guard',async()=>{
      await db.query('UPDATE public.profiles SET account_suspended=true WHERE id=$1',[ids.staff]);await deny(()=>search('missing'))
      await db.query('UPDATE public.profiles SET account_suspended=false,is_staff=false WHERE id=$1',[ids.staff]);await deny(()=>search('missing'))
      await db.query('UPDATE public.profiles SET is_staff=true WHERE id=$1',[ids.staff])
      await deny(()=>as(ids.staff,"SELECT public.staff_check_pocketfi_payments('reference','missing',25)",[],db,'service_role'))
      assert.equal((await search('missing',ids.admin)).results[0].status,'no_webhook')
    }),
    check('missing webhook is not payment failure or a credit claim',async()=>{
      const r=await row('never-received');assert.equal(r.webhook_state,'not_found');assert.equal(r.status,'no_webhook');assert.equal(r.can_flag,false)
      assert.equal(r.credit_state,'not_found')
    }),
    check('complete authenticated success with no credit is missing credit',async()=>{
      await addLog('PFI|missing-credit');const r=await row('PFI|missing-credit')
      assert.equal(r.status,'paid_credit_missing');assert.equal(r.expected_credit_ngn,1000);assert.equal(r.can_flag,true)
      assert.equal(r.account_number,'••••3344');assert.equal(r.fee_ngn,null)
    }),
    check('unique exact posted credit remains credited after customer spent balance',async()=>{
      const l=await addLog('PFI|credited');const t=await addCredit('PFI|credited',l)
      const r=await row('PFI|credited');assert.equal(r.status,'paid_and_credited');assert.equal(r.transaction_id,t)
      assert.equal((await db.query('SELECT wallet_balance FROM public.profiles WHERE id=$1',[ids.customer])).rows[0].wallet_balance,'0')
      assert.equal(r.credited_amount_ngn,1000)
    }),
    check('historical matched ledger is recorded but old webhook authenticity not invented',async()=>{
      const l=await addLog('PFI|old-credit',{attested:false});await addCredit('PFI|old-credit',l)
      const r=await row('PFI|old-credit');assert.equal(r.status,'needs_review');assert.equal(r.webhook_state,'unverified');assert.equal(r.credit_state,'credited')
    }),
    check('canonical historical provider confirmations prove recorded credit without inventing signature',async()=>{
      const l=await addLog('PFI|recovered-credit',{attested:false}),t=await addCredit('PFI|recovered-credit',l,{legacy:true,createdAt:'2026-09-22T00:00:00Z'})
      await db.query("INSERT INTO public.wallet_provider_confirmations VALUES($1,$2,'pocketfi',$3,1000,'completed',now())",[t,ids.customer,'PFI|recovered-credit'])
      const r=await row('PFI|recovered-credit');assert.equal(r.credit_state,'credited');assert.equal(r.status,'needs_review');assert.equal(r.webhook_state,'unverified')
      await db.query('UPDATE public.wallet_provider_confirmations SET confirmed_amount=500 WHERE transaction_id=$1',[t])
      assert.equal((await row('PFI|recovered-credit')).credit_state,'review')
      await db.query('UPDATE public.wallet_provider_confirmations SET confirmed_amount=1000,provider_reference=$1 WHERE transaction_id=$2',['PFI|different-reference',t])
      assert.equal((await row('PFI|recovered-credit')).credit_state,'review')
      await db.query('UPDATE public.wallet_provider_confirmations SET provider_reference=$1 WHERE transaction_id=$2',['PFI|recovered-credit',t])
      await addCredit('PFI|recovered-credit',l,{user:ids.other,amount:1000,legacy:true,createdAt:'2026-09-22T00:00:00Z'})
      assert.equal((await row('PFI|recovered-credit')).credit_state,'review')
    }),
    check('processed flag alone does not establish wallet credit',async()=>{
      await addLog('PFI|processed-only',{processed:true});const r=await row('PFI|processed-only')
      assert.equal(r.credit_state,'not_found');assert.equal(r.status,'paid_credit_missing')
    }),
    check('cross-customer reference and amount conflicts require review',async()=>{
      const l=await addLog('PFI|cross-wallet');await addCredit('PFI|cross-wallet',l)
      await addCredit('PFI|cross-wallet',l,{user:ids.other,amount:500})
      const r=await row('PFI|cross-wallet');assert.equal(r.status,'needs_review');assert.equal(r.credit_state,'review');assert.equal(r.transaction_id,null)
    }),
    check('failed and pending require explicit authenticated statuses',async()=>{
      await addLog('PFI|failed',{status:'failed'});assert.equal((await row('PFI|failed')).status,'failed')
      await addLog('PFI|pending',{status:'pending'});assert.equal((await row('PFI|pending')).status,'pending')
      await addLog('PFI|old-failed',{status:'failed',attested:false});assert.equal((await row('PFI|old-failed')).status,'needs_review')
      await addLog('PFI|status-conflict',{status:'failed'});await addLog('PFI|status-conflict',{status:'pending'})
      assert.equal((await row('PFI|status-conflict')).status,'needs_review')
    }),
    check('nested synthetic probes and non-NGN events never establish success',async()=>{
      for (const [ref,payload] of [['PFI|probe',{data:{migration_probe:true}}],['PFI|foreign',{order:{currency:'USD'}}]]) {
        await addLog(ref,{payload});assert.equal((await row(ref)).status,'needs_review')
      }
    }),
    check('malformed attested event cannot borrow amount or account from unsigned event',async()=>{
      await addLog('PFI|laundering',{user:null,account:null,amount:null});await addLog('PFI|laundering',{attested:false})
      const r=await row('PFI|laundering');assert.equal(r.status,'needs_review');assert.equal(r.expected_credit_ngn,null)
    }),
    check('duplicate account ownership and partner account are not retail missing credits',async()=>{
      await addLog('PFI|duplicate-owner');await db.query('UPDATE public.profiles SET pocketfi_account_number=$1 WHERE id=$2',['0011223344',ids.other])
      assert.equal((await row('PFI|duplicate-owner')).status,'needs_review')
      await db.query('UPDATE public.profiles SET pocketfi_account_number=$1 WHERE id=$2',['0099887766',ids.other])
      await db.query("INSERT INTO public.api_partner_customers(pocketfi_account_number) VALUES('0011223344')")
      assert.equal((await row('PFI|missing-credit')).status,'needs_review');await db.query('DELETE FROM public.api_partner_customers')
    }),
    check('null authentication-method receipt is rejected',async()=>{
      await assert.rejects(()=>db.query("INSERT INTO public.pocketfi_webhook_logs(id,raw_payload,webhook_verified_at) VALUES(gen_random_uuid(),'{}',now())"),e=>e.code==='23514')
    }),
    check('exact email/account search masks account, no wildcard or SQL injection',async()=>{
      const email=await search('CUSTOMER@EXAMPLE.INVALID',ids.staff,'email');assert.equal(email.search,'customer@example.invalid')
      assert.ok(email.results.some(r=>r.reference==='PFI|credited'))
      const account=await search('0011223344',ids.staff,'account_number');assert.ok(account.results.every(r=>r.account_number==='••••3344'))
      assert.equal((await row("x' OR '1'='1")).status,'no_webhook')
      await deny(()=>search('0011%',ids.staff,'account_number'),'22023');await deny(()=>search('missing',ids.staff,null),'22023')
      await db.query('UPDATE public.profiles SET email=$1 WHERE id=$2',['customer@example.invalid',ids.other])
      const ambiguous=await search('customer@example.invalid',ids.staff,'email')
      assert.equal(ambiguous.error,'POCKETFI_CUSTOMER_AMBIGUOUS');assert.equal(ambiguous.results,undefined)
      await db.query('UPDATE public.profiles SET email=$1 WHERE id=$2',['other@example.invalid',ids.other])
    }),
    check('raw logs and private audit/queue are not directly readable',async()=>{
      await deny(()=>as(ids.staff,'SELECT * FROM public.pocketfi_webhook_logs'))
      await deny(()=>as(ids.staff,'SELECT * FROM private.staff_pocketfi_checks'))
    }),
    check('receipt/index change preserves service-only webhook INSERT and UPDATE',async()=>{
      await db.query('GRANT SELECT,INSERT,UPDATE ON public.pocketfi_webhook_logs TO service_role')
      const id=randomUUID()
      await as(null,"INSERT INTO public.pocketfi_webhook_logs(id,raw_payload,created_at,webhook_verified_at,webhook_verification_method) VALUES($1,'{}',now(),now(),'hmac_sha512')",[id],db,'service_role')
      await as(null,'UPDATE public.pocketfi_webhook_logs SET processed=true WHERE id=$1',[id],db,'service_role')
      assert.equal((await db.query('SELECT processed FROM public.pocketfi_webhook_logs WHERE id=$1',[id])).rows[0].processed,true)
    }),
    check('flags pin a checked result, are deduplicated and write no money',async()=>{
      const before=(await db.query("SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) hash FROM public.transactions t")).rows[0].hash
      const walletsBefore=(await db.query("SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) hash FROM public.profiles t")).rows[0].hash
      const s=await search('PFI|missing-credit'),r=s.results[0]
      const flag=async(client=db)=>(await as(ids.staff,'SELECT public.staff_flag_pocketfi_payment($1,$2,$3) value',
        [s.check_id,r.result_key,'Customer reports missing credit'],client)).rows[0].value
      const [a,b]=await Promise.all([flag(),flag(second)])
      assert.equal(a.review_id,b.review_id);assert.notEqual(a.already_flagged,b.already_flagged)
      assert.equal((await db.query("SELECT count(*) n FROM private.staff_pocketfi_reviews WHERE status='pending'")).rows[0].n,'1')
      const after=(await db.query("SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) hash FROM public.transactions t")).rows[0].hash
      assert.equal(before,after)
      await deny(()=>as(ids.staff,'SELECT public.admin_list_pocketfi_payment_reviews()'))
      const q=(await as(ids.admin,'SELECT public.admin_list_pocketfi_payment_reviews() value')).rows[0].value
      assert.equal(q.reviews[0].id,a.review_id);assert.equal(q.reviews[0].snapshot.reference,r.reference)
      await as(ids.admin,'SELECT public.admin_resolve_pocketfi_payment_review($1,$2)',[a.review_id,'Checked evidence; no financial action taken'])
      assert.equal((await db.query('SELECT count(*) n FROM private.staff_pocketfi_review_audit')).rows[0].n,'3')
      assert.equal((await db.query("SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) hash FROM public.transactions t")).rows[0].hash,before)
      assert.equal((await db.query("SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) hash FROM public.profiles t")).rows[0].hash,walletsBefore)
    }),
    check('admin resolve racing a duplicate flag preserves one pending case and complete audit',async()=>{
      await addLog('PFI|review-concurrency');const s=await search('PFI|review-concurrency')
      const args=[s.check_id,s.results[0].result_key,'Customer requests a payment review']
      const first=(await as(ids.staff,'SELECT public.staff_flag_pocketfi_payment($1,$2,$3) value',args)).rows[0].value
      const before=(await db.query("SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) hash FROM public.transactions t")).rows[0].hash
      const outcomes=await Promise.all([
        as(ids.admin,'SELECT public.admin_resolve_pocketfi_payment_review($1,$2) value',[first.review_id,'Evidence reviewed without a financial action']),
        as(ids.staff,'SELECT public.staff_flag_pocketfi_payment($1,$2,$3) value',args,second),
      ])
      assert.ok(outcomes.every(r=>r.rows[0].value.review_id))
      assert.ok(Number((await db.query("SELECT count(*) n FROM private.staff_pocketfi_reviews WHERE payment_identity=md5('pocketfi|PFI|review-concurrency') AND status='pending'")).rows[0].n)<=1)
      assert.equal((await db.query('SELECT status FROM private.staff_pocketfi_reviews WHERE id=$1',[first.review_id])).rows[0].status,'reviewed')
      assert.equal((await db.query("SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) hash FROM public.transactions t")).rows[0].hash,before)
    }),
    check('stale missing-credit screen cannot flag now-credited payment',async()=>{
      const l=await addLog('PFI|race-credit'),s=await search('PFI|race-credit');await addCredit('PFI|race-credit',l)
      await deny(()=>as(ids.staff,'SELECT public.staff_flag_pocketfi_payment($1,$2,$3)',
        [s.check_id,s.results[0].result_key,'Please investigate missing payment']),'22023')
    }),
    check('unavailable ledger evidence is never reported as missing credit',async()=>{
      await db.query('ALTER TABLE public.transactions RENAME COLUMN metadata TO unavailable_metadata_test')
      try {const r=await row('PFI|missing-credit');assert.equal(r.credit_state,'unavailable');assert.equal(r.status,'needs_review')}
      finally {await db.query('ALTER TABLE public.transactions RENAME COLUMN unavailable_metadata_test TO metadata')}
    }),
    check('checks are audited with final state and responses contain no raw payload',async()=>{
      const c=(await db.query("SELECT count(*) n FROM private.staff_pocketfi_checks WHERE check_state='complete'")).rows[0].n
      assert.ok(Number(c)>15)
      const s=await search('PFI|credited');const serialized=JSON.stringify(s)
      assert.ok(!serialized.includes('raw_payload'));assert.ok(!serialized.includes('webhook_verification_method'))
      assert.ok(!serialized.includes('0011223344'));assert.ok(!serialized.includes('balance_before'))
    }),
    check('per-actor check rate limit is enforced on the server',async()=>{
      await db.query("INSERT INTO private.staff_pocketfi_checks(actor_id,search_type,search_value,check_state) SELECT $1,'reference','synthetic-rate-probe','complete' FROM generate_series(1,30)",[ids.staff])
      await deny(()=>search('PFI|credited'),'P0001')
      assert.equal((await search('PFI|credited',ids.admin)).results[0].credit_state,'credited')
    }),
  ]
  for(const test of tests){await test();await db.query("UPDATE private.staff_pocketfi_checks SET checked_at=checked_at-interval '2 minutes'")}
  return {passed,syntheticOnly:true,moneyActionsImplemented:false,providerCalls:0}
}
