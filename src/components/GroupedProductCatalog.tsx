import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, ChevronUp, Package } from 'lucide-react'
import CategoryLogo from '@/components/CategoryLogo'
import { Button } from '@/components/ui/button'
import { groupProductsByRegion } from '@/lib/catalogGrouping'
import type { Category, ProductGroup } from '@/lib/supabase'
import { useCurrency } from '@/contexts/CurrencyContext'
import { isCustomerSellableProduct, isCustomerVisibleProduct } from '@/lib/productAvailability'
import { getProductIconName } from '@/lib/categoryStyles'

type Props = {
  categories: Category[]
  products: ProductGroup[]
  selectedCategory: string
  searching?: boolean
  onSelectCategory?: (id: string) => void
  onBuy: (productGroupId: string, quantity: number) => void
  onImpression?: (product: ProductGroup) => void
}

function ProductRow({ product, category, onBuy, onImpression }: { product: ProductGroup; category: Category; onBuy: Props['onBuy']; onImpression: Props['onImpression'] }) {
  const { formatPrice } = useCurrency()
  const available = isCustomerSellableProduct(product)
  const paused = String(product.availability_status).toUpperCase() === 'PAUSED'
  const rowRef = useRef<HTMLDivElement>(null)
  const didTrackImpression = useRef(false)
  useEffect(() => {
    if (!rowRef.current || !onImpression || didTrackImpression.current || typeof IntersectionObserver === 'undefined') return
    let isInView = false
    const trackVisibleRow = () => {
      if (didTrackImpression.current || !isInView || document.visibilityState !== 'visible') return
      didTrackImpression.current = true
      onImpression(product)
      observer.disconnect()
      document.removeEventListener('visibilitychange', trackVisibleRow)
    }
    const observer = new IntersectionObserver(([entry]) => {
      isInView = entry.isIntersecting && entry.intersectionRatio >= 0.25
      trackVisibleRow()
    }, { threshold: 0.25 })
    observer.observe(rowRef.current)
    document.addEventListener('visibilitychange', trackVisibleRow)
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', trackVisibleRow) }
  }, [product, onImpression])
  return (
    <div ref={rowRef} className="flex items-center gap-3 border-b border-slate-100 px-4 py-4 last:border-b-0 dark:border-white/10 sm:gap-4 sm:px-5">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-slate-100 dark:bg-white/10 sm:h-12 sm:w-12">
        <CategoryLogo name={getProductIconName(product.name, category.name)} className="h-8 w-8" iconClassName="h-7 w-7" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-snug text-slate-900 dark:text-white">{product.name.trim()}</p>
        {product.description && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{product.description}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className={`rounded-full px-2.5 py-1 font-semibold ${available ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300'}`}>
            {available ? product.stock_count > 0 ? `${product.stock_count} in stock` : 'Available to order' : paused ? 'Paused' : 'Sold out'}
          </span>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 font-bold text-slate-900 dark:bg-white/10 dark:text-white">{formatPrice(product.price)}</span>
        </div>
      </div>
      <Button type="button" disabled={!available} onClick={() => onBuy(product.id, 1)} className="h-9 shrink-0 rounded-full bg-purple-600 px-3 text-xs font-bold text-white hover:bg-purple-700 disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-700 sm:px-5 sm:text-sm">
        {available ? <>Buy <ChevronRight className="h-4 w-4" /></> : paused ? 'Paused' : 'Sold'}
      </Button>
    </div>
  )
}

function categoryHeaderColor(name: string) {
  if (/facebook/i.test(name)) return 'from-blue-700 to-blue-600'
  if (/email|gmail|mail/i.test(name)) return 'from-red-600 to-rose-500'
  if (/proxy|vpn/i.test(name)) return 'from-cyan-700 to-blue-600'
  if (/instagram/i.test(name)) return 'from-pink-600 to-fuchsia-600'
  if (/telegram/i.test(name)) return 'from-sky-700 to-blue-600'
  return 'from-purple-700 to-indigo-700'
}

export default function GroupedProductCatalog({ categories, products, selectedCategory, searching = false, onSelectCategory, onBuy, onImpression }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const visibleCategories = selectedCategory === 'all' ? categories : categories.filter((category) => category.id === selectedCategory)
  const sections = visibleCategories.map((category) => ({
    category,
    products: products.filter((product) => product.category_id === category.id && isCustomerVisibleProduct(product)),
  })).filter((section) => section.products.length > 0)

  if (sections.length === 0) {
    return <div className="rounded-2xl border border-slate-200 bg-white px-5 py-14 text-center dark:border-white/10 dark:bg-card"><Package className="mx-auto h-10 w-10 text-slate-400" /><p className="mt-3 font-bold">No products found</p><p className="mt-1 text-sm text-slate-500">Try another category or search term.</p></div>
  }

  return <div className="space-y-5">
    {sections.map(({ category, products: categoryProducts }) => {
      const isAll = selectedCategory === 'all'
      const isExpanded = expanded[category.id] === true
      const shown = isAll && !searching && !isExpanded ? categoryProducts.slice(0, 3) : categoryProducts
      const regions = !isAll && categoryProducts.length > 5 ? groupProductsByRegion(shown) : []
      return <section key={category.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-card">
        <div className={`relative flex items-center justify-between gap-3 overflow-hidden bg-gradient-to-r ${categoryHeaderColor(category.name)} px-4 py-4 text-white sm:px-5`}>
          <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-white/10" />
          <div className="relative flex min-w-0 items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/20"><CategoryLogo name={category.name} className="h-7 w-7" iconClassName="h-7 w-7 text-white" /></span>
            <div className="min-w-0"><h2 className="truncate text-base font-extrabold uppercase tracking-wide sm:text-lg">{category.name.trim()}</h2><p className="text-xs text-white/75">{categoryProducts.length} products</p></div>
          </div>
          {isAll && onSelectCategory && <button type="button" className="relative shrink-0 rounded-lg bg-white/15 px-3 py-2 text-xs font-bold hover:bg-white/25" onClick={() => onSelectCategory(category.id)}>View all <ChevronRight className="inline h-3.5 w-3.5" /></button>}
        </div>
        {regions.length > 1 ? regions.map(({ region, products: regionProducts }) => <div key={region.label}>
          <h3 className="border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">{region.label} <span className="font-normal">({regionProducts.length})</span></h3>
          {regionProducts.map((product) => <ProductRow key={product.id} product={product} category={category} onBuy={onBuy} onImpression={onImpression} />)}
        </div>) : shown.map((product) => <ProductRow key={product.id} product={product} category={category} onBuy={onBuy} onImpression={onImpression} />)}
        {isAll && !searching && categoryProducts.length > 3 && <button type="button" className="flex w-full items-center justify-center gap-1 border-t border-slate-100 py-3 text-xs font-bold text-purple-700 hover:bg-purple-50 dark:border-white/10 dark:text-purple-300 dark:hover:bg-white/5" onClick={() => setExpanded((current) => ({ ...current, [category.id]: !isExpanded }))}>
          {isExpanded ? <>Show fewer <ChevronUp className="h-4 w-4" /></> : <>Show all {categoryProducts.length} <ChevronDown className="h-4 w-4" /></>}
        </button>}
      </section>
    })}
  </div>
}
