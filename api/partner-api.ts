// api/partner-api.ts
// Public partner API bridge intentionally closed during wallet security review.

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

  return res.status(503).json({
    success: false,
    error: 'Partner API is temporarily paused while TallyStore completes a wallet security review.',
    code: 'PARTNER_API_PAUSED',
  })
}
