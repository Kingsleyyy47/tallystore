import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const migration = readFileSync(new URL('../supabase/migrations/20261006030000_istar_webhook_inbox.sql', import.meta.url), 'utf8')
const user = '10000000-0000-4000-8000-000000000001'
const order = '20000000-0000-4000-8000-000000000001'
const debit = '30000000-0000-4000-8000-000000000001'
const provider = '4820'
const signedOrder = status => ({ id: provider, status, order_type:'star', amount:0.5,
  payload:{ username:'testuser', recipient:'recipient_123456', quantity:50 },
  ...(status === 'failed' ? { refunded:true,refund_amount:0.5,refund_transaction_id:4821 } : {}) })
const body = JSON.stringify({ event_type:'order.failed',order:signedOrder('failed') })
const receipt = { order_id: provider, status: 'failed', username:'testuser',
  wallet_type:'USDT', quantity:50, amount:0.5, refunded:true, refund_amount:0.5 }
async function call(name, args) {
  const keys = Object.keys(args)
  return (await db.query(`SELECT public.${name}(${keys.map((_, n) => `$${n+1}`).join(',')}) AS value`,
    keys.map(key => args[key]))).rows[0].value
}
async function enqueue(hash = 'a'.repeat(64), type = 'order.failed') {
  return call('enqueue_istar_webhook_event', {
    p_event_hash: hash, p_event_type: type, p_provider_order_id: provider,
    p_raw_body: body, p_signature: 'b'.repeat(64),
  })
}
async function claim(limit = 1) {
  return (await db.query('SELECT public.claim_istar_webhook_events($1) AS value', [limit])).rows[0].value
}

try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.telegram_orders(
      id uuid PRIMARY KEY,user_id uuid,istar_order_id text,order_type text,username text,
      recipient_hash text,wallet_type text,quantity integer,months integer,
      istar_amount numeric,price_ngn numeric,status text,error_message text,
      refunded_at timestamptz,idempotency_key text,reference text,completed_at timestamptz,
      updated_at timestamptz,refund_amount_ngn numeric,refund_reference text);
    CREATE TABLE public.transactions(
      id uuid PRIMARY KEY,user_id uuid,idempotency_key text UNIQUE,type text,status text,
      amount numeric,currency text,balance_type text,reference text,balance_before numeric,
      balance_after numeric,metadata jsonb);
    CREATE TABLE public.wallet_test_calls(order_id text);
    CREATE FUNCTION public.apply_wallet_transaction(p_user_id uuid,p_type text,p_amount numeric,
      p_reference text,p_description text,p_idempotency_key text,p_metadata jsonb,p_currency text,
      p_balance_type text,p_external_payment_id text,p_created_by uuid)
      RETURNS jsonb LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO public.wallet_test_calls(order_id) VALUES (p_metadata->>'source_order_id');
        RETURN '{"success":true}'::jsonb;
      END $$;
    INSERT INTO public.telegram_orders(id,user_id,istar_order_id,order_type,username,recipient_hash,
      wallet_type,quantity,istar_amount,price_ngn,status,idempotency_key,reference)
    VALUES ('${order}','${user}','${provider}','stars','testuser','recipient_123456',
      'USDT',50,0.5,100,'processing','purchase-1','TG-1');
    INSERT INTO public.transactions(id,user_id,idempotency_key,type,status,amount,currency,balance_type,
      reference,balance_before,balance_after,metadata)
    VALUES ('${debit}','${user}','telegram:purchase:purchase-1','purchase','completed',-100,'NGN',
      'wallet','TG-1',100,0,
      '{"source":"telegram-stars","source_order_id":"${order}","source_order_table":"telegram_orders",
        "source_debit_idempotency_key":"telegram:purchase:purchase-1",
        "trusted_principal_authorized":true,"trusted_principal_debit_amount":100}');
  `)
  await db.exec(migration)
  const bodyHash = createHash('sha256').update(body).digest('hex')
  const first = await enqueue(bodyHash)
  assert.equal(first.success, true)
  const duplicate = await enqueue(bodyHash)
  assert.equal(duplicate.event_id, first.event_id)
  assert.equal((await db.query('SELECT delivery_count FROM private.istar_webhook_inbox')).rows[0].delivery_count, 2)
  let rows = await claim()
  assert.equal(rows.length, 1)
  assert.equal((await db.query('SELECT raw_body FROM private.istar_webhook_inbox WHERE id=$1',
    [first.event_id])).rows[0].raw_body, body, 'exact signed body must remain in durable inbox')
  assert.equal(rows[0].raw_body, undefined, 'worker claim must not export the stored signed body')
  let outcome = await call('settle_istar_webhook_event', {
    p_event_id: rows[0].id, p_lease_token: rows[0].lease_token,
    p_receipt: JSON.stringify({ ...receipt, refund_transaction_id: '' }),
  })
  assert.equal(outcome.code, 'ISTAR_REFUND_UNPROVEN')
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.wallet_test_calls')).rows[0].n, 0)
  outcome = await call('settle_istar_webhook_event', {
    p_event_id: rows[0].id, p_lease_token: rows[0].lease_token,
    p_receipt: JSON.stringify({ ...receipt, username: 'otheruser' }),
  })
  assert.equal(outcome.code, 'ISTAR_RECEIPT_MISMATCH', 'contradictory top-level and nested recipient evidence must fail')
  for (const [payload, code] of [
    [{ order_id:'different-order' },'ISTAR_RECEIPT_MISMATCH'],
    [{ status:'completed' },'ISTAR_RECEIPT_MISMATCH'],
    [{ order_type:'premium' },'ISTAR_RECEIPT_MISMATCH'],
    [{ amount:'0.500000000000000001' },'ISTAR_RECEIPT_MISMATCH'],
    [{ refunded:false },'ISTAR_REFUND_UNPROVEN'],
    [{ refund_amount:'0.500000000000000001' },'ISTAR_REFUND_UNPROVEN'],
  ]) {
    outcome = await call('settle_istar_webhook_event', {
      p_event_id: rows[0].id, p_lease_token: rows[0].lease_token,
      p_receipt: JSON.stringify({ ...receipt, payload }),
    })
    assert.equal(outcome.code, code)
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.wallet_test_calls')).rows[0].n, 0)
    assert.equal((await db.query('SELECT status FROM public.telegram_orders WHERE id=$1', [order])).rows[0].status, 'processing')
  }
  outcome = await call('settle_istar_webhook_event', {
    p_event_id: rows[0].id, p_lease_token: rows[0].lease_token,
    p_receipt: JSON.stringify({ ...receipt, payload:{ id:'recipient-profile-id',
      order_id:provider,status:'failed',order_type:'star',amount:'0.5000',
      refunded:true,refund_amount:'0.50' } }),
  })
  assert.equal(outcome.success, true)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.wallet_test_calls')).rows[0].n, 1)
  assert.equal((await db.query('SELECT status,refunded_at FROM public.telegram_orders')).rows[0].status, 'failed')
  assert.equal((await db.query('SELECT state FROM private.istar_webhook_inbox')).rows[0].state, 'processed')
  assert.equal((await claim()).length, 0, 'processed event must never replay')

  const completedBody = JSON.stringify({ event_type: 'order.completed', order: signedOrder('completed') })
  const second = await call('enqueue_istar_webhook_event', {
    p_event_hash: createHash('sha256').update(completedBody).digest('hex'),
    p_event_type: 'order.completed', p_provider_order_id: provider,
    p_raw_body: completedBody, p_signature: 'b'.repeat(64),
  })
  assert.equal(second.success, true)
  rows = await claim()
  outcome = await call('settle_istar_webhook_event', {
    p_event_id: rows[0].id, p_lease_token: rows[0].lease_token,
    p_receipt: JSON.stringify({ ...receipt, status: 'completed' }),
  })
  assert.equal(outcome.code, 'ISTAR_TERMINAL_CONFLICT')
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.wallet_test_calls')).rows[0].n, 1)
  outcome = await call('defer_istar_webhook_event', {
    p_event_id: rows[0].id, p_lease_token: rows[0].lease_token,
    p_error: 'ISTAR_TERMINAL_CONFLICT', p_manual_review: true,
  })
  assert.equal(outcome.success, true)
  assert.equal((await db.query('SELECT state FROM private.istar_webhook_inbox WHERE id=$1', [second.event_id])).rows[0].state, 'manual_review')

  await assert.rejects(enqueue('d'.repeat(64)), /istar_event_invalid/)
  await assert.rejects(call('enqueue_istar_webhook_event', {
    p_event_hash: bodyHash, p_event_type: 'order.completed', p_provider_order_id: provider,
    p_raw_body: body, p_signature: 'b'.repeat(64),
  }), /istar_event_invalid/)
  await assert.rejects(db.query('UPDATE private.istar_webhook_inbox SET raw_body=$1 WHERE id=$2', ['{}', first.event_id]), /istar_inbox_history_immutable/)
  await assert.rejects(db.query('DELETE FROM private.istar_webhook_inbox WHERE id=$1', [first.event_id]), /istar_inbox_history_immutable/)

  for (const role of ['anon','authenticated']) {
    await db.exec(`SET ROLE ${role}`)
    await assert.rejects(enqueue(bodyHash), /permission denied/)
    await assert.rejects(db.query('SELECT * FROM private.istar_webhook_inbox'), /permission denied/)
    await db.exec('RESET ROLE')
  }
  await db.exec('SET ROLE service_role')
  assert.deepEqual(await claim(), [])
  await assert.rejects(db.query('SELECT * FROM private.istar_webhook_inbox'), /permission denied/)
  await db.exec('RESET ROLE')
  console.log('iStar inbox: signed-body dedupe, claim, receipt/debit guard, atomic refund, terminal race and private grants passed.')
} catch (error) {
  console.error(error.message, error.detail || '')
  process.exitCode = 1
} finally { await db.close() }
