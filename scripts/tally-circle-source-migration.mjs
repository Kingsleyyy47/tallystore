import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const mode = process.argv[2] || 'verify'
assert.ok(['dry', 'apply', 'verify'].includes(mode))
const tokenLine = readFileSync('.env', 'utf8').split(/\r?\n/).find(line => line.startsWith('SUPABASE_ACCESS_TOKEN='))
const token = tokenLine?.slice(tokenLine.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')
assert.ok(token, 'Source management credential required')
const base = 'https://api.supabase.com/v1/projects/dssvvswvqnxanyzfhixf'
const version = '20261005023000'
const migration = readFileSync(`supabase/migrations/${version}_tally_circle_launch_gate.sql`, 'utf8')
const digest = createHash('sha256').update(migration).digest('hex')
const proofPath = 'scripts/crypto-review.local/circle-dry-pass.json'
async function query(sql) {
  const response = await fetch(`${base}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }), signal: AbortSignal.timeout(60000),
  })
  if (!response.ok) throw new Error(`Source verification HTTP ${response.status}`)
  return response.json()
}
const guards = `SELECT
  public.tally_circle_launch_enabled() IS FALSE AS paused,
  NOT has_table_privilege('anon','private.tally_circle_launch','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS anon_table_denied,
  NOT has_table_privilege('authenticated','private.tally_circle_launch','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS browser_table_denied,
  NOT has_table_privilege('service_role','private.tally_circle_launch','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS service_table_denied,
  NOT has_function_privilege('authenticated','public.tally_circle_launch_enabled()','EXECUTE') AS browser_gate_denied,
  NOT has_function_privilege('authenticated','public.get_tally_circle_purchase_status(uuid)','EXECUTE') AS browser_purchase_status_denied,
  NOT has_function_privilege('anon','public.get_my_tally_circle_status()','EXECUTE') AS anon_status_denied,
  has_function_privilege('service_role','public.get_tally_circle_purchase_status(uuid)','EXECUTE') AS service_status_allowed,
  has_function_privilege('authenticated','public.get_my_tally_circle_status()','EXECUTE') AS owned_status_allowed,
  (SELECT count(*)=1 FROM private.tally_circle_launch) AS single_gate,
  (SELECT bool_and(proconfig @> ARRAY['search_path=""']) FROM pg_proc
    WHERE oid IN ('public.tally_circle_launch_enabled()'::regprocedure,
      'public.get_tally_circle_purchase_status(uuid)'::regprocedure)) AS pinned_search_paths`
const recorded = (await query(`BEGIN READ ONLY; SELECT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${version}') AS applied; COMMIT;`))[0].applied
if (mode === 'dry') {
  assert.equal(recorded, false, 'Already applied')
  const output = await query(`BEGIN ISOLATION LEVEL REPEATABLE READ;
    CREATE TEMP TABLE circle_financial_snapshot ON COMMIT DROP AS
    SELECT relation, md5(string_agg(row_hash,'' ORDER BY row_hash)) AS digest FROM (
      SELECT 'profiles' AS relation, md5(to_jsonb(p)::text) AS row_hash FROM public.profiles p
      UNION ALL SELECT 'transactions',md5(to_jsonb(t)::text) FROM public.transactions t
      UNION ALL SELECT 'orders',md5(to_jsonb(o)::text) FROM public.orders o
    ) rows GROUP BY relation;
    ${migration}
    SELECT set_config('request.jwt.claim.role','service_role',true);
    DO $$ DECLARE u uuid; s jsonb; BEGIN
      SELECT id INTO u FROM public.profiles WHERE is_admin IS DISTINCT FROM true AND is_staff IS DISTINCT FROM true LIMIT 1;
      IF u IS NULL THEN RAISE EXCEPTION 'No customer fixture'; END IF;
      s := public.get_tally_circle_purchase_status(u);
      IF s->>'enabled' <> 'false' OR s->>'is_member' <> 'false' OR s->>'discount_percent' <> '0' THEN RAISE EXCEPTION 'Paused price mismatch'; END IF;
      PERFORM set_config('request.jwt.claim.sub',u::text,true);
    END $$;
    SET LOCAL ROLE authenticated;
    DO $$ DECLARE s jsonb; BEGIN
      s := public.get_my_tally_circle_status();
      IF s->>'enabled' <> 'false' OR s->>'discount_active' <> 'false' OR s->>'discount_percent' <> '0' THEN RAISE EXCEPTION 'Browser paused price mismatch'; END IF;
    END $$;
    RESET ROLE;
    DO $$ BEGIN
      IF EXISTS (
        SELECT relation,md5(string_agg(row_hash,'' ORDER BY row_hash)) AS digest FROM (
          SELECT 'profiles' AS relation,md5(to_jsonb(p)::text) AS row_hash FROM public.profiles p
          UNION ALL SELECT 'transactions',md5(to_jsonb(t)::text) FROM public.transactions t
          UNION ALL SELECT 'orders',md5(to_jsonb(o)::text) FROM public.orders o
        ) rows GROUP BY relation
        EXCEPT SELECT relation,digest FROM circle_financial_snapshot
      ) THEN RAISE EXCEPTION 'Customer financial rows changed'; END IF;
    END $$;
    ${guards}; ROLLBACK;`)
  assert.ok(output.length === 1 && Object.values(output[0]).every(value => value === true), 'Source guards failed')
  const clean = await query(`BEGIN READ ONLY; SELECT to_regclass('private.tally_circle_launch') IS NULL AS rolled_back,
    NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${version}') AS history_unchanged; COMMIT;`)
  assert.ok(Object.values(clean[0]).every(value => value === true))
  writeFileSync(proofPath, JSON.stringify({ digest, verifiedAt: new Date().toISOString() }))
  console.log(JSON.stringify({ mode, sourceDryRunPassed: true, financialRowsUnchanged: true, ...output[0], ...clean[0] }))
} else if (mode === 'apply') {
  assert.equal(recorded, false, 'Already applied')
  assert.equal(JSON.parse(readFileSync(proofPath,'utf8')).digest, digest, 'Migration changed since source dry run')
  const escaped = migration.replace(/'/g,"''")
  const output = await query(`BEGIN; ${migration}
    INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
    VALUES ('${version}','tally_circle_launch_gate',ARRAY['${escaped}']);
    ${guards}; COMMIT;`)
  assert.ok(output.length === 1 && Object.values(output[0]).every(value => value === true))
  console.log(JSON.stringify({ mode, applied: true, ...output[0] }))
} else {
  assert.equal(recorded, true, 'Migration not recorded')
  const output = await query(`BEGIN READ ONLY; ${guards}; COMMIT;`)
  assert.ok(Object.values(output[0]).every(value => value === true))
  console.log(JSON.stringify({ mode, recorded: true, ...output[0] }))
}
