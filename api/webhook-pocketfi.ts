// api/webhook-pocketfi.ts
// Tallystore-domain bridge for PocketFi webhooks.
//
// The real wallet-crediting logic lives in the Supabase Edge Function:
//   webhook-pocketfi
//
// Keep this Vercel route as a thin proxy so PocketFi can use
// https://tallystore.org/api/webhook-pocketfi without drifting from the
// hardened Supabase implementation.

const SUPABASE_PROJECT_URL = 'https://dssvvswvqnxanyzfhixf.supabase.co'
const POCKETFI_EDGE_URL = `${SUPABASE_PROJECT_URL}/functions/v1/webhook-pocketfi`

function pickWebhookSecret() {
  return (
    process.env.POCKETFI_WEBHOOK_SECRET ||
    process.env.POCKETFI_SECRET_KEY ||
    process.env.POCKETFI_SECRET_API_KEY ||
    process.env.VITE_POCKETFI_SECRET_KEY ||
    ''
  )
}

function copyHeader(req: any, name: string) {
  const value = req.headers?.[name] || req.headers?.[name.toLowerCase()]
  return Array.isArray(value) ? value[0] : value
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {})
  const secret = pickWebhookSecret()
  const requestUrl = new URL(req.url || '/api/webhook-pocketfi', 'https://tallystore.org')
  const upstreamUrl = `${POCKETFI_EDGE_URL}${requestUrl.search}`

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': copyHeader(req, 'content-type') || 'application/json',
  }

  for (const name of [
    'authorization',
    'pocketfi-signature',
    'http_pocketfi_signature',
    'x-pocketfi-signature',
    'x-webhook-signature',
    'x-pocketfi-webhook-secret',
    'x-webhook-secret',
  ]) {
    const value = copyHeader(req, name)
    if (value) headers[name] = String(value)
  }

  if (secret && !headers.authorization && !headers['x-pocketfi-webhook-secret']) {
    headers['x-pocketfi-webhook-secret'] = secret
  }

  try {
    const upstream = await fetch(upstreamUrl, {
      method: 'POST',
      headers,
      body,
    })
    const text = await upstream.text()

    res.status(upstream.status)
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
    return res.send(text)
  } catch (error) {
    console.error('PocketFi webhook bridge failed:', error instanceof Error ? error.message : 'Unknown error')
    return res.status(502).json({
      error: 'PocketFi webhook bridge failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}
