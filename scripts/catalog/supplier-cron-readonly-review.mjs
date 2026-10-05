import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

// Management queries are restricted to SELECT in a read-only transaction.
// Neither raw cron commands nor environment values are emitted.
const entries = readFileSync('.env', 'utf8').split(/\r?\n/).flatMap(line => {
  const match = line.match(/^([A-Z_][A-Z_0-9]*)\s*=\s*(.*)$/)
  if (!match) return []
  let value = match[2].trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1,-1)
  return [[match[1], value]]
})
const ref = 'dssvvswvqnxanyzfhixf' // Confirmed source project, not another environment's URL.
const tokens = entries.filter(([name]) => name === 'SUPABASE_ACCESS_TOKEN').map(([,value]) => value)
const token = process.argv.includes('--last-existing-pat') ? tokens.at(-1) : tokens[0]
if (!token) throw new Error('Management credential is not configured')
async function query(sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: `BEGIN READ ONLY; ${sql}; COMMIT;` }), signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`Read-only management query HTTP ${response.status}`)
  return response.json()
}
const extensions = await query(`SELECT jsonb_build_object(
  'extensions',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',e.extname,'version',e.extversion,'schema',n.nspname)),'[]'::jsonb) FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname IN ('pg_cron','pg_net','supabase_vault')),
  'schemas',(SELECT coalesce(jsonb_agg(nspname),'[]'::jsonb) FROM pg_namespace WHERE nspname IN ('cron','net','vault')),
  'relations',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'relation',c.relname)),'[]'::jsonb) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('cron','net','vault') AND c.relname IN ('job','job_run_details','http_request_queue','_http_response','secrets','decrypted_secrets')),
  'functions',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'arguments',pg_get_function_identity_arguments(p.oid))),'[]'::jsonb) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname='net' AND p.proname='http_post') OR (n.nspname='vault' AND p.proname IN ('create_secret','update_secret')))
) AS evidence`)
console.log(JSON.stringify({ extensions }))
const evidence=extensions[0]?.evidence
if (!evidence?.relations?.some(item => item.schema==='cron' && item.relation==='job')) {
  console.log(JSON.stringify({ jobs: [], reason: 'cron.job does not exist' }))
  process.exit(0)
}
const jobs = await query(`SELECT jobid,jobname,schedule,active,
  command ILIKE '%auto-restock%' AS auto_restock,
  command ILIKE '%manual-restock%' AS manual_restock,
  command ILIKE '%supplier-catalog-maintenance%' AS catalog_maintenance,
  command ILIKE '%net.http_post%' AS net_http_post,
  command ILIKE '%vault.decrypted_secrets%' AS uses_vault,
  command ILIKE '%x-cron-secret%' AS cron_secret_header,
  CASE WHEN command ILIKE '%/functions/v1/%' THEN substring(command FROM '/functions/v1/([a-z0-9-]+)') ELSE NULL END AS edge_route
  FROM cron.job ORDER BY jobid`)
console.log(JSON.stringify({ jobs }))
const schemas = await query(`SELECT jsonb_build_object(
  'matching_secret_names',(SELECT coalesce(jsonb_agg(name),'[]'::jsonb) FROM vault.secrets WHERE name ILIKE '%supplier%' OR name ILIKE '%restock%'),
  'recent_runs',(SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM (SELECT j.jobid,j.jobname,d.status,count(*) AS runs,max(d.start_time) AS latest_run FROM cron.job_run_details d JOIN cron.job j ON j.jobid=d.jobid WHERE d.start_time>now()-interval '2 hours' AND (j.command ILIKE '%restock%' OR j.command ILIKE '%supplier%') GROUP BY j.jobid,j.jobname,d.status ORDER BY j.jobid,d.status) t)
) AS evidence`)
console.log(JSON.stringify({ schemas }))
const secretResponse=await fetch(`https://api.supabase.com/v1/projects/${ref}/secrets`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)})
if(secretResponse.ok) {
  const secrets=await secretResponse.json()
  const hash=value=>createHash('sha256').update(value).digest('hex')
  const safe=secrets.filter(item=>['AUTO_RESTOCK_ENABLED','LIVE_ACCOUNT_FULFILLMENT_ENABLED','SUPPLIER_CATALOG_SECRET','AUTO_RESTOCK_SECRET'].includes(item.name)).map(item=>({name:item.name,present:true,enabled:item.name.endsWith('_ENABLED')?(item.value==='true'||item.value===hash('true')?true:item.value==='false'||item.value===hash('false')?false:'unverified'):undefined}))
  console.log(JSON.stringify({ edgeSecretConfiguration:safe }))
} else console.log(JSON.stringify({ edgeSecretConfigurationReadStatus:secretResponse.status }))
const bodyResponse=await fetch(`https://api.supabase.com/v1/projects/${ref}/functions/auto-restock/body`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)})
if(bodyResponse.ok) {
  const body=await bodyResponse.text()
  console.log(JSON.stringify({deployedAutoRestockSource:{containsEnabledGate:body.includes('AUTO_RESTOCK_ENABLED'),containsPausedResponse:body.includes('AUTO_RESTOCK_PAUSED'),contentType:bodyResponse.headers.get('content-type')}}))
} else console.log(JSON.stringify({deployedAutoRestockSourceReadStatus:bodyResponse.status}))
