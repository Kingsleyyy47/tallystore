// api/partner-api.ts
// TallyStore-domain bridge for private partner API access.
//
// Trusted partners can call:
//   https://tallystore.org/api/partner-api
//
// The real logic stays in the Supabase Edge Function:
//   partner-api

const SUPABASE_PROJECT_URL = 'https://dssvvswvqnxanyzfhixf.supabase.co'
const PARTNER_EDGE_URL = `${SUPABASE_PROJECT_URL}/functions/v1/partner-api`

function copyHeader(req: any, name: string) {
  const value = req.headers?.[name] || req.headers?.[name.toLowerCase()]
  return Array.isArray(value) ? value[0] : value
}

export default async function handler(req: any, res: any) {
  if (!['GET', 'POST', 'OPTIONS'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type, x-tally-api-key, x-api-key')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    return res.status(204).end()
  }

  const requestUrl = new URL(req.url || '/api/partner-api', 'https://tallystore.org')
  const upstreamUrl = `${PARTNER_EDGE_URL}${requestUrl.search}`
  const body = req.method === 'GET'
    ? undefined
    : typeof req.body === 'string'
      ? req.body
      : JSON.stringify(req.body || {})

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': copyHeader(req, 'content-type') || 'application/json',
  }

  for (const name of ['authorization', 'x-tally-api-key', 'x-api-key', 'x-client-info', 'apikey']) {
    const value = copyHeader(req, name)
    if (value) headers[name] = String(value)
  }

  try {
    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body,
    })
    const text = await upstream.text()

    res.status(upstream.status)
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
    return res.send(text)
  } catch (error) {
    console.error('Partner API bridge failed:', error instanceof Error ? error.message : 'Unknown error')
    return res.status(502).json({
      success: false,
      error: 'Partner API bridge failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}
