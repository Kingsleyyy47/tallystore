import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'

const sql=readFileSync(new URL('../supabase/migrations/20261018002000_sms_cancellation_sweeper.sql',import.meta.url),'utf8')
const db=new PGlite()
let stage='setup'
try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA cron; CREATE SCHEMA vault; CREATE SCHEMA net; CREATE SCHEMA private;
    CREATE TABLE cron.job(jobid bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      jobname text UNIQUE,schedule text,command text,active boolean DEFAULT true);
    CREATE FUNCTION cron.schedule(p_name text,p_schedule text,p_command text)
      RETURNS bigint LANGUAGE plpgsql AS $$
      DECLARE v_id bigint;
      BEGIN INSERT INTO cron.job(jobname,schedule,command) VALUES(p_name,p_schedule,p_command)
        RETURNING jobid INTO v_id; RETURN v_id; END $$;
    CREATE TABLE vault.decrypted_secrets(name text,decrypted_secret text);
    INSERT INTO vault.decrypted_secrets VALUES
      ('tallystore_project_url','https://dssvvswvqnxanyzfhixf.supabase.co'),
      ('payment_recovery_cron_secret',repeat('a',64));
    CREATE TABLE private.migration_write_freeze_control(singleton boolean PRIMARY KEY,phase text);
    INSERT INTO private.migration_write_freeze_control VALUES(true,'active');
    CREATE TABLE net.calls(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      url text,headers jsonb,body jsonb,timeout_ms integer);
    CREATE FUNCTION net.http_post(url text,body jsonb DEFAULT '{}'::jsonb,
      params jsonb DEFAULT '{}'::jsonb,headers jsonb DEFAULT '{}'::jsonb,
      timeout_milliseconds integer DEFAULT 1000) RETURNS bigint LANGUAGE plpgsql AS $$
      DECLARE v_id bigint;
      BEGIN INSERT INTO net.calls(url,headers,body,timeout_ms)
        VALUES(url,headers,body,timeout_milliseconds) RETURNING id INTO v_id;
        RETURN v_id; END $$;
  `)
  stage='migration'
  await db.exec(sql)
  const jobs=await db.query("SELECT schedule,command,active FROM cron.job WHERE jobname='tallystore-sms-cancellation-recovery'")
  assert.deepEqual(jobs.rows,[{schedule:'* * * * *',command:'SELECT private.enqueue_sms_cancellation_sweep();',active:true}])
  const grants=await db.query(`SELECT
    has_function_privilege('anon','private.enqueue_sms_cancellation_sweep()','EXECUTE') anon,
    has_function_privilege('authenticated','private.enqueue_sms_cancellation_sweep()','EXECUTE') customer,
    has_function_privilege('service_role','private.enqueue_sms_cancellation_sweep()','EXECUTE') service`)
  assert.deepEqual(grants.rows,[{anon:false,customer:false,service:false}])
  stage='runtime'
  const queued=await db.query('SELECT private.enqueue_sms_cancellation_sweep() id')
  assert.equal(Number(queued.rows[0].id),1)
  const calls=await db.query('SELECT url,body,timeout_ms FROM net.calls')
  assert.deepEqual(calls.rows,[{url:'https://dssvvswvqnxanyzfhixf.supabase.co/functions/v1/smsbus',
    body:{action:'sweep_stale_sms'},timeout_ms:30000}])
  await db.query("UPDATE private.migration_write_freeze_control SET phase='draining'")
  assert.equal((await db.query('SELECT private.enqueue_sms_cancellation_sweep() id')).rows[0].id,null)
  assert.equal((await db.query('SELECT count(*)::int n FROM net.calls')).rows[0].n,1)
  await db.query("UPDATE private.migration_write_freeze_control SET phase='active'")
  await db.exec('CREATE SCHEMA migration_setup; CREATE TABLE migration_setup.destination_write_admission(id integer)')
  assert.equal((await db.query('SELECT private.enqueue_sms_cancellation_sweep() id')).rows[0].id,null)
  assert.equal((await db.query('SELECT count(*)::int n FROM net.calls')).rows[0].n,1)
  console.log('sms cancellation scheduler PGlite: schedule, role, active, freeze, destination guards passed')
} catch(error) {
  console.error('sms cancellation scheduler test failed:',stage,error.code||'',error.message)
  process.exitCode=1
} finally {await db.close()}
