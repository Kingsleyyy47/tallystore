import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, RefreshCw, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import Navbar from '@/components/NavbarAuth'
import Footer from '@/components/Footer'
import GroupedProductCatalog from '@/components/GroupedProductCatalog'
import PageBreadcrumb from '@/components/PageBreadcrumb'
import { useAuth } from '@/contexts/SimpleAuth'
import { isCustomerSellableProduct, isCustomerVisibleProduct } from '@/lib/productAvailability'
import {
  getAllProductGroups,
  getCategories,
  getAppSetting,
  getRecentlyRestockedProductGroupIds,
  getFavoriteProductGroupIds,
  getTopSellingProductGroupIds,
  getUserPurchaseHistory,
  testConnection,
  type Category,
  type ProductGroup,
} from '@/lib/supabase'
import {
  getRevenueVisitorId,
  loadCustomerRelationshipBoosts,
  loadRevenueOsSettings,
  loadRunningCroActionPlans,
  loadRunningCroExperiments,
  rankProductsForRevenueOs,
  retrieveProductsForQuery,
  resolveCroAssignment,
  trackRevenueEvent,
  type RevenueOsSettings,
} from '@/lib/revenue-os'

type SortMode = 'recommended' | 'newest' | 'az' | 'price-low' | 'price-high' | 'stock'

const CORE_LOAD_TIMEOUT_MS = 8000
const OPTIONAL_LOAD_TIMEOUT_MS = 3500
const VISIBLE_REFRESH_COOLDOWN_MS = 3 * 60 * 1000

const SAFE_REVENUE_OS_SETTINGS: RevenueOsSettings = {
  enabled: false,
  shadowMode: true,
  autonomyLevel: 0,
  explorationPct: 5,
  pressureLimit: 2,
  globalHoldoutPct: 5,
  experimentationEnabled: false,
  freezeReason: '',
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<T>((resolve) => {
    timeoutId = setTimeout(() => {
      console.warn(`${label} timed out; using fallback`)
      resolve(fallback)
    }, timeoutMs)
  })

  return Promise.race([promise, timeout])
    .catch((error) => {
      console.warn(`${label} failed; using fallback`, error)
      return fallback
    })
    .finally(() => {
      if (timeoutId) clearTimeout(timeoutId)
    })
}

function isPurchasable(productGroup: ProductGroup) {
  return isCustomerSellableProduct(productGroup)
}

export default function ProductsPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [categories, setCategories] = useState<Category[]>([])
  const [productGroups, setProductGroups] = useState<ProductGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [restockedIds, setRestockedIds] = useState<string[]>([])
  const [topSellingIds, setTopSellingIds] = useState<string[]>([])
  const [favoriteProductIds, setFavoriteProductIds] = useState<string[]>([])
  const [myProductGroupCounts, setMyProductGroupCounts] = useState<Record<string, number>>({})
  const [myCategoryCounts, setMyCategoryCounts] = useState<Record<string, number>>({})
  const [myProductLastPurchasedAt, setMyProductLastPurchasedAt] = useState<Record<string, string>>({})
  const [myCategoryLastPurchasedAt, setMyCategoryLastPurchasedAt] = useState<Record<string, string>>({})
  const [myLastProductGroupId, setMyLastProductGroupId] = useState<string | null>(null)
  const [relationshipBoosts, setRelationshipBoosts] = useState<Record<string, number>>({})
  const [recommendationAutomationEnabled, setRecommendationAutomationEnabled] = useState(true)
  const [revenueOsSettings, setRevenueOsSettings] = useState<RevenueOsSettings | null>(null)
  const [runningCroExperiments, setRunningCroExperiments] = useState<any[]>([])
  const [runningCroActionPlans, setRunningCroActionPlans] = useState<any[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [sortMode, setSortMode] = useState<SortMode>('recommended')
  const didTrackInitialFilter = useRef(false)
  const didTrackInitialSort = useRef(false)
  const loadInFlight = useRef(false)
  const lastLoadAt = useRef(0)

  const loadData = useCallback(async (showPageLoader = false) => {
    if (loadInFlight.current) return
    loadInFlight.current = true
    try {
      if (showPageLoader) setLoading(true)
      setRefreshing(true)

      const [connectionOk, categoriesData, productGroupsData] = await Promise.all([
        withTimeout(testConnection(), CORE_LOAD_TIMEOUT_MS, true, 'Database connection check'),
        withTimeout(getCategories(), CORE_LOAD_TIMEOUT_MS, [], 'Categories'),
        withTimeout(getAllProductGroups(), CORE_LOAD_TIMEOUT_MS, [], 'Products'),
      ])

      if (!connectionOk && categoriesData.length === 0 && productGroupsData.length === 0) {
        throw new Error('Failed to connect to database')
      }

      setCategories(categoriesData)
      setProductGroups(productGroupsData)
      setError(null)
      setLoading(false)

      const [topSellingData, favoriteIds, automationSetting, revenueSettings, experiments, actionPlans, recentlyRestocked] = await Promise.all([
        withTimeout(getTopSellingProductGroupIds(12), OPTIONAL_LOAD_TIMEOUT_MS, [], 'Top sellers'),
        withTimeout(getFavoriteProductGroupIds(), OPTIONAL_LOAD_TIMEOUT_MS, [], 'Favorite products'),
        withTimeout(getAppSetting('sales_recommendation_automation_enabled'), OPTIONAL_LOAD_TIMEOUT_MS, null, 'Recommendation automation setting'),
        withTimeout(loadRevenueOsSettings(), OPTIONAL_LOAD_TIMEOUT_MS, SAFE_REVENUE_OS_SETTINGS, 'Revenue OS settings'),
        withTimeout(loadRunningCroExperiments(), OPTIONAL_LOAD_TIMEOUT_MS, [], 'Running CRO experiments'),
        withTimeout(loadRunningCroActionPlans(), OPTIONAL_LOAD_TIMEOUT_MS, [], 'Running CRO action plans'),
        withTimeout(getRecentlyRestockedProductGroupIds(8), OPTIONAL_LOAD_TIMEOUT_MS, [], 'Recently restocked products'),
      ])

      const automationEnabled = automationSetting !== 'false' && revenueSettings.enabled
      setTopSellingIds(automationEnabled ? topSellingData : [])
      setFavoriteProductIds(automationEnabled ? favoriteIds : [])
      setRecommendationAutomationEnabled(automationEnabled)
      setRevenueOsSettings(revenueSettings)
      setRunningCroExperiments(experiments)
      setRunningCroActionPlans(actionPlans)
      setRestockedIds(recentlyRestocked)
    } catch (err) {
      console.error('Error loading products:', err)
      setError(err instanceof Error ? err.message : 'Failed to load products')
    } finally {
      lastLoadAt.current = Date.now()
      loadInFlight.current = false
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    loadData(true)
  }, [loadData])

  useEffect(() => {
    let cancelled = false

    if (!recommendationAutomationEnabled || !user?.id) {
      setMyProductGroupCounts({})
      setMyCategoryCounts({})
      setMyProductLastPurchasedAt({})
      setMyCategoryLastPurchasedAt({})
      setMyLastProductGroupId(null)
      setRelationshipBoosts({})
      return () => {
        cancelled = true
      }
    }

    getUserPurchaseHistory(user.id)
      .then(({ productGroupCounts, categoryCounts, lastPurchasedAtByProductGroup, lastPurchasedAtByCategory, lastProductGroupId }) => {
        if (cancelled) return null
        setMyProductGroupCounts(productGroupCounts)
        setMyCategoryCounts(categoryCounts)
        setMyProductLastPurchasedAt(lastPurchasedAtByProductGroup)
        setMyCategoryLastPurchasedAt(lastPurchasedAtByCategory)
        setMyLastProductGroupId(lastProductGroupId)
        return loadCustomerRelationshipBoosts(productGroupCounts, lastPurchasedAtByProductGroup)
      })
      .then((boosts) => {
        if (!cancelled && boosts) setRelationshipBoosts(boosts)
      })
      .catch((err) => {
        if (cancelled) return
        console.error('Error loading customer recommendation profile:', err)
        setMyProductGroupCounts({})
        setMyCategoryCounts({})
        setMyProductLastPurchasedAt({})
        setMyCategoryLastPurchasedAt({})
        setMyLastProductGroupId(null)
        setRelationshipBoosts({})
      })

    return () => {
      cancelled = true
    }
  }, [recommendationAutomationEnabled, user?.id])

  useEffect(() => {
    const refreshVisibleData = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastLoadAt.current < VISIBLE_REFRESH_COOLDOWN_MS) return
      void loadData(false)
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshVisibleData()
    }

    window.addEventListener('focus', refreshVisibleData)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('focus', refreshVisibleData)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [loadData])

  useEffect(() => {
    const query = searchTerm.trim()
    if (query.length < 2) return

    const timeout = window.setTimeout(() => {
      trackRevenueEvent({
        eventType: 'SEARCHED',
        userId: user?.id || null,
        surface: 'products',
        metadata: {
          query,
          selectedCategory,
          sortMode,
        },
      })
    }, 500)

    return () => window.clearTimeout(timeout)
  }, [searchTerm, selectedCategory, sortMode, user?.id])

  useEffect(() => {
    if (!didTrackInitialFilter.current) {
      didTrackInitialFilter.current = true
      return
    }

    trackRevenueEvent({
      eventType: 'FILTER_USED',
      userId: user?.id || null,
      categoryId: selectedCategory === 'all' ? null : selectedCategory,
      surface: 'products',
      metadata: { selectedCategory },
    })
  }, [selectedCategory, user?.id])

  useEffect(() => {
    if (!didTrackInitialSort.current) {
      didTrackInitialSort.current = true
      return
    }

    trackRevenueEvent({
      eventType: 'SORT_USED',
      userId: user?.id || null,
      surface: 'products',
      metadata: { sortMode },
    })
  }, [sortMode, user?.id])

  const activeProductGroups = useMemo(
    () => productGroups.filter(isCustomerVisibleProduct),
    [productGroups],
  )

  const productCountByCategory = useMemo(() => {
    return activeProductGroups.reduce<Record<string, number>>((acc, productGroup) => {
      acc[productGroup.category_id] = (acc[productGroup.category_id] || 0) + 1
      return acc
    }, {})
  }, [activeProductGroups])

  const categoryChips = useMemo(() => {
    const ranked = categories
      .map((category) => ({
        category,
        count: productCountByCategory[category.id] || 0,
      }))
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.count - a.count || a.category.name.localeCompare(b.category.name))

    return ranked
  }, [categories, productCountByCategory])

  const categoryForProduct = useCallback(
    (productGroup: ProductGroup) => categories.find((category) => category.id === productGroup.category_id),
    [categories],
  )

  const croAssignment = useMemo(() => resolveCroAssignment({
    surface: 'products',
    settings: revenueOsSettings,
    experiments: runningCroExperiments,
    visitorId: getRevenueVisitorId(),
    userId: user?.id || null,
  }), [revenueOsSettings, runningCroExperiments, user?.id])

  const retrievalBaseProductGroups = useMemo(() => {
    return activeProductGroups.filter((productGroup) => selectedCategory === 'all' || productGroup.category_id === selectedCategory)
  }, [activeProductGroups, selectedCategory])

  const productRetrievalResults = useMemo(
    () => retrieveProductsForQuery(retrievalBaseProductGroups, categories, searchTerm),
    [categories, retrievalBaseProductGroups, searchTerm],
  )

  const retrievalScoreById = useMemo(
    () => new Map(productRetrievalResults.map((result) => [result.product.id, result.score])),
    [productRetrievalResults],
  )

  const retrievedProductGroups = useMemo(
    () => productRetrievalResults.map((result) => result.product),
    [productRetrievalResults],
  )

  const revenueOsRankedProducts = useMemo(() => {
    if (!recommendationAutomationEnabled) return []
    return rankProductsForRevenueOs(retrievedProductGroups.filter(isCustomerSellableProduct), categories, {
      surface: 'products',
      query: searchTerm,
      selectedCategoryId: selectedCategory,
      topSellingIds,
      favoriteProductIds,
      restockedIds,
      actionPlans: runningCroActionPlans,
      relationshipBoosts,
      customer: {
        productGroupCounts: myProductGroupCounts,
        categoryCounts: myCategoryCounts,
        lastPurchasedAtByProductGroup: myProductLastPurchasedAt,
        lastPurchasedAtByCategory: myCategoryLastPurchasedAt,
        lastProductGroupId: myLastProductGroupId,
      },
      settings: revenueOsSettings || undefined,
      assignment: croAssignment,
    })
  }, [categories, croAssignment, favoriteProductIds, myCategoryCounts, myCategoryLastPurchasedAt, myLastProductGroupId, myProductGroupCounts, myProductLastPurchasedAt, recommendationAutomationEnabled, relationshipBoosts, restockedIds, retrievedProductGroups, revenueOsSettings, runningCroActionPlans, searchTerm, selectedCategory, topSellingIds])

  const revenueOsScoreById = useMemo(() => {
    return new Map(revenueOsRankedProducts.map((ranked) => [ranked.product.id, ranked]))
  }, [revenueOsRankedProducts])
  const revenueOsCanRank = recommendationAutomationEnabled && croAssignment.rankingEnabled
  const sortedProductGroups = useMemo(() => {
    const query = searchTerm.trim()
    const searched = [...retrievedProductGroups]

    return searched.sort((a, b) => {
      const aPurchasable = isPurchasable(a)
      const bPurchasable = isPurchasable(b)
      if (aPurchasable !== bPurchasable) return aPurchasable ? -1 : 1

      if (sortMode === 'price-low') return a.price - b.price
      if (sortMode === 'price-high') return b.price - a.price
      if (sortMode === 'stock') return b.stock_count - a.stock_count
      if (sortMode === 'newest') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      if (sortMode === 'az') return a.name.trim().localeCompare(b.name.trim(), undefined, { numeric: true, sensitivity: 'base' })

      if (sortMode === 'recommended' && revenueOsCanRank) {
        if (query.length > 0) {
          const relevanceA = retrievalScoreById.get(a.id) || 0
          const relevanceB = retrievalScoreById.get(b.id) || 0
          if (relevanceA !== relevanceB) return relevanceB - relevanceA
        }
        const scoreA = revenueOsScoreById.get(a.id)?.score || 0
        const scoreB = revenueOsScoreById.get(b.id)?.score || 0
        if (scoreA !== scoreB) return scoreB - scoreA
      }

      return a.name.trim().localeCompare(b.name.trim(), undefined, { numeric: true, sensitivity: 'base' })
    })
  }, [retrievalScoreById, retrievedProductGroups, revenueOsCanRank, revenueOsScoreById, searchTerm, sortMode])

  const goToProduct = (productGroup: ProductGroup) => {
    const category = categoryForProduct(productGroup)
    if (!category || !isCustomerSellableProduct(productGroup)) return
    trackRevenueEvent({
      eventType: 'BUY_CLICKED',
      userId: user?.id || null,
      productGroupId: productGroup.id,
      categoryId: productGroup.category_id,
      surface: 'products_catalog',
      experimentId: croAssignment.experimentId,
      variantId: croAssignment.variantId,
      metadata: { price: productGroup.price, assignmentMode: croAssignment.mode },
    })
    navigate('/checkout', {
      state: {
        productGroup,
        category,
        quantity: 1,
        isBulkPurchase: false,
        croAssignment,
      },
    })
  }

  const handleImpression = useCallback((product: ProductGroup) => {
    trackRevenueEvent({
      eventType: 'PRODUCT_IMPRESSION', userId: user?.id || null,
      productGroupId: product.id, categoryId: product.category_id,
      surface: 'products_catalog', experimentId: croAssignment.experimentId, variantId: croAssignment.variantId,
      metadata: { sortMode, selectedCategory, assignmentMode: croAssignment.mode },
      eventId: ['PRODUCT_IMPRESSION', new Date().toISOString().slice(0, 10), user?.id || getRevenueVisitorId() || 'anonymous', 'products_catalog', croAssignment.variantId || croAssignment.mode, product.id].join(':'),
    })
  }, [user?.id, croAssignment, sortMode, selectedCategory])

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f6f7fb] text-slate-950 dark:bg-[#05070d] dark:text-white">
        <Navbar />
        <main className="mx-auto flex min-h-[60vh] max-w-7xl items-center justify-center px-5">
          <div className="flex items-center gap-3 text-sm font-black text-slate-600 dark:text-slate-300">
            <Loader2 className="h-6 w-6 animate-spin text-purple-600" />
            Loading products...
          </div>
        </main>
        <Footer />
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#f6f7fb] text-slate-950 dark:bg-[#05070d] dark:text-white">
        <Navbar />
        <main className="mx-auto flex min-h-[60vh] max-w-7xl items-center justify-center px-5">
          <div className="max-w-md rounded-xl border border-red-200 bg-white p-6 text-center shadow-sm dark:border-red-500/30 dark:bg-white/[0.04]">
            <h1 className="text-xl font-black text-red-600 dark:text-red-400">Could not load products</h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{error}</p>
            <Button className="mt-5" onClick={() => loadData(true)}>
              Try Again
            </Button>
          </div>
        </main>
        <Footer />
      </div>
    )
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_20%_0%,rgba(168,85,247,0.10),transparent_30rem),linear-gradient(180deg,#ffffff_0%,#f7f9fc_55%,#eef3f8_100%)] text-slate-950 dark:bg-[radial-gradient(circle_at_20%_0%,rgba(126,51,231,0.16),transparent_30rem),linear-gradient(180deg,#05070d_0%,#07111d_100%)] dark:text-white">
      <Navbar />
      <main className="mx-auto w-full max-w-5xl px-3 pb-16 pt-5 sm:px-6">
        <PageBreadcrumb items={[{ label: 'Products' }]} className="mb-5" />
        <header className="mb-5">
          <h1 className="text-2xl font-extrabold sm:text-3xl">Products</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Browse by platform, compare stock and price, then choose your quantity at checkout.</p>
        </header>

        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input aria-label="Search products" placeholder="Search products..." value={searchTerm} onChange={(event) => {
            setSearchTerm(event.target.value)
            if (event.target.value.trim()) setSelectedCategory('all')
          }} className="h-11 rounded-xl border-slate-200 bg-white pl-10 dark:border-white/10 dark:bg-card" />
        </div>

        <nav aria-label="Product categories" className="mb-4 flex gap-2 overflow-x-auto pb-2">
          <button type="button" onClick={() => setSelectedCategory('all')} className={`shrink-0 rounded-xl px-4 py-2 text-xs font-bold transition ${selectedCategory === 'all' ? 'bg-purple-600 text-white shadow-md' : 'border border-slate-200 bg-white text-slate-600 hover:border-purple-300 dark:border-white/10 dark:bg-card dark:text-slate-300'}`}>All ({activeProductGroups.length})</button>
          {categoryChips.map(({ category, count }) => <button key={category.id} type="button" onClick={() => setSelectedCategory(category.id)} className={`shrink-0 rounded-xl px-4 py-2 text-xs font-bold transition ${selectedCategory === category.id ? 'bg-purple-600 text-white shadow-md' : 'border border-slate-200 bg-white text-slate-600 hover:border-purple-300 dark:border-white/10 dark:bg-card dark:text-slate-300'}`}>{category.name.trim()} ({count})</button>)}
        </nav>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{sortedProductGroups.length} product{sortedProductGroups.length === 1 ? '' : 's'} found</p>
          <div className="flex items-center gap-2">
            <select aria-label="Sort products" value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold dark:border-white/10 dark:bg-card">
              <option value="recommended">Recommended</option>
              <option value="newest">Newest</option>
              <option value="az">A–Z</option>
              <option value="stock">Most stock</option>
              <option value="price-low">Lowest price</option>
              <option value="price-high">Highest price</option>
            </select>
            <Button type="button" variant="outline" size="sm" onClick={() => loadData(false)} disabled={refreshing} className="h-10 rounded-xl">
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
            </Button>
          </div>
        </div>

        <GroupedProductCatalog categories={categories} products={sortedProductGroups} selectedCategory={selectedCategory} onImpression={handleImpression} searching={Boolean(searchTerm.trim())} onSelectCategory={setSelectedCategory} onBuy={(id) => {
          const product = productGroups.find((item) => item.id === id)
          if (product) goToProduct(product)
        }} />
      </main>
      <Footer />
    </div>
  )
}
