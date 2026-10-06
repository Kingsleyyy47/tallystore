// STEP 1: Basic Supabase Service
// Simple functions to get categories and product groups

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''
const PUBLIC_PRODUCT_GROUP_COLUMNS =
  'id,category_id,name,description,price,features,stock_count,availability_status,is_sellable,is_active,created_at,quantity_discount_tiers'

export const supabase = createClient(supabaseUrl, supabaseKey)

// Basic types for Step 1
export interface Category {
  id: string
  name: string
  display_name: string
  description: string | null
  is_active: boolean
  created_at: string
}

export interface ProductGroup {
  id: string
  category_id: string
  name: string
  description: string | null
  price: number
  features: unknown
  stock_count: number
  availability_status: string | null
  is_sellable: boolean | null
  is_active: boolean
  created_at: string
  quantity_discount_tiers: unknown
}

// Step 1: Get all categories
export async function getCategories(): Promise<Category[]> {
  try {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .eq('is_active', true)
      .order('display_name')

    if (error) throw error
    return data || []
  } catch (error) {
    console.error('Error fetching categories:', error)
    return []
  }
}

// Step 1: Get product groups by category
export async function getProductGroupsByCategory(categoryId: string): Promise<ProductGroup[]> {
  try {
    const { data, error } = await supabase
      .from('product_groups')
      .select(PUBLIC_PRODUCT_GROUP_COLUMNS)
      .eq('category_id', categoryId)
      .eq('is_active', true)
      .order('name')

    if (error) throw error
    return data || []
  } catch (error) {
    console.error('Error fetching product groups:', error)
    return []
  }
}

// Step 1: Get all product groups (for products page)
export async function getAllProductGroups(): Promise<ProductGroup[]> {
  try {
    const { data, error } = await supabase
      .from('product_groups')
      .select(PUBLIC_PRODUCT_GROUP_COLUMNS)
      .eq('is_active', true)
      .order('name')

    if (error) throw error
    return data || []
  } catch (error) {
    console.error('Error fetching all product groups:', error)
    return []
  }
}
