import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function cleanText(value: unknown, max = 500) {
  return Array.from(String(value || '')).filter((char) => {
    const code = char.charCodeAt(0)
    return code >= 32 && code !== 127
  }).join('').trim().slice(0, max)
}

function cleanGeoText(value: unknown, max = 120) {
  const cleaned = cleanText(value, max)
  return cleaned || null
}

function cleanPath(value: unknown) {
  const path = cleanText(value, 500) || '/'
  if (!path.startsWith('/')) return '/'
  return path
}

function cleanTrafficQuality(value: unknown) {
  const next = cleanText(value, 20).toLowerCase()
  return ['human', 'suspect', 'bot', 'internal'].includes(next) ? next : 'human'
}

function cleanIp(value: string | null) {
  if (!value) return null
  const first = value.split(',')[0]?.trim() || ''
  const withoutPort = first.includes('.') ? first.replace(/:\d+$/, '') : first
  const cleaned = withoutPort.replace(/[^a-fA-F0-9:.[\]]/g, '').replace(/^\[|\]$/g, '')
  if (!cleaned || cleaned.length > 80) return null
  return cleaned
}

function getRequestIp(req: Request) {
  return cleanIp(
    req.headers.get('cf-connecting-ip') ||
      req.headers.get('x-real-ip') ||
      req.headers.get('x-forwarded-for') ||
      req.headers.get('forwarded')?.match(/for="?([^";,]+)"?/i)?.[1] ||
      null,
  )
}

function isPrivateIp(ipAddress: string | null) {
  if (!ipAddress) return true
  const ip = ipAddress.toLowerCase()
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    ip.startsWith('fc') ||
    ip.startsWith('fd') ||
    ip.startsWith('fe80:')
  )
}

function getHeaderGeo(req: Request) {
  const countryCode = cleanGeoText(
    req.headers.get('x-vercel-ip-country') ||
      req.headers.get('cf-ipcountry') ||
      req.headers.get('x-country-code'),
    2,
  )?.toUpperCase() || null
  const region = cleanGeoText(
    req.headers.get('x-vercel-ip-country-region') ||
      req.headers.get('x-region') ||
      req.headers.get('x-region-code'),
  )
  const city = cleanGeoText(req.headers.get('x-vercel-ip-city') || req.headers.get('x-city'))

  if (!countryCode && !region && !city) return null
  return {
    ip_country_code: countryCode,
    ip_country: null,
    ip_region: region,
    ip_city: city,
    ip_timezone: null,
    ip_isp: null,
    ip_asn: null,
    ip_geo_source: 'headers',
  }
}

async function lookupIpGeo(ipAddress: string | null) {
  if (!ipAddress || isPrivateIp(ipAddress)) return null

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1200)

  try {
    const response = await fetch(
      `https://ipwho.is/${encodeURIComponent(ipAddress)}?fields=success,message,country,country_code,region,city,timezone,connection`,
      { signal: controller.signal },
    )
    if (!response.ok) return null

    const data = await response.json().catch(() => null) as any
    if (!data || data.success === false) return null

    const timezone = typeof data.timezone === 'string' ? data.timezone : data.timezone?.id
    const connection = data.connection && typeof data.connection === 'object' ? data.connection : {}

    return {
      ip_country_code: cleanGeoText(data.country_code, 2)?.toUpperCase() || null,
      ip_country: cleanGeoText(data.country),
      ip_region: cleanGeoText(data.region),
      ip_city: cleanGeoText(data.city),
      ip_timezone: cleanGeoText(timezone),
      ip_isp: cleanGeoText(connection.isp || connection.org, 180),
      ip_asn: connection.asn ? cleanGeoText(String(connection.asn), 40) : null,
      ip_geo_source: 'ipwho.is',
    }
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

function cleanAttribution(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const source = value as Record<string, unknown>
  const output: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(source).slice(0, 30)) {
    const cleanKey = cleanText(key, 60).replace(/[^a-zA-Z0-9_.-]/g, '')
    if (!cleanKey) continue
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      output[cleanKey] = typeof raw === 'string' ? cleanText(raw, 180) : raw
    }
  }
  return output
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405)

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) throw new Error('Supabase environment is not configured')

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const body = await req.json().catch(() => ({}))
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    let userId: string | null = null

    if (token) {
      const { data } = await admin.auth.getUser(token)
      userId = data?.user?.id || null
    }

    const ipAddress = getRequestIp(req)
    const headerGeo = getHeaderGeo(req)
    const lookupGeo = headerGeo?.ip_city && headerGeo?.ip_region ? null : await lookupIpGeo(ipAddress)
    const geo = lookupGeo || headerGeo || {}
    const { error } = await admin
      .from('site_visits')
      .insert({
        visitor_id: cleanText(body.visitor_id || body.visitorId, 160) || `anonymous:${crypto.randomUUID()}`,
        user_id: userId,
        path: cleanPath(body.path),
        user_agent: cleanText(body.user_agent || body.userAgent || req.headers.get('user-agent'), 500),
        attribution: cleanAttribution(body.attribution),
        traffic_quality: cleanTrafficQuality(body.traffic_quality || body.trafficQuality),
        ip_address: ipAddress,
        ip_source: ipAddress ? 'edge' : 'unknown',
        ...geo,
      })

    if (error) throw new Error(error.message)

    return json({ success: true, ip_captured: Boolean(ipAddress) })
  } catch (error) {
    console.error('record-site-visit failed:', error)
    return json({ success: false, error: error instanceof Error ? error.message : 'Failed to record visit' }, 400)
  }
})
