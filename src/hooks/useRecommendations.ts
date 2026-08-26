/**
 * useRecommendations
 *
 * Fetches a small number of active products for CRO recommendation cards.
 * Uses a direct lightweight Supabase query — NOT getAllProductGroups() —
 * to avoid loading the full catalog on every page.
 *
 * Deferred: fetch starts after a 1.5s idle delay so it never blocks
 * the main page content from rendering.
 */

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { RecommendationProduct } from '@/components/RecommendationCard'

export type UseRecommendationsOptions = {
  excludeProductId?: string | null
  excludeCategoryId?: string | null
  preferCategoryId?: string | null
  limit?: number
  /** Only fetch if true (e.g. gate on payment verified). Default true. */
  enabled?: boolean
  /** Delay in ms before fetch starts. Default 1500 (after page paint). */
  delayMs?: number
}

export function useRecommendations({
  excludeProductId,
  excludeCategoryId,
  preferCategoryId,
  limit = 3,
  enabled = true,
  delayMs = 1500,
}: UseRecommendationsOptions = {}): {
  recommendations: RecommendationProduct[]
  loading: boolean
} {
  const [recommendations, setRecommendations] = useState<RecommendationProduct[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>

    async function load() {
      if (cancelled) return
      setLoading(true)
      try {
        // Fetch only the columns we need, server-side filtered
        // Fetch a small pool (limit × 6) and pick randomly client-side
        const fetchLimit = Math.min(limit * 6, 24)

        let query = supabase
          .from('product_groups')
          .select('id, name, price, description, category_id, is_active, stock_count, categories(name)')
          .eq('is_active', true)
          .gt('stock_count', 0)
          .limit(fetchLimit)

        if (excludeProductId) query = query.neq('id', excludeProductId)
        if (preferCategoryId) query = query.eq('category_id', preferCategoryId)
        else if (excludeCategoryId) query = query.neq('category_id', excludeCategoryId)

        const { data, error } = await query

        if (error || !data?.length) return

        // Shuffle and take `limit`
        const shuffled = [...data].sort(() => Math.random() - 0.5).slice(0, limit)

        const recs: RecommendationProduct[] = shuffled.map((g: any) => ({
          id:           g.id,
          name:         g.name,
          price:        Number(g.price || 0),
          href:         `/product/${g.id}`,
          categoryName: (g.categories as any)?.name || null,
          description:  g.description || null,
        }))

        if (!cancelled) setRecommendations(recs)
      } catch (_) {
        // non-critical
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    // Defer so it never competes with the primary page queries
    timer = setTimeout(load, delayMs)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [enabled, excludeProductId, excludeCategoryId, preferCategoryId, limit, delayMs])

  return { recommendations, loading }
}
