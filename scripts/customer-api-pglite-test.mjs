import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const user = '10000000-0000-4000-8000-000000000001'
const key = '20000000-0000-4000-8000-000000000001'
const nonce = '30000000-0000-4000-8000-000000000001'
const hash = 'a'.repeat(64)

try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY, is_admin boolean DEFAULT false, is_staff boolean DEFAULT false,
      account_suspended boolean DEFAULT false
    );
  `)
  await db.exec(readFileSync(new URL('../supabase/migrations/20261005010000_customer_api_keys.sql', import.meta.url), 'utf8'))
  await db.exec(readFileSync(new URL('../supabase/migrations/20261005013000_default_customer_api_sections.sql', import.meta.url), 'utf8'))
  await db.exec(readFileSync(new URL('../supabase/migrations/20261005014000_atomic_customer_api_key_creation.sql', import.meta.url), 'utf8'))
  await db.exec(readFileSync(new URL('../supabase/migrations/20261005033000_customer_api_airtime_section.sql', import.meta.url), 'utf8'))
  await db.query('INSERT INTO public.profiles(id) VALUES ($1)', [user])
  const create = async (section, hash, prefix) => (await db.query(
    'SELECT public.customer_api_create_key($1,$2,$3,$4,$5) AS result',
    [user,section,'integration',hash,prefix],
  )).rows[0].result
  assert.equal((await create('sms','b'.repeat(64),'tlyc_sms_bbbbbbbb')).success,true)
  const airtimeKey = await create('airtime','7'.repeat(64),'tlyc_airtime_77777777')
  assert.equal(airtimeKey.success, true)
  await db.query(`INSERT INTO public.customer_api_keys(id,user_id,section,label,key_hash,key_prefix)
    VALUES ($1,$2,'products','test',$3,'tlyc_products_aaaaaaaa')`, [key, user, hash])

  const authorize = async (section, limit = 2) => (await db.query(
    'SELECT public.customer_api_authorize($1,$2,$3) AS result', [hash, section, limit],
  )).rows[0].result
  assert.equal((await authorize('products')).ok, true) // no grant row: ordinary customer default
  assert.equal((await db.query('SELECT public.customer_api_authorize($1,$2,$3) AS result',
    ['7'.repeat(64),'airtime',2])).rows[0].result.ok, true)
  assert.equal((await db.query('SELECT public.customer_api_consume_capability($1,$2,$3,$4) AS result',
    [airtimeKey.id,user,'airtime','30000000-0000-4000-8000-000000000099'])).rows[0].result, true)
  assert.equal((await db.query('SELECT public.customer_api_consume_capability($1,$2,$3,$4) AS result',
    [airtimeKey.id,user,'products','30000000-0000-4000-8000-000000000098'])).rows[0].result, false)
  await db.query('UPDATE public.customer_api_keys SET rate_count=0 WHERE id=$1',[key])
  await db.query(`INSERT INTO public.customer_api_access(user_id, allowed_sections, is_active)
    VALUES ($1, ARRAY['products']::text[], true)`, [user])
  assert.equal((await create('sms','c'.repeat(64),'tlyc_sms_cccccccc')).code,'SECTION_NOT_GRANTED')
  assert.equal((await authorize('sms')).ok, false)
  assert.equal((await db.query('SELECT public.customer_api_authorize($1,$2,$3) AS result',
    ['7'.repeat(64),'airtime',2])).rows[0].result.code, 'access_disabled')
  assert.equal((await authorize('products')).ok, true)
  assert.equal((await authorize('products')).ok, true)
  assert.equal((await authorize('products')).code, 'rate_limited')

  const consume = async () => (await db.query(
    'SELECT public.customer_api_consume_capability($1,$2,$3,$4) AS result',
    [key, user, 'products', nonce],
  )).rows[0].result
  assert.equal(await consume(), true)
  assert.equal(await consume(), false)
  for (const digit of 'cdef01234') {
    assert.equal((await create('products',digit.repeat(64),`tlyc_products_${digit.repeat(8)}`)).success,true)
  }
  assert.equal((await create('products','6'.repeat(64),'tlyc_products_66666666')).code,'KEY_LIMIT')
  assert.equal((await db.query(
    'SELECT public.customer_api_consume_capability($1,$2,$3,$4) AS result',
    [key, '10000000-0000-4000-8000-000000000099', 'products', '30000000-0000-4000-8000-000000000002'],
  )).rows[0].result, false)
  assert.equal((await db.query(
    'SELECT public.customer_api_consume_capability($1,$2,$3,$4) AS result',
    [key, user, 'sms', '30000000-0000-4000-8000-000000000002'],
  )).rows[0].result, false)
  await db.query('UPDATE public.customer_api_keys SET revoked_at = now() WHERE id = $1', [key])
  assert.equal((await authorize('products')).code, 'invalid_key')
  assert.equal((await db.query(
    'SELECT public.customer_api_consume_capability($1,$2,$3,$4) AS result',
    [key, user, 'products', '30000000-0000-4000-8000-000000000002'],
  )).rows[0].result, false)
  await db.query('UPDATE public.customer_api_keys SET revoked_at = null WHERE id = $1', [key])
  await db.query('UPDATE public.customer_api_access SET is_active = false WHERE user_id = $1', [user])
  assert.equal((await create('products','d'.repeat(64),'tlyc_products_dddddddd')).code,'SECTION_NOT_GRANTED')
  assert.equal((await authorize('products')).code, 'access_disabled')
  assert.equal((await db.query(
    'SELECT public.customer_api_consume_capability($1,$2,$3,$4) AS result',
    [key, user, 'products', '30000000-0000-4000-8000-000000000002'],
  )).rows[0].result, false)
  await db.query('UPDATE public.customer_api_access SET is_active=true WHERE user_id=$1', [user])
  for (const role of ['is_admin','is_staff','account_suspended']) {
    await db.query(`UPDATE public.profiles SET ${role}=true WHERE id=$1`, [user])
    assert.equal((await create('airtime','8'.repeat(64),'tlyc_airtime_88888888')).code,'CUSTOMER_REQUIRED')
    assert.equal((await authorize('products')).code,'access_disabled')
    assert.equal((await db.query('SELECT public.customer_api_consume_capability($1,$2,$3,$4) AS result',
      [key,user,'products','30000000-0000-4000-8000-000000000003'])).rows[0].result,false)
    await db.query(`UPDATE public.profiles SET ${role}=false WHERE id=$1`, [user])
  }
  await db.exec('SET ROLE authenticated')
  await assert.rejects(db.query('SELECT public.customer_api_authorize($1,$2,$3)', [hash,'products',2]),
    /permission denied/)
  await assert.rejects(db.query('SELECT public.customer_api_create_key($1,$2,$3,$4,$5)',
    [user,'products','test','e'.repeat(64),'tlyc_products_eeeeeeee']), /permission denied/)
  await db.exec('RESET ROLE')
  console.log('customer API SQL authorization checks passed')
} finally {
  await db.close()
}
