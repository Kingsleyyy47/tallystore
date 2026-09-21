import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  return res.status(410).json({
    error: 'This legacy webhook is disabled. Use the hardened Supabase payment verification flow.',
  })
}
