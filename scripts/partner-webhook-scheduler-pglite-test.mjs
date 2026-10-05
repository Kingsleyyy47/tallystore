import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite()
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA private; CREATE SCHEMA cron; CREATE SCHEMA vault; CREATE SCHEMA net; CREATE SCHEMA supabase_migrations;
 CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY);
 INSERT INTO supabase_migrations.schema_migrations VALUES('20261005030000');
 CREATE TABLE cron.job(jobid bigserial PRIMARY KEY,jobname text UNIQUE,schedule text,command text,active boolean DEFAULT true);
 CREATE TABLE vault.decrypted_secrets(name text,decrypted_secret text);
 CREATE TABLE net.http_request_queue(id bigserial,headers jsonb);
 CREATE TABLE net._http_response(id bigint,status_code integer);
 GRANT USAGE ON SCHEMA net TO anon,authenticated;
 GRANT SELECT ON net.http_request_queue,net._http_response TO PUBLIC,anon,authenticated;
 CREATE FUNCTION net.http_post(url text,body jsonb DEFAULT '{}',params jsonb DEFAULT '{}',headers jsonb DEFAULT '{}',timeout_milliseconds integer DEFAULT 1000)
 RETURNS bigint LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'no_network_call_allowed'; END; $$;
 CREATE FUNCTION cron.schedule(job_name text,job_schedule text,job_command text) RETURNS bigint LANGUAGE plpgsql AS $$
 DECLARE n bigint; BEGIN INSERT INTO cron.job(jobname,schedule,command) VALUES(job_name,job_schedule,job_command) RETURNING jobid INTO n; RETURN n; END; $$;`)
const migration=readFileSync('supabase/migrations/20261005031000_schedule_partner_webhook_worker.sql','utf8')
const probe=readFileSync('scripts/catalog/partner-webhook-scheduler-live-probe.sql','utf8')
await assert.rejects(db.exec(migration),/Vault configuration missing/)
assert.equal((await db.query(`SELECT count(*)::integer n FROM cron.job`)).rows[0].n,0)
await db.exec(`INSERT INTO vault.decrypted_secrets VALUES('partner_webhook_worker_secret',repeat('a',64));`)
await db.exec(migration)
await db.exec(probe)
const job=(await db.query(`SELECT * FROM cron.job`)).rows[0]
assert.equal(job.schedule,'* * * * *');assert.equal(job.active,true)
assert.ok(!job.command.includes('a'.repeat(64)))
assert.equal((await db.query(`SELECT count(*)::integer n FROM net.http_request_queue`)).rows[0].n,0)
assert.equal((await db.query(`SELECT count(*)::integer n FROM private.partner_webhook_worker_runs`)).rows[0].n,0)
await db.exec(`SET ROLE authenticated`)
await assert.rejects(db.query(`SELECT * FROM private.partner_webhook_worker_runs`),/permission denied/)
await db.exec(`RESET ROLE`)
await assert.rejects(db.exec(migration),/already exists/)
console.log('Partner webhook scheduler: private valid secret and NOLOGIN roles required, Vault reference only, private run records denied, duplicate schedule refused, no network call. Browser net API boundary is separately tested live.')
await db.close()
