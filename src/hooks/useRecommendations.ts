/**
 * useRecommendations
 *
 * Fetches a short list of active products to show as CRO recommendations.
 * Excludes the current product/category if provided so recs are always fresh.
 *
 * Returns at most `limit` products (default 3).
 */

import { useEffect, useState } from 'react'
import { getAllProductGroups, getCategories } from '@/lib/supabase'
import { isCustomerSellableProduct } from '@/lib/productAvailability'
import type { RecommendationProduct } from '@/components/RecommendationCard'

export type UseRecommendationsOptions = {
  /** Exclude this product group ID from results */
  excludeProductId?: string | null
  /** Prefer products from a different category than this one */
  excludeCategoryId?: string | null
  /** Prefer products from this specific category */
  preferCategoryId?: string | null
  /** Max products to return. Default 3. */
  limit?: number
  /** Only run fetch if true. Useful for gating behind a condition (e.g. payment verified). */
  enabled?: boolean
}

export function useRecommendations({
  excludeProductId,
  excludeCategoryId,
  preferCategoryId,
  limit = 3,
  enabled = true,
}: UseRecommendationsOptions = {}): {
  recommendations: RecommendationProduct[]
  loading: boolean
} {
  const [recommendations, setRecommendations] = useState<RecommendationProduct[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const [groups, categories] = await Promise.all([
          getAllProductGroups(),
          getCategories(),
        ])

        const categoryMap = new Map(categories.map((c) => [c.id, c]))

        // Filter to sellable, active products
        let sellable = groups.filter((g) => {
          if (!isCustomerSellableProduct(g)) return false
          if (g.id === excludeProductId) return false
          return true
        })

        // Score: prefer different category from current page (cross-sell),
        // or preferred category if specified
        const scored = sellable.map((g) => {
          let score = Math.random() // base randomness so every load is fresh
          if (preferCategoryId && g.category_id === preferCategoryId) score += 2
          if (excludeCategoryId && g.category_id !== excludeCategoryId) score += 1
          return { g, score }
        })

        scored.sort((a, b) => b.score - a.score)
        const top = scored.slice(0, limit).map(({ g }) => {
          const cat = g.category_id ? categoryMap.get(g.category_id) : null
          return {
            id:           g.id,
            name:         g.name,
            price:        Number(g.price || 0),
            href:         `/product/${g.id}`,
            categoryName: cat?.name || null,
            description:  g.description || null,
          } satisfies RecommendationProduct
        })

        if (!cancelled) setRecommendations(top)
      } catch (_) {
        // non-critical — silently swallow
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [enabled, excludeProductId, excludeCategoryId, preferCategoryId, limit])

  return { recommendations, loading }
}
