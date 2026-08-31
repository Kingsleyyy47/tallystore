import { supabase } from './supabase'

// ── Permission keys ────────────────────────────────────────────────────────
// These map 1:1 to sections/capabilities in AdminPage.
// A staff user only sees/can use capabilities where is_enabled = true.
// An action with auto_approve = false goes into the pending queue instead of
// executing immediately — the super-admin approves and applies it manually.

export const PERMISSIONS = [
  // ── Stats
  { key: 'view_stats',              label: 'View Analytics',         description: 'See top-level sales, user count, and revenue cards', group: 'Overview' },
  // ── Tabs
  { key: 'tab_templates',           label: 'Templates tab',          description: 'View and edit product templates', group: 'Tabs' },
  { key: 'tab_products',            label: 'Products tab',           description: 'View and manage individual accounts / stock', group: 'Tabs' },
  { key: 'tab_add_product',         label: 'Add Product tab',        description: 'Add single accounts to a product group', group: 'Tabs' },
  { key: 'tab_bulk_upload',         label: 'Bulk Upload tab',        description: 'Upload accounts via CSV', group: 'Tabs' },
  { key: 'tab_discount_codes',      label: 'Discount Codes tab',     description: 'View, create, and toggle discount codes', group: 'Tabs' },
  { key: 'tab_sms_products',        label: 'SMS Products tab',       description: 'Enable SMS products, set favorites, and manage customer SMS pricing', group: 'Tabs' },
  { key: 'tab_sms_orders',          label: 'SMS Orders tab',         description: 'View all customer SMS order history, cancel pending orders, and issue refunds', group: 'Tabs' },
  { key: 'tab_transactions',        label: 'Transaction History tab', description: 'View completed customer wallet deposits only', group: 'Tabs' },
  { key: 'tab_sales',               label: 'Sales History tab',       description: 'View completed customer product, SMS, crypto, bills, gift card, and social sales history', group: 'Tabs' },
  { key: 'tab_revenue_os',          label: 'Revenue OS tab',          description: 'View CRO health, data-quality findings, opportunities, and change bounded Revenue OS controls', group: 'Tabs' },
  { key: 'tab_categories',          label: 'Categories tab',         description: 'View, create, and edit product categories', group: 'Tabs' },
  { key: 'tab_users',               label: 'Users tab',              description: 'Search and view user accounts', group: 'Tabs' },
  { key: 'tab_email',               label: 'Email / Broadcast tab',  description: 'Send emails and broadcasts to users', group: 'Tabs' },
  // ── Settings sections
  { key: 'setting_rate',            label: 'NGN/USD Rate',           description: 'Override the exchange rate shown to customers', group: 'Settings' },
  { key: 'setting_referral_pct',    label: 'Referral Commission',    description: 'Change the referral reward percentage', group: 'Settings' },
  { key: 'setting_ercas',           label: 'Ercas Pay Toggle',       description: 'Enable or disable the Ercas Pay gateway', group: 'Settings' },
  { key: 'setting_support_links',   label: 'Support Links',          description: 'Change WhatsApp, Telegram, channel, and login popup support text', group: 'Settings' },
  // ── Specific actions
  { key: 'action_adjust_balance',   label: 'Adjust User Balance',    description: 'Add or subtract wallet balance for a user', group: 'Actions' },
] as const

export type PermissionKey = typeof PERMISSIONS[number]['key']

export interface StaffPermission {
  permission_key: PermissionKey
  is_enabled: boolean
  auto_approve: boolean
}

export type PermissionMap = Record<PermissionKey, StaffPermission>

// ── DB helpers ─────────────────────────────────────────────────────────────

/** Fetch all permissions for the currently logged-in staff user. */
export async function getMyStaffPermissions(): Promise<PermissionMap> {
  const { data, error } = await supabase
    .from('staff_permissions')
    .select('permission_key, is_enabled, auto_approve')

  const map: PermissionMap = {} as PermissionMap
  if (error || !data) return map

  for (const row of data) {
    map[row.permission_key as PermissionKey] = row as StaffPermission
  }
  return map
}

/** Submit an action for super-admin approval. */
export async function submitPendingAction(
  permissionKey: PermissionKey,
  actionType: string,
  actionLabel: string,
  actionData: Record<string, unknown> = {},
): Promise<{ success: boolean; error?: string; applied?: boolean; queued?: boolean; accountsCreated?: number }> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data, error } = await supabase.functions.invoke('manage-staff', {
    body: {
      action: 'submit_staff_action',
      permission_key: permissionKey,
      action_type: actionType,
      action_label: actionLabel,
      action_data: actionData,
    },
  })

  if (error) {
    let message = error.message || 'Action failed'
    const context = (error as any)?.context
    if (context && typeof context.json === 'function') {
      try {
        const body = await context.clone().json()
        message = body?.error || body?.message || message
      } catch {
        // Keep the Supabase client error if the function did not return JSON.
      }
    }
    return { success: false, error: message }
  }
  if (data?.success === false) return { success: false, error: data.error || 'Action failed' }
  return data || { success: true }
}

/** (Admin only) Fetch all pending actions. Uses service role via edge function
 *  or direct admin client — called from AdminPage. */
export async function getStaffPermissionsForUser(userId: string): Promise<StaffPermission[]> {
  const { data, error } = await supabase
    .from('staff_permissions')
    .select('permission_key, is_enabled, auto_approve')
    .eq('user_id', userId)

  if (error || !data) return []
  return data as StaffPermission[]
}
