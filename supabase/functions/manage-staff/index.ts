import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ADMIN_EMAIL = 'wisdomthedev@gmail.com'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function optionalNaira(value: unknown) {
  if (value === null || value === '') return null
  const number = Math.round(Number(value))
  return Number.isFinite(number) && number >= 0 ? number : null
}

async function applySmsPendingAction(admin: ReturnType<typeof createClient>, pendingAction: any) {
  const d = pendingAction.action_data || {}
  const now = new Date().toISOString()

  if (pendingAction.action_type === 'sms_update_product') {
    const serviceCode = String(d.service_code || '').trim()
    if (!serviceCode) throw new Error('SMS service_code missing')
    const updates: Record<string, unknown> = { service_code: serviceCode, updated_at: now }
    if (typeof d.service_name === 'string') updates.service_name = d.service_name.trim()
    if (typeof d.is_enabled === 'boolean') updates.is_enabled = d.is_enabled
    if (typeof d.is_favorite === 'boolean') updates.is_favorite = d.is_favorite
    if (typeof d.auto_markup_enabled === 'boolean') updates.auto_markup_enabled = d.auto_markup_enabled
    if (Object.prototype.hasOwnProperty.call(d, 'price_override_ngn')) updates.price_override_ngn = optionalNaira(d.price_override_ngn)
    if (Object.prototype.hasOwnProperty.call(d, 'margin_ngn')) updates.margin_ngn = optionalNaira(d.margin_ngn)

    const { error } = await admin.from('sms_product_settings').upsert(updates, { onConflict: 'service_code' })
    if (error) throw new Error(error.message)
    return
  }

  if (pendingAction.action_type === 'sms_bulk_products') {
    if (typeof d.is_enabled !== 'boolean') throw new Error('SMS is_enabled missing')
    const { data: rows, error: loadError } = await admin.from('sms_product_settings').select('service_code, service_name')
    if (loadError) throw new Error(loadError.message)
    const updates = (rows || []).map((row: any) => ({
      service_code: row.service_code,
      service_name: row.service_name,
      is_enabled: d.is_enabled,
      updated_at: now,
    }))
    if (updates.length > 0) {
      const { error } = await admin.from('sms_product_settings').upsert(updates, { onConflict: 'service_code' })
      if (error) throw new Error(error.message)
    }
    return
  }

  if (pendingAction.action_type === 'sms_apply_markup') {
    const marginNgn = optionalNaira(d.margin_ngn)
    if (marginNgn === null) throw new Error('SMS markup missing')
    const keepAutoApplying = d.keep_auto_applying !== false

    const { error: settingError } = await admin
      .from('app_settings')
      .upsert({ key: 'sms_default_margin_ngn', value: String(marginNgn), updated_at: now }, { onConflict: 'key' })
    if (settingError) throw new Error(settingError.message)

    const { error } = await admin
      .from('sms_product_settings')
      .update({ margin_ngn: marginNgn, auto_markup_enabled: keepAutoApplying, updated_at: now })
      .neq('service_code', '')
    if (error) throw new Error(error.message)
    return
  }

  if (pendingAction.action_type === 'sms_set_rounding') {
    if (typeof d.round_to_nearest_10 !== 'boolean') throw new Error('SMS rounding value missing')
    const { error } = await admin
      .from('app_settings')
      .upsert({
        key: 'sms_round_markup_to_nearest_10',
        value: d.round_to_nearest_10 ? 'true' : 'false',
        updated_at: now,
      }, { onConflict: 'key' })
    if (error) throw new Error(error.message)
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Unauthorized' }, 401)

    // Verify caller is the super-admin
    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } }
    )
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser(authHeader.replace('Bearer ', ''))
    if (userError || !user || user.email?.toLowerCase() !== ADMIN_EMAIL) {
      return json({ error: 'Forbidden — admin only' }, 403)
    }

    // All operations use service role to bypass RLS
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    )

    const body = await req.json().catch(() => ({})) as Record<string, any>
    const { action } = body

    // ── List all staff users ─────────────────────────────────────────────
    if (action === 'list_staff') {
      const { data, error } = await admin
        .from('profiles')
        .select('id, email, is_staff, wallet_balance')
        .eq('is_staff', true)
        .order('email')
      if (error) return json({ error: error.message }, 500)
      return json({ users: data || [] })
    }

    // ── Grant / revoke staff role ────────────────────────────────────────
    if (action === 'grant_staff' || action === 'revoke_staff') {
      const { user_id } = body
      if (!user_id) return json({ error: 'user_id required' }, 400)
      const { error } = await admin
        .from('profiles')
        .update({ is_staff: action === 'grant_staff' })
        .eq('id', user_id)
      if (error) return json({ error: error.message }, 500)
      return json({ success: true })
    }

    // ── List permissions for one staff user ─────────────────────────────
    if (action === 'list_permissions') {
      const { user_id } = body
      if (!user_id) return json({ error: 'user_id required' }, 400)
      const { data, error } = await admin
        .from('staff_permissions')
        .select('permission_key, is_enabled, auto_approve')
        .eq('user_id', user_id)
      if (error) return json({ error: error.message }, 500)
      return json({ permissions: data || [] })
    }

    // ── Set a single permission ──────────────────────────────────────────
    if (action === 'set_permission') {
      const { user_id, permission_key, is_enabled, auto_approve } = body
      if (!user_id || !permission_key) return json({ error: 'user_id and permission_key required' }, 400)
      const { error } = await admin
        .from('staff_permissions')
        .upsert(
          { user_id, permission_key, is_enabled: !!is_enabled, auto_approve: auto_approve !== false },
          { onConflict: 'user_id,permission_key' }
        )
      if (error) return json({ error: error.message }, 500)
      return json({ success: true })
    }

    // ── List all pending actions ─────────────────────────────────────────
    if (action === 'list_pending') {
      const { data, error } = await admin
        .from('staff_pending_actions')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
      if (error) return json({ error: error.message }, 500)
      return json({ actions: data || [] })
    }

    // ── Approve / reject a pending action ───────────────────────────────
    if (action === 'approve_action' || action === 'reject_action') {
      const { action_id } = body
      if (!action_id) return json({ error: 'action_id required' }, 400)

      if (action === 'approve_action') {
        // Fetch the action to execute it
        const { data: pendingAction } = await admin
          .from('staff_pending_actions')
          .select('*')
          .eq('id', action_id)
          .single()

        if (pendingAction) {
          const d = pendingAction.action_data || {}
          if (pendingAction.action_type === 'upsert_setting') {
            await admin.from('app_settings').upsert({ key: d.setting_key, value: d.value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
          } else if (pendingAction.action_type === 'upsert_settings') {
            const settings = d.settings || {}
            const rows = Object.entries(settings).map(([key, value]) => ({
              key,
              value: String(value ?? ''),
              updated_at: new Date().toISOString(),
            }))
            if (rows.length > 0) await admin.from('app_settings').upsert(rows, { onConflict: 'key' })
          } else if (String(pendingAction.action_type || '').startsWith('sms_')) {
            await applySmsPendingAction(admin, pendingAction)
          } else if (pendingAction.action_type === 'adjust_balance') {
            // Read current balance then update
            const { data: profile } = await admin.from('profiles').select('wallet_balance').eq('id', d.user_id).single()
            if (profile) {
              const newBal = (profile.wallet_balance || 0) + d.amount
              await admin.from('profiles').update({ wallet_balance: newBal }).eq('id', d.user_id)
              await admin.from('transactions').insert({
                user_id: d.user_id, type: 'adjustment', amount: d.amount,
                status: 'completed', balance_after: newBal,
                description: d.reason || 'Approved staff balance adjustment',
                reference: `STAFF-ADJ-${action_id.substring(0, 8).toUpperCase()}`,
              })
            }
          }
        }
      }

      await admin
        .from('staff_pending_actions')
        .update({ status: action === 'approve_action' ? 'approved' : 'rejected', reviewed_at: new Date().toISOString(), reviewed_by: user.id })
        .eq('id', action_id)

      return json({ success: true })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal error'
    console.error('manage-staff error:', msg)
    return json({ error: msg }, 500)
  }
})
