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

export const config = {
  api: {
    bodyParser: false,
  },
}

async function readRawBody(req: any): Promise<string> {
  if (typeof req.body === 'string') return req.body
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8')

  const chunks: Buffer[] = []
  try {
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
  } catch {
    // Some serverless adapters still provide a parsed body instead of a stream.
  }

  if (chunks.length > 0) return Buffer.concat(chunks).toString('utf8')
  return ''
}

function parsePayload(rawBody: string): Record<string, any> | null {
  try {
    const payload = JSON.parse(rawBody)
    return payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload
      : null
  } catch {
    return null
  }
}

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
  if (!webhookSecret) {
    console.error('Missing ISTAR_WEBHOOK_SECRET')
    return res.status(503).json({ error: 'Webhook is not configured' })
  }

  const rawBody = await readRawBody(req)

  const sig = req.headers['x-istar-signature']
  if (!verifySignature(rawBody, sig, webhookSecret)) {
    console.warn('iStar webhook signature mismatch')
    return res.status(401).json({ error: 'Invalid webhook signature' })
  }

  const payload = parsePayload(rawBody)
  if (!payload || !['order.completed', 'order.failed'].includes(payload.event_type)) {
    return res.status(400).json({ error: 'Invalid signed webhook event' })
  }

  const { createClient } = await import('@supabase/supabase-js')
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing Supabase env vars for iStar webhook')
    return res.status(500).json({ error: 'Server configuration error' })
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const eventType = payload.event_type
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
      console.warn('iStar webhook order reference requires review')
      await supabase.from('istar_webhook_logs').update({ error_message: 'Order reference not matched' }).eq('id', logRow?.id)
      return res.status(200).json({ message: 'Order reference not matched' })
    }

    // ── order.completed ──────────────────────────────────────────────────────
    if (eventType === 'order.completed') {
      if (order.status === 'completed') {
        console.log('✅ Already completed:', istarOrderId)
        return res.status(200).json({ message: 'Already processed' })
      }
      if (order.status === 'failed' || order.refunded_at) {
        return res.status(200).json({ message: 'Terminal order needs manual review' })
      }
      const { data: completedOrder, error: completionError } = await supabase.from('telegram_orders').update({
        status: 'completed',
        completed_at: payload?.completed_at || payload?.occurred_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', order.id)
        .in('status', ['pending', 'processing'])
        .is('refunded_at', null)
        .select('id').maybeSingle()
      if (completionError) throw new Error('Could not record completed order')
      if (!completedOrder) return res.status(200).json({ message: 'Order changed; manual review required' })
      console.log('✅ Telegram order completed:', order.reference)
      return res.status(200).json({ success: true })
    }

    // ── order.failed ─────────────────────────────────────────────────────────
    if (eventType === 'order.failed') {
      if (order.status === 'completed' || order.refunded_at) {
        return res.status(200).json({ message: 'Already in terminal state' })
      }
      if (order.status === 'failed' && order.error_message !== 'Supplier confirmed order failure') {
        return res.status(200).json({ message: 'Failed order needs manual review' })
      }
      if (order.status !== 'failed') {
        const { data: failedOrder, error: statusError } = await supabase.from('telegram_orders').update({
          status: 'failed',
          error_message: 'Supplier confirmed order failure',
          updated_at: new Date().toISOString(),
        }).eq('id', order.id)
          .in('status', ['pending', 'processing'])
          .is('refunded_at', null)
          .select('id').maybeSingle()
        if (statusError) throw new Error(`Order status update failed: ${statusError.message}`)
        if (!failedOrder) return res.status(200).json({ message: 'Order changed; manual review required' })
      }

      // A pending order can fail before its wallet debit. Refund only a
      // matching completed debit, using the same key as telegram-stars.
      if (Number(order.price_ngn) > 0) {
        const originalDebitKey = order.idempotency_key
          ? `telegram:purchase:${order.idempotency_key}`
          : `telegram:purchase:${order.reference}`
        const { data: debit, error: debitError } = await supabase.from('transactions')
          .select('id, amount, status, type')
          .eq('user_id', order.user_id)
          .eq('idempotency_key', originalDebitKey)
          .maybeSingle()
        if (debitError) throw new Error(`Debit lookup failed: ${debitError.message}`)
        if (!debit || debit.type !== 'purchase' || debit.status !== 'completed' ||
            Math.round(Math.abs(Number(debit.amount)) * 100) !== Math.round(Number(order.price_ngn) * 100)) {
          await supabase.from('istar_webhook_logs').update({ error_message: 'No matching completed wallet debit; refund held for review' }).eq('id', logRow?.id)
          return res.status(200).json({ message: 'Refund held for review' })
        }
        const refundRef = `REFUND-${order.reference}`
        const { data: refundResult, error: refundError } = await supabase.rpc('apply_wallet_transaction', {
          p_user_id: order.user_id,
          p_type: 'refund',
          p_amount: Number(order.price_ngn),
          p_reference: refundRef,
          p_description: `Refund: Telegram ${order.order_type} order failed`,
          p_idempotency_key: `telegram:refund:${order.id}`,
          p_metadata: {
            source: 'webhook-istar',
            source_order_id: order.id,
            source_order_table: 'telegram_orders',
            order_id: order.id,
            original_reference: order.reference,
            source_debit_idempotency_key: originalDebitKey,
            original_purchase_idempotency_key: originalDebitKey,
          },
          p_currency: 'NGN',
          p_balance_type: 'wallet',
          p_external_payment_id: null,
          p_created_by: null,
        })
        if (refundError || !refundResult?.success) {
          throw new Error(`Refund failed: ${refundError?.message || refundResult?.error || 'unknown error'}`)
        }
        const { error: orderError } = await supabase.from('telegram_orders').update({
          refunded_at: new Date().toISOString(),
          refund_amount_ngn: order.price_ngn,
          refund_reference: refundRef,
        }).eq('id', order.id)
        if (orderError) throw new Error(`Refund recorded but order update failed: ${orderError.message}`)
        console.log('💸 Refunded', order.price_ngn, 'NGN to user', order.user_id)
      }
      return res.status(200).json({ success: true })
    }

    // Unknown event — log and return 200
    await supabase.from('istar_webhook_logs').update({ error_message: 'Unsupported event type' }).eq('id', logRow?.id)
    return res.status(200).json({ message: 'Unsupported event type' })

  } catch {
    console.error('iStar webhook processing failed')
    await supabase.from('istar_webhook_logs').update({ error_message: 'Webhook processing failed' }).eq('id', logRow?.id)
    return res.status(500).json({ error: 'Webhook processing failed' })
  }
}
