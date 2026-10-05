import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'
import { configuredSuppliers } from '../_shared/supplier-purchase.mjs'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}
function matchesSecret(candidate: string | null, expected: string | undefined) {
  if (!candidate || !expected || candidate.length !== expected.length) return false
  let difference = 0
  for (let i = 0; i < expected.length; i++) difference |= candidate.charCodeAt(i) ^ expected.charCodeAt(i)
  return difference === 0
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ success: false, code: 'METHOD_NOT_ALLOWED' }, 405)
  try {
    const cron = matchesSecret(req.headers.get('x-cron-secret'), Deno.env.get('SUPPLIER_CATALOG_SECRET'))
    const admin = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '', { auth: { persistSession: false } })
    let owner = false
    if (!cron) {
      const authorization = req.headers.get('Authorization') || ''
      const ownerId = Deno.env.get('TALLYSTORE_OWNER_USER_ID')?.trim()
      if (!ownerId || !authorization.startsWith('Bearer ')) return json({ success: false, code: 'UNAUTHORIZED' }, 401)
      const client = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_ANON_KEY') || '', { auth: { persistSession: false }, global: { headers: { Authorization: authorization } } })
      const { data: { user }, error } = await client.auth.getUser(authorization.slice(7))
      if (error || !user || user.id !== ownerId) return json({ success: false, code: 'OWNER_ACCESS_REQUIRED' }, 403)
      const { data: profile, error: profileError } = await admin.from('profiles').select('is_admin, account_suspended').eq('id', user.id).single()
      if (profileError || profile?.is_admin !== true || profile.account_suspended === true) return json({ success: false, code: 'OWNER_ACCESS_REQUIRED' }, 403)
      owner = true
    }
    const rawBody = await req.text()
    if (rawBody.length > 8192) return json({ success: false, code: 'REQUEST_TOO_LARGE' }, 413)
    let body: Record<string, unknown>
    try { body = rawBody.trim() ? JSON.parse(rawBody) : {} } catch { return json({ success: false, code: 'INVALID_REQUEST' }, 400) }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ success: false, code: 'INVALID_REQUEST' }, 400)
    const action = body.action ?? 'refresh'
    if (action !== 'refresh' && action !== 'reset_fallback') return json({ success: false, code: 'INVALID_ACTION' }, 400)
    const counts = { processed: 0, ready: 0, paused: 0, updated: 0, failed: 0 }
    const liveEnabled = Deno.env.get('LIVE_ACCOUNT_FULFILLMENT_ENABLED') === 'true'
    async function refresh(product: { id: string; auto_fulfill_enabled: boolean }) {
      const enabled = liveEnabled && configuredSuppliers(product, (key: string) => Deno.env.get(key)).length > 0
      const { data, error } = await admin.rpc('refresh_supplier_product_availability', { p_product_group_id: product.id, p_fallback_enabled: enabled })
      counts.processed++
      if (error || data?.success !== true) { counts.failed++; return }
      if (data.updated === true) counts.updated++
      if (data.supplier_fallback_enabled === true) counts.ready++
      if (data.availability_status === 'PAUSED') counts.paused++
    }
    const columns = 'id, auto_fulfill_enabled, muabanvia_product_id, shopclone_product_id, shopviaclone_product_id'
    if (action === 'reset_fallback') {
      if (!owner) return json({ success: false, code: 'OWNER_ACCESS_REQUIRED' }, 403)
      const productId = typeof body.product_group_id === 'string' ? body.product_group_id : ''
      if (!UUID.test(productId)) return json({ success: false, code: 'INVALID_PRODUCT' }, 400)
      const { data: reset, error: resetError } = await admin.rpc('reset_supplier_product_fallback', { p_product_group_id: productId })
      if (resetError) return json({ success: false, code: 'RESET_UNAVAILABLE' }, 503)
      if (reset?.success !== true) {
        const missing = reset?.code === 'PRODUCT_NOT_FOUND'
        return json({ success: false, code: missing ? 'PRODUCT_NOT_FOUND' : 'SUPPLIER_RECONCILIATION_PENDING' }, missing ? 404 : 409)
      }
      const { data: product, error: productError } = await admin.from('product_groups').select(columns).eq('id', productId).single()
      if (productError || !product) return json({ success: false, code: 'CATALOG_REFRESH_UNAVAILABLE' }, 503)
      await refresh(product)
      return json({ success: counts.failed === 0, reset: 1, ...counts }, counts.failed ? 503 : 200)
    }
    let lastId: string | null = null
    // Cursor paging avoids the PostgREST row cap and keeps all catalog mutations
    // bounded to one product at a time. No supplier purchase endpoint is called.
    while (true) {
      let query = admin.from('product_groups').select(columns).eq('is_active', true).order('id').limit(250)
      if (lastId) query = query.gt('id', lastId)
      const { data: products, error } = await query
      if (error || !Array.isArray(products)) return json({ success: false, code: 'CATALOG_REFRESH_UNAVAILABLE', ...counts }, 503)
      for (const product of products) await refresh(product)
      if (products.length < 250) break
      lastId = products[products.length - 1].id
    }
    return json({ success: counts.failed === 0, ...counts }, counts.failed ? 503 : 200)
  } catch {
    console.error('Supplier catalog maintenance failed')
    return json({ success: false, code: 'CATALOG_REFRESH_UNAVAILABLE' }, 503)
  }
})
