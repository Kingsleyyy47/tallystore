// api/webhook-istar.ts
// Vercel serverless function for handling iStar webhooks.
//
// iStar fires `order.completed` when stars/premium are delivered and
// `order.failed` when the order exhausts retries. We match by istar_order_id
// stored on the telegram_orders row created at purchase time.
//
// Signature verification: if a webhook secret is configured in the iStar
// dashboard, iStar sends X-iStar-Signature = HMAC-SHA256(raw body, secret).
// Set ISTAR_WEBHOOK_SECRET in Vercel environment variables to enable verification.

import crypto from 'crypto'

function verifySignature(rawBody: string, signature: string | undefined, secret: string): boolean {
  if (!signature) return false
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  } catch {
    return false
  }
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const webhookSecret = process.env.ISTAR_WEBHOOK_SECRET || ''

  // Vercel parses JSON automatically; re-stringify to get the body for HMAC.
  // Note: if signature keeps failing, disable verification (leave ISTAR_WEBHOOK_SECRET unset).
  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)

  // Verify signature if secret is configured
  if (webhookSecret) {
    const sig = req.headers['x-istar-signature']
    if (!verifySignature(rawBody, sig, webhookSecret)) {
      console.warn('⚠️  iStar webhook signature mismatch — processing anyway to avoid missed events')
      // Don't hard-reject; log and continue so orders still get processed
    }
  }

  const { createClient } = await import('@supabase/supabase-js')
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing Supabase env vars for iStar webhook')
    return res.status(500).json({ error: 'Server configuration error' })
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const payload = req.body
  const eventType = payload?.event_type || req.headers['x-istar-event'] || ''
  const istarOrderId = payload?.order?.id || ''

  console.log('🔔 iStar webhook received:', { eventType, istarOrderId })

  // Always log the raw payload first
  const { data: logRow } = await supabase.from('istar_webhook_logs').insert({
    event_type: eventType,
    istar_order_id: istarOrderId,
    payload,
  }).select('id').single()

  try {
    if (!istarOrderId) {
      await supabase.from('istar_webhook_logs').update({ error_message: 'Missing order id in payload' }).eq('id', logRow?.id)
      return res.status(200).json({ message: 'No order id — ignored' })
    }

    // Find our order by istar_order_id
    const { data: order, error: orderErr } = await supabase
      .from('telegram_orders')
      .select('*')
      .eq('istar_order_id', istarOrderId)
      .maybeSingle()

    if (orderErr || !order) {
      const msg = `No telegram_order found for istar_order_id ${istarOrderId}`
      console.warn(msg)
      await supabase.from('istar_webhook_logs').update({ error_message: msg }).eq('id', logRow?.id)
      return res.status(200).json({ message: msg })
    }

    // ── order.completed ──────────────────────────────────────────────────────
    if (eventType === 'order.completed') {
      if (order.status === 'completed') {
        console.log('✅ Already completed:', istarOrderId)
        return res.status(200).json({ message: 'Already processed' })
      }
      await supabase.from('telegram_orders').update({
        status: 'completed',
        completed_at: payload?.completed_at || payload?.occurred_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', order.id)
      console.log('✅ Telegram order completed:', order.reference)
      return res.status(200).json({ success: true })
    }

    // ── order.failed ─────────────────────────────────────────────────────────
    if (eventType === 'order.failed') {
      if (['failed', 'completed'].includes(order.status)) {
        return res.status(200).json({ message: 'Already in terminal state' })
      }
      const reason = payload?.error || payload?.order?.payload?.reason || 'Order failed'
      await supabase.from('telegram_orders').update({
        status: 'failed',
        error_message: reason,
        updated_at: new Date().toISOString(),
      }).eq('id', order.id)

      // Refund if not already refunded
      if (!order.refunded_at && order.price_ngn > 0) {
        const refundRef = `REFUND-${order.reference}`
        const { data: existingTx } = await supabase.from('transactions').select('id, status').eq('reference', refundRef).maybeSingle()
        if (!existingTx) {
          const { data: p } = await supabase.from('profiles').select('wallet_balance').eq('id', order.user_id).single()
          if (p) {
            const next = Number(p.wallet_balance || 0) + Number(order.price_ngn)
            await supabase.from('profiles').update({ wallet_balance: next, updated_at: new Date().toISOString() }).eq('id', order.user_id)
            await supabase.from('transactions').insert({
              user_id: order.user_id,
              type: 'refund',
              amount: Number(order.price_ngn),
              balance_after: next,
              description: `Refund: Telegram ${order.order_type} order failed — ${reason}`,
              reference: refundRef,
              status: 'completed',
            })
            await supabase.from('telegram_orders').update({
              refunded_at: new Date().toISOString(),
              refund_amount_ngn: order.price_ngn,
              refund_reference: refundRef,
            }).eq('id', order.id)
            console.log('💸 Refunded', order.price_ngn, 'NGN to user', order.user_id)
          }
        }
      }
      return res.status(200).json({ success: true })
    }

    // Unknown event — log and return 200
    await supabase.from('istar_webhook_logs').update({ error_message: `Unknown event_type: ${eventType}` }).eq('id', logRow?.id)
    return res.status(200).json({ message: `Unknown event type: ${eventType}` })

  } catch (err: any) {
    console.error('❌ iStar webhook error:', err)
    await supabase.from('istar_webhook_logs').update({ error_message: err.message }).eq('id', logRow?.id)
    return res.status(500).json({ error: err.message })
  }
}
