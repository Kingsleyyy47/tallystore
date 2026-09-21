export default async function handler(_req: any, res: any) {
  return res.status(410).json({
    error: 'This legacy webhook is disabled. Use the hardened Supabase payment verification flow.',
  })
}
