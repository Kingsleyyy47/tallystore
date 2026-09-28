import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const migration = readFileSync(new URL('../supabase/migrations/20260925016000_reserve_discount_uses_with_orders.sql', import.meta.url), 'utf8')
const queryPack = readFileSync(new URL('../docs/security/wallet-readonly-query-pack.sql', import.meta.url), 'utf8')
const user = '11111111-1111-4111-8111-111111111111'
const otherUser = '22222222-2222-4222-8222-222222222222'
const product = '33333333-3333-4333-8333-333333333333'
const category = '44444444-4444-4444-8444-444444444444'
const oneUse = '55555555-5555-4555-8555-555555555555'
const released = '66666666-6666-4666-8666-666666666666'
const reward = '77777777-7777-4777-8777-777777777777'
const orderIds = {
  first: '88888888-8888-4888-8888-888888888888',
  second: '99999999-9999-4999-8999-999999999999',
  failed: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  replacement: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
}

async function insertOrder(id, userId, codeId, amount = 80, status = 'processing') {
  return db.query(`
    INSERT INTO public.orders(id, user_id, product_group_id, amount, status, account_details)
    VALUES ($1, $2, $3, $4, $5, jsonb_build_object('quantity', 1, 'discount_code_id', $6::text))
    RETURNING id, discount_code_id
  `, [id, userId, product, amount, status, codeId])
}

try {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE TABLE public.product_groups (
      id uuid PRIMARY KEY, category_id uuid NOT NULL, price numeric NOT NULL
    );
    INSERT INTO public.product_groups VALUES ('${product}', '${category}', 100);
    CREATE TABLE public.discount_codes (
      id uuid PRIMARY KEY, code text, percent_off smallint NOT NULL,
      category_id uuid, product_group_id uuid, max_uses integer,
      used_count integer NOT NULL DEFAULT 0, expires_at timestamptz,
      is_active boolean NOT NULL DEFAULT true, user_id uuid,
      max_order_amount integer
    );
    INSERT INTO public.discount_codes(id, code, percent_off, max_uses, user_id) VALUES
      ('${oneUse}', 'ONE', 20, 1, NULL),
      ('${released}', 'RELEASE', 20, 1, NULL),
      ('${reward}', 'REWARD', 20, 1, '${user}');
    CREATE TABLE public.orders (
      id uuid PRIMARY KEY, user_id uuid NOT NULL, product_group_id uuid NOT NULL,
      amount numeric NOT NULL, status text NOT NULL,
      account_details jsonb NOT NULL DEFAULT '{}'::jsonb,
      discount_code_id uuid
    );
  `)
  await db.exec(migration)
  const query54Start = queryPack.indexOf('-- 54.')
  const query54End = queryPack.indexOf('-- 55.', query54Start)
  assert(query54Start >= 0 && query54End > query54Start,
    'read-only query 54 must be delimited by the next numbered query')
  await db.exec(queryPack.slice(query54Start, query54End))
  await db.query('SET ROLE service_role')
  assert.equal((await db.query('SELECT public.discount_code_capacity_version() AS version')).rows[0].version, 1)
  await db.query('RESET ROLE')

  const first = await insertOrder(orderIds.first, user, oneUse)
  assert.equal(first.rows[0].discount_code_id, oneUse)
  assert.equal((await db.query('SELECT used_count FROM public.discount_codes WHERE id = $1', [oneUse])).rows[0].used_count, 0)
  await assert.rejects(
    () => insertOrder(orderIds.second, otherUser, oneUse),
    (error) => error.message.includes('discount_code_capacity_exhausted'),
  )
  assert.equal((await db.query('SELECT count(*)::int AS count FROM public.orders')).rows[0].count, 1)

  await db.query("UPDATE public.orders SET status = 'completed' WHERE id = $1", [orderIds.first])
  assert.equal((await db.query('SELECT used_count FROM public.discount_codes WHERE id = $1', [oneUse])).rows[0].used_count, 1)
  await db.query("UPDATE public.orders SET status = 'completed' WHERE id = $1", [orderIds.first])
  assert.equal((await db.query('SELECT used_count FROM public.discount_codes WHERE id = $1', [oneUse])).rows[0].used_count, 1)
  await assert.rejects(
    () => insertOrder(orderIds.second, otherUser, oneUse),
    (error) => error.message.includes('discount_code_capacity_exhausted'),
  )
  await assert.rejects(
    () => db.query('UPDATE public.orders SET discount_code_id = $1 WHERE id = $2', [released, orderIds.first]),
    (error) => error.message.includes('discount_order_link_immutable'),
  )

  await insertOrder(orderIds.failed, user, released)
  await db.query("UPDATE public.orders SET status = 'failed' WHERE id = $1", [orderIds.failed])
  await insertOrder(orderIds.replacement, otherUser, released)
  await assert.rejects(
    () => db.query("UPDATE public.orders SET status = 'completed' WHERE id = $1", [orderIds.failed]),
    (error) => error.message.includes('discount_order_completion_state_invalid'),
  )
  await db.query("UPDATE public.orders SET status = 'completed' WHERE id = $1", [orderIds.replacement])
  assert.equal((await db.query('SELECT used_count FROM public.discount_codes WHERE id = $1', [released])).rows[0].used_count, 1)

  await assert.rejects(
    () => insertOrder('cccccccc-cccc-4ccc-8ccc-cccccccccccc', user, reward, 1),
    (error) => error.message.includes('discount_order_amount_invalid'),
  )
  await assert.rejects(
    () => insertOrder('cccccccc-cccc-4ccc-8ccc-cccccccccccc', otherUser, reward),
    (error) => error.message.includes('discount_code_unavailable'),
  )
  await insertOrder('cccccccc-cccc-4ccc-8ccc-cccccccccccc', user, reward)
  console.log('Discount order capacity, completion posting, failure release, and code binding passed isolated PostgreSQL fixture.')
} finally {
  await db.close()
}
