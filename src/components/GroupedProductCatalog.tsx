import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, ChevronUp, Package } from 'lucide-react'
import CategoryLogo from '@/components/CategoryLogo'
import { Button } from '@/components/ui/button'
import { getProductRegion } from '@/lib/catalogGrouping'
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

function ProductRow({ product, category, onBuy, onImpression, regionBadge }: { product: ProductGroup; category: Category; onBuy: Props['onBuy']; onImpression: Props['onImpression']; regionBadge?: string }) {
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
          {regionBadge && <span className="rounded-full bg-slate-100 px-2 py-1 font-medium text-slate-600 dark:bg-white/10 dark:text-slate-300">{regionBadge}</span>}
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

function categoryHeaderTone(name: string) {
  if (/facebook|telegram|proxy|vpn/i.test(name)) return {
    surface: 'border-sky-200 bg-[#eaf3f7] text-[#173c52] dark:border-sky-900/70 dark:bg-[#142937] dark:text-sky-100',
    rail: 'bg-[#397b9c]',
    icon: 'border-sky-200 bg-white/85 dark:border-sky-700/70 dark:bg-sky-950/60',
    meta: 'text-[#4f7890] dark:text-sky-300/75',
    count: 'border-sky-200 bg-white/70 text-[#285873] dark:border-sky-700/70 dark:bg-sky-950/50 dark:text-sky-200',
    action: 'text-[#235d7b] hover:bg-white/65 dark:text-sky-200 dark:hover:bg-sky-900/60',
  }
  if (/instagram|snapchat|email|gmail|mail/i.test(name)) return {
    surface: 'border-[#ead9c7] bg-[#f7f0e8] text-[#59402d] dark:border-[#634633] dark:bg-[#302820] dark:text-[#f7dfc6]',
    rail: 'bg-[#b77c4f]',
    icon: 'border-[#e6d2bd] bg-white/80 dark:border-[#72543c] dark:bg-[#463528]',
    meta: 'text-[#926d4e] dark:text-[#d7ad86]',
    count: 'border-[#e6d2bd] bg-white/70 text-[#815a3c] dark:border-[#72543c] dark:bg-[#463528] dark:text-[#eac7a6]',
    action: 'text-[#825335] hover:bg-white/65 dark:text-[#f0c9a6] dark:hover:bg-[#57402e]',
  }
  return {
    surface: 'border-teal-200 bg-[#eaf4f0] text-[#17483f] dark:border-teal-900/70 dark:bg-[#132e2c] dark:text-teal-100',
    rail: 'bg-[#368a76]',
    icon: 'border-teal-200 bg-white/85 dark:border-teal-700/70 dark:bg-teal-950/60',
    meta: 'text-[#578478] dark:text-teal-300/75',
    count: 'border-teal-200 bg-white/70 text-[#2d6c5b] dark:border-teal-700/70 dark:bg-teal-950/50 dark:text-teal-200',
    action: 'text-[#286b5c] hover:bg-white/65 dark:text-teal-200 dark:hover:bg-teal-900/60',
  }
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
      const headerTone = categoryHeaderTone(category.name)
      const isAll = selectedCategory === 'all'
      const isExpanded = expanded[category.id] === true
      const shown = isAll && !searching && !isExpanded ? categoryProducts.slice(0, 3) : categoryProducts
      const regionRuns: Array<{ label: string; products: ProductGroup[] }> = []
      for (const product of shown) {
        const label = getProductRegion(product.name).label
        const lastRun = regionRuns[regionRuns.length - 1]
        if (lastRun?.label === label) lastRun.products.push(product)
        else regionRuns.push({ label, products: [product] })
      }
      const regionLabels = new Set(regionRuns.map((run) => run.label))
      const canShowRegions = (!isAll || isExpanded || searching) && regionLabels.size > 1 && [...regionLabels].some((label) => label !== 'Other')
      const showRegionHeadings = canShowRegions && regionRuns.length === regionLabels.size
      const showRegionBadges = canShowRegions && !showRegionHeadings
      return <section key={category.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-card">
        <div className={`relative overflow-hidden border-b px-4 py-3.5 sm:px-5 ${headerTone.surface}`}>
          <div aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${headerTone.rail}`} />
          <div aria-hidden="true" className="pointer-events-none absolute -right-5 inset-y-0 w-24 -skew-x-12 border-x border-current opacity-[0.07]" />
          <div className="relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 sm:flex sm:justify-between sm:gap-3">
            <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-3 sm:order-1 sm:flex-1">
              <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl border shadow-sm ${headerTone.icon}`}>
                <CategoryLogo name={category.name} className="h-8 w-8" iconClassName="h-7 w-7" />
              </span>
              <div className="min-w-0">
                <p className={`text-[10px] font-bold uppercase tracking-[0.18em] ${headerTone.meta}`}>TallyStore collection</p>
                <h2 className="break-words text-base font-extrabold leading-tight sm:truncate sm:text-lg">{category.name.trim()}</h2>
              </div>
            </div>
            <img src="/icon-192x192.png" alt="TallyStore logo" className="col-start-2 row-start-1 h-11 w-11 shrink-0 object-contain sm:order-3 sm:h-12 sm:w-12" loading="lazy" />
            <div className="col-span-2 row-start-2 flex items-center justify-between gap-2 pl-14 sm:order-2 sm:ml-auto sm:justify-end sm:pl-0">
              <span className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${headerTone.count}`}>
                {categoryProducts.length} {categoryProducts.length === 1 ? 'product' : 'products'}
              </span>
              {isAll && onSelectCategory && <button type="button" className={`rounded-lg px-2 py-2 text-[11px] font-bold transition-colors sm:px-3 sm:text-xs ${headerTone.action}`} onClick={() => onSelectCategory(category.id)}>View all <ChevronRight className="inline h-3.5 w-3.5" /></button>}
            </div>
          </div>
        </div>
        {showRegionHeadings ? regionRuns.map(({ label, products: regionProducts }) => <div key={label}>
          <h3 className="border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">{label === 'Other' ? 'Other products' : label} <span className="font-normal">({regionProducts.length})</span></h3>
          {regionProducts.map((product) => <ProductRow key={product.id} product={product} category={category} onBuy={onBuy} onImpression={onImpression} />)}
        </div>) : shown.map((product) => {
          const label = getProductRegion(product.name).label
          return <ProductRow key={product.id} product={product} category={category} onBuy={onBuy} onImpression={onImpression} regionBadge={showRegionBadges && label !== 'Other' ? label : undefined} />
        })}
        {isAll && !searching && categoryProducts.length > 3 && <button type="button" className="flex w-full items-center justify-center gap-1 border-t border-slate-100 py-3 text-xs font-bold text-purple-700 hover:bg-purple-50 dark:border-white/10 dark:text-purple-300 dark:hover:bg-white/5" onClick={() => setExpanded((current) => ({ ...current, [category.id]: !isExpanded }))}>
          {isExpanded ? <>Show fewer <ChevronUp className="h-4 w-4" /></> : <>Show all {categoryProducts.length} <ChevronDown className="h-4 w-4" /></>}
        </button>}
      </section>
    })}
  </div>
}
