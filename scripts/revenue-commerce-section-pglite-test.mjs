import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const read = name => readFileSync(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8')
const insert = (key, type, id) => db.query(
  'INSERT INTO public.revenue_feature_snapshots(snapshot_key,scope_type,scope_id,features) VALUES ($1,$2,$3,$4)',
  [key, type, id, JSON.stringify({ revenue_30d: 1234 })],
)
const boundaries = async () => ({
  rls: (await db.query("SELECT relrowsecurity,relforcerowsecurity,relacl FROM pg_class WHERE oid='public.revenue_feature_snapshots'::regclass")).rows,
  policies: (await db.query("SELECT * FROM pg_policies WHERE tablename='revenue_feature_snapshots' ORDER BY policyname")).rows,
})

try {
  await db.exec(`
    CREATE ROLE authenticated;
    CREATE ROLE anon;
    CREATE FUNCTION public.is_admin_profile() RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT COALESCE(current_setting('test.admin',true),'false') = 'true'
    $$;
  `)
  await db.exec(read('20260820005000_create_revenue_os_runtime_intelligence'))
  await db.exec('GRANT SELECT,INSERT ON public.revenue_feature_snapshots TO authenticated;')
  for (const type of ['store','product','category','customer','session']) await insert(`old:${type}`,type,'existing')
  const existing = (await db.query('SELECT * FROM public.revenue_feature_snapshots ORDER BY snapshot_key')).rows
  const before = await boundaries()
  await assert.rejects(insert('unavailable:section','commerce_section','products'), /scope_type_check/)

  await db.exec(read('20261006041000_revenue_commerce_section_snapshots'))
  assert.deepEqual(await boundaries(),before, 'migration must preserve RLS, grants and policies')
  assert.deepEqual((await db.query('SELECT * FROM public.revenue_feature_snapshots ORDER BY snapshot_key')).rows,existing,
    'existing snapshots must remain exact')
  await insert('section:products','commerce_section','products')
  await insert('section:sms','commerce_section','sms')
  assert.deepEqual((await db.query("SELECT scope_type,scope_id FROM public.revenue_feature_snapshots WHERE scope_type='commerce_section' ORDER BY scope_id")).rows,
    [{scope_type:'commerce_section',scope_id:'products'},{scope_type:'commerce_section',scope_id:'sms'}])
  await assert.rejects(insert('invalid:scope','unknown','products'), /scope_type_check/)
  await db.exec('SET ROLE authenticated;')
  assert.equal((await db.query('SELECT * FROM public.revenue_feature_snapshots')).rows.length,0,
    'ordinary users must not see section or existing analytics')
  await assert.rejects(insert('customer:forged','commerce_section','products'), /row-level security/)
  await db.exec('RESET ROLE; SET ROLE anon;')
  await assert.rejects(db.query('SELECT * FROM public.revenue_feature_snapshots'), /permission denied/)
  await db.exec('RESET ROLE;')
  console.log('Revenue commerce sections: actual original schema accepts separate section snapshots, preserves existing rows/RLS/grants, and rejects unknown scopes and browser writes (local only).')
} finally { await db.close() }
