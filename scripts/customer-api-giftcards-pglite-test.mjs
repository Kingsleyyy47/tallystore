import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const root = new URL('../supabase/migrations/', import.meta.url)
const user = '10000000-0000-4000-8000-000000000001'
const restricted = '10000000-0000-4000-8000-000000000002'
const staff = '10000000-0000-4000-8000-000000000003'
const hash = 'a'.repeat(64)
const suffix = '30000000-0000-4000-8000-000000000001'
const fixture = ['20261005010000_customer_api_keys.sql',
  '20261005013000_default_customer_api_sections.sql',
  '20261005014000_atomic_customer_api_key_creation.sql',
  '20261005033000_customer_api_airtime_section.sql']
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.profiles(id uuid PRIMARY KEY, is_admin boolean DEFAULT false,
      is_staff boolean DEFAULT false, account_suspended boolean DEFAULT false);`)
  for (const file of fixture) await db.exec(readFileSync(new URL(file, root), 'utf8'))
  await db.query('INSERT INTO public.profiles(id) VALUES ($1),($2),($3)', [user, restricted, staff])
  await db.query(`INSERT INTO public.customer_api_access(user_id,allowed_sections,is_active)
    VALUES ($1,ARRAY['products','sms']::text[],true)`, [restricted])
  await db.query('UPDATE public.profiles SET is_staff=true WHERE id=$1', [staff])
  const migration = readFileSync(new URL('20261006010000_customer_api_giftcards_section.sql', root), 'utf8')
  assert.ok(!/\bUPDATE\s+public\.customer_api_access\b/i.test(migration), 'explicit section rows must not widen')
  await db.exec(migration)
  const restrictedSections = (await db.query('SELECT allowed_sections FROM public.customer_api_access WHERE user_id=$1',
    [restricted])).rows[0].allowed_sections
  assert.deepEqual(restrictedSections, ['products', 'sms'])
  const create = async (userId, keyHash) => (await db.query(
    `SELECT public.customer_api_create_key($1,'giftcards','integration',$2,$3) AS result`,
    [userId, keyHash, `tlyc_giftcards_${keyHash.slice(0, 8)}`],
  )).rows[0].result
  assert.equal((await create(restricted,'b'.repeat(64))).code, 'SECTION_NOT_GRANTED')
  assert.equal((await create(staff,'c'.repeat(64))).code, 'CUSTOMER_REQUIRED')
  const key = await create(user,hash)
  assert.equal(key.success, true, 'an ordinary customer without an explicit restriction can create a section key')
  const authorize = async (section = 'giftcards') => (await db.query(
    'SELECT public.customer_api_authorize($1,$2,60) AS result', [hash, section],
  )).rows[0].result
  assert.equal((await authorize()).ok, true)
  assert.equal((await authorize('products')).ok, false)
  const consume = async nonce => (await db.query(
    `SELECT public.customer_api_consume_capability($1,$2,'giftcards',$3) AS result`,
    [key.id,user,nonce],
  )).rows[0].result
  assert.equal(await consume(suffix), true)
  assert.equal(await consume(suffix), false, 'one section-bound capability can be used once')
  await db.query(`INSERT INTO public.customer_api_access(user_id,allowed_sections,is_active)
    VALUES ($1,ARRAY['products']::text[],true)`, [user])
  assert.equal((await authorize()).code, 'access_disabled')
  assert.equal(await consume('30000000-0000-4000-8000-000000000002'), false)
  await db.exec('SET ROLE authenticated')
  await assert.rejects(db.query('SELECT public.customer_api_authorize($1,$2,60)', [hash,'giftcards']),
    /permission denied/)
  await assert.rejects(db.query(`SELECT public.customer_api_create_key($1,'giftcards','x',$2,$3)`,
    [user,'d'.repeat(64),'tlyc_giftcards_dddddddd']), /permission denied/)
  await db.exec('RESET ROLE')
  console.log('Customer API gift-card SQL: explicit restrictions preserved; ordinary key, section-bound nonce, staff and ACL denial passed')
} finally { await db.close() }
