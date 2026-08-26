// revenue-os-loop/index.ts
// Scheduled Supabase Edge Function — runs every hour via pg_cron or Supabase scheduler.
// Responsibilities:
//   1. Close attribution windows (24h, 7d, 30d)
//   2. Aggregate strategy stats from closed outcomes
//   3. Auto-promote / auto-rollback strategies based on evidence
//   4. Detect revenue opportunities and persist them
//   5. Log each run to cro_attribution_closures

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL    = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

// ── Attribution windows to close ──────────────────────────────────────────────
const WINDOWS_H = [24, 168, 720] // 24h, 7d, 30d

// ── Normal CDF approximation (Abramowitz & Stegun) ───────────────────────────
function normalCdf(z: number): number {
  if (z < 0) return 1 - normalCdf(-z)
  const t    = 1 / (1 + 0.2316419 * z)
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  return 1 - (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * z * z) * poly
}

function calcLift(tViewed: number, tPurchases: number, cViewed: number, cPurchases: number) {
  const tCvr = tViewed > 0 ? tPurchases / tViewed : 0
  const cCvr = cViewed  > 0 ? cPurchases / cViewed  : 0
  let confidence = 0
  if (tViewed >= 30 && cViewed >= 30) {
    const pooled = (tPurchases + cPurchases) / (tViewed + cViewed)
    const se = Math.sqrt(pooled * (1 - pooled) * (1 / tViewed + 1 / cViewed))
    if (se > 0) confidence = normalCdf(Math.abs((tCvr - cCvr) / se))
  }
  return { upliftPp: (tCvr - cCvr) * 100, confidence }
}

function evaluateLearningState(s: {
  totalViewed: number; upliftPp: number; confidence: number
  guardrailsHealthy: boolean; autoRolledBackAt?: string | null
}): string {
  if (s.autoRolledBackAt)                                                     return 'RETIRED'
  if (!s.guardrailsHealthy && s.confidence >= 0.75)                           return 'HARMFUL'
  if (s.upliftPp < -1 && s.confidence >= 0.85 && s.totalViewed >= 500)       return 'HARMFUL'
  if (s.totalViewed < 50)                                                     return 'NEW'
  if (s.totalViewed < 300)                                                    return 'EXPLORING'
  if (s.upliftPp > 0.5 && s.confidence >= 0.90 && s.totalViewed >= 1000
    && s.guardrailsHealthy)                                                   return 'PROVEN'
  if (s.upliftPp > 0 && s.confidence >= 0.60 && s.totalViewed >= 300)        return 'PROMISING'
  return 'EXPLORING'
}

function evaluatePromotion(s: {
  learningState: string; totalViewed: number; upliftPp: number
  confidence: number; guardrailsHealthy: boolean
}): { action: string; reason: string; newState: string } {
  if (!s.guardrailsHealthy && s.confidence >= 0.75)
    return { action: 'rollback', reason: 'guardrails_breach_confirmed', newState: 'HARMFUL' }
  if (s.upliftPp < -2 && s.confidence >= 0.90 && s.totalViewed >= 500)
    return { action: 'rollback', reason: 'negative_revenue_uplift_confirmed', newState: 'HARMFUL' }
  if (s.learningState === 'PROVEN' && s.upliftPp > 1.0 && s.confidence >= 0.95
    && s.totalViewed >= 1000 && s.guardrailsHealthy)
    return { action: 'promote', reason: 'strong_positive_evidence', newState: 'PROVEN' }
  if (s.totalViewed < 100)
    return { action: 'insufficient_data', reason: 'not_enough_observations', newState: s.learningState }
  return { action: 'keep_running', reason: 'evidence_accumulating', newState: s.learningState }
}

// ── 1. Close attribution windows ──────────────────────────────────────────────
async function closeAttributionWindows(windowH: number): Promise<{ evaluated: number; written: number; errors: number }> {
  const cutoff   = new Date(Date.now() - windowH * 3600 * 1000).toISOString()
  let evaluated  = 0
  let written    = 0
  let errors     = 0

  // Find pending interventions older than the window
  const { data: pending, error: fetchErr } = await supabase
    .from('cro_interventions')
    .select('id, visitor_id, customer_id, viewed_at, buy_clicked_at, outcome')
    .eq('outcome', 'pending')
    .lt('rendered_at', cutoff)
    .limit(500)

  if (fetchErr) {
    console.error('[loop] fetch pending:', fetchErr.message)
    return { evaluated: 0, written: 0, errors: 1 }
  }
  if (!pending?.length) return { evaluated: 0, written: 0, errors: 0 }

  for (const intervention of pending) {
    evaluated++
    try {
      // Check if this visitor / customer purchased anything after the intervention
      let purchased = false
      let orderId: string | null = null
      let revenueNgn = 0

      if (intervention.customer_id) {
        // Check telegram_orders (covers both stars & premium)
        const { data: orders } = await supabase
          .from('telegram_orders')
          .select('id, price_ngn, created_at')
          .eq('user_id', intervention.customer_id)
          .eq('status', 'completed')
          .gt('created_at', intervention.viewed_at || new Date(Date.now() - windowH * 3600 * 1000).toISOString())
          .order('created_at', { ascending: true })
          .limit(1)

        if (orders?.length) {
          purchased  = true
          orderId    = orders[0].id
          revenueNgn = Number(orders[0].price_ngn)
        }
      }

      const outcomeType    = purchased ? 'purchased' : 'ignored'
      const attributionType = purchased && intervention.buy_clicked_at ? 'direct' : purchased ? 'assisted' : 'none'

      // Write outcome row
      const { error: insertErr } = await supabase.from('cro_outcomes').insert({
        intervention_id:         intervention.id,
        order_id:                orderId,
        outcome_type:            outcomeType,
        revenue_ngn:             revenueNgn,
        attribution_type:        attributionType,
        window_h:                windowH,
        is_incremental_estimate: attributionType === 'assisted',
        confidence:              attributionType === 'direct' ? 0.9 : attributionType === 'assisted' ? 0.4 : 0,
      })
      if (insertErr) throw insertErr

      // Update intervention outcome
      await supabase.from('cro_interventions').update({
        outcome:              outcomeType,
        outcome_closed_at:    new Date().toISOString(),
        attributed_order_id:  orderId,
        attributed_at:        orderId ? new Date().toISOString() : null,
        attribution_type:     attributionType,
        attribution_window_h: windowH,
        updated_at:           new Date().toISOString(),
      }).eq('id', intervention.id)

      written++
    } catch (e: any) {
      console.error('[loop] outcome write error:', e?.message)
      errors++
    }
  }

  return { evaluated, written, errors }
}

// ── 2. Update strategy stats ──────────────────────────────────────────────────
async function updateStrategyStats(): Promise<void> {
  // Pull interventions WITH their closed outcomes (revenue) via left join via two queries
  const { data: rows, error } = await supabase
    .from('cro_interventions')
    .select('id, strategy_key, experiment_id, variant_id, viewed_at, clicked_at, dismissed_at, buy_clicked_at, outcome')
    .not('strategy_key', 'is', null)

  if (error || !rows?.length) return

  // Pull revenue per intervention from cro_outcomes
  const interventionIds = rows.map((r) => r.id)
  const { data: outcomeRows } = await supabase
    .from('cro_outcomes')
    .select('intervention_id, revenue_ngn, outcome_type')
    .in('intervention_id', interventionIds)

  const revenueByIntervention = new Map<string, number>()
  for (const o of (outcomeRows || [])) {
    if (o.outcome_type === 'purchased') {
      revenueByIntervention.set(o.intervention_id, (revenueByIntervention.get(o.intervention_id) || 0) + Number(o.revenue_ngn || 0))
    }
  }

  // Group by strategy_key
  const map = new Map<string, {
    strategyKey: string; experimentId: string | null; variantId: string | null
    rendered: number; viewed: number; clicked: number; dismissed: number
    purchases: number; revenueNgn: number
    controlRendered: number; controlPurchases: number; controlRevenueNgn: number
  }>()

  for (const r of rows) {
    const key = r.strategy_key as string
    if (!map.has(key)) {
      map.set(key, {
        strategyKey: key, experimentId: r.experiment_id || null, variantId: r.variant_id || null,
        rendered: 0, viewed: 0, clicked: 0, dismissed: 0, purchases: 0, revenueNgn: 0,
        controlRendered: 0, controlPurchases: 0, controlRevenueNgn: 0,
      })
    }
    const s = map.get(key)!
    s.rendered++
    if (r.viewed_at)     s.viewed++
    if (r.clicked_at)    s.clicked++
    if (r.dismissed_at)  s.dismissed++
    const rev = revenueByIntervention.get(r.id) || 0
    if (r.outcome === 'purchased') {
      s.purchases++
      s.revenueNgn += rev
    }
    if (r.variant_id === 'control') {
      s.controlRendered++
      if (r.outcome === 'purchased') {
        s.controlPurchases++
        s.controlRevenueNgn += rev
      }
    }
  }

  for (const [, s] of map) {
    const { upliftPp, confidence } = calcLift(s.viewed, s.purchases, s.controlRendered, s.controlPurchases)
    const tRpv = s.viewed > 0 ? s.revenueNgn / s.viewed : 0
    const cRpv = s.controlRendered > 0 ? s.controlRevenueNgn / s.controlRendered : 0
    const guardrailsHealthy = upliftPp > -5
    const learningState = evaluateLearningState({
      totalViewed: s.viewed, upliftPp, confidence, guardrailsHealthy,
    })

    await supabase.from('cro_strategy_stats').upsert({
      strategy_key:               s.strategyKey,
      action_type:                s.strategyKey.split(':')[0] || 'UNKNOWN',
      surface:                    s.strategyKey.split(':')[1] || 'all',
      context_key:                'all',
      learning_state:             learningState,
      total_rendered:             s.rendered,
      total_viewed:               s.viewed,
      total_clicked:              s.clicked,
      total_dismissed:            s.dismissed,
      total_purchases:            s.purchases,
      total_revenue_ngn:          s.revenueNgn,
      control_rendered:           s.controlRendered,
      control_purchases:          s.controlPurchases,
      control_revenue_ngn:        s.controlRevenueNgn,
      view_rate:                  s.rendered > 0 ? s.viewed / s.rendered : 0,
      click_rate:                 s.viewed   > 0 ? s.clicked / s.viewed  : 0,
      purchase_rate:              s.viewed   > 0 ? s.purchases / s.viewed : 0,
      control_purchase_rate:      s.controlRendered > 0 ? s.controlPurchases / s.controlRendered : 0,
      uplift_pp:                  upliftPp,
      uplift_revenue_per_visitor: tRpv - cRpv,
      confidence:                 confidence,
      guardrails_healthy:         guardrailsHealthy,
      experiment_key:             s.experimentId,
      last_evaluated_at:          new Date().toISOString(),
      updated_at:                 new Date().toISOString(),
    }, { onConflict: 'strategy_key' })
  }
}

// ── 3. Auto-promote / auto-rollback strategies ────────────────────────────────
async function evaluateStrategies(): Promise<void> {
  const { data: stats, error } = await supabase
    .from('cro_strategy_stats')
    .select('*')
    .in('learning_state', ['PROMISING', 'PROVEN', 'DECLINING', 'EXPLORING'])

  if (error || !stats?.length) return

  for (const s of stats) {
    const decision = evaluatePromotion({
      learningState:     s.learning_state,
      totalViewed:       s.total_viewed,
      upliftPp:          s.uplift_pp || 0,
      confidence:        s.confidence || 0,
      guardrailsHealthy: s.guardrails_healthy !== false,
    })

    if (decision.action === 'promote' || decision.action === 'rollback') {
      const now = new Date().toISOString()
      const patch: Record<string, unknown> = {
        learning_state: decision.newState,
        updated_at:     now,
      }
      if (decision.action === 'promote') patch.auto_promoted_at   = now
      if (decision.action === 'rollback') {
        patch.auto_rolled_back_at = now
        patch.rollback_reason     = decision.reason
      }

      await supabase.from('cro_strategy_stats').update(patch).eq('strategy_key', s.strategy_key)

      // Write a version record
      const nextVersion = (s.current_version || 1) + 1
      await supabase.from('cro_strategy_versions').insert({
        strategy_key:    s.strategy_key,
        version:         nextVersion,
        status:          decision.action === 'promote' ? 'LIVE' : 'ROLLED_BACK',
        config:          {},
        evidence:        {
          uplift_pp:     s.uplift_pp,
          confidence:    s.confidence,
          total_viewed:  s.total_viewed,
          reason:        decision.reason,
        },
        promoted_at:     decision.action === 'promote'   ? now : null,
        rolled_back_at:  decision.action === 'rollback'  ? now : null,
        rollback_reason: decision.action === 'rollback'  ? decision.reason : null,
      }).onConflict ? undefined : undefined // insert only, ignore conflict
    }
  }
}

// ── 3b. Update product_relationship_stats from purchase sequences ─────────────
async function updatePurchaseSequences(): Promise<void> {
  // Look at all completed telegram_orders in the last 30 days
  const since30d = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()

  const { data: orders, error } = await supabase
    .from('telegram_orders')
    .select('user_id, order_type, quantity, months, created_at')
    .eq('status', 'completed')
    .gte('created_at', since30d)
    .order('created_at', { ascending: true })

  if (error || !orders?.length) return

  // Group by user → ordered list of (product_key, created_at)
  const byUser = new Map<string, Array<{ key: string; ts: string }>>()
  for (const o of orders) {
    const key = o.order_type === 'stars'
      ? `stars:${o.quantity}`
      : `premium:${o.months}m`
    if (!byUser.has(o.user_id)) byUser.set(o.user_id, [])
    byUser.get(o.user_id)!.push({ key, ts: o.created_at })
  }

  // Build A→B co-purchase counts (within 7 days of A)
  const seqMap = new Map<string, { exposures: number; purchases: number }>()
  for (const [, events] of byUser) {
    for (let i = 0; i < events.length - 1; i++) {
      const a = events[i]
      for (let j = i + 1; j < events.length; j++) {
        const b = events[j]
        const diffH = (new Date(b.ts).getTime() - new Date(a.ts).getTime()) / 3600000
        if (diffH > 168) break // only within 7 days
        if (a.key === b.key) continue
        const pairKey = `${a.key}→${b.key}`
        if (!seqMap.has(pairKey)) seqMap.set(pairKey, { exposures: 0, purchases: 0 })
        seqMap.get(pairKey)!.purchases++
        seqMap.get(pairKey)!.exposures++
      }
    }
  }

  if (!seqMap.size) return

  // Upsert into product_relationship_stats
  // We use product key strings as IDs since these are telegram products (not uuid product_groups)
  const rows = Array.from(seqMap.entries()).map(([pair, s]) => {
    const [src, tgt] = pair.split('→')
    const cvr = s.exposures > 0 ? s.purchases / s.exposures : 0
    let evidenceGrade = 'HYPOTHESIS'
    if (s.purchases >= 50) evidenceGrade = 'STRONG'
    else if (s.purchases >= 20) evidenceGrade = 'MODERATE'
    else if (s.purchases >= 5)  evidenceGrade = 'WEAK'
    return {
      source_product_id:  src,   // key string used as pseudo-UUID
      target_product_id:  tgt,
      relationship_type:  'PURCHASED_NEXT',
      surface:            'all',
      time_bucket:        '7d',
      context_key:        'all',
      exposures:          s.exposures,
      purchases:          s.purchases,
      conversion_rate:    cvr,
      strength:           Math.min(1, cvr * 2),
      evidence_grade:     evidenceGrade,
      last_updated_at:    new Date().toISOString(),
    }
  })

  // product_relationship_stats has a uuid PK — use text keys as pseudo-IDs
  // Upsert on the unique constraint
  await supabase
    .from('product_relationship_stats')
    .upsert(rows, { onConflict: 'source_product_id,target_product_id,relationship_type,surface,time_bucket,context_key' })
    .then(() => {}).catch((e) => console.warn('[loop] product_relationship_stats upsert:', e?.message))
}

// ── 4. Detect & persist opportunities ────────────────────────────────────────
async function runOpportunityDetectors(): Promise<void> {
  // Fetch 7-day product view / purchase stats from revenue_events
  const since7d = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()

  const { data: purchaseEvents } = await supabase
    .from('revenue_events')
    .select('product_id, event_type, revenue_ngn')
    .gte('created_at', since7d)
    .in('event_type', ['PRODUCT_VIEWED', 'PURCHASE_COMPLETED'])

  if (!purchaseEvents?.length) return

  // Build per-product stats
  const productMap = new Map<string, { views7d: number; purchases7d: number }>()
  for (const e of purchaseEvents) {
    if (!e.product_id) continue
    if (!productMap.has(e.product_id)) productMap.set(e.product_id, { views7d: 0, purchases7d: 0 })
    const p = productMap.get(e.product_id)!
    if (e.event_type === 'PRODUCT_VIEWED')    p.views7d++
    if (e.event_type === 'PURCHASE_COMPLETED') p.purchases7d++
  }

  // Fetch CRO exposures per product from cro_interventions
  const { data: interventionRows } = await supabase
    .from('cro_interventions')
    .select('target_product_id')
    .gte('rendered_at', since7d)
    .not('target_product_id', 'is', null)

  const exposureMap = new Map<string, number>()
  for (const row of (interventionRows || [])) {
    const pid = row.target_product_id as string
    exposureMap.set(pid, (exposureMap.get(pid) || 0) + 1)
  }

  const productStats = Array.from(productMap.entries()).map(([productId, s]) => ({
    productId,
    productName: productId, // we don't join products table to keep it fast
    views7d: s.views7d,
    purchases7d: s.purchases7d,
    exposures7d: exposureMap.get(productId) || 0,
  }))

  // Funnel stats from revenue_events
  const { data: funnelEvents } = await supabase
    .from('revenue_events')
    .select('event_type')
    .gte('created_at', since7d)
    .in('event_type', ['BUY_CLICKED', 'CHECKOUT_STARTED', 'PURCHASE_COMPLETED'])

  const funnelCounts = { productViews7d: 0, buyClicks7d: 0, paymentStarts7d: 0, paymentCompleted7d: 0 }
  for (const e of (funnelEvents || [])) {
    if (e.event_type === 'BUY_CLICKED')         funnelCounts.buyClicks7d++
    if (e.event_type === 'CHECKOUT_STARTED')    funnelCounts.paymentStarts7d++
    if (e.event_type === 'PURCHASE_COMPLETED')  funnelCounts.paymentCompleted7d++
  }

  // ── Detector 1: Underexposed winners ─────────────────────────────────────────
  const opportunities: Array<Record<string, unknown>> = []
  for (const p of productStats) {
    if (p.views7d < 20 || p.purchases7d < 3) continue
    const cvr          = p.purchases7d / p.views7d
    const exposureRate = p.views7d > 0 ? p.exposures7d / p.views7d : 0
    if (cvr >= 0.12 && exposureRate < 0.25) {
      opportunities.push({
        opportunity_key:               `underexposed_winner:${p.productId}`,
        type:                          'UNDEREXPOSED_WINNER',
        scope:                         p.productId,
        description:                   `Product ${p.productId} converts at ${(cvr * 100).toFixed(1)}% but CRO exposure rate is only ${(exposureRate * 100).toFixed(0)}%.`,
        evidence:                      { conversion_rate: cvr, cro_exposure_rate: exposureRate, views_7d: p.views7d, purchases_7d: p.purchases7d },
        estimated_revenue_opportunity: Math.round(cvr * p.views7d * 0.3 * 4 * 12000),
        confidence:                    Math.min(0.75, 0.3 + p.purchases7d * 0.025),
        risk:                          0.2,
        priority:                      cvr * (1 - exposureRate) * p.views7d,
        status:                        'open',
        updated_at:                    new Date().toISOString(),
      })
    }
  }

  // ── Detector 2: Funnel drop ───────────────────────────────────────────────────
  const { buyClicks7d, paymentStarts7d, paymentCompleted7d } = funnelCounts
  if (buyClicks7d >= 20) {
    const startRate = buyClicks7d > 0 ? paymentStarts7d / buyClicks7d : 1
    if (startRate < 0.75) {
      opportunities.push({
        opportunity_key:               'funnel_drop:buy_to_payment_start',
        type:                          'FUNNEL_DROP',
        scope:                         'payment_funnel',
        description:                   `Only ${(startRate * 100).toFixed(0)}% of buy clicks reach payment start.`,
        evidence:                      { buy_clicks_7d: buyClicks7d, payment_starts_7d: paymentStarts7d, start_rate: startRate },
        estimated_revenue_opportunity: Math.round((1 - startRate) * buyClicks7d * 4 * 12000),
        confidence:                    0.85,
        risk:                          0.1,
        priority:                      (1 - startRate) * buyClicks7d * 10,
        status:                        'open',
        updated_at:                    new Date().toISOString(),
      })
    }

    const completionRate = paymentStarts7d > 0 ? paymentCompleted7d / paymentStarts7d : 1
    if (completionRate < 0.85 && paymentStarts7d >= 10) {
      opportunities.push({
        opportunity_key:               'funnel_drop:payment_completion',
        type:                          'FUNNEL_DROP',
        scope:                         'payment_completion',
        description:                   `Payment completion rate is ${(completionRate * 100).toFixed(0)}%.`,
        evidence:                      { payment_starts_7d: paymentStarts7d, payment_completed_7d: paymentCompleted7d, completion_rate: completionRate },
        estimated_revenue_opportunity: Math.round((1 - completionRate) * paymentStarts7d * 4 * 12000),
        confidence:                    0.90,
        risk:                          0.05,
        priority:                      (1 - completionRate) * paymentStarts7d * 20,
        status:                        'open',
        updated_at:                    new Date().toISOString(),
      })
    }
  }

  if (opportunities.length) {
    await supabase
      .from('cro_opportunities')
      .upsert(opportunities, { onConflict: 'opportunity_key' })
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  // Allow both scheduled cron invocations and manual POST triggers
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('method not allowed', { status: 405 })
  }

  const runAt = new Date().toISOString()
  console.log('[revenue-os-loop] run started', runAt)

  let totalEvaluated = 0
  let totalWritten   = 0
  let totalErrors    = 0
  const windowResults: Record<string, unknown> = {}

  try {
    // 1. Close attribution windows
    for (const windowH of WINDOWS_H) {
      const result = await closeAttributionWindows(windowH)
      windowResults[`${windowH}h`] = result
      totalEvaluated += result.evaluated
      totalWritten   += result.written
      totalErrors    += result.errors
    }

    // 2. Aggregate strategy stats (with real revenue from cro_outcomes)
    await updateStrategyStats()

    // 2b. Update product purchase sequences
    await updatePurchaseSequences()

    // 3. Auto-promote / auto-rollback
    await evaluateStrategies()

    // 4. Opportunity detection
    await runOpportunityDetectors()

    // 5. Log this run
    await supabase.from('cro_attribution_closures').insert({
      run_at:                  runAt,
      window_h:                0, // multi-window run
      interventions_evaluated: totalEvaluated,
      outcomes_written:        totalWritten,
      errors:                  totalErrors,
      details:                 { windows: windowResults },
    })

    console.log('[revenue-os-loop] run complete', { totalEvaluated, totalWritten, totalErrors })

    return new Response(
      JSON.stringify({ ok: true, evaluated: totalEvaluated, written: totalWritten, errors: totalErrors }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  } catch (err: any) {
    console.error('[revenue-os-loop] fatal error:', err?.message)
    return new Response(JSON.stringify({ ok: false, error: err?.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
