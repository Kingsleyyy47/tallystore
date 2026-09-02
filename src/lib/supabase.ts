import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Test database connection and setup
export async function testAuthConnection(): Promise<{ success: boolean; message: string }> {
  try {
    // Test basic connection
    const { data: { session } } = await supabase.auth.getSession()
    
    // Test if profiles table exists
    const { data, error } = await supabase
      .from('profiles')
      .select('id')
      .limit(1)
    
    if (error) {
      if (error.code === '42P01') { // Table doesn't exist
        return { 
          success: false, 
          message: 'Profiles table not found. Please run the setup SQL script in Supabase.' 
        }
      }
      throw error
    }
    
    return { success: true, message: 'Authentication tables are ready!' }
    
  } catch (error) {
    console.error('❌ Auth connection test failed:', error)
    return { 
      success: false, 
      message: `Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}` 
    }
  }
}

// User authentication functions
export async function createUserProfile(userId: string, username: string): Promise<{ success: boolean; message: string; profile?: Profile }> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .insert([
        {
          id: userId,
          username: username,
          wallet_balance: 0,
          is_admin: false,
        }
      ])
      .select()
      .single()

    if (error) {
      if (error.code === '23505') { // Unique constraint violation
        return { success: false, message: 'Username already taken' }
      }
      throw error
    }

    return { success: true, message: 'Profile created successfully', profile: data }
  } catch (error) {
    console.error('Error creating user profile:', error)
    return { 
      success: false, 
      message: `Failed to create profile: ${error instanceof Error ? error.message : 'Unknown error'}` 
    }
  }
}

export async function getUserProfile(userId: string): Promise<Profile | null> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    if (error) {
      if (error.code === 'PGRST116') { // No rows returned
        return null
      }
      throw error
    }

    return data
  } catch (error) {
    console.error('Error fetching user profile:', error)
    return null
  }
}

// Database types
export interface Profile {
  id: string
  username: string
  wallet_balance: number
  is_admin: boolean
  created_at: string
  updated_at: string
  referral_code?: string
  referred_by?: string | null
  referral_balance?: number
}

export interface Category {
  id: string
  name: string
  description?: string
  is_active: boolean
  created_at: string
}

export interface ProductGroup {
  id: string
  category_id: string
  name: string
  description?: string
  price: number
  features?: any[]
  stock_count: number
  availability_status?: 'AVAILABLE' | 'LOW_STOCK' | 'PREORDER' | 'BACKORDER' | 'UNLIMITED' | 'UNAVAILABLE' | 'PAUSED' | 'UNKNOWN' | string | null
  is_sellable?: boolean | null
  is_active: boolean
  created_at: string
  categories?: { name: string }
  muabanvia_product_id?: string | null
  auto_fulfill_enabled?: boolean
  shopclone_product_id?: string | null
  shopviaclone_product_id?: string | null
  auto_restock_enabled?: boolean
  restock_buffer_days?: number
  quantity_discount_tiers?: QuantityDiscountTier[]
}

export interface QuantityDiscountTier {
  min_qty: number
  discount_pct: number
}

// Kill switch: both quantity discount tiers and discount codes are paused
// store-wide while a better bundle/promo solution is worked out. Flip this
// back to true to re-enable both (no data was deleted - tiers and codes are
// still sitting in the DB, just not applied at checkout). Mirrors the same
// flag in supabase/functions/process-purchase/index.ts - keep both in sync.
export const DISCOUNTS_ENABLED = true

// Picks the best applicable bulk tier for a given quantity (highest min_qty the
// quantity meets or exceeds) and returns the discounted total. Tiers start at 2
// units so a single account cannot accidentally be repriced by a "bulk" rule.
// Mirrors the exact same logic used server-side in process-purchase/index.ts.
export function computeDiscountedTotal(
  unitPrice: number,
  quantity: number,
  tiers: QuantityDiscountTier[] | undefined | null,
): { total: number; discountPct: number; originalTotal: number } {
  const originalTotal = unitPrice * quantity
  if (!DISCOUNTS_ENABLED || !tiers || tiers.length === 0) {
    return { total: originalTotal, discountPct: 0, originalTotal }
  }
  const applicable = tiers
    .filter((t) => Number(t.min_qty) >= 2 && quantity >= Number(t.min_qty))
    .sort((a, b) => b.discount_pct - a.discount_pct)[0]
  if (!applicable) {
    return { total: originalTotal, discountPct: 0, originalTotal }
  }
  const discountPct = Math.min(Math.max(applicable.discount_pct, 0), 100)
  const total = Math.round(originalTotal * (1 - discountPct / 100))
  return { total, discountPct, originalTotal }
}

export interface Product {
  id: string
  category_id: string
  username: string
  password: string
  tfa_code: string
  email?: string
  email_password?: string
  price: number
  is_sold: boolean
  sold_to?: string
  created_at: string
  sold_at?: string
}

export interface Order {
  id: string
  user_id: string
  product_group_id: string // Changed back to product_group_id for foreign key
  amount: number
  status: string
  account_details?: any
  created_at: string
}

export interface Transaction {
  id: string
  user_id: string
  type: 'topup' | 'purchase'
  amount: number
  status: string
  reference: string
  ercas_reference?: string
  created_at: string
}

// STEP 1B: Basic database functions
// Module-level cache — shared across all components so multiple simultaneous
// callers on the same page share a single in-flight request and reuse the result
// for 3 minutes before hitting the DB again.
const CACHE_TTL = 3 * 60 * 1000 // 3 minutes
let _categoriesCache: { data: Category[]; ts: number } | null = null
let _categoriesInflight: Promise<Category[]> | null = null
let _pgCache: { data: ProductGroup[]; ts: number } | null = null
let _pgInflight: Promise<ProductGroup[]> | null = null

export async function getCategories(): Promise<Category[]> {
  if (_categoriesCache && Date.now() - _categoriesCache.ts < CACHE_TTL) {
    return _categoriesCache.data
  }
  if (_categoriesInflight) return _categoriesInflight

  _categoriesInflight = (async () => {
    try {
      const timeout = new Promise<{ data: null; error: Error }>(resolve =>
        setTimeout(() => resolve({ data: null, error: new Error('getCategories timeout') }), 12000)
      )
      const { data, error } = await Promise.race([
        supabase.from('categories').select('*').eq('is_active', true).order('name'),
        timeout,
      ])
      if (error) { console.error('Supabase error:', error); throw error }
      const result = data || []
      _categoriesCache = { data: result, ts: Date.now() }
      return result
    } catch (error) {
      console.error('Error fetching categories:', error)
      return _categoriesCache?.data || []
    } finally {
      _categoriesInflight = null
    }
  })()

  return _categoriesInflight
}

export async function getAllProductGroups(): Promise<ProductGroup[]> {
  if (_pgCache && Date.now() - _pgCache.ts < CACHE_TTL) {
    return _pgCache.data
  }
  if (_pgInflight) return _pgInflight

  _pgInflight = (async () => {
    try {
      const timeout = new Promise<{ data: null; error: Error }>(resolve =>
        setTimeout(() => resolve({ data: null, error: new Error('getAllProductGroups timeout') }), 12000)
      )
      const { data, error } = await Promise.race([
        supabase.from('product_groups').select('*').eq('is_active', true).order('name'),
        timeout,
      ])
      if (error) { console.error('Supabase error:', error); throw error }
      const result = data || []
      _pgCache = { data: result, ts: Date.now() }
      return result
    } catch (error) {
      console.error('Error fetching product groups:', error)
      return _pgCache?.data || []
    } finally {
      _pgInflight = null
    }
  })()

  return _pgInflight
}

export async function testConnection() {
  try {
    // Test basic Supabase connection without hitting RLS policies
    // Just test if we can reach Supabase at all
    const { data: { session } } = await supabase.auth.getSession()
    
    return true
  } catch (error) {
    console.error('❌ Supabase connection failed:', error)
    return false
  }
}

// ====================================
// ADMIN CRUD OPERATIONS
// ====================================

// === CATEGORIES MANAGEMENT ===
export async function createCategory(name: string, displayName: string, description?: string): Promise<Category | null> {
  try {
    const { data, error } = await supabase
      .from('categories')
      .insert([{
        name: displayName,
        description,
        is_active: true
      }])
      .select()
      .single()

    if (error) {
      console.error('❌ Error creating category:', error)
      throw error
    }

    return data
  } catch (error) {
    console.error('❌ Failed to create category:', error)
    throw error
  }
}

export async function updateCategory(id: string, updates: Partial<Category>): Promise<Category | null> {
  try {
    const { data, error } = await supabase
      .from('categories')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('❌ Error updating category:', error)
      throw error
    }

    return data
  } catch (error) {
    console.error('❌ Failed to update category:', error)
    return null
  }
}

export async function deleteCategory(id: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('categories')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('❌ Error deleting category:', error)
      throw error
    }

    return true
  } catch (error) {
    console.error('❌ Failed to delete category:', error)
    return false
  }
}

// === PRODUCT GROUPS MANAGEMENT ===
export async function createProductGroup(productGroup: Omit<ProductGroup, 'id' | 'created_at'>): Promise<ProductGroup | null> {
  try {
    const { data, error } = await supabase
      .from('product_groups')
      .insert([productGroup])
      .select()
      .single()

    if (error) {
      console.error('❌ Error creating product group:', error)
      throw error
    }

    return data
  } catch (error) {
    console.error('❌ Failed to create product group:', error)
    return null
  }
}

export async function updateProductGroup(id: string, updates: Partial<ProductGroup>): Promise<ProductGroup | null> {
  try {
    const { data, error } = await supabase
      .from('product_groups')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('❌ Error updating product group:', error)
      throw error
    }

    return data
  } catch (error) {
    console.error('❌ Failed to update product group:', error)
    return null
  }
}

export async function deleteProductGroup(id: string): Promise<boolean> {
  try {
    // First check if there are any orders referencing this product group
    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select('id')
      .eq('product_group_id', id)
      .limit(1)

    if (ordersError) {
      console.error('❌ Error checking orders:', ordersError)
      throw ordersError
    }

    if (orders && orders.length > 0) {
      throw new Error('Cannot delete product group that has existing orders. Please archive it instead or contact support.')
    }

    // Check if there are any individual accounts referencing this product group
    const { data: accounts, error: accountsError } = await supabase
      .from('individual_accounts')
      .select('id')
      .eq('product_group_id', id)
      .limit(1)

    if (accountsError) {
      console.error('❌ Error checking accounts:', accountsError)
      throw accountsError
    }

    if (accounts && accounts.length > 0) {
      throw new Error('Cannot delete product group that has existing accounts. Please remove all accounts first.')
    }

    // If no dependencies, proceed with deletion
    const { error } = await supabase
      .from('product_groups')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('❌ Error deleting product group:', error)
      throw error
    }

    return true
  } catch (error) {
    console.error('❌ Failed to delete product group:', error)
    return false
  }
}

// Archive a product group (set is_active to false)
export async function archiveProductGroup(id: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('product_groups')
      .update({ is_active: false })
      .eq('id', id)

    if (error) {
      console.error('❌ Error archiving product group:', error)
      throw error
    }

    return true
  } catch (error) {
    console.error('❌ Failed to archive product group:', error)
    return false
  }
}

// Restore an archived product group
export async function restoreProductGroup(id: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('product_groups')
      .update({ is_active: true })
      .eq('id', id)

    if (error) {
      console.error('❌ Error restoring product group:', error)
      throw error
    }

    return true
  } catch (error) {
    console.error('❌ Failed to restore product group:', error)
    return false
  }
}

// === INDIVIDUAL ACCOUNTS MANAGEMENT ===
export interface IndividualAccount {
  id: string
  product_group_id: string
  username: string
  password: string
  email?: string
  email_password?: string
  two_fa_code?: string
  recovery_email?: string
  recovery_email_password?: string
  additional_info?: any
  status: 'available' | 'sold' | 'reserved'
  created_at: string
  sold_at?: string
}

export async function createIndividualAccount(account: Omit<IndividualAccount, 'id' | 'created_at'>): Promise<IndividualAccount | null> {
  try {
    const { data, error } = await supabase
      .from('individual_accounts')
      .insert([account])
      .select()
      .single()

    if (error) {
      console.error('❌ Error creating individual account:', error)
      throw error
    }

    // Update stock count in product group
    await updateProductGroupStock(account.product_group_id)

    return data
  } catch (error) {
    console.error('❌ Failed to create individual account:', error)
    return null
  }
}

export async function bulkCreateIndividualAccounts(accounts: Omit<IndividualAccount, 'id' | 'created_at'>[]): Promise<IndividualAccount[]> {
  try {
    const { data, error } = await supabase
      .from('individual_accounts')
      .insert(accounts)
      .select()

    if (error) {
      console.error('❌ Error bulk creating accounts:', error)
      throw error
    }

    // Update stock counts for all affected product groups
    const productGroupIds = [...new Set(accounts.map(acc => acc.product_group_id))]
    await Promise.all(productGroupIds.map(id => updateProductGroupStock(id)))

    return data
  } catch (error) {
    console.error('❌ Failed to bulk create accounts:', error)
    return []
  }
}

export async function getIndividualAccounts(productGroupId?: string): Promise<IndividualAccount[]> {
  try {
    let query = supabase.from('individual_accounts').select('*')
    
    if (productGroupId) {
      query = query.eq('product_group_id', productGroupId)
    }
    
    const { data, error } = await query.order('created_at', { ascending: false })

    if (error) {
      console.error('❌ Error fetching individual accounts:', error)
      throw error
    }

    return data || []
  } catch (error) {
    console.error('❌ Failed to fetch individual accounts:', error)
    return []
  }
}

// Get total count of individual accounts (for admin dashboard stats)
export async function getIndividualAccountsCount(): Promise<number> {
  try {
    const { count, error } = await supabase
      .from('individual_accounts')
      .select('*', { count: 'exact', head: true })

    if (error) {
      console.error('❌ Error counting individual accounts:', error)
      return 0
    }

    return count || 0
  } catch (error) {
    console.error('❌ Failed to count individual accounts:', error)
    return 0
  }
}

// Returns product_group_ids ordered by most-recently-restocked (i.e. the
// most recent individual_accounts inventory was added), deduped, most
// recent first. Used to power the "Refilled" section on the Products page.
export async function getRecentlyRestockedProductGroupIds(limit: number = 4): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('individual_accounts_public')
      .select('product_group_id, created_at')
      .eq('status', 'available')
      .order('created_at', { ascending: false })
      .limit(500)

    if (error) {
      console.error('❌ Error fetching recently restocked accounts:', error)
      throw error
    }

    const seen = new Set<string>()
    const orderedIds: string[] = []
    for (const row of data || []) {
      if (!seen.has(row.product_group_id)) {
        seen.add(row.product_group_id)
        orderedIds.push(row.product_group_id)
      }
      if (orderedIds.length >= limit) break
    }

    return orderedIds
  } catch (error) {
    console.error('❌ Failed to fetch recently restocked product groups:', error)
    return []
  }
}

// Maps product_group_id -> one available individual_account id, so UI tiles
// (Popular Products, New, Refilled) that only know the product GROUP can
// still link to a real, clickable account on the Product Detail page (which
// is keyed by individual account id, not product group id).
export async function getAvailableAccountIdsByProductGroup(): Promise<Record<string, string>> {
  try {
    const { data, error } = await supabase
      .from('individual_accounts_public')
      .select('id, product_group_id, status')
      .limit(5000)

    if (error) {
      console.error('❌ Error fetching available account map:', error)
      throw error
    }

    // Prefer an 'available' account per product group, but fall back to
    // ANY account (sold/reserved) if that's all that exists, so tiles can
    // still link straight to the product detail page instead of bouncing
    // to the category page just because the only known account isn't
    // currently in stock.
    const availableMap: Record<string, string> = {}
    const anyMap: Record<string, string> = {}
    for (const row of data || []) {
      if (!anyMap[row.product_group_id]) {
        anyMap[row.product_group_id] = row.id
      }
      if (row.status === 'available' && !availableMap[row.product_group_id]) {
        availableMap[row.product_group_id] = row.id
      }
    }
    return { ...anyMap, ...availableMap }
  } catch (error) {
    console.error('❌ Failed to fetch available account map:', error)
    return {}
  }
}

// Real "most bought" ranking for the Popular Products section, computed by a
// security-definer RPC so staff/admin orders never contaminate customer-facing
// popularity while profile rows stay hidden from customer browsers.
export async function getTopSellingProductGroupIds(limit: number = 8): Promise<string[]> {
  try {
    const { data, error } = await supabase.rpc('get_customer_top_product_groups', {
      p_limit: limit,
    })

    if (error) {
      console.error('❌ Error fetching customer top sellers:', error)
      throw error
    }

    return (data || [])
      .map((row: { product_group_id?: string | null }) => row.product_group_id)
      .filter((id): id is string => Boolean(id))
  } catch (error) {
    console.error('❌ Failed to fetch top selling product groups:', error)
    return []
  }
}

// Per-user purchase history, used to power "Recommended for you" ordering on
// product listing pages: which product groups (and their categories) has
// this user actually bought before, ranked by how many times. Categories the
// user already buys from are what "recommended" leans on most; the global
// top-seller ranking (getTopSellingProductGroupIds) fills in the rest.
export async function getUserPurchaseHistory(userId: string): Promise<{
  productGroupCounts: Record<string, number>
  categoryCounts: Record<string, number>
  lastPurchasedAtByProductGroup: Record<string, string>
  lastPurchasedAtByCategory: Record<string, string>
  lastProductGroupId: string | null
}> {
  const empty = { productGroupCounts: {}, categoryCounts: {}, lastPurchasedAtByProductGroup: {}, lastPurchasedAtByCategory: {}, lastProductGroupId: null }
  if (!userId) return empty

  try {
    const { data, error } = await supabase
      .from('orders')
      .select('product_group_id, account_details, created_at, product_groups(category_id)')
      .eq('user_id', userId)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(2000)

    if (error) {
      console.error('❌ Error fetching user purchase history:', error)
      return empty
    }

    const productGroupCounts: Record<string, number> = {}
    const categoryCounts: Record<string, number> = {}
    const lastPurchasedAtByProductGroup: Record<string, string> = {}
    const lastPurchasedAtByCategory: Record<string, string> = {}
    let lastProductGroupId: string | null = null

    for (const row of (data || []) as any[]) {
      if (!row.product_group_id) continue
      if (!lastProductGroupId) lastProductGroupId = row.product_group_id
      const details = row.account_details as { quantity?: number } | null
      const qty = details && typeof details.quantity === 'number' && details.quantity > 0
        ? details.quantity
        : 1
      productGroupCounts[row.product_group_id] = (productGroupCounts[row.product_group_id] || 0) + qty
      if (!lastPurchasedAtByProductGroup[row.product_group_id] || new Date(row.created_at).getTime() > new Date(lastPurchasedAtByProductGroup[row.product_group_id]).getTime()) {
        lastPurchasedAtByProductGroup[row.product_group_id] = row.created_at
      }

      const categoryId = row.product_groups?.category_id
      if (categoryId) {
        categoryCounts[categoryId] = (categoryCounts[categoryId] || 0) + qty
        if (!lastPurchasedAtByCategory[categoryId] || new Date(row.created_at).getTime() > new Date(lastPurchasedAtByCategory[categoryId]).getTime()) {
          lastPurchasedAtByCategory[categoryId] = row.created_at
        }
      }
    }

    return { productGroupCounts, categoryCounts, lastPurchasedAtByProductGroup, lastPurchasedAtByCategory, lastProductGroupId }
  } catch (error) {
    console.error('❌ Failed to fetch user purchase history:', error)
    return empty
  }
}

// ---------------------------------------------------------------------------
// Product suggestions ("trending category, want to add a product?" panel)
// ---------------------------------------------------------------------------
//
// Trigger is your own store's sales velocity, NOT a live scan of the
// supplier sites yet - MuaBanVia/ShopClone/ShopViaClone22 do expose a
// products.php "list of categories and products" endpoint, but its exact
// response shape hasn't been confirmed, so matching that against your
// catalog is a follow-up, not part of this first pass.

export interface ProductSuggestion {
  id: string
  category_id: string
  based_on_product_group_id: string | null
  created_product_group_id: string | null
  suggested_name: string
  reason?: string | null
  velocity_recent?: number | null
  velocity_previous?: number | null
  status: 'pending' | 'accepted' | 'dismissed'
  snoozed_until?: string | null
  created_at: string
  updated_at: string
  categories?: { name: string }
}

// Scans the last 14 days of completed orders, splits into two 7-day windows,
// and flags any category whose unit velocity grew by at least `growthRatio`
// (default 1.5x = 50% faster) with enough absolute volume to not just be
// noise. For each flagged category, upserts a 'pending' suggestion based on
// that category's own best-selling template (skipped if one is already
// pending or still snoozed for that category).
export async function computeAndUpsertTrendSuggestions(options?: {
  growthRatio?: number
  minRecentUnits?: number
}): Promise<ProductSuggestion[]> {
  const growthRatio = options?.growthRatio ?? 1.5
  const minRecentUnits = options?.minRecentUnits ?? 5

  try {
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    const { data: orders, error } = await supabase
      .from('orders')
      .select('product_group_id, user_id, account_details, created_at, status')
      .eq('status', 'completed')
      .gte('created_at', fourteenDaysAgo)
      .limit(5000)

    if (error) throw error

    const userIds = [...new Set((orders || []).map((order) => order.user_id).filter(Boolean))]
    const customerUserIds = new Set<string>()

    if (userIds.length > 0) {
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, is_staff, is_admin')
        .in('id', userIds)

      if (profilesError) throw profilesError

      for (const profile of profiles || []) {
        if (!profile.is_staff && !profile.is_admin) {
          customerUserIds.add(profile.id)
        }
      }
    }

    const productGroups = await getAllProductGroups()
    const pgById: Record<string, ProductGroup> = {}
    productGroups.forEach((pg) => { pgById[pg.id] = pg })

    const recentByCategory: Record<string, number> = {}
    const previousByCategory: Record<string, number> = {}
    const recentByProduct: Record<string, number> = {}

    for (const row of orders || []) {
      if (!customerUserIds.has(row.user_id)) continue
      const pg = pgById[row.product_group_id]
      if (!pg) continue
      const details = row.account_details as { quantity?: number } | null
      const qty = details && typeof details.quantity === 'number' && details.quantity > 0
        ? details.quantity
        : 1

      const isRecent = row.created_at >= sevenDaysAgo
      if (isRecent) {
        recentByCategory[pg.category_id] = (recentByCategory[pg.category_id] || 0) + qty
        recentByProduct[pg.id] = (recentByProduct[pg.id] || 0) + qty
      } else {
        previousByCategory[pg.category_id] = (previousByCategory[pg.category_id] || 0) + qty
      }
    }

    const { data: existing } = await supabase
      .from('product_suggestions')
      .select('category_id, status, snoozed_until')
      .in('status', ['pending', 'dismissed'])

    const blockedCategoryIds = new Set(
      (existing || [])
        .filter((s) => s.status === 'pending' || (s.snoozed_until && s.snoozed_until > new Date().toISOString()))
        .map((s) => s.category_id),
    )

    const created: ProductSuggestion[] = []

    for (const categoryId of Object.keys(recentByCategory)) {
      const recent = recentByCategory[categoryId] || 0
      const previous = previousByCategory[categoryId] || 0
      if (recent < minRecentUnits) continue
      if (blockedCategoryIds.has(categoryId)) continue
      // previous === 0 with real recent volume still counts as "trending" -
      // treat it as effectively infinite growth rather than dividing by zero.
      const growth = previous > 0 ? recent / previous : Infinity
      if (growth < growthRatio) continue

      const bestTemplate = productGroups
        .filter((pg) => pg.category_id === categoryId && pg.is_active)
        .sort((a, b) => (recentByProduct[b.id] || 0) - (recentByProduct[a.id] || 0))[0]

      if (!bestTemplate) continue

      const { data: inserted, error: insertError } = await supabase
        .from('product_suggestions')
        .insert([{
          category_id: categoryId,
          based_on_product_group_id: bestTemplate.id,
          suggested_name: `${bestTemplate.name} (New)`,
          reason: `Sales in this category are up ${previous > 0 ? `${Math.round((growth - 1) * 100)}%` : 'sharply'} vs last week (${recent} vs ${previous} units).`,
          velocity_recent: recent,
          velocity_previous: previous,
          status: 'pending',
        }])
        .select('*, categories(name)')
        .single()

      if (!insertError && inserted) {
        created.push(inserted)
      }
    }

    return created
  } catch (error) {
    console.error('❌ Failed to compute trend suggestions:', error)
    return []
  }
}

export async function getProductSuggestions(status: 'pending' | 'accepted' | 'dismissed' = 'pending'): Promise<ProductSuggestion[]> {
  try {
    const { data, error } = await supabase
      .from('product_suggestions')
      .select('*, categories(name)')
      .eq('status', status)
      .order('created_at', { ascending: false })

    if (error) throw error
    return data || []
  } catch (error) {
    console.error('❌ Failed to fetch product suggestions:', error)
    return []
  }
}

// "Not now" - hides this suggestion until it's re-flagged after the snooze
// window passes (default 3 days).
export async function dismissSuggestion(id: string, snoozeDays: number = 3): Promise<boolean> {
  try {
    const snoozedUntil = new Date(Date.now() + snoozeDays * 24 * 60 * 60 * 1000).toISOString()
    const { error } = await supabase
      .from('product_suggestions')
      .update({ status: 'dismissed', snoozed_until: snoozedUntil, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) throw error
    return true
  } catch (error) {
    console.error('❌ Failed to dismiss suggestion:', error)
    return false
  }
}

// "Add product" - clones the based-on template into a new DRAFT product
// (is_active: false, no stock, provider IDs blank) and links it to the
// suggestion. This never spends money by itself - the admin still has to
// open the new draft, fill in a provider ID, and explicitly trigger a test
// stock purchase afterwards.
export async function acceptSuggestion(id: string): Promise<ProductGroup | null> {
  try {
    const { data: suggestion, error: fetchError } = await supabase
      .from('product_suggestions')
      .select('*')
      .eq('id', id)
      .single()

    if (fetchError || !suggestion) throw fetchError || new Error('Suggestion not found')

    const template = suggestion.based_on_product_group_id
      ? await (async () => {
          const { data } = await supabase
            .from('product_groups')
            .select('*')
            .eq('id', suggestion.based_on_product_group_id)
            .single()
          return data
        })()
      : null

    const newProduct = await createProductGroup({
      category_id: suggestion.category_id,
      name: suggestion.suggested_name,
      description: template?.description || '',
      price: template?.price || 0,
      features: template?.features || [],
      stock_count: 0,
      is_active: false,
    } as any)

    if (!newProduct) throw new Error('Failed to create draft product')

    await supabase
      .from('product_suggestions')
      .update({
        status: 'accepted',
        created_product_group_id: newProduct.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    return newProduct
  } catch (error) {
    console.error('❌ Failed to accept suggestion:', error)
    return null
  }
}

export async function deleteIndividualAccount(id: string): Promise<boolean> {
  try {
    // Get the account to know which product group to update
    const { data: account } = await supabase
      .from('individual_accounts')
      .select('product_group_id')
      .eq('id', id)
      .single()

    const { error } = await supabase
      .from('individual_accounts')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('❌ Error deleting individual account:', error)
      throw error
    }

    // Update stock count
    if (account) {
      await updateProductGroupStock(account.product_group_id)
    }

    return true
  } catch (error) {
    console.error('❌ Failed to delete individual account:', error)
    return false
  }
}

export async function updateIndividualAccount(id: string, updates: Partial<Omit<IndividualAccount, 'id' | 'created_at'>>): Promise<IndividualAccount | null> {
  try {
    const { data, error } = await supabase
      .from('individual_accounts')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('❌ Error updating individual account:', error)
      throw error
    }

    return data
  } catch (error) {
    console.error('❌ Failed to update individual account:', error)
    return null
  }
}

// === UTILITY FUNCTIONS ===
export async function updateProductGroupStock(productGroupId: string): Promise<boolean> {
  try {
    // Count available accounts
    const { count, error } = await supabase
      .from('individual_accounts')
      .select('*', { count: 'exact', head: true })
      .eq('product_group_id', productGroupId)
      .eq('status', 'available')

    if (error) {
      console.error('❌ Error counting accounts:', error)
      return false
    }

    // Update the product group stock
    const { error: updateError } = await supabase
      .from('product_groups')
      .update({ stock_count: count || 0 })
      .eq('id', productGroupId)

    if (updateError) {
      console.error('❌ Error updating stock:', updateError)
      return false
    }

    return true
  } catch (error) {
    console.error('❌ Failed to update stock:', error)
    return false
  }
}

// Get product groups by category
export async function getProductGroupsByCategory(categoryId: string): Promise<ProductGroup[]> {
  try {
    const { data, error } = await supabase
      .from('product_groups')
      .select('*')
      .eq('category_id', categoryId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching product groups by category:', error)
      throw error
    }

    return data || []
  } catch (error) {
    console.error('Database error:', error)
    throw error
  }
}

// Get individual accounts by product group
export async function getIndividualAccountsByProductGroup(productGroupId: string): Promise<IndividualAccount[]> {
  try {
    const { data, error } = await supabase
      .from('individual_accounts')
      .select('*')
      .eq('product_group_id', productGroupId)
      .eq('status', 'available')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching individual accounts by product group:', error)
      throw error
    }

    return data || []
  } catch (error) {
    console.error('Database error:', error)
    throw error
  }
}

// === CSV PARSING UTILITY ===
function parseCsvLine(line: string): string[] {
  const values: string[] = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]

    if (char === '"' && inQuotes && next === '"') {
      current += '"'
      index += 1
      continue
    }

    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }

    if (char === ',' && !inQuotes) {
      values.push(current.trim())
      current = ''
      continue
    }

    current += char
  }

  values.push(current.trim())
  return values
}

export function parseCSV(csvText: string): any[] {
  const lines = csvText
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length === 0) return []

  // \u2500\u2500 TXT / plain-credential format detection \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  // If the first line contains ':' or '|' but no comma, treat every line as
  // "username:password" or "username|password" (no header row needed).
  const firstLine = lines[0]
  const hasColon = firstLine.includes(':')
  const hasPipe  = firstLine.includes('|')
  const hasComma = firstLine.includes(',')
  const looksLikePlainCredentials = (hasColon || hasPipe) && !hasComma

  if (looksLikePlainCredentials) {
    const sep = hasPipe ? '|' : ':'

    // Column mapping by position — covers all known site formats:
    //
    // PIPE formats:
    //   Facebook full (8): username | password | mail | mail_pass | recovery_mail | 2fa | year | friends
    //   Facebook 2   (7): username | password | mail | mail_pass | (empty)       | year | friends
    //   Twitter      (5-6): username | password | mail | mail_pass | 2fa |
    //
    // COLON formats:
    //   Instagram / TikTok (4): username : password : mail : mail_pass

    const COLON_FIELDS = ['username', 'password', 'email', 'email_password', 'two_fa_code']

    // Detect column count from the first line
    const colCount = lines[0].split(sep).length

    const fieldMap = sep === '|'
      ? colCount >= 8
        // Facebook full: 8 cols — recovery_mail at 4, 2fa at 5, year at 6, friends at 7
        ? ['username', 'password', 'email', 'email_password', 'recovery_email', 'two_fa_code', 'year', 'friends_count']
        : colCount === 7
        // Facebook 2: 7 cols — empty recovery at 4, year at 5, friends at 6 (no 2fa)
        ? ['username', 'password', 'email', 'email_password', 'recovery_email', 'year', 'friends_count']
        // Twitter / short pipe: ≤6 cols — username | password | mail | mail_pass | 2fa |
        : ['username', 'password', 'email', 'email_password', 'two_fa_code']
      : COLON_FIELDS

    return lines.map(line => {
      const parts = line.split(sep).map(p => p.trim())
      const obj: Record<string, string> = {}
      fieldMap.forEach((field, i) => {
        if (field && parts[i] !== undefined) obj[field] = parts[i]
      })
      return obj
    }).filter(r => r.username || r.password)
  }

  // \u2500\u2500 CSV format: requires at least header + one data row \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  if (lines.length < 2) return []

  const normalizeHeader = (header: string) => {
    const key = header.trim().toLowerCase().replace(/^\uFEFF/, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    const aliases: Record<string, string> = {
      user: 'username',
      user_name: 'username',
      login: 'username',
      account: 'username',
      account_username: 'username',
      mail: 'email',
      email_address: 'email',
      account_email: 'email',
      pass: 'password',
      account_password: 'password',
      email_pass: 'email_password',
      mail_password: 'email_password',
      emailpassword: 'email_password',
      twofa: 'two_fa_code',
      two_factor: 'two_fa_code',
      two_factor_code: 'two_fa_code',
      authenticator: 'two_fa_code',
      authenticator_code: 'two_fa_code',
      recovery_mail: 'recovery_email',
      recovery_email_address: 'recovery_email',
      recovery_pass: 'recovery_email_password',
      recovery_mail_password: 'recovery_email_password',
    }
    return aliases[key] || key
  }

  const headers = parseCsvLine(lines[0]).map(normalizeHeader)
  const rows = lines.slice(1)

  return rows.map(row => {
    const values = parseCsvLine(row)
    const obj: any = {}
    
    headers.forEach((header, index) => {
      obj[header] = values[index] || ''
    })
    
    return obj
  })
}

// === PRODUCT TEMPLATE MANAGEMENT ===
export interface ProductTemplate {
  productName: string
  description: string
  price: number
  categoryId: string
}

// Create a product group for bulk account uploads
export async function createProductTemplate(template: ProductTemplate): Promise<ProductGroup | null> {
  try {
    const productGroupData = {
      category_id: template.categoryId,
      name: template.productName,
      description: template.description,
      price: template.price,
      features: [],
      stock_count: 0,
      is_active: true
    }

    const productGroup = await createProductGroup(productGroupData)
    return productGroup
  } catch (error) {
    console.error('Error creating product template:', error)
    return null
  }
}

// Process CSV accounts and link them to a product group
export async function processBulkAccountUpload(
  csvData: any[], 
  productGroupId: string
): Promise<{ success: boolean; accountsCreated: number; error?: string }> {
  try {
    if (!csvData || csvData.length === 0) {
      return { success: false, accountsCreated: 0, error: 'No account data provided' }
    }

    // Validate required fields in CSV
    const requiredFields = ['password']
    const optionalFields = ['email', 'username', 'email_password', 'two_fa', 'two_fa_code']
    
    const firstRow = csvData[0]
    const hasPassword = 'password' in firstRow
    const hasEmail = 'email' in firstRow
    const hasUsername = 'username' in firstRow

    if (!hasPassword) {
      return { success: false, accountsCreated: 0, error: 'CSV must contain password field' }
    }

    if (!hasEmail && !hasUsername) {
      return { success: false, accountsCreated: 0, error: 'CSV must contain either email or username field (or both)' }
    }

    // Create accounts array
    const accountsToCreate: Omit<IndividualAccount, 'id' | 'created_at'>[] = []

    for (const row of csvData) {
      // Skip rows without required data
      if (!row.password || (!row.email && !row.username)) {
        console.warn('Skipping CSV row with missing required account data.')
        continue
      }

      const accountData: Omit<IndividualAccount, 'id' | 'created_at'> = {
        product_group_id: productGroupId,
        username: row.username || row.email || '', // Use email as username if username not provided
        password: row.password,
        email: row.email || undefined,
        email_password: row.email_password || undefined,
        two_fa_code: row.two_fa || row.two_fa_code || undefined,
        recovery_email: row.recovery_email || undefined,
        recovery_email_password: row.recovery_email_password || undefined,
        additional_info: null,
        status: 'available'
      }

      accountsToCreate.push(accountData)
    }

    if (accountsToCreate.length === 0) {
      return { success: false, accountsCreated: 0, error: 'No valid accounts found in CSV' }
    }

    // Bulk create accounts
    const createdAccounts = await bulkCreateIndividualAccounts(accountsToCreate)
    
    if (createdAccounts.length === 0) {
      return { success: false, accountsCreated: 0, error: 'Failed to create accounts' }
    }

    // Update product group stock count
    const stockUpdated = await updateProductGroupStock(productGroupId)

    if (!stockUpdated) {
      return {
        success: false,
        accountsCreated: createdAccounts.length,
        error: `${createdAccounts.length} accounts were added, but stock count failed to refresh`,
      }
    }

    return { 
      success: true, 
      accountsCreated: createdAccounts.length,
      error: createdAccounts.length < accountsToCreate.length ? 
        `${accountsToCreate.length - createdAccounts.length} accounts failed to create` : undefined
    }

  } catch (error) {
    console.error('❌ Error processing bulk account upload:', error)
    return { 
      success: false, 
      accountsCreated: 0, 
      error: error instanceof Error ? error.message : 'Unknown error occurred' 
    }
  }
}

// ===============================
// PURCHASE PROCESSING FUNCTIONS
// ===============================

// Get user's wallet balance
export async function getUserWalletBalance(userId: string): Promise<number> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('wallet_balance')
      .eq('id', userId)
      .single()

    if (error) {
      console.error('Error fetching wallet balance:', error)
      return 0
    }

    return data?.wallet_balance || 0
  } catch (error) {
    console.error('Error getting wallet balance:', error)
    return 0
  }
}

/**
 * @deprecated SECURITY RISK - DO NOT USE
 * This function has been replaced by the verify-and-credit-wallet Edge Function.
 * Use verifyAndCreditWalletSecure() instead.
 * This function will be removed in a future update.
 */
export async function updateUserWalletBalance(
  _userId: string,
  _amountToAdd: number,
  _reference?: string,
  _ercasReference?: string
): Promise<boolean> {
  console.warn('Legacy client-side wallet credit is disabled. Use verifyAndCreditWalletSecure().')
  return false
}

// Get available account for purchase
export async function getAvailableAccount(productGroupId: string): Promise<IndividualAccount | null> {
  try {
    const { data, error } = await supabase
      .from('individual_accounts_public')
      .select('id, product_group_id, username, status, created_at')
      .eq('product_group_id', productGroupId)
      .eq('status', 'available')
      .limit(1)
      .single()

    if (error) {
      console.error('Error fetching available account:', error)
      return null
    }

    return data
  } catch (error) {
    console.error('Error getting available account:', error)
    return null
  }
}

// Generate idempotency key for preventing duplicate purchases
function generateIdempotencyKey(userId: string, productGroupId: string, quantity: number): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 10);
  return `purchase_${userId.substring(0, 8)}_${productGroupId.substring(0, 8)}_${quantity}_${timestamp}_${random}`;
}

// SECURE: Process purchase via Edge Function (server-side)
export async function processPurchaseSecure(
  productGroupId: string,
  quantity: number,
  discountCode?: string,
  croContext?: {
    experimentId?: string | null
    variantId?: string | null
    assignmentMode?: string | null
    revenueContext?: Record<string, unknown> | null
  },
  preferredAccountId?: string | null,
  expectedAmountNgn?: number,
  clientIdempotencyKey?: string,
): Promise<{ success: boolean; error?: string; order_id?: string; amount?: number; new_balance?: number; reward_code?: string }> {
  try {
    // Get current session for user ID
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) {
      return { success: false, error: 'Not authenticated' };
    }

    const idempotencyKey = clientIdempotencyKey || generateIdempotencyKey(session.user.id, productGroupId, quantity);

    const { data, error } = await supabase.functions.invoke('process-purchase', {
      body: {
        product_group_id: productGroupId,
        quantity: quantity,
        idempotency_key: idempotencyKey,
        discount_code: discountCode || undefined,
        cro_context: croContext || undefined,
        revenue_context: croContext?.revenueContext || undefined,
        preferred_account_id: preferredAccountId || undefined,
        expected_amount_ngn: expectedAmountNgn,
      },
    });

    if (error) {
      console.error('❌ Edge Function error:', error);
      
      // Try to extract detailed error message from response context
      let errorMessage = error.message || 'Purchase failed';
      
      // Check if error has context with the actual error response
      if (error.context && typeof error.context === 'object') {
        const context = error.context as any;
        if (context.error) {
          errorMessage = context.error;
        } else if (context.message) {
          errorMessage = context.message;
        }
      }
      
      return { success: false, error: errorMessage };
    }

    if (!data?.success) {
      return { success: false, error: data?.error || 'Purchase failed' };
    }

    return {
      success: true,
      order_id: data.order_id,
      amount: data.amount,
      new_balance: data.new_balance,
      reward_code: data.reward_code,
    };
  } catch (error: any) {
    console.error('❌ processPurchaseSecure error:', error);
    
    // Try to extract meaningful error message
    let errorMessage = 'An unexpected error occurred';
    
    if (error?.message) {
      errorMessage = error.message;
    }
    
    // For FunctionsHttpError, try to parse the response body
    if (error?.context) {
      try {
        // Check for body in context
        if (error.context.body) {
          const body = typeof error.context.body === 'string' 
            ? JSON.parse(error.context.body) 
            : error.context.body;
          if (body.error) {
            errorMessage = body.error;
          }
        }
        // Check for error directly in context
        else if (error.context.error) {
          errorMessage = error.context.error;
        }
      } catch (e) {
        console.error('Failed to parse error context:', e);
      }
    }
    
    return { success: false, error: errorMessage };
  }
}

// SECURE: Verify payment and credit wallet via Edge Function (server-side)
export async function verifyAndCreditWalletSecure(
  transactionReference: string,
  ercasReference?: string
): Promise<{ success: boolean; error?: string; amount?: number; new_balance?: number; already_processed?: boolean }> {
  try {
    const { data, error } = await supabase.functions.invoke('verify-and-credit-wallet', {
      body: {
        transaction_reference: transactionReference,
        ercas_reference: ercasReference,
      },
    });

    if (error) {
      console.error('❌ Edge Function error:', error);
      let message = error.message || 'Verification failed';
      const context = (error as any)?.context;
      if (context && typeof context.json === 'function') {
        try {
          const body = await context.clone().json();
          message = body?.error || body?.message || message;
        } catch {
          // Keep the Supabase client error if the function did not return JSON.
        }
      }
      return { success: false, error: message };
    }

    if (!data?.success) {
      return { success: false, error: data?.error || 'Verification failed' };
    }

    return {
      success: true,
      amount: data.amount,
      new_balance: data.new_balance,
      already_processed: data.already_processed,
    };
  } catch (error) {
    console.error('❌ verifyAndCreditWalletSecure error:', error);
    return { success: false, error: 'An unexpected error occurred' };
  }
}

// Get multiple available accounts for bulk purchase
// NOTE: This function is deprecated - accounts are now fetched server-side only
export async function getAvailableAccounts(productGroupId: string, quantity: number): Promise<IndividualAccount[]> {
  try {
    const { data, error } = await supabase
      .from('individual_accounts_public')
      .select('id, product_group_id, username, status, created_at')
      .eq('product_group_id', productGroupId)
      .eq('status', 'available')
      .limit(quantity)

    if (error) {
      console.error('Error fetching available accounts:', error)
      return []
    }

    return data || []
  } catch (error) {
    console.error('Error getting available accounts:', error)
    return []
  }
}

/**
 * @deprecated SECURITY RISK - DO NOT USE
 * This function has been replaced by the process-purchase Edge Function.
 * Use processPurchaseSecure() instead.
 * This function will be removed in a future update.
 */
export async function processBulkPurchase(
  _userId: string,
  _productGroupId: string,
  _quantity: number
): Promise<{ success: boolean; error?: string; orderData?: any; accounts?: IndividualAccount[] }> {
  return {
    success: false,
    error: 'Legacy client-side purchase is disabled. Use secure checkout so stock, pricing, staff restrictions, and idempotency are enforced server-side.',
  }
}

// Process complete purchase transaction
export async function processPurchase(
  _userId: string,
  _accountId: string
): Promise<{ success: boolean; error?: string; orderData?: any }> {
  return {
    success: false,
    error: 'Legacy client-side purchase is disabled. Use secure checkout so stock, pricing, staff restrictions, and idempotency are enforced server-side.',
  }
}

// Get user's order history
export async function getUserOrders(userId: string): Promise<any[]> {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select(`
        *,
        product_groups(name, categories(name))
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching user orders:', error)
      return []
    }

    return data || []
  } catch (error) {
    console.error('Error getting user orders:', error)
    return []
  }
}

// Get user transactions
export async function getUserTransactions(userId: string): Promise<any[]> {
  try {
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching user transactions:', error)
      return []
    }

    return data || []
  } catch (error) {
    console.error('Error getting user transactions:', error)
    return []
  }
}

// Record a wallet top-up transaction
export async function recordTopUpTransaction(
  _userId: string,
  _amount: number,
  _reference: string,
  _ercasReference?: string
): Promise<boolean> {
  console.warn('Legacy client-side top-up transaction insertion is disabled. Use verifyAndCreditWalletSecure() or provider webhooks.')
  return false
}

// Get individual account by ID. Reads from individual_accounts_public (a
// safe view exposing only id/product_group_id/username/status/created_at)
// since this is used for pre-purchase browsing (Product Detail / Checkout
// preview) where the actual credentials must never be fetched client-side.
// Run supabase/migrations/20260624000000_add_individual_accounts_public_view.sql
// in Supabase for this view to exist.
export async function getIndividualAccountById(accountId: string): Promise<IndividualAccount | null> {
  try {
    const { data, error } = await supabase
      .from('individual_accounts_public')
      .select('*')
      .eq('id', accountId)
      .eq('status', 'available')
      .single()

    if (error) {
      console.error('Error fetching individual account:', error)
      return null
    }

    return data
  } catch (error) {
    console.error('Error getting individual account:', error)
    return null
  }
}

// Get product group by ID
export async function getProductGroupById(productGroupId: string): Promise<ProductGroup | null> {
  try {
    const { data, error } = await supabase
      .from('product_groups')
      .select('*, categories(name)')
      .eq('id', productGroupId)
      .eq('is_active', true)
      .single()

    if (error) {
      console.error('Error fetching product group:', error)
      return null
    }

    return data
  } catch (error) {
    console.error('Error getting product group:', error)
    return null
  }
}

// Get category by ID
export async function getCategoryById(categoryId: string): Promise<Category | null> {
  try {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .eq('id', categoryId)
      .eq('is_active', true)
      .single()

    if (error) {
      console.error('Error fetching category:', error)
      return null
    }

    return data
  } catch (error) {
    console.error('Error getting category:', error)
    return null
  }
}

// Get all users for admin dashboard
export async function getAllUsers(): Promise<Profile[]> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching users:', error)
      return []
    }

    return data || []
  } catch (error) {
    console.error('Error getting users:', error)
    return []
  }
}

// Get user count for admin dashboard
export async function getUserCount(): Promise<number> {
  try {
    const { data, error } = await supabase.rpc('get_customer_count')

    if (error) {
      console.error('Error counting customers:', error)
      return 0
    }

    return Number(data || 0)
  } catch (error) {
    console.error('Error getting customer count:', error)
    return 0
  }
}

// Get admin sales statistics from orders table
export async function getAdminSalesStats(): Promise<{ totalSales: number; totalRevenue: number }> {
  try {
    const { data: rpcData, error: rpcError } = await supabase.rpc('get_customer_sales_stats')
    if (!rpcError && Array.isArray(rpcData) && rpcData[0]) {
      return {
        totalSales: Number(rpcData[0].total_sales || 0),
        totalRevenue: Number(rpcData[0].total_revenue || 0),
      }
    }
    if (rpcError) console.warn('Customer sales stats RPC unavailable:', rpcError.message)
    return { totalSales: 0, totalRevenue: 0 }
  } catch (error) {
    console.error('Error getting admin sales stats:', error)
    return { totalSales: 0, totalRevenue: 0 }
  }
}

// ==================== USER MANAGEMENT FUNCTIONS ====================

// Search users by email or name
export async function searchUsers(query: string) {
  try {
    if (!query || query.trim() === '') {
      return getAllUsers()
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .or(`email.ilike.%${query}%,full_name.ilike.%${query}%`)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) {
      console.error('Error searching users:', error)
      throw error
    }

    return data || []
  } catch (error) {
    console.error('Error in searchUsers:', error)
    throw error
  }
}

// SECURE: Admin adjust user wallet/crypto balance via Edge Function
// Admin-triggered one-off live purchase, used by the "Test Stock" button on
// a newly-accepted product suggestion (or any product with a provider ID
// set). Separate from accepting a suggestion so spending is always its own
// explicit click - see manual-restock/index.ts for the actual buy logic.
export async function manualRestock(
  productGroupId: string,
  quantity: number,
): Promise<{ success: boolean; bought?: number; error?: string; attempts?: any[] }> {
  try {
    const { data, error } = await supabase.functions.invoke('manual-restock', {
      body: { product_group_id: productGroupId, quantity },
    })

    if (error) {
      return { success: false, error: error.message || 'Failed to reach manual-restock function' }
    }

    return data
  } catch (error) {
    console.error('❌ manualRestock failed:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Manual restock failed' }
  }
}

export async function adminAdjustBalance(
  userId: string,
  amount: number,
  reason: string,
  _adminEmail: string, // Kept for backwards compatibility, but verified server-side
  balanceType: 'wallet' | 'crypto' = 'wallet'
): Promise<{ success: boolean; newBalance: number; previousBalance?: number }> {
  try {
    const { data, error } = await supabase.functions.invoke('admin-adjust-balance', {
      body: {
        target_user_id: userId,
        adjustment_amount: amount,
        balance_type: balanceType,
        reason: reason,
        idempotency_key: `admin-${userId}-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      },
    });

    if (error) {
      console.error('Admin adjust balance Edge Function error:', error);
      let message = error.message || 'Failed to adjust balance';
      const context = (error as any)?.context;
      if (context && typeof context.json === 'function') {
        try {
          const body = await context.clone().json();
          message = body?.error || body?.message || message;
        } catch {
          // Keep the Supabase client error if the function did not return JSON.
        }
      }
      throw new Error(message);
    }

    if (!data.success) {
      throw new Error(data.error || 'Balance adjustment failed');
    }

    return { 
      success: true, 
      newBalance: data.new_balance,
      previousBalance: data.previous_balance
    };
  } catch (error) {
    console.error('Error in adminAdjustBalance:', error);
    throw error;
  }
}

// Get user's order history (admin view)
export async function getUserOrdersAdmin(userId: string) {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select(`
        *,
        product_groups (
          name,
          price,
          category_id,
          categories (
            name
          )
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching user orders:', error)
      throw error
    }

    return data || []
  } catch (error) {
    console.error('Error in getUserOrdersAdmin:', error)
    throw error
  }
}

// Legacy browser-side pending payment creation is disabled. Pending payments
// must be created by create-wallet-topup so transaction references are bound
// to the authenticated user before verification can credit a wallet.
export async function createPendingPayment(params: {
  userId: string;
  transactionReference: string;
  ercasReference?: string;
  amount: number;
}) {
  console.warn('Legacy client-side pending payment creation is disabled.')
  return null
}

// ============================================================
// App settings (key/value store for admin-configurable values)
// ============================================================

export async function getAppSetting(key: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', key)
      .maybeSingle()

    if (error || !data) return null
    return data.value
  } catch (error) {
    console.error(`Error getting app setting "${key}":`, error)
    return null
  }
}

export async function upsertAppSetting(key: string, value: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('app_settings')
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })

    if (error) {
      console.error(`Error setting app setting "${key}":`, error)
      return false
    }
    return true
  } catch (error) {
    console.error(`Error setting app setting "${key}":`, error)
    return false
  }
}

export async function getFavoriteProductGroupIds(): Promise<string[]> {
  const raw = await getAppSetting('sales_favorite_product_group_ids')
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.map((id) => String(id)).filter(Boolean)
      : []
  } catch {
    return raw
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
  }
}

export async function setFavoriteProductGroupIds(productGroupIds: string[]): Promise<boolean> {
  const uniqueIds = [...new Set(productGroupIds.map((id) => String(id).trim()).filter(Boolean))]
  return upsertAppSetting('sales_favorite_product_group_ids', JSON.stringify(uniqueIds))
}

// ============================================================
// Referral system
// ============================================================

// Generate a short, deterministic referral code from a user id
export function generateReferralCode(userId: string): string {
  return userId.replace(/-/g, '').substring(0, 8).toUpperCase()
}

// Legacy client-side referral attribution is disabled. Use the apply-referral
// edge function after authentication so callers cannot choose arbitrary user ids.
export async function applyReferralOnSignup(
  _userId: string,
  _referralCodeInput?: string
): Promise<void> {
  console.warn('Legacy client-side referral signup attribution is disabled.')
}

// Legacy client-side purchase referral rewards are disabled. Referral rewards
// must be credited by server-side payment/deposit functions only.
export async function rewardReferrerForPurchase(
  _userId: string,
  _orderAmount: number
): Promise<void> {
  console.warn('Legacy client-side referral purchase reward is disabled. Referral rewards must be credited by server-side payment functions.')
}

// Get a user's referral stats: their code, balance, and earnings history
export async function getReferralStats(userId: string): Promise<{
  referralCode: string | null
  referralBalance: number
  totalReferred: number
  earnings: Array<{ id: string; order_amount: number; commission_amount: number; created_at: string }>
}> {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('referral_code, referral_balance')
      .eq('id', userId)
      .single()

    const { data: earnings } = await supabase
      .from('referral_earnings')
      .select('id, order_amount, commission_amount, created_at')
      .eq('referrer_id', userId)
      .order('created_at', { ascending: false })

    // Same RLS issue as applyReferralOnSignup: counting OTHER users whose
    // referred_by = me is a cross-user read that profiles RLS silently
    // blocks (returns 0, no error). Use the referral_lookup view instead.
    const { count: totalReferred } = await supabase
      .from('referral_lookup')
      .select('*', { count: 'exact', head: true })
      .eq('referred_by', userId)

    return {
      referralCode: profile?.referral_code || null,
      referralBalance: profile?.referral_balance || 0,
      totalReferred: totalReferred || 0,
      earnings: earnings || []
    }
  } catch (error) {
    console.error('Error getting referral stats:', error)
    return { referralCode: null, referralBalance: 0, totalReferred: 0, earnings: [] }
  }
}

// Move referral_balance into the user's main wallet_balance so it can be
// spent or withdrawn through existing flows.
//
// This used to write directly to profiles.wallet_balance/referral_balance
// from the browser. That update never errored but also never actually moved
// anything - profiles RLS doesn't let authenticated users write their own
// balance columns directly (same as every other balance change in this app),
// so it silently touched 0 rows while still reporting success. Moved into
// the withdraw-referral-balance edge function (service role) instead.
export async function withdrawReferralBalance(_userId: string): Promise<{ success: boolean; error?: string; amount?: number }> {
  try {
    const { data, error } = await supabase.functions.invoke('withdraw-referral-balance', {
      body: {},
    })

    if (error) {
      let errorMessage = error.message || 'Failed to withdraw referral balance'
      if (error.context && typeof error.context === 'object') {
        const context = error.context as any
        if (context.error) errorMessage = context.error
        else if (context.message) errorMessage = context.message
      }
      return { success: false, error: errorMessage }
    }

    if (!data?.success) {
      return { success: false, error: data?.error || 'Failed to withdraw referral balance' }
    }

    return { success: true, amount: data.amount }
  } catch (error) {
    console.error('Error withdrawing referral balance:', error)
    return { success: false, error: 'Failed to withdraw referral balance' }
  }
}

// Global "Recent Activity" social-proof feed item (masked, safe to show to
// logged-out visitors too — see get_recent_activity_feed() in
// add-global-activity-feed.sql for what's actually exposed).
export interface GlobalActivityItem {
  kind: 'deposit' | 'order'
  maskedName: string
  amount: number
  label: string
  createdAt: string
}

// Fetches real, masked site-wide activity via the get_recent_activity_feed
// Postgres function (SECURITY DEFINER — never exposes raw user rows). Safe to
// call from anon (logged-out) context.
export async function getGlobalActivityFeed(limit = 12): Promise<GlobalActivityItem[]> {
  try {
    const { data, error } = await supabase.rpc('get_recent_activity_feed', { p_limit: limit })
    if (error) throw error

    return ((data || []) as Array<{
      kind: 'deposit' | 'order'
      masked_name: string
      amount: number
      label: string
      created_at: string
    }>).map((row) => ({
      kind: row.kind,
      maskedName: row.masked_name,
      amount: Number(row.amount) || 0,
      label: row.label,
      createdAt: row.created_at,
    }))
  } catch (error) {
    console.error('Error loading global activity feed:', error)
    return []
  }
}

// Get total user count, formatted for stat displays (e.g. "1,204" or "12.3K")
export function formatCount(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return n.toString()
}

// Used by PocketFi top-up polling: PocketFi credits the wallet via webhook
// (webhook-pocketfi) rather than a client-callable verify endpoint, so the
// client just checks whether a transaction row with this reference has shown up yet.
export async function checkTransactionByReference(reference: string): Promise<{
  found: boolean
  amount?: number
  status?: string
}> {
  try {
    const { data, error } = await supabase
      .from('transactions')
      .select('amount, status')
      .eq('reference', reference)
      .maybeSingle()

    if (error || !data) return { found: false }
    return { found: true, amount: data.amount, status: data.status }
  } catch (error) {
    console.error('Error checking transaction by reference:', error)
    return { found: false }
  }
}

// ---------------------------------------------------------------------------
// Discount codes / flash sales
// ---------------------------------------------------------------------------

export interface DiscountCode {
  id: string
  code: string
  percent_off: number
  category_id: string | null
  product_group_id: string | null
  max_uses: number | null
  used_count: number
  expires_at: string | null
  is_active: boolean
  created_at: string
  max_order_amount?: number | null  // code only valid for orders ≤ this amount (NGN)
  user_id?: string | null           // null = store-wide; set = single-user reward code
  is_reward?: boolean               // true = auto-generated loyalty reward
}

export async function getDiscountCodes(): Promise<DiscountCode[]> {
  try {
    const { data, error } = await supabase
      .from('discount_codes')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) {
      console.error('❌ Error fetching discount codes:', error)
      return []
    }
    return data || []
  } catch (error) {
    console.error('❌ Failed to fetch discount codes:', error)
    return []
  }
}

export async function createDiscountCode(input: {
  code: string
  percent_off: number
  category_id?: string | null
  product_group_id?: string | null
  max_uses?: number | null
  expires_at?: string | null
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase.from('discount_codes').insert({
      code: input.code.trim().toUpperCase(),
      percent_off: input.percent_off,
      category_id: input.category_id || null,
      product_group_id: input.product_group_id || null,
      max_uses: input.max_uses || null,
      expires_at: input.expires_at || null,
    })
    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (error) {
    console.error('❌ Failed to create discount code:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create code' }
  }
}

export async function setDiscountCodeActive(id: string, isActive: boolean): Promise<boolean> {
  try {
    const { error } = await supabase.from('discount_codes').update({ is_active: isActive }).eq('id', id)
    return !error
  } catch (error) {
    console.error('❌ Failed to update discount code:', error)
    return false
  }
}

// Client-side preview only - this is NOT the source of truth for the actual
// charge. The purchase edge function re-validates and re-applies the code
// server-side before deducting wallet balance, so a tampered client value
// here can never result in an incorrect charge.
export async function previewDiscountCode(
  code: string,
  productGroupId: string,
  categoryId: string | null,
  orderTotal?: number,
): Promise<{ valid: boolean; percentOff?: number; error?: string }> {
  if (!DISCOUNTS_ENABLED) return { valid: false, error: 'Discount codes are temporarily unavailable' }
  if (!code.trim()) return { valid: false, error: 'Enter a code' }
  try {
    const { data, error } = await supabase
      .from('discount_codes')
      .select('*')
      .eq('code', code.trim().toUpperCase())
      .eq('is_active', true)
      .maybeSingle()

    if (error || !data) return { valid: false, error: 'Invalid or expired code' }
    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      return { valid: false, error: 'This code has expired' }
    }
    if (data.max_uses && data.used_count >= data.max_uses) {
      return { valid: false, error: 'This code has reached its usage limit' }
    }
    if (data.product_group_id && data.product_group_id !== productGroupId) {
      return { valid: false, error: 'This code is not valid for this product' }
    }
    if (data.category_id && !data.product_group_id && data.category_id !== categoryId) {
      return { valid: false, error: 'This code is not valid for this category' }
    }
    // Reward codes are user-specific — verify the current user owns this code
    if (data.user_id) {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || user.id !== data.user_id) {
        return { valid: false, error: 'This code is not valid for your account' }
      }
    }
    // Reward codes have a maximum order amount
    if (data.max_order_amount && orderTotal !== undefined && orderTotal > data.max_order_amount) {
      return { valid: false, error: `This code is only valid for orders up to ₦${data.max_order_amount.toLocaleString('en-NG')}` }
    }
    return { valid: true, percentOff: data.percent_off }
  } catch (error) {
    console.error('❌ Failed to preview discount code:', error)
    return { valid: false, error: 'Failed to validate code' }
  }
}
