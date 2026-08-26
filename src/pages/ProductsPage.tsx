import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Grid,
  LayoutGrid,
  List,
  Loader2,
  MoreHorizontal,
  Package,
  RefreshCw,
  Search,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import Navbar from '@/components/NavbarAuth'
import Footer from '@/components/Footer'
import HomepageLiveActivity from '@/components/HomepageLiveActivity'
import ProductTemplateCard from '@/components/ProductTemplateCard'
import CategorySidebar from '@/components/CategorySidebar'
import CategoryLogo from '@/components/CategoryLogo'
import PageBreadcrumb from '@/components/PageBreadcrumb'
import { useAuth } from '@/contexts/SimpleAuth'
import { isCustomerSellableProduct } from '@/lib/productAvailability'
import {
  getAllProductGroups,
  getAvailableAccountIdsByProductGroup,
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
  auditCroDecision,
  decideNextBestCommerceAction,
  estimatePurchaseIntent,
  getCustomerPressureState,
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

type ProductCollection = 'popular' | 'refilled' | 'new'
type SortMode = 'recommended' | 'newest' | 'price-low' | 'price-high' | 'stock'

const PAGE_SIZE = 12

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
  const [, setAccountMap] = useState<Record<string, string>>({})
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
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [activeCollection, setActiveCollection] = useState<ProductCollection>('popular')
  const [sortMode, setSortMode] = useState<SortMode>('recommended')
  const [currentPage, setCurrentPage] = useState(1)
  const didTrackInitialFilter = useRef(false)
  const didTrackInitialSort = useRef(false)

  const loadData = useCallback(async (showPageLoader = false) => {
    try {
      if (showPageLoader) setLoading(true)
      setRefreshing(true)

      const connectionOk = await testConnection()
      if (!connectionOk) throw new Error('Failed to connect to database')

      const [categoriesData, productGroupsData, accountMapData, topSellingData, favoriteIds, automationSetting, revenueSettings, experiments, actionPlans] = await Promise.all([
        getCategories(),
        getAllProductGroups(),
        getAvailableAccountIdsByProductGroup(),
        getTopSellingProductGroupIds(12),
        getFavoriteProductGroupIds(),
        getAppSetting('sales_recommendation_automation_enabled'),
        loadRevenueOsSettings(),
        loadRunningCroExperiments(),
        loadRunningCroActionPlans(),
      ])

      const automationEnabled = automationSetting !== 'false' && revenueSettings.enabled
      setCategories(categoriesData)
      setProductGroups(productGroupsData)
      setAccountMap(accountMapData)
      setTopSellingIds(automationEnabled ? topSellingData : [])
      setFavoriteProductIds(automationEnabled ? favoriteIds : [])
      setRecommendationAutomationEnabled(automationEnabled)
      setRevenueOsSettings(revenueSettings)
      setRunningCroExperiments(experiments)
      setRunningCroActionPlans(actionPlans)
      setError(null)

      getRecentlyRestockedProductGroupIds(8).then(setRestockedIds).catch((err) => {
        console.error('Error loading restocked product groups:', err)
      })
    } catch (err) {
      console.error('Error loading products:', err)
      setError(err instanceof Error ? err.message : 'Failed to load products')
    } finally {
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
      if (!loading) loadData(false)
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
  }, [loadData, loading])

  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, selectedCategory, sortMode])

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
    () => productGroups.filter(isCustomerSellableProduct),
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

    return ranked.slice(0, 7)
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
    return rankProductsForRevenueOs(retrievedProductGroups, categories, {
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
  const nextBestAction = useMemo(() => decideNextBestCommerceAction(revenueOsRankedProducts, {
    purchaseIntent: estimatePurchaseIntent({
      query: searchTerm,
      selectedCategoryId: selectedCategory,
      hasRequestedProduct: searchTerm.trim().length >= 4 && revenueOsRankedProducts.some((ranked) => ranked.reasons.includes('query_relevance')),
      pressure: getCustomerPressureState(),
    }),
    surface: 'products',
    query: searchTerm,
    selectedCategoryId: selectedCategory,
    customer: {
      productGroupCounts: myProductGroupCounts,
      categoryCounts: myCategoryCounts,
      lastPurchasedAtByProductGroup: myProductLastPurchasedAt,
      lastPurchasedAtByCategory: myCategoryLastPurchasedAt,
      lastProductGroupId: myLastProductGroupId,
    },
    pressure: getCustomerPressureState(),
    settings: revenueOsSettings || undefined,
    assignment: croAssignment,
  }), [croAssignment, myCategoryCounts, myCategoryLastPurchasedAt, myLastProductGroupId, myProductGroupCounts, myProductLastPurchasedAt, revenueOsRankedProducts, revenueOsSettings, searchTerm, selectedCategory])

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

      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
  }, [retrievalScoreById, retrievedProductGroups, revenueOsCanRank, revenueOsScoreById, searchTerm, sortMode])

  const collectionRankedProducts = useMemo(() => {
    if (!recommendationAutomationEnabled || !revenueOsCanRank) return []
    return rankProductsForRevenueOs(activeProductGroups, categories, {
      surface: 'products_collection_rails',
      query: '',
      selectedCategoryId: 'all',
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
  }, [activeProductGroups, categories, croAssignment, favoriteProductIds, myCategoryCounts, myCategoryLastPurchasedAt, myLastProductGroupId, myProductGroupCounts, myProductLastPurchasedAt, recommendationAutomationEnabled, relationshipBoosts, restockedIds, revenueOsCanRank, revenueOsSettings, runningCroActionPlans, topSellingIds])

  const topSellingProductGroups = useMemo(() => {
    const safeFallback = [...activeProductGroups]
      .filter(isPurchasable)
      .sort((a, b) => {
        if (b.stock_count !== a.stock_count) return b.stock_count - a.stock_count
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      })
      .slice(0, 9)

    if (!revenueOsCanRank) return safeFallback

    const byId = new Map(activeProductGroups.map((productGroup) => [productGroup.id, productGroup]))
    const pushUnique = (target: ProductGroup[], productGroup?: ProductGroup | null) => {
      if (!productGroup || !isPurchasable(productGroup) || target.some((item) => item.id === productGroup.id)) return
      target.push(productGroup)
    }

    const result: ProductGroup[] = []
    favoriteProductIds.forEach((id) => pushUnique(result, byId.get(id)))
    collectionRankedProducts
      .filter((ranked) => ranked.reasons.some((reason) => ['customer_repeat_purchase_fit', 'customer_related_product', 'customer_category_affinity', 'customer_recent_category_interest'].includes(reason)))
      .forEach((ranked) => pushUnique(result, ranked.product))
    topSellingIds.forEach((id) => pushUnique(result, byId.get(id)))
    restockedIds.forEach((id) => pushUnique(result, byId.get(id)))
    collectionRankedProducts.forEach((ranked) => pushUnique(result, ranked.product))

    const fillIns = [...activeProductGroups]
      .filter((productGroup) => isPurchasable(productGroup) && !result.some((rankedProduct) => rankedProduct.id === productGroup.id))
      .sort((a, b) => a.stock_count - b.stock_count)

    const mixed = [...result, ...fillIns].slice(0, 9)
    return mixed.length > 0 ? mixed : safeFallback
  }, [activeProductGroups, collectionRankedProducts, favoriteProductIds, restockedIds, revenueOsCanRank, topSellingIds])

  const restockedProductGroups = useMemo(
    () =>
      restockedIds
        .map((id) => activeProductGroups.find((productGroup) => productGroup.id === id))
        .filter((productGroup): productGroup is ProductGroup => !!productGroup)
        .slice(0, 9),
    [activeProductGroups, restockedIds],
  )

  const newProductGroups = useMemo(
    () =>
      [...activeProductGroups]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 9),
    [activeProductGroups],
  )

  const collectionGroups = {
    popular: topSellingProductGroups,
    refilled: restockedProductGroups,
    new: newProductGroups,
  }

  const totalPages = Math.max(1, Math.ceil(sortedProductGroups.length / PAGE_SIZE))
  const pageProductGroups = sortedProductGroups.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  useEffect(() => {
    if (!recommendationAutomationEnabled || revenueOsRankedProducts.length === 0) return
    auditCroDecision({
      userId: user?.id || null,
      surface: 'products',
      selected: nextBestAction.selected || revenueOsRankedProducts[0] || null,
      candidates: revenueOsRankedProducts.slice(0, 12),
      metadata: {
        searchTerm,
        selectedCategory,
        sortMode,
        nextBestAction: nextBestAction.action,
        actionReason: nextBestAction.reason,
        actionConfidence: nextBestAction.confidence,
        expectedValue: nextBestAction.expectedValue,
        pressureScore: nextBestAction.pressureScore,
        actionCandidates: nextBestAction.candidates.slice(0, 8),
        actionArbitration: nextBestAction.arbitration,
      },
      assignment: croAssignment,
    })
  }, [croAssignment, nextBestAction, recommendationAutomationEnabled, revenueOsRankedProducts, searchTerm, selectedCategory, sortMode, user?.id])

  useEffect(() => {
    if (!revenueOsCanRank || !nextBestAction.selected || nextBestAction.action === 'DO_NOTHING') return
    const today = new Date().toISOString().slice(0, 10)
    const actorKey = user?.id || getRevenueVisitorId() || 'anonymous'
    trackRevenueEvent({
      eventType: 'RECOMMENDATION_SHOWN',
      userId: user?.id || null,
      productGroupId: nextBestAction.selected.product.id,
      categoryId: nextBestAction.selected.product.category_id,
      surface: 'products_next_best_action',
      experimentId: croAssignment.experimentId,
      variantId: croAssignment.variantId,
      metadata: {
        action: nextBestAction.action,
        reason: nextBestAction.reason,
        confidence: nextBestAction.confidence,
        pressureScore: nextBestAction.pressureScore,
        assignmentMode: croAssignment.mode,
      },
      eventId: `RECOMMENDATION_SHOWN:${today}:${actorKey}:products:${croAssignment.variantId || croAssignment.mode}:${nextBestAction.action}:${nextBestAction.selected.product.id}`,
    })
  }, [croAssignment.experimentId, croAssignment.mode, croAssignment.variantId, nextBestAction, revenueOsCanRank, user?.id])

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10)
    const actorKey = user?.id || getRevenueVisitorId() || 'anonymous'
    pageProductGroups.forEach((productGroup, index) => {
      trackRevenueEvent({
        eventType: 'PRODUCT_IMPRESSION',
        userId: user?.id || null,
        productGroupId: productGroup.id,
        categoryId: productGroup.category_id,
        surface: 'products_grid',
        experimentId: croAssignment.experimentId,
        variantId: croAssignment.variantId,
        metadata: { position: index + 1, page: currentPage, sortMode, selectedCategory, assignmentMode: croAssignment.mode },
        eventId: `PRODUCT_IMPRESSION:${today}:${actorKey}:products:${currentPage}:${croAssignment.variantId || croAssignment.mode}:${productGroup.id}`,
      })
    })
  }, [croAssignment.experimentId, croAssignment.mode, croAssignment.variantId, currentPage, pageProductGroups, selectedCategory, sortMode, user?.id])

  const goToProduct = (productGroup: ProductGroup) => {
    const category = categoryForProduct(productGroup)
    const isRecommendationShow = !!(
      nextBestAction.selected?.product.id === productGroup.id &&
      ['SHOW_REQUESTED_PRODUCT', 'SHOW_ALTERNATIVE', 'SHOW_UPGRADE', 'SHOW_DOWNGRADE', 'SHOW_COMPLEMENT', 'SHOW_TRENDING', 'POST_PURCHASE_RECOMMENDATION'].includes(nextBestAction.action)
    )
    const productClickType = isRecommendationShow ? 'RECOMMENDATION_CLICKED' : 'PRODUCT_CLICKED'

    trackRevenueEvent({
      eventType: productClickType,
      userId: user?.id || null,
      productGroupId: productGroup.id,
      categoryId: productGroup.category_id,
      surface: 'products_grid',
      experimentId: croAssignment.experimentId,
      variantId: croAssignment.variantId,
      metadata: { sortMode, selectedCategory, assignmentMode: croAssignment.mode },
      eventId: `${productClickType}:${crypto.randomUUID()}:products_grid:${productGroup.id}:${nextBestAction.action || 'none'}`,
    })
    trackRevenueEvent({
      eventType: 'BUY_CLICKED',
      userId: user?.id || null,
      productGroupId: productGroup.id,
      categoryId: productGroup.category_id,
      surface: 'products_grid',
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

  const handlePurchase = (productGroupId: string, quantity: number) => {
    const productGroup = productGroups.find((pg) => pg.id === productGroupId)
    const category = productGroup ? categoryForProduct(productGroup) : null

    if (productGroup && category) {
      navigate('/checkout', {
        state: {
          productGroup,
          category,
          quantity,
          isBulkPurchase: quantity > 1,
          croAssignment,
        },
      })
    }
  }

  const handleProductView = (productGroup: ProductGroup) => {
    const isRecommendationShow = !!(
      nextBestAction.selected?.product.id === productGroup.id &&
      ['SHOW_REQUESTED_PRODUCT', 'SHOW_ALTERNATIVE', 'SHOW_UPGRADE', 'SHOW_DOWNGRADE', 'SHOW_COMPLEMENT', 'SHOW_TRENDING', 'POST_PURCHASE_RECOMMENDATION'].includes(nextBestAction.action)
    )
    const productClickType = isRecommendationShow ? 'RECOMMENDATION_CLICKED' : 'PRODUCT_CLICKED'

    trackRevenueEvent({
      eventType: productClickType,
      userId: user?.id || null,
      productGroupId: productGroup.id,
      categoryId: productGroup.category_id,
      surface: 'products_grid',
      experimentId: croAssignment.experimentId,
      variantId: croAssignment.variantId,
      metadata: { sortMode, selectedCategory, assignmentMode: croAssignment.mode },
      eventId: `${productClickType}:${Date.now()}:products_grid:${productGroup.id}:${nextBestAction.action || 'none'}`,
    })
  }

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

      <main className="mx-auto w-full max-w-7xl overflow-x-hidden px-3 pb-12 pt-5 sm:px-6 lg:px-8">
        <PageBreadcrumb items={[{ label: 'Products' }]} className="mb-5" />

        <section className="mb-7">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="text-xl font-black tracking-normal">Browse Categories</h1>
            <Link to="/products" className="hidden items-center gap-2 text-xs font-black text-purple-700 dark:text-purple-300 sm:inline-flex">
              View all categories
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="grid min-w-0 grid-cols-[repeat(5,minmax(0,1fr))] gap-1.5 sm:grid-cols-4 sm:gap-3 lg:grid-cols-8">
            <button
              type="button"
              onClick={() => setSelectedCategory('all')}
              className={`flex min-h-16 min-w-0 max-w-full flex-col items-center justify-center gap-1 overflow-hidden rounded-lg border px-1 py-2 text-center transition sm:flex-row sm:justify-start sm:gap-3 sm:p-3 sm:text-left ${
                selectedCategory === 'all'
                  ? 'border-purple-400 bg-purple-600 text-white shadow-lg shadow-purple-600/20'
                  : 'border-slate-200 bg-white/85 hover:bg-white dark:border-white/10 dark:bg-white/[0.035] dark:hover:bg-white/[0.06]'
              }`}
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-purple-500/20 sm:h-9 sm:w-9">
                <LayoutGrid className="h-4 w-4 sm:h-5 sm:w-5" />
              </span>
              <span className="min-w-0 max-w-full">
                <strong className="block max-w-full break-words text-[10px] leading-tight sm:text-sm">All</strong>
                <small className={selectedCategory === 'all' ? 'text-white/75' : 'text-slate-500 dark:text-slate-400'}>{activeProductGroups.length}</small>
              </span>
            </button>

            {categoryChips.slice(0, 3).map(({ category, count }) => {
              const active = selectedCategory === category.id
              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => setSelectedCategory(category.id)}
                  className={`flex min-h-16 min-w-0 max-w-full flex-col items-center justify-center gap-1 overflow-hidden rounded-lg border px-1 py-2 text-center transition sm:flex-row sm:justify-start sm:gap-3 sm:p-3 sm:text-left ${
                    active
                      ? 'border-purple-400 bg-purple-600 text-white shadow-lg shadow-purple-600/20'
                      : 'border-slate-200 bg-white/85 hover:bg-white dark:border-white/10 dark:bg-white/[0.035] dark:hover:bg-white/[0.06]'
                  }`}
                >
                  <CategoryLogo name={category.name} className="h-7 w-7 sm:h-9 sm:w-9" iconClassName={active ? 'h-6 w-6 text-white sm:h-7 sm:w-7' : 'h-6 w-6 sm:h-7 sm:w-7'} />
                  <span className="min-w-0 max-w-full">
                    <strong className="block max-w-full break-words text-[9px] leading-tight sm:text-sm">{category.name}</strong>
                    <small className={active ? 'text-white/75' : 'text-slate-500 dark:text-slate-400'}>{count}</small>
                  </span>
                </button>
              )
            })}

            {categoryChips.slice(3).map(({ category, count }) => {
              const active = selectedCategory === category.id
              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => setSelectedCategory(category.id)}
                  className={`hidden min-h-16 min-w-0 max-w-full flex-col items-center justify-center gap-1 overflow-hidden rounded-lg border px-1 py-2 text-center transition sm:flex sm:flex-row sm:justify-start sm:gap-3 sm:p-3 sm:text-left ${
                    active
                      ? 'border-purple-400 bg-purple-600 text-white shadow-lg shadow-purple-600/20'
                      : 'border-slate-200 bg-white/85 hover:bg-white dark:border-white/10 dark:bg-white/[0.035] dark:hover:bg-white/[0.06]'
                  }`}
                >
                  <CategoryLogo name={category.name} className="h-7 w-7 sm:h-9 sm:w-9" iconClassName={active ? 'h-6 w-6 text-white sm:h-7 sm:w-7' : 'h-6 w-6 sm:h-7 sm:w-7'} />
                  <span className="min-w-0 max-w-full">
                    <strong className="block max-w-full break-words text-[9px] leading-tight sm:text-sm">{category.name}</strong>
                    <small className={active ? 'text-white/75' : 'text-slate-500 dark:text-slate-400'}>{count}</small>
                  </span>
                </button>
              )
            })}

            <Link
              to="/products"
              className="flex min-h-16 min-w-0 max-w-full flex-col items-center justify-center gap-1 overflow-hidden rounded-lg border border-slate-200 bg-white/85 px-1 py-2 text-center transition hover:bg-white dark:border-white/10 dark:bg-white/[0.035] dark:hover:bg-white/[0.06] sm:flex-row sm:justify-start sm:gap-3 sm:p-3 sm:text-left"
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-slate-100 dark:bg-white/10 sm:h-9 sm:w-9">
                <MoreHorizontal className="h-4 w-4 sm:h-5 sm:w-5" />
              </span>
              <span className="min-w-0 max-w-full">
                <strong className="block max-w-full break-words text-[10px] leading-tight sm:text-sm">More</strong>
                <small className="text-slate-500 dark:text-slate-400">{Math.max(0, categories.length - categoryChips.length)}</small>
              </span>
            </Link>
          </div>
        </section>

        <section className="mb-8">
          <div className="mb-3 flex min-w-0 items-center gap-3">
            <div className="grid min-w-0 flex-1 grid-cols-3 items-center gap-1">
              {([
                ['popular', 'Popular'],
                ['refilled', 'Refilled'],
                ['new', 'New'],
              ] as Array<[ProductCollection, string]>).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setActiveCollection(value)}
                  className={`relative min-w-0 px-1 py-2 text-center text-xs font-black transition sm:px-4 sm:text-sm ${
                    activeCollection === value ? 'text-purple-700 dark:text-purple-300' : 'text-slate-500 hover:text-slate-950 dark:hover:text-white'
                  }`}
                >
                  {label}
                  {activeCollection === value && <span className="absolute inset-x-3 -bottom-0.5 h-0.5 rounded-full bg-purple-600" />}
                </button>
              ))}
            </div>
            <Link to="/products" className="hidden shrink-0 items-center gap-2 text-xs font-black text-purple-700 dark:text-purple-300 lg:inline-flex">
              View all
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="grid min-w-0 gap-2.5 lg:grid-cols-3">
            {collectionGroups[activeCollection].slice(0, 9).map((productGroup) => (
              (() => {
                const category = categoryForProduct(productGroup)
                return (
                  <button
                    key={productGroup.id}
                    type="button"
                    onClick={() => goToProduct(productGroup)}
                    className="flex min-w-0 max-w-full items-center justify-between gap-2 overflow-hidden rounded-lg border border-slate-200 bg-white/85 px-3 py-2.5 text-left text-[10px] font-black shadow-sm transition hover:border-purple-300 hover:bg-white dark:border-white/10 dark:bg-white/[0.035] dark:hover:border-purple-300/30 dark:hover:bg-white/[0.06] sm:px-4 sm:py-3 sm:text-sm"
                    title={productGroup.name}
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
                      {category ? (
                        <CategoryLogo name={category.name} className="h-4 w-4" iconClassName="h-4 w-4" />
                      ) : (
                        <Package className="h-4 w-4 shrink-0 text-purple-600 dark:text-purple-300" />
                      )}
                      <span className="block min-w-0 max-w-full whitespace-normal break-words leading-tight [overflow-wrap:anywhere]">
                        {productGroup.name}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                  </button>
                )
              })()
            ))}
          </div>
        </section>

        <section>
          <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-black tracking-normal">Available Products</h2>
              <Badge className="rounded-full bg-purple-100 text-purple-700 hover:bg-purple-100 dark:bg-purple-500/15 dark:text-purple-300">
                {sortedProductGroups.length} products
              </Badge>
            </div>

            <div className="grid min-w-0 gap-2.5 sm:grid-cols-[auto_minmax(210px,1fr)_160px_auto] sm:gap-3 lg:min-w-[620px]">
              <Button
                variant="outline"
                size="sm"
                onClick={() => loadData(false)}
                disabled={refreshing}
                className="h-10 min-w-0 rounded-lg"
              >
                {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Refresh Stock
              </Button>

              <div className="relative min-w-0">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Search products..."
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  className="h-10 min-w-0 rounded-lg border-slate-200 bg-white/85 pl-10 dark:border-white/10 dark:bg-white/[0.035]"
                />
              </div>

              <select
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value as SortMode)}
                className="h-10 min-w-0 rounded-lg border border-slate-200 bg-white/85 px-3 text-sm font-semibold outline-none dark:border-white/10 dark:bg-[#080d15]"
              >
                <option value="recommended">Recommended</option>
                <option value="newest">Newest</option>
                <option value="stock">Most stock</option>
                <option value="price-low">Lowest price</option>
                <option value="price-high">Highest price</option>
              </select>

              <div className="flex items-center gap-2">
                <Button variant={viewMode === 'grid' ? 'default' : 'outline'} size="icon" onClick={() => setViewMode('grid')} className="h-10 w-10 rounded-lg">
                  <Grid className="h-4 w-4" />
                </Button>
                <Button variant={viewMode === 'list' ? 'default' : 'outline'} size="icon" onClick={() => setViewMode('list')} className="h-10 w-10 rounded-lg">
                  <List className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          <div className="grid min-w-0 gap-5 lg:grid-cols-[210px_minmax(0,1fr)]">
            <aside className="hidden rounded-xl border border-slate-200 bg-white/85 p-3 shadow-sm dark:border-white/10 dark:bg-white/[0.035] lg:block">
              <CategorySidebar
                categories={categories}
                productGroups={activeProductGroups}
                selectedCategory={selectedCategory}
                onSelectCategory={setSelectedCategory}
              />
            </aside>

            <div className="min-w-0">
              {pageProductGroups.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white/85 px-5 py-16 text-center shadow-sm dark:border-white/10 dark:bg-white/[0.035]">
                  <Package className="mx-auto h-12 w-12 text-slate-400" />
                  <h3 className="mt-4 text-xl font-black">No products found</h3>
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Try a different category or search term.</p>
                </div>
              ) : (
                <div className={`grid min-w-0 ${
                  viewMode === 'grid'
                    ? 'grid-cols-[repeat(2,minmax(0,1fr))] gap-2 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4'
                    : 'grid-cols-1 gap-4'
                }`}>
                  {pageProductGroups.map((productGroup) => {
                    const category = categoryForProduct(productGroup)
                    return category ? (
                    <ProductTemplateCard
                        key={productGroup.id}
                        productGroup={productGroup}
                        category={category}
                        onPurchase={handlePurchase}
                        onView={handleProductView}
                      />
                    ) : null
                  })}
                </div>
              )}

              <div className="mt-6 flex flex-col gap-3 text-xs font-semibold text-slate-500 dark:text-slate-400 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center justify-center gap-2 sm:justify-start">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 rounded-lg"
                    onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                    disabled={currentPage <= 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, index) => index + 1).map((page) => (
                    <Button
                      key={page}
                      variant={currentPage === page ? 'default' : 'outline'}
                      size="icon"
                      className="h-9 w-9 rounded-lg"
                      onClick={() => setCurrentPage(page)}
                    >
                      {page}
                    </Button>
                  ))}
                  {totalPages > 5 && <span className="px-1">...</span>}
                  {totalPages > 5 && (
                    <Button
                      variant={currentPage === totalPages ? 'default' : 'outline'}
                      size="icon"
                      className="h-9 w-9 rounded-lg"
                      onClick={() => setCurrentPage(totalPages)}
                    >
                      {totalPages}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 rounded-lg"
                    onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                    disabled={currentPage >= totalPages}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>

                <span className="text-center sm:text-right">
                  Showing {sortedProductGroups.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1}-
                  {Math.min(currentPage * PAGE_SIZE, sortedProductGroups.length)} of {sortedProductGroups.length} products
                </span>
              </div>
            </div>
          </div>
        </section>
      </main>

      <HomepageLiveActivity />
      <Footer />
    </div>
  )
}
