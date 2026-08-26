/**
 * RecommendationCard
 *
 * Drop this wherever you want CRO-tracked product recommendations:
 *   - Post-purchase upsell
 *   - Homepage featured slot
 *   - Product page "you might also like"
 *   - Cart cross-sell
 *
 * It handles the full intervention lifecycle automatically:
 *   rendered → viewed → clicked → buy_clicked → dismissed
 *
 * Usage:
 *   <RecommendationCard
 *     product={{ id, name, price, href, categoryName }}
 *     surface="post_purchase"
 *     actionType="POST_PURCHASE_RECOMMENDATION"
 *     userId={user?.id}
 *     strategyKey="post_purchase:stars_upsell"
 *     onBuyClick={(interventionId) => { ... }}
 *   />
 */

import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, X } from 'lucide-react'
import { useCurrency } from '@/contexts/CurrencyContext'
import {
  createCroIntervention,
  markInterventionViewed,
  markInterventionClicked,
  markInterventionDismissed,
  markInterventionBuyClicked,
} from '@/lib/revenue-os'
import { useViewabilityTracker } from '@/hooks/useViewabilityTracker'
import type { CroActionType } from '@/lib/revenue-os'

// ── Types ─────────────────────────────────────────────────────────────────────

export type RecommendationProduct = {
  id: string
  name: string
  price: number
  href: string
  categoryName?: string | null
  badge?: string | null        // e.g. "Popular", "Best value"
  description?: string | null
}

export type RecommendationCardProps = {
  product: RecommendationProduct
  surface: string
  actionType?: CroActionType
  strategyKey?: string
  experimentId?: string | null
  variantId?: string | null
  userId?: string | null
  sourceProductId?: string | null
  /** Called with the interventionId after buy is clicked — lets parent attribute a purchase */
  onBuyClick?: (interventionId: string | null) => void
  /** Called after card is dismissed */
  onDismiss?: () => void
  /** Show X dismiss button. Default true. */
  dismissible?: boolean
  /** Extra classes for the card container */
  className?: string
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function RecommendationCard({
  product,
  surface,
  actionType = 'SHOW_ALTERNATIVE',
  strategyKey,
  experimentId,
  variantId,
  userId,
  sourceProductId,
  onBuyClick,
  onDismiss,
  dismissible = true,
  className = '',
}: RecommendationCardProps) {
  const { formatPrice } = useCurrency()
  const interventionIdRef = useRef<string | null>(null)
  const [dismissed, setDismissed] = useState(false)

  // ── 1. Create intervention row on mount ────────────────────────────────────
  useEffect(() => {
    if (dismissed) return
    let cancelled = false
    createCroIntervention({
      actionType,
      surface,
      targetProductId: product.id,
      sourceProductId: sourceProductId || null,
      strategyKey:     strategyKey || `${actionType}:${surface}`,
      experimentId:    experimentId || null,
      variantId:       variantId   || null,
      userId:          userId      || null,
    }).then((id) => {
      if (!cancelled) interventionIdRef.current = id
    })
    return () => { cancelled = true }
  }, []) // intentionally empty — run once on mount

  // ── 2. Mark viewed via IntersectionObserver ────────────────────────────────
  const viewRef = useViewabilityTracker(
    () => {
      if (interventionIdRef.current) markInterventionViewed(interventionIdRef.current)
    },
    { threshold: 0.5, durationMs: 500, once: true },
  )

  // ── 3. Handlers ────────────────────────────────────────────────────────────
  function handleClick() {
    if (interventionIdRef.current) markInterventionClicked(interventionIdRef.current)
  }

  function handleBuyClick(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (interventionIdRef.current) markInterventionBuyClicked(interventionIdRef.current)
    onBuyClick?.(interventionIdRef.current)
    // Navigate after tracking
    window.location.href = product.href
  }

  function handleDismiss(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (interventionIdRef.current) markInterventionDismissed(interventionIdRef.current)
    setDismissed(true)
    onDismiss?.()
  }

  if (dismissed) return null

  // ── 4. Render ──────────────────────────────────────────────────────────────
  return (
    <div
      ref={viewRef}
      className={`relative group rounded-2xl border border-border/70 bg-background p-4 shadow-sm transition hover:border-primary/40 hover:bg-primary/5 ${className}`}
    >
      {/* Dismiss button */}
      {dismissible && (
        <button
          onClick={handleDismiss}
          aria-label="Dismiss recommendation"
          className="absolute top-2 right-2 rounded-full p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground transition-all"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}

      <Link to={product.href} onClick={handleClick} className="flex flex-col gap-2">
        {/* Badge */}
        {product.badge && (
          <span className="inline-flex w-fit items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
            {product.badge}
          </span>
        )}

        {/* Name + arrow */}
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-bold leading-snug text-foreground line-clamp-2">
            {product.name}
          </p>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary mt-0.5" />
        </div>

        {/* Category / description */}
        {(product.categoryName || product.description) && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {product.description || product.categoryName}
          </p>
        )}

        {/* Price */}
        <p className="text-sm font-black text-primary">
          {formatPrice(product.price)}
        </p>
      </Link>

      {/* Buy CTA — separate from the Link so it gets its own tracking event */}
      <button
        onClick={handleBuyClick}
        className="mt-3 w-full rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 py-2 text-xs font-semibold text-white shadow-sm transition hover:opacity-90 active:scale-[0.98]"
      >
        Buy now
      </button>
    </div>
  )
}

// ── Horizontal strip variant (for post-purchase banners) ─────────────────────

export function RecommendationStrip({
  products,
  surface,
  actionType,
  strategyKey,
  userId,
  title = 'You might also like',
}: {
  products: RecommendationProduct[]
  surface: string
  actionType?: CroActionType
  strategyKey?: string
  userId?: string | null
  title?: string
}) {
  if (!products.length) return null
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-bold text-foreground">{title}</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((p) => (
          <RecommendationCard
            key={p.id}
            product={p}
            surface={surface}
            actionType={actionType}
            strategyKey={strategyKey}
            userId={userId}
          />
        ))}
      </div>
    </section>
  )
}
