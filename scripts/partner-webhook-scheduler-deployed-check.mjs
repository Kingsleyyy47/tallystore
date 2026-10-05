// Joins pg_net HTTP results to private scheduler request IDs. No headers/body
// or secret values are emitted. A cron enqueue alone is not delivery evidence.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {verifySourceNetApiBoundary} from './partner-webhook-data-api-boundary.mjs'
await verifySourceNetApiBoundary()
const sourceRef='dssvvswvqnxanyzfhixf'
const line=readFileSync('.env','utf8').split(/\r?\n/).find(v=>v.startsWith('SUPABASE_ACCESS_TOKEN='))
const token=line?.slice(line.indexOf('=')+1).trim().replace(/^["']|["']$/g,'')
assert.ok(token)
const response=await fetch(`https://api.supabase.com/v1/projects/${sourceRef}/database/query`,{
 method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
 body:JSON.stringify({query:`BEGIN READ ONLY;
 SELECT (SELECT count(*)=1 FROM cron.job WHERE jobname='tallystore-partner-webhook-worker-every-min'
   AND active AND schedule='* * * * *') scheduler_active,
 (SELECT count(*) FROM private.partner_webhook_worker_runs) scheduled_requests,
 (SELECT count(*) FROM private.partner_webhook_worker_runs r JOIN net._http_response h ON h.id=r.request_id
   WHERE h.status_code=200 AND NOT coalesce(h.timed_out,false)) successful_http_runs,
 (SELECT h.status_code FROM private.partner_webhook_worker_runs r LEFT JOIN net._http_response h ON h.id=r.request_id
   ORDER BY r.requested_at DESC LIMIT 1) latest_http_status,
 (SELECT count(*) FROM cron.job_run_details d JOIN cron.job j ON j.jobid=d.jobid
   WHERE j.jobname='tallystore-partner-webhook-worker-every-min' AND d.status='succeeded') cron_successes,
 (SELECT NOT rolcanlogin FROM pg_roles WHERE rolname='anon') anon_database_login_denied,
 (SELECT NOT rolcanlogin FROM pg_roles WHERE rolname='authenticated') browser_database_login_denied,
 NOT has_table_privilege('anon','vault.decrypted_secrets','SELECT') anon_vault_denied,
 NOT has_table_privilege('authenticated','vault.decrypted_secrets','SELECT') browser_vault_denied;
 COMMIT;`}),signal:AbortSignal.timeout(30000)})
assert.ok(response.ok,`Source scheduled verification HTTP ${response.status}`)
const evidence=(await response.json())[0]
for(const field of ['scheduler_active','anon_database_login_denied','browser_database_login_denied','anon_vault_denied','browser_vault_denied']) assert.equal(evidence[field],true,field)
console.log(JSON.stringify({sourceRef,...evidence,actualScheduledHttpVerified:Number(evidence.successful_http_runs)>0&&Number(evidence.cron_successes)>0}))
if(process.argv.includes('--require-run')) {
 assert.ok(Number(evidence.successful_http_runs)>0,'Scheduled HTTP run not confirmed yet')
 assert.ok(Number(evidence.cron_successes)>0,'Cron execution not confirmed yet')
}
