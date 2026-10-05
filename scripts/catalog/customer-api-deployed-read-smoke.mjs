import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomBytes, randomUUID, createHash } from 'node:crypto'

// Explicitly authorized internal verification of the owner's ordinary account.
// The temporary key remains in memory. Every customer API request is GET.
if (!process.argv.includes('--execute')) {
  console.log('Use --execute only after the owner authorizes deployed read verification.')
  process.exit(0)
}
const ownerEmail = process.env.CUSTOMER_API_SMOKE_OWNER_EMAIL?.trim().toLowerCase()
if (!ownerEmail || ownerEmail.length > 254 || !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(ownerEmail)) {
  throw new Error('Set CUSTOMER_API_SMOKE_OWNER_EMAIL to the explicitly authorized ordinary account')
}
const source = readFileSync('.env','utf8')
const tokenLine = source.split(/\r?\n/).find(line => line.startsWith('SUPABASE_ACCESS_TOKEN='))
const managementToken = tokenLine?.slice(tokenLine.indexOf('=')+1).trim().replace(/^["']|["']$/g,'')
if (!managementToken) throw new Error('Management credential is not configured')
const ref = 'dssvvswvqnxanyzfhixf'
const label = 'Internal read verification 20261005'
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
let phase = 'profile'
let userId
let keyId
let rawKey
let cleanupDone = false
let report = { success: false, checks: {}, cleanup: false }
async function query(sql, readOnly = true) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${managementToken}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ query: `BEGIN${readOnly?' READ ONLY':''}; ${sql}; COMMIT;` }), signal: AbortSignal.timeout(30000),
  })
  if (!response.ok) throw new Error(`Management HTTP ${response.status}`)
  return response.json()
}
async function cleanup() {
  if (!userId || cleanupDone) return
  await query(`DELETE FROM public.customer_api_keys WHERE user_id='${userId}'::uuid AND label='${label}'`,false)
  const remaining = await query(`SELECT (SELECT count(*) FROM public.customer_api_keys WHERE user_id='${userId}'::uuid AND label='${label}') AS keys,(SELECT count(*) FROM public.customer_api_capability_nonces WHERE key_id='${keyId || '00000000-0000-0000-0000-000000000000'}'::uuid) AS nonces`)
  cleanupDone = Number(remaining[0]?.keys) === 0 && Number(remaining[0]?.nonces) === 0
  report.cleanup = cleanupDone
  rawKey = undefined
}
for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => { cleanup().finally(() => process.exit(1)) })
const forbidden = new Set(['api_key','key_hash','provider_product_id','muabanvia_product_id','shopclone_product_id','shopviaclone_product_id','supplier_fallback_ready','supplier_fallback_blocked','account_details','password','username','email_password'])
function noPrivateFields(value) {
  if (Array.isArray(value)) return value.every(noPrivateFields)
  if (value && typeof value==='object') return Object.entries(value).every(([key,item])=>!forbidden.has(key)&&noPrivateFields(item))
  return true
}
async function get(path, parameters) {
  const url = new URL(`https://${ref}.supabase.co/functions/v1/customer-api/v1/${path}`)
  for (const [name,value] of Object.entries(parameters)) url.searchParams.set(name,String(value))
  const response = await fetch(url,{ method:'GET',headers:{Authorization:`Bearer ${rawKey}`},signal:AbortSignal.timeout(30000) })
  const body = await response.json()
  assert.equal(noPrivateFields(body),true,'Private field found in read response')
  assert.equal(JSON.stringify(body).includes(rawKey),false,'Key leaked in response')
  return {status:response.status,body}
}
async function moneySnapshot() {
  const rows = await query(`SELECT public.wallet_financial_truth_internal('${userId}'::uuid) AS wallet,(SELECT count(*) FROM public.orders o WHERE o.user_id='${userId}'::uuid) AS orders`)
  return rows[0]
}
try {
  const profiles = await query(`SELECT p.id,p.is_admin,p.is_staff,p.account_suspended,
    NOT EXISTS(SELECT 1 FROM public.customer_api_access a WHERE a.user_id=p.id AND (a.is_active IS DISTINCT FROM true OR NOT ('products'=ANY(a.allowed_sections)))) AS products_allowed
    FROM public.profiles p WHERE lower(p.email)='${ownerEmail}' LIMIT 2`)
  if (profiles.length!==1 || profiles[0].is_admin===true || profiles[0].is_staff===true || profiles[0].account_suspended===true || profiles[0].products_allowed!==true || !uuid.test(profiles[0].id)) {
    report.code='OWNER_CUSTOMER_INELIGIBLE'
  } else {
    userId=profiles[0].id
    phase='stale_cleanup'
    // Remove only this reserved internal label for this explicitly owned user.
    await cleanup()
    cleanupDone=false; report.cleanup=false
    phase='baseline'
    const before=await moneySnapshot()
    phase='temporary_key'
    keyId=randomUUID()
    const secret=randomBytes(32).toString('hex')
    rawKey=`tlyc_products_${secret}`
    const hash=createHash('sha256').update(rawKey).digest('hex')
    const prefix=`tlyc_products_${secret.slice(0,8)}`
    await query(`INSERT INTO public.customer_api_keys(id,user_id,section,label,key_hash,key_prefix) VALUES('${keyId}'::uuid,'${userId}'::uuid,'products','${label}','${hash}','${prefix}')`,false)
    phase='catalogue'
    const catalog=await get('catalogue',{section:'products'})
    report.checks.catalogue={status:catalog.status,success:catalog.body.success===true,count:Array.isArray(catalog.body.data)?catalog.body.data.length:0}
    assert.equal(catalog.status,200); assert.equal(catalog.body.success,true); assert.ok(Array.isArray(catalog.body.data))
    const product=catalog.body.data.find(item=>item.available===true&&uuid.test(item.id)&&Number.isFinite(Number(item.price_ngn))&&Number(item.price_ngn)>0)
    assert.ok(product,'No available product for read quote')
    phase='quote'
    const quote=await get('quote',{section:'products',product_group_id:product.id,quantity:1})
    report.checks.quote={status:quote.status,success:quote.body.success===true,positiveAmount:Number(quote.body.data?.expected_amount_ngn)>0}
    assert.equal(quote.status,200); assert.equal(quote.body.success,true); assert.ok(Number(quote.body.data.expected_amount_ngn)>0)
    phase='wallet'
    const wallet=await get('wallet',{section:'products'})
    report.checks.wallet={status:wallet.status,success:wallet.body.success===true,finiteBalance:Number.isFinite(Number(wallet.body.data?.spendable_ngn))}
    assert.equal(wallet.status,200); assert.equal(wallet.body.success,true)
    phase='orders'
    const orders=await get('orders',{section:'products'})
    report.checks.orders={status:orders.status,success:orders.body.success===true,count:Array.isArray(orders.body.data)?orders.body.data.length:0}
    assert.equal(orders.status,200); assert.equal(orders.body.success,true)
    phase='cross_section'
    const sms=await get('catalogue',{section:'sms'})
    report.checks.crossSection={status:sms.status,denied:sms.status===401&&sms.body.success===false}
    assert.equal(sms.status,401); assert.equal(sms.body.success,false)
    phase='financial_comparison'
    const after=await moneySnapshot()
    report.moneyStateUnchanged=JSON.stringify(before)===JSON.stringify(after)
    assert.equal(report.moneyStateUnchanged,true,'Concurrent financial state change requires review')
    report.success=true
  }
} catch {
  report.code='READ_VERIFICATION_FAILED'; report.phase=phase
} finally {
  try { await cleanup() } catch { report.cleanup=false; report.code='CLEANUP_RETRY_REQUIRED'; report.success=false }
}
console.log(JSON.stringify(report))
if (!report.success) process.exitCode=1
