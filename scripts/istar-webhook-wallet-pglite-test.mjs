import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

// This fixture uses the deployed wallet writer and its trusted-principal proof,
// not a stub that returns success without posting a transaction.
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8')
const migration = name => read(`../supabase/migrations/${name}.sql`)
const db = new PGlite()
let stage = 'setup'
const user = '10000000-0000-4000-8000-000000000001'
const unfunded = '10000000-0000-4000-8000-000000000002'
const orderId = '20000000-0000-4000-8000-000000000001'
const unfundedOrderId = '20000000-0000-4000-8000-000000000002'
const paymentId = '30000000-0000-4000-8000-000000000001'
const supplierOrderId = '4820'
const body = JSON.stringify({ event_type: 'order.failed', order: { id: supplierOrderId } })
const bodyHash = createHash('sha256').update(body).digest('hex')
const receipt = { order_id: supplierOrderId, status: 'failed', order_type: 'star',
  username: 'synthetic_user', recipient_hash: 'synthetic_recipient', wallet_type: 'USDT',
  quantity: 50, amount: 0.5, refunded: true, refund_amount: 0.5, refund_transaction_id: 4821 }
const rpc = async (name, args = []) => (await db.query(
  `SELECT public.${name}(${args.map((_, index) => `$${index + 1}`).join(',')}) AS result`, args,
)).rows[0].result
const balance = async (id = user) => Number((await db.query(
  'SELECT wallet_balance FROM public.profiles WHERE id=$1', [id],
)).rows[0].wallet_balance)
const ledger = async key => (await db.query(
  'SELECT * FROM public.transactions WHERE idempotency_key=$1', [key],
)).rows[0]
const countRefunds = async () => Number((await db.query(
  "SELECT count(*) AS n FROM public.transactions WHERE type='refund'",
)).rows[0].n)
const settle = (claim, proof = receipt) => rpc('settle_istar_webhook_event', [
  claim.id, claim.lease_token, JSON.stringify(proof),
])
const enqueue = (hash = bodyHash) => rpc('enqueue_istar_webhook_event', [
  hash, 'order.failed', supplierOrderId, body, 'b'.repeat(64),
])

try {
  const fixture = read('./catalog/nowpayments-wallet-pglite-test.mjs')
    .match(/await db\.exec\(`([\s\S]*?)`\)\s*await db\.exec\(migration\)/)?.[1]
  assert.ok(fixture, 'reviewed canonical wallet fixture was not found')
  await db.exec(fixture.replaceAll('${user}', user)
    .replaceAll('${oldReceipt}', '30000000-0000-4000-8000-000000000099')
    .replaceAll('${address}', 'TEST_ONLY_NOT_A_REAL_CHAIN_ADDRESS_ISTAR'))
  await db.exec(`
    CREATE TABLE public.telegram_orders(
      id uuid PRIMARY KEY,user_id uuid,istar_order_id text,order_type text,username text,
      recipient_hash text,wallet_type text,quantity integer,months integer,
      istar_amount numeric,price_ngn numeric,status text,error_message text,
      refunded_at timestamptz,idempotency_key text,reference text,completed_at timestamptz,
      updated_at timestamptz,refund_amount_ngn numeric,refund_reference text);
    INSERT INTO auth.users(id) VALUES ('${unfunded}');
    INSERT INTO public.profiles(id,wallet_balance) VALUES ('${unfunded}',0);
  `)
  await db.exec(migration('20261005022000_nowpayments_verified_wallet_credit'))
  // Replace the fixture's always-false matcher with the exact production helper.
  const refundPatch = migration('20260924012000_refund_link_precedence_in_financial_truth')
  const helper = refundPatch.slice(0, refundPatch.indexOf('REVOKE ALL ON FUNCTION public.wallet_refund_links_debit'))
  assert.match(helper, /CREATE OR REPLACE FUNCTION public\.wallet_refund_links_debit/)
  await db.exec(helper)
  await db.exec(`CREATE TRIGGER trusted_transaction_guard BEFORE INSERT ON public.transactions
    FOR EACH ROW EXECUTE FUNCTION public.guard_trusted_principal_transaction();`)
  await db.exec(migration('20261006030000_istar_webhook_inbox'))
  stage = 'verified funding'

  // Synthetic registered provider proof produces a real trusted wallet credit.
  await db.query(`INSERT INTO public.crypto_transactions(id,user_id,payment_provider,nowpayments_payment_id,
    payment_reference,naira_amount,crypto_amount,crypto_type,outcome_amount,outcome_currency,
    nowpayments_pay_address,status,created_at)
    VALUES($1,$2,'nowpayments','ISTAR-FUND-1','ISTAR-FUND-REF',1000,1,'usdttrc20',
      1.05,'usdttrc20','TEST_ONLY_NOT_A_REAL_CHAIN_ADDRESS_ISTAR','pending',clock_timestamp())`,
  [paymentId, user])
  assert.equal((await rpc('register_nowpayments_wallet_quote', [paymentId,user,'ISTAR-FUND-1',
    'ISTAR-FUND-REF',1000,1.05,'usdttrc20','TEST_ONLY_NOT_A_REAL_CHAIN_ADDRESS_ISTAR'])).success, true)
  assert.equal((await rpc('settle_nowpayments_wallet_quote', ['ISTAR-FUND-1','ISTAR-FUND-REF',
    1.05,'usdttrc20','TEST_ONLY_NOT_A_REAL_CHAIN_ADDRESS_ISTAR',1.05,'finished',
    'a'.repeat(64),'b'.repeat(64)])).success, true)
  assert.equal(await balance(), 1000)
  stage = 'trusted purchase'

  await db.query(`INSERT INTO public.telegram_orders(id,user_id,istar_order_id,order_type,username,
    recipient_hash,wallet_type,quantity,istar_amount,price_ngn,status,idempotency_key,reference)
    VALUES($1,$2,$3,'stars','synthetic_user','synthetic_recipient','USDT',50,0.5,
      100,'processing','purchase-1','TG-1')`, [orderId,user,supplierOrderId])
  const debitKey = 'telegram:purchase:purchase-1'
  const debitResult = await rpc('apply_wallet_transaction', [user,'purchase',100,'TG-1',
    'Synthetic Telegram Stars purchase',debitKey,JSON.stringify({ source:'telegram-stars',
      source_order_id:orderId,source_order_table:'telegram_orders',
      source_debit_idempotency_key:debitKey }), 'NGN','wallet',null,null])
  assert.equal(debitResult.success, true, 'canonical writer must post genuine trusted purchase debit')
  const debit = await ledger(debitKey)
  assert.equal(Number(debit.amount), -100)
  assert.equal(debit.metadata.trusted_principal_authorized, true)
  assert.equal(Number(debit.metadata.trusted_principal_debit_amount), 100)
  assert.equal(await balance(), 900)
  stage = 'unfunded purchase rejection'

  // A wallet with no verified principal cannot create the same debit.
  await assert.rejects(rpc('apply_wallet_transaction', [unfunded,'purchase',100,'TG-2',
    'Unfunded synthetic purchase','telegram:purchase:unfunded',JSON.stringify({
      source:'telegram-stars',source_order_id:unfundedOrderId,
      source_order_table:'telegram_orders',source_debit_idempotency_key:'telegram:purchase:unfunded',
    }), 'NGN','wallet',null,null]), /insufficient_balance|INSUFFICIENT_TRUSTED_AVAILABLE_FUNDS/)
  assert.equal(await balance(unfunded), 0)
  stage = 'receipt and debit guards'

  // A provider failure cannot manufacture a wallet refund for an order whose
  // customer's original trusted purchase never happened.
  await db.query(`INSERT INTO public.telegram_orders(id,user_id,istar_order_id,order_type,username,
    recipient_hash,wallet_type,quantity,istar_amount,price_ngn,status,idempotency_key,reference)
    VALUES($1,$2,'4830','stars','synthetic_user','synthetic_recipient','USDT',50,0.5,
      100,'processing','unfunded','TG-2')`, [unfundedOrderId,unfunded])
  const unfundedBody = JSON.stringify({ event_type:'order.failed', order:{ id:'4830' } })
  await rpc('enqueue_istar_webhook_event', [createHash('sha256').update(unfundedBody).digest('hex'),
    'order.failed','4830',unfundedBody,'b'.repeat(64)])
  const [unfundedClaim] = await rpc('claim_istar_webhook_events', [1])
  assert.equal((await settle(unfundedClaim, {...receipt,order_id:'4830'})).code,
    'ISTAR_DEBIT_UNPROVEN')
  assert.equal(await balance(unfunded), 0)
  assert.equal(await countRefunds(), 0)

  const first = await enqueue()
  assert.equal(first.success, true)
  const [claim] = await rpc('claim_istar_webhook_events', [1])
  assert.ok(claim)
  assert.equal((await settle(claim, {...receipt, refund_amount:0.4})).code, 'ISTAR_REFUND_UNPROVEN')
  assert.equal((await settle(claim, {...receipt, recipient_hash:'wrong'})).code, 'ISTAR_RECEIPT_MISMATCH')
  assert.equal(await countRefunds(), 0)

  // Changing the debit evidence must fail before any wallet refund is attempted.
  await db.query(`UPDATE public.transactions SET metadata=metadata||'{"trusted_principal_authorized":false}'::jsonb
    WHERE id=$1`, [debit.id])
  assert.equal((await settle(claim)).code, 'ISTAR_DEBIT_UNPROVEN')
  assert.equal(await countRefunds(), 0)
  await db.query('UPDATE public.transactions SET metadata=$1 WHERE id=$2',
    [JSON.stringify(debit.metadata),debit.id])
  await db.query("UPDATE public.transactions SET reference='FORGED' WHERE id=$1", [debit.id])
  assert.equal((await settle(claim)).code, 'ISTAR_DEBIT_UNPROVEN')
  await db.query('UPDATE public.transactions SET reference=$1 WHERE id=$2', [debit.reference,debit.id])
  await db.query('UPDATE public.transactions SET amount=-90 WHERE id=$1', [debit.id])
  assert.equal((await settle(claim)).code, 'ISTAR_DEBIT_UNPROVEN')
  await db.query('UPDATE public.transactions SET amount=$1 WHERE id=$2', [debit.amount,debit.id])

  // If the final order update fails, the actual wallet refund and inbox state roll back.
  await db.exec(`CREATE FUNCTION public.synthetic_final_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.status='failed' THEN RAISE EXCEPTION 'synthetic_final_failure'; END IF;
    RETURN NEW; END $$;
    CREATE TRIGGER synthetic_final_failure BEFORE UPDATE ON public.telegram_orders
    FOR EACH ROW EXECUTE FUNCTION public.synthetic_final_failure();`)
  await assert.rejects(settle(claim), /synthetic_final_failure/)
  stage = 'successful refund'
  assert.equal(await balance(), 900)
  assert.equal(await countRefunds(), 0)
  assert.equal((await db.query('SELECT status FROM public.telegram_orders WHERE id=$1', [orderId])).rows[0].status, 'processing')
  assert.equal((await db.query('SELECT state FROM private.istar_webhook_inbox WHERE id=$1', [first.event_id])).rows[0].state, 'leased')
  await db.exec('DROP TRIGGER synthetic_final_failure ON public.telegram_orders')

  assert.equal((await settle(claim)).success, true)
  assert.equal(await balance(), 1000)
  assert.equal(await countRefunds(), 1)
  const refund = await ledger(`telegram:refund:${orderId}`)
  assert.equal(Number(refund.amount), 100)
  assert.equal(refund.metadata.source_debit_transaction_id, debit.id)
  assert.equal((await db.query('SELECT status FROM public.telegram_orders WHERE id=$1', [orderId])).rows[0].status, 'failed')
  assert.equal((await settle(claim)).code, 'ISTAR_LEASE_STALE')
  assert.equal((await enqueue()).event_id, first.event_id)
  assert.deepEqual(await rpc('claim_istar_webhook_events', [1]), [])
  assert.equal(await countRefunds(), 1)
  assert.equal(await balance(), 1000)

  console.log('iStar wallet fixture passed: actual verified credit/debit, refund, replay, forged evidence refusal, and atomic rollback.')
} catch (error) {
  console.error(stage, error.message, error.detail || '')
  process.exitCode = 1
} finally {
  await db.close()
}
