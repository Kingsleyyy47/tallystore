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
    console.log('🔍 Testing Supabase auth connection...')
    
    // Test basic connection
    const { data: { session } } = await supabase.auth.getSession()
    console.log('✅ Supabase auth connection successful')
    
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
    
    console.log('✅ Profiles table exists and accessible')
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

// Picks the best applicable tier for a given quantity (highest min_qty the
// quantity meets or exceeds) and returns the discounted total. Mirrors the
// exact same logic used server-side in process-purchase/index.ts - if you
// change this, change that too, or displayed totals will stop matching what
// actually gets charged.
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
    .filter((t) => quantity >= t.min_qty)
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
export async function getCategories(): Promise<Category[]> {
  try {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .eq('is_active', true)
      .order('name')

    if (error) {
      console.error('Supabase error:', error)
      throw error
    }

    console.log('✅ Categories fetched from Supabase:', data)
    return data || []
  } catch (error) {
    console.error('❌ Error fetching categories:', error)
    return []
  }
}

export async function getAllProductGroups(): Promise<ProductGroup[]> {
  try {
    const { data, error } = await supabase
      .from('product_groups')
      .select('*')
      .eq('is_active', true)
      .order('name')

    if (error) {
      console.error('Supabase error:', error)
      throw error
    }

    console.log('✅ Product groups fetched from Supabase:', data)
    return data || []
  } catch (error) {
    console.error('❌ Error fetching product groups:', error)
    return []
  }
}

export async function testConnection() {
  try {
    // Test basic Supabase connection without hitting RLS policies
    // Just test if we can reach Supabase at all
    const { data: { session } } = await supabase.auth.getSession()
    
    console.log('🔗 Supabase connection successful!')
    console.log('📊 Current session:', session ? 'Authenticated' : 'Anonymous')
    
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

    console.log('✅ Category created:', data)
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

    console.log('✅ Category updated:', data)
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

    console.log('✅ Category deleted:', id)
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

    console.log('✅ Product group created:', data)
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

    console.log('✅ Product group updated:', data)
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

    console.log('✅ Product group deleted:', id)
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

    console.log('✅ Product group archived:', id)
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

    console.log('✅ Product group restored:', id)
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

    console.log('✅ Individual account created:', data)
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

    console.log('✅ Bulk accounts created:', data.length)
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

// Real "most bought" ranking for the Popular Products section, computed from
// completed orders rather than a stock-count proxy. Sums the quantity stored
// in each order's account_details JSON (falls back to 1 per order if missing)
// per product_group_id, and returns the top N ids, highest units-sold first.
export async function getTopSellingProductGroupIds(limit: number = 8): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('product_group_id, account_details')
      .eq('status', 'completed')
      .limit(5000)

    if (error) {
      console.error('❌ Error fetching orders for top sellers:', error)
      throw error
    }

    const totals: Record<string, number> = {}
    for (const row of data || []) {
      if (!row.product_group_id) continue
      const details = row.account_details as { quantity?: number } | null
      const qty = details && typeof details.quantity === 'number' && details.quantity > 0
        ? details.quantity
        : 1
      totals[row.product_group_id] = (totals[row.product_group_id] || 0) + qty
    }

    return Object.entries(totals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id]) => id)
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
}> {
  const empty = { productGroupCounts: {}, categoryCounts: {} }
  if (!userId) return empty

  try {
    const { data, error } = await supabase
      .from('orders')
      .select('product_group_id, account_details, product_groups(category_id)')
      .eq('user_id', userId)
      .eq('status', 'completed')
      .limit(2000)

    if (error) {
      console.error('❌ Error fetching user purchase history:', error)
      return empty
    }

    const productGroupCounts: Record<string, number> = {}
    const categoryCounts: Record<string, number> = {}

    for (const row of (data || []) as any[]) {
      if (!row.product_group_id) continue
      const details = row.account_details as { quantity?: number } | null
      const qty = details && typeof details.quantity === 'number' && details.quantity > 0
        ? details.quantity
        : 1
      productGroupCounts[row.product_group_id] = (productGroupCounts[row.product_group_id] || 0) + qty

      const categoryId = row.product_groups?.category_id
      if (categoryId) {
        categoryCounts[categoryId] = (categoryCounts[categoryId] || 0) + qty
      }
    }

    return { productGroupCounts, categoryCounts }
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
      .select('product_group_id, account_details, created_at, status')
      .eq('status', 'completed')
      .gte('created_at', fourteenDaysAgo)
      .limit(5000)

    if (error) throw error

    const productGroups = await getAllProductGroups()
    const pgById: Record<string, ProductGroup> = {}
    productGroups.forEach((pg) => { pgById[pg.id] = pg })

    const recentByCategory: Record<string, number> = {}
    const previousByCategory: Record<string, number> = {}
    const recentByProduct: Record<string, number> = {}

    for (const row of orders || []) {
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

    console.log('✅ Individual account deleted:', id)
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

    console.log('✅ Individual account updated:', data)
    return data
  } catch (error) {
    console.error('❌ Failed to update individual account:', error)
    return null
  }
}

// === UTILITY FUNCTIONS ===
export async function updateProductGroupStock(productGroupId: string): Promise<void> {
  try {
    // Count available accounts
    const { count, error } = await supabase
      .from('individual_accounts')
      .select('*', { count: 'exact', head: true })
      .eq('product_group_id', productGroupId)
      .eq('status', 'available')

    if (error) {
      console.error('❌ Error counting accounts:', error)
      return
    }

    // Update the product group stock
    const { error: updateError } = await supabase
      .from('product_groups')
      .update({ stock_count: count || 0 })
      .eq('id', productGroupId)

    if (updateError) {
      console.error('❌ Error updating stock:', updateError)
      return
    }

    console.log('✅ Stock updated for product group:', productGroupId, 'New count:', count)
  } catch (error) {
    console.error('❌ Failed to update stock:', error)
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
export function parseCSV(csvText: string): any[] {
  const lines = csvText.trim().split('\n')
  if (lines.length < 2) return []

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase())
  const rows = lines.slice(1)

  return rows.map(row => {
    const values = row.split(',').map(v => v.trim())
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
    console.log('📤 Processing bulk account upload for product group:', productGroupId)

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
        console.warn('Skipping row with missing required data:', row)
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
    await updateProductGroupStock(productGroupId)

    console.log(`✅ Successfully created ${createdAccounts.length} accounts`)
    
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
  userId: string,
  amountToAdd: number,
  reference?: string,
  ercasReference?: string
): Promise<boolean> {
  try {
    // If a reference is provided, ensure we haven't processed it already
    if (reference) {
      const { data: existingTx, error: existingErr } = await supabase
        .from('transactions')
        .select('id')
        .or(`reference.eq.${reference},ercas_reference.eq.${ercasReference || ''}`)
        .limit(1)

      if (existingErr) {
        console.error('❌ Error checking existing transaction for idempotency:', existingErr)
      }

      if (existingTx && (existingTx as any[]).length > 0) {
        console.log('⏭️ Transaction already processed, skipping wallet update:', reference)
        return true
      }
    }

    // Retry loop to avoid race conditions: update only when balance matches the read value
    const maxAttempts = 5
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // CRITICAL: If this is a retry (attempt > 0) and we have a reference, 
      // check if the transaction was recorded by another concurrent process while we were failing.
      if (reference && attempt > 0) {
        const { data: retryCheckTx } = await supabase
          .from('transactions')
          .select('id')
          .or(`reference.eq.${reference},ercas_reference.eq.${ercasReference || ''}`)
          .limit(1)
        
        if (retryCheckTx && (retryCheckTx as any[]).length > 0) {
          console.log('⏭️ Transaction found during retry check, skipping wallet update:', reference)
          return true
        }
      }

      const currentBalance = await getUserWalletBalance(userId)
      const newBalance = currentBalance + amountToAdd

      const { data, error } = await supabase
        .from('profiles')
        .update({ wallet_balance: newBalance, updated_at: new Date().toISOString() })
        .match({ id: userId, wallet_balance: currentBalance })
        .select()
        .single()

      if (error) {
        // If it's the last attempt, throw; otherwise retry
        if (attempt === maxAttempts - 1) {
          console.error('❌ Error updating wallet balance after retries:', error)
          throw error
        }
        console.warn('⚠️ Transient error updating wallet balance, retrying...', { attempt, error })
        await new Promise((r) => setTimeout(r, 200 * (attempt + 1)))
        continue
      }

      if (!data) {
        // No rows updated (likely due to concurrent modification) — retry
        console.log('🔁 Wallet update conflict detected, retrying...', { attempt })
        await new Promise((r) => setTimeout(r, 150 * (attempt + 1)))
        continue
      }

      // Successfully updated balance — record transaction if reference provided
      if (reference) {
        try {
          const { error: txError } = await supabase
            .from('transactions')
            .insert([{
              user_id: userId,
              type: 'topup',
              amount: amountToAdd,
              status: 'completed',
              balance_after: newBalance,
              description: `Wallet top-up via Ercas Pay`,
              reference,
              ercas_reference: ercasReference
            }])

          if (txError) {
            console.error('❌ Failed to record top-up transaction after wallet update:', txError)
          } else {
            console.log('✅ Top-up transaction recorded during wallet update:', reference)
          }
        } catch (txErr) {
          console.error('❌ Exception while recording top-up transaction:', txErr)
        }
      }

      console.log(`✅ Wallet updated: ${userId} +₦${amountToAdd} (New balance: ₦${newBalance})`)
      return true
    }

    console.error('❌ Failed to update wallet after max retries')
    return false
  } catch (error) {
    console.error('❌ Failed to update wallet balance:', error)
    return false
  }
}

// Get available account for purchase
export async function getAvailableAccount(productGroupId: string): Promise<IndividualAccount | null> {
  try {
    const { data, error } = await supabase
      .from('individual_accounts')
      .select('*')
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
): Promise<{ success: boolean; error?: string; order_id?: string; amount?: number; new_balance?: number; reward_code?: string }> {
  try {
    // Get current session for user ID
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) {
      return { success: false, error: 'Not authenticated' };
    }

    const idempotencyKey = generateIdempotencyKey(session.user.id, productGroupId, quantity);

    console.log('🛒 Calling secure purchase Edge Function:', { productGroupId, quantity });

    const { data, error } = await supabase.functions.invoke('process-purchase', {
      body: {
        product_group_id: productGroupId,
        quantity: quantity,
        idempotency_key: idempotencyKey,
        discount_code: discountCode || undefined,
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

    console.log('✅ Secure purchase completed:', data);
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
    console.log('🔍 Calling secure verify-and-credit Edge Function:', transactionReference);

    const { data, error } = await supabase.functions.invoke('verify-and-credit-wallet', {
      body: {
        transaction_reference: transactionReference,
        ercas_reference: ercasReference,
      },
    });

    if (error) {
      console.error('❌ Edge Function error:', error);
      return { success: false, error: error.message || 'Verification failed' };
    }

    if (!data?.success) {
      return { success: false, error: data?.error || 'Verification failed' };
    }

    console.log('✅ Wallet credited:', data);
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
      .from('individual_accounts')
      .select('*')
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
  userId: string, 
  productGroupId: string,
  quantity: number
): Promise<{ success: boolean; error?: string; orderData?: any; accounts?: IndividualAccount[] }> {
  try {
    console.log('🛒 Starting bulk purchase process for user:', userId, 'productGroup:', productGroupId, 'quantity:', quantity)

    // 1. Get product group details for pricing
    const { data: productGroup, error: productError } = await supabase
      .from('product_groups')
      .select('*, categories(name)')
      .eq('id', productGroupId)
      .single()

    if (productError || !productGroup) {
      console.error('Product group not found:', productError)
      return { success: false, error: 'Product not found' }
    }

    // 2. Check if enough accounts are available
    const availableAccounts = await getAvailableAccounts(productGroupId, quantity)
    if (availableAccounts.length < quantity) {
      return { 
        success: false, 
        error: `Only ${availableAccounts.length} accounts available, but ${quantity} requested` 
      }
    }

    // 3. Check user wallet balance
    const totalPrice = productGroup.price * quantity
    const walletBalance = await getUserWalletBalance(userId)
    if (walletBalance < totalPrice) {
      return { success: false, error: 'Insufficient wallet balance' }
    }

    // 4. Reserve all selected accounts
    const accountIds = availableAccounts.map(acc => acc.id)
    const { error: reserveError } = await supabase
      .from('individual_accounts')
      .update({ status: 'reserved' })
      .in('id', accountIds)
      .eq('status', 'available')

    if (reserveError) {
      console.error('Failed to reserve accounts:', reserveError)
      return { success: false, error: 'Failed to reserve accounts - some may have been sold to others' }
    }

    // 5. Deduct wallet balance
    const { error: balanceError } = await supabase
      .from('profiles')
      .update({ 
        wallet_balance: walletBalance - totalPrice,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)

    if (balanceError) {
      // Rollback: unreserve the accounts
      await supabase
        .from('individual_accounts')
        .update({ status: 'available' })
        .in('id', accountIds)
      
      return { success: false, error: 'Failed to process payment' }
    }

    // 6. Create order record - using actual database schema
    const orderData = {
      user_id: userId,
      product_group_id: productGroupId, // Changed back to product_group_id for foreign key
      amount: totalPrice,
      status: 'completed',
      account_details: {
        accounts: availableAccounts.map(acc => ({
          username: acc.username,
          password: acc.password,
          email: acc.email,
          email_password: acc.email_password,
          two_fa_code: acc.two_fa_code,
          additional_info: acc.additional_info
        })),
        product_name: productGroup.name,
        category: productGroup.categories?.name,
        quantity: quantity,
        price_per_unit: productGroup.price
      }
    }

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert([orderData])
      .select()
      .single()

    if (orderError) {
      console.error('❌ Order creation failed:', orderError)
      console.error('❌ Order data that failed:', orderData)
      
      // Rollback: restore wallet balance and unreserve accounts
      await supabase
        .from('profiles')
        .update({ wallet_balance: walletBalance })
        .eq('id', userId)
      
      await supabase
        .from('individual_accounts')
        .update({ status: 'available' })
        .in('id', accountIds)
      
      return { success: false, error: `Failed to create order: ${orderError.message}` }
    }

    // 7. Mark accounts as sold
    const { error: soldError } = await supabase
      .from('individual_accounts')
      .update({ 
        status: 'sold',
        sold_at: new Date().toISOString()
      })
      .in('id', accountIds)

    if (soldError) {
      console.error('Warning: Accounts not marked as sold, but purchase completed')
    }

    // 8. Update product group stock count
    await updateProductGroupStock(productGroupId)

    // 9. Record transaction
    const newBalance = walletBalance - totalPrice
    await supabase
      .from('transactions')
      .insert([{
        user_id: userId,
        type: 'purchase',
        amount: -totalPrice,
        balance_after: newBalance,
        description: `Bulk Purchase: ${quantity}x ${productGroup.name}`,
        reference: `ORD-${order.id.substring(0, 8).toUpperCase()}`
      }])

    // Reward the referrer (if any) for this purchase - non-blocking
    rewardReferrerForPurchase(userId, totalPrice)

    console.log('✅ Bulk purchase completed successfully!')
    
    // Update product group stock count
    await updateProductGroupStock(productGroupId)
    return { 
      success: true, 
      orderData: {
        ...order,
        product_name: productGroup.name,
        category: productGroup.categories?.name
      },
      accounts: availableAccounts
    }

  } catch (error) {
    console.error('❌ Bulk purchase processing error:', error)
    return { success: false, error: 'Purchase failed. Please try again.' }
  }
}

// Process complete purchase transaction
export async function processPurchase(
  userId: string, 
  accountId: string
): Promise<{ success: boolean; error?: string; orderData?: any }> {
  try {
    console.log('🛒 Starting purchase process for user:', userId, 'account:', accountId)

    // 1. Get the specific account details
    const { data: account, error: accountError } = await supabase
      .from('individual_accounts')
      .select('*')
      .eq('id', accountId)
      .eq('status', 'available')
      .single()

    if (accountError || !account) {
      console.error('Account not found or not available:', accountError)
      return { success: false, error: 'Account not found or no longer available' }
    }

    // 2. Get product group details for pricing
    const { data: productGroup, error: productError } = await supabase
      .from('product_groups')
      .select('*, categories(name)')
      .eq('id', account.product_group_id)
      .single()

    if (productError || !productGroup) {
      console.error('Product group not found:', productError)
      return { success: false, error: 'Product details not found' }
    }

    // 3. Check user wallet balance
    const walletBalance = await getUserWalletBalance(userId)
    if (walletBalance < productGroup.price) {
      return { success: false, error: 'Insufficient wallet balance' }
    }

    // 4. Reserve the account first (prevent double-selling)
    const { error: reserveError } = await supabase
      .from('individual_accounts')
      .update({ status: 'reserved' })
      .eq('id', accountId)
      .eq('status', 'available') // Double-check it's still available

    if (reserveError) {
      console.error('Failed to reserve account:', reserveError)
      return { success: false, error: 'Failed to reserve account - may have been purchased by someone else' }
    }

    // 5. Deduct wallet balance
    const { error: balanceError } = await supabase
      .from('profiles')
      .update({ 
        wallet_balance: walletBalance - productGroup.price,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)

    if (balanceError) {
      // Rollback: unreserve the account
      await supabase
        .from('individual_accounts')
        .update({ status: 'available' })
        .eq('id', accountId)
      
      return { success: false, error: 'Failed to process payment' }
    }

    // 6. Create order record
    const orderData = {
      user_id: userId,
      product_group_id: account.product_group_id, // Changed back to product_group_id
      amount: productGroup.price,
      status: 'completed',
      account_details: {
        username: account.username,
        password: account.password,
        email: account.email,
        email_password: account.email_password,
        two_fa_code: account.two_fa_code,
        additional_info: account.additional_info,
        product_name: productGroup.name,
        category: productGroup.categories?.name,
        quantity: 1,
        price_per_unit: productGroup.price
      }
    }

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert([orderData])
      .select()
      .single()

    if (orderError) {
      console.error('❌ Single account order creation failed:', orderError)
      console.error('❌ Order data that failed:', orderData)
      
      // Rollback: restore wallet balance and unreserve account
      await supabase
        .from('profiles')
        .update({ wallet_balance: walletBalance })
        .eq('id', userId)
      
      await supabase
        .from('individual_accounts')
        .update({ status: 'available' })
        .eq('id', accountId)
      
      return { success: false, error: `Failed to create order: ${orderError.message}` }
    }

    // 7. Mark account as sold
    const { error: soldError } = await supabase
      .from('individual_accounts')
      .update({ 
        status: 'sold',
        sold_at: new Date().toISOString()
      })
      .eq('id', accountId)

    if (soldError) {
      console.error('Warning: Account not marked as sold, but purchase completed')
    }

    // 8. Update product group stock count
    await updateProductGroupStock(account.product_group_id)

    // 9. Record transaction
    const newBalance = walletBalance - productGroup.price
    await supabase
      .from('transactions')
      .insert([{
        user_id: userId,
        type: 'purchase',
        amount: -productGroup.price,
        balance_after: newBalance,
        description: `Purchase: ${productGroup.name}`,
        reference: `ORD-${order.id.substring(0, 8).toUpperCase()}`
      }])

    console.log('✅ Purchase completed successfully!')
    
    // Update product group stock count
    await updateProductGroupStock(account.product_group_id)
    return { 
      success: true, 
      orderData: {
        ...order,
        product_name: productGroup.name,
        category: productGroup.categories?.name
      }
    }

  } catch (error) {
    console.error('❌ Purchase processing error:', error)
    return { success: false, error: 'Purchase failed. Please try again.' }
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
  userId: string, 
  amount: number, 
  reference: string, 
  ercasReference?: string
): Promise<boolean> {
  try {
    // Get current balance to calculate balance_after
    const currentBalance = await getUserWalletBalance(userId);
    
    const transactionData = {
      user_id: userId,
      type: 'topup' as const,
      amount: amount,
      status: 'completed', // Add status field to match purchase transactions
      balance_after: currentBalance + amount, // balance after top-up
      description: `Wallet top-up via Ercas Pay`, // Add description
      reference: reference,
      ercas_reference: ercasReference
    };

    console.log('📝 Attempting to record transaction:', transactionData);

    const { data, error } = await supabase
      .from('transactions')
      .insert([transactionData]) // Use array format like purchase transactions
      .select() // Get the inserted record back

    if (error) {
      console.error('❌ Detailed transaction error:', {
        error,
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
        data: transactionData
      });
      throw error
    }

    console.log(`✅ Top-up transaction recorded successfully:`, data)
    console.log(`✅ Summary: User ${userId} +₦${amount} (${reference})`)
    return true
  } catch (error) {
    console.error('❌ Failed to record top-up transaction:', error)
    return false
  }
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
    const { count, error } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })

    if (error) {
      console.error('Error counting users:', error)
      return 0
    }

    return count || 0
  } catch (error) {
    console.error('Error getting user count:', error)
    return 0
  }
}

// Get admin sales statistics from orders table
export async function getAdminSalesStats(): Promise<{ totalSales: number; totalRevenue: number }> {
  try {
    // Get total count of completed orders using exact count (bypasses 1000 row limit)
    const { count: totalSales, error: countError } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'completed')

    if (countError) {
      console.error('Error fetching sales count:', countError)
      return { totalSales: 0, totalRevenue: 0 }
    }

    // For revenue, we need to fetch amounts in batches to handle >1000 orders
    // Supabase doesn't support SUM aggregation directly, so we paginate
    let totalRevenue = 0
    const batchSize = 1000
    let offset = 0
    let hasMore = true

    while (hasMore) {
      const { data: orders, error: revenueError } = await supabase
        .from('orders')
        .select('amount')
        .eq('status', 'completed')
        .range(offset, offset + batchSize - 1)

      if (revenueError) {
        console.error('Error fetching revenue batch:', revenueError)
        break
      }

      if (!orders || orders.length === 0) {
        hasMore = false
      } else {
        totalRevenue += orders.reduce((sum, order) => sum + (order.amount || 0), 0)
        offset += batchSize
        // If we got fewer than batchSize, we've reached the end
        if (orders.length < batchSize) {
          hasMore = false
        }
      }
    }

    return { totalSales: totalSales || 0, totalRevenue }
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
      throw new Error(error.message || 'Failed to adjust balance');
    }

    if (!data.success) {
      throw new Error(data.error || 'Balance adjustment failed');
    }

    console.log('✅ Balance adjusted via Edge Function:', {
      user: data.target_email,
      previousBalance: data.previous_balance,
      adjustment: data.adjustment,
      newBalance: data.new_balance,
      reason: data.reason,
      admin: data.adjusted_by
    });

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

// Create pending payment record for automatic recovery
export async function createPendingPayment(params: {
  userId: string;
  transactionReference: string;
  ercasReference?: string;
  amount: number;
}) {
  try {
    const { data, error } = await supabase
      .from('pending_payments')
      .insert({
        user_id: params.userId,
        transaction_reference: params.transactionReference,
        ercas_reference: params.ercasReference || null,
        amount: params.amount,
        status: 'pending'
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating pending payment:', error)
      throw error
    }

    console.log('✅ Pending payment record created:', data)
    return data
  } catch (error) {
    console.error('Error in createPendingPayment:', error)
    // Don't throw - this is optional tracking, shouldn't block payment
    return null
  }
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
      .single()

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

// ============================================================
// Referral system
// ============================================================

// Generate a short, deterministic referral code from a user id
export function generateReferralCode(userId: string): string {
  return userId.replace(/-/g, '').substring(0, 8).toUpperCase()
}

// Called right after a successful signup. Generates this user's own
// referral_code, and if they signed up with someone else's code,
// records who referred them.
export async function applyReferralOnSignup(
  userId: string,
  referralCodeInput?: string
): Promise<void> {
  try {
    const ownCode = generateReferralCode(userId)
    const update: Record<string, any> = { referral_code: ownCode }

    if (referralCodeInput && referralCodeInput.trim()) {
      const cleanCode = referralCodeInput.trim().toUpperCase()

      // Don't let someone refer themselves
      if (cleanCode !== ownCode) {
        // Look up the referrer's id via the referral_lookup view, not the
        // profiles table directly - profiles RLS only allows a user to read
        // their own row, so a direct cross-user select here silently
        // returns nothing (no error) and referred_by never gets set. Run
        // supabase/migrations/20260625000000_add_referral_lookup_view.sql
        // in Supabase for this view to exist.
        const { data: referrer } = await supabase
          .from('referral_lookup')
          .select('id')
          .eq('referral_code', cleanCode)
          .maybeSingle()

        if (referrer) {
          update.referred_by = referrer.id
        }
      }
    }

    const { error } = await supabase
      .from('profiles')
      .update(update)
      .eq('id', userId)

    if (error) {
      console.error('Error applying referral on signup:', error)
    }
  } catch (error) {
    console.error('Error in applyReferralOnSignup:', error)
  }
}

// Called after a purchase completes. If the buyer was referred by
// someone, credits that referrer's referral_balance and logs the
// reward to referral_earnings for audit purposes.
export async function rewardReferrerForPurchase(
  userId: string,
  orderAmount: number
): Promise<void> {
  try {
    const { data: buyerProfile, error: buyerError } = await supabase
      .from('profiles')
      .select('referred_by')
      .eq('id', userId)
      .single()

    if (buyerError || !buyerProfile?.referred_by) return

    const referrerId = buyerProfile.referred_by

    const pctSetting = await getAppSetting('referral_commission_pct')
    const commissionPct = pctSetting ? parseFloat(pctSetting) : 5
    const commissionAmount = (orderAmount * commissionPct) / 100

    if (commissionAmount <= 0) return

    const { data: referrerProfile, error: referrerError } = await supabase
      .from('profiles')
      .select('referral_balance')
      .eq('id', referrerId)
      .single()

    if (referrerError || !referrerProfile) return

    const newBalance = (referrerProfile.referral_balance || 0) + commissionAmount

    await supabase
      .from('profiles')
      .update({ referral_balance: newBalance })
      .eq('id', referrerId)

    await supabase
      .from('referral_earnings')
      .insert([{
        referrer_id: referrerId,
        referred_user_id: userId,
        order_amount: orderAmount,
        commission_pct: commissionPct,
        commission_amount: commissionAmount
      }])

    console.log(`✅ Referral reward: ₦${commissionAmount} credited to referrer ${referrerId}`)
  } catch (error) {
    console.error('Error rewarding referrer for purchase:', error)
    // Don't throw - referral rewards shouldn't block a purchase
  }
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
// (api/webhook-pocketfi.ts) rather than a client-callable verify endpoint, so the
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
