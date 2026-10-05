import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Search, ArrowLeft, Loader2 } from 'lucide-react'
import Navbar from '@/components/NavbarAuth'
import Footer from '@/components/Footer'
import { RecommendationStrip } from '@/components/RecommendationCard'
import { useRecommendations } from '@/hooks/useRecommendations'
import GroupedProductCatalog from '@/components/GroupedProductCatalog'
import { useAuth } from '@/contexts/SimpleAuth'
import { isCustomerSellableProduct, isCustomerVisibleProduct } from '@/lib/productAvailability'
import {
  getCategories,
  getAllProductGroups,
  getAppSetting,
  getFavoriteProductGroupIds,
  getTopSellingProductGroupIds,
  getUserPurchaseHistory,
  type Category,
  type ProductGroup
} from '@/lib/supabase'
import {
  getRevenueVisitorId,
  loadRevenueOsSettings,
  loadCustomerRelationshipBoosts,
  loadRunningCroActionPlans,
  loadRunningCroExperiments,
  rankProductsForRevenueOs,
  retrieveProductsForQuery,
  resolveCroAssignment,
  trackRevenueEvent,
  type RevenueOsSettings,
} from '@/lib/revenue-os'

export default function CategoryPage() {
  const { categoryId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { recommendations: recs } = useRecommendations({ excludeCategoryId: categoryId, limit: 3 })

  // State for real Supabase data
  const [category, setCategory] = useState<Category | null>(null)
  const [productGroups, setProductGroups] = useState<ProductGroup[]>([])
  const [allCategories, setAllCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // UI state
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState('recommended')
  const didTrackInitialSort = useRef(false)

  // Personalization data for "Recommended" sort: global popularity rank (best
  // overall sellers) plus this user's own purchase history (rebuy signal).
  // Neither one blocks page load if it fails - sort just falls back to
  // whatever default ordering came back from the DB.
  const [globalRank, setGlobalRank] = useState<Record<string, number>>({})
  const [myPurchaseCounts, setMyPurchaseCounts] = useState<Record<string, number>>({})
  const [myCategoryCounts, setMyCategoryCounts] = useState<Record<string, number>>({})
  const [myProductLastPurchasedAt, setMyProductLastPurchasedAt] = useState<Record<string, string>>({})
  const [myCategoryLastPurchasedAt, setMyCategoryLastPurchasedAt] = useState<Record<string, string>>({})
  const [myLastProductGroupId, setMyLastProductGroupId] = useState<string | null>(null)
  const [relationshipBoosts, setRelationshipBoosts] = useState<Record<string, number>>({})
  const [topSellingIds, setTopSellingIds] = useState<string[]>([])
  const [favoriteProductIds, setFavoriteProductIds] = useState<string[]>([])
  const [revenueOsSettings, setRevenueOsSettings] = useState<RevenueOsSettings | null>(null)
  const [runningCroExperiments, setRunningCroExperiments] = useState<any[]>([])
  const [runningCroActionPlans, setRunningCroActionPlans] = useState<any[]>([])
  const [recommendationAutomationEnabled, setRecommendationAutomationEnabled] = useState(true)

  useEffect(() => {
    let cancelled = false

    Promise.all([
      getAppSetting('sales_recommendation_automation_enabled'),
      loadRevenueOsSettings(),
      loadRunningCroExperiments(),
      loadRunningCroActionPlans(),
      getFavoriteProductGroupIds(),
    ])
      .then(async ([setting, revenueSettings, experiments, actionPlans, favoriteIds]) => {
        const enabled = setting !== 'false' && revenueSettings.enabled
        if (cancelled) return
        setRecommendationAutomationEnabled(enabled)
        setRevenueOsSettings(revenueSettings)
        setRunningCroExperiments(experiments)
        setRunningCroActionPlans(actionPlans)
        if (!enabled) {
          setGlobalRank({})
          setMyPurchaseCounts({})
          setMyCategoryCounts({})
          setMyProductLastPurchasedAt({})
          setMyCategoryLastPurchasedAt({})
          setMyLastProductGroupId(null)
          setRelationshipBoosts({})
          setTopSellingIds([])
          setFavoriteProductIds([])
          return
        }

        const ids = await getTopSellingProductGroupIds(200)
        if (cancelled) return
        const rank: Record<string, number> = {}
        ids.forEach((id, index) => { rank[id] = index })
        setGlobalRank(rank)
        setTopSellingIds(ids)
        setFavoriteProductIds(favoriteIds)

        if (user?.id) {
          const { productGroupCounts, categoryCounts, lastPurchasedAtByProductGroup, lastPurchasedAtByCategory, lastProductGroupId } = await getUserPurchaseHistory(user.id)
          const boosts = await loadCustomerRelationshipBoosts(productGroupCounts, lastPurchasedAtByProductGroup)
          if (!cancelled) {
            setMyPurchaseCounts(productGroupCounts)
            setMyCategoryCounts(categoryCounts)
            setMyProductLastPurchasedAt(lastPurchasedAtByProductGroup)
            setMyCategoryLastPurchasedAt(lastPurchasedAtByCategory)
            setMyLastProductGroupId(lastProductGroupId)
            setRelationshipBoosts(boosts)
          }
        } else {
          setMyPurchaseCounts({})
          setMyCategoryCounts({})
          setMyProductLastPurchasedAt({})
          setMyCategoryLastPurchasedAt({})
          setMyLastProductGroupId(null)
          setRelationshipBoosts({})
        }
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [user?.id])

  // Handle direct product purchase
  const handleProductPurchase = (productGroupId: string, quantity: number) => {
    const productGroup = productGroups.find(pg => pg.id === productGroupId)
    
    if (productGroup && category && isCustomerSellableProduct(productGroup)) {
      trackRevenueEvent({
        eventType: 'BUY_CLICKED',
        userId: user?.id || null,
        productGroupId: productGroup.id,
        categoryId: productGroup.category_id,
        surface: 'category',
        experimentId: croAssignment.experimentId,
        variantId: croAssignment.variantId,
        metadata: { quantity, sortBy, searchTerm, assignmentMode: croAssignment.mode },
      })
      navigate('/checkout', {
        state: {
          productGroup,
          category,
          quantity,
          isBulkPurchase: quantity > 1,
          croAssignment,
        }
      })
    }
  }

  // Load real data from Supabase
  useEffect(() => {
    const loadData = async () => {
      if (!categoryId) return
      
      try {
        setLoading(true)
        console.log('🔄 Loading category data for:', categoryId)
        
        // Load categories and product groups
        const [categoriesData, productGroupsData] = await Promise.all([
          getCategories(),
          getAllProductGroups()
        ])

        // Find the current category
        const currentCategory = categoriesData.find(cat => cat.id === categoryId)
        if (!currentCategory) {
          setError('Category not found')
          setLoading(false)
          return
        }

        // Filter product groups for this category
        const categoryProductGroups = productGroupsData.filter(pg =>
          pg.category_id === categoryId && isCustomerVisibleProduct(pg)
        )

        setCategory(currentCategory)
        setProductGroups(categoryProductGroups)
        setAllCategories(categoriesData)

        console.log('✅ Category data loaded:', {
          category: currentCategory.name,
          productGroups: categoryProductGroups.length
        })
      } catch (error) {
        console.error('❌ Error loading category data:', error)
        setError('Failed to load category data')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [categoryId])

  const croAssignment = useMemo(() => resolveCroAssignment({
    surface: 'category',
    settings: revenueOsSettings,
    experiments: runningCroExperiments,
    visitorId: getRevenueVisitorId(),
    userId: user?.id || null,
  }), [revenueOsSettings, runningCroExperiments, user?.id])

  const productRetrievalResults = useMemo(
    () => retrieveProductsForQuery(productGroups, allCategories, searchTerm),
    [allCategories, productGroups, searchTerm],
  )

  const retrievalScoreById = useMemo(
    () => new Map(productRetrievalResults.map((result) => [result.product.id, result.score])),
    [productRetrievalResults],
  )

  const retrievedProductGroups = useMemo(
    () => productRetrievalResults.map((result) => result.product),
    [productRetrievalResults],
  )

  useEffect(() => {
    const query = searchTerm.trim()
    if (query.length < 2 || !category) return

    const timeout = window.setTimeout(() => {
      trackRevenueEvent({
        eventType: 'SEARCHED',
        userId: user?.id || null,
        categoryId: category.id,
        surface: 'category',
        metadata: {
          query,
          categoryId: category.id,
          resultCount: productRetrievalResults.length,
          topRetrievalScore: productRetrievalResults[0]?.score || 0,
        },
      })
    }, 500)

    return () => window.clearTimeout(timeout)
  }, [category, productRetrievalResults, searchTerm, user?.id])

  useEffect(() => {
    if (!didTrackInitialSort.current) {
      didTrackInitialSort.current = true
      return
    }
    trackRevenueEvent({
      eventType: 'SORT_USED',
      userId: user?.id || null,
      categoryId: category?.id || null,
      surface: 'category',
      metadata: { sortBy, categoryId: category?.id || null },
    })
  }, [category?.id, sortBy, user?.id])

  const revenueOsRankedProducts = useMemo(() => {
    if (!recommendationAutomationEnabled || !category) return []
    return rankProductsForRevenueOs(retrievedProductGroups.filter(isCustomerSellableProduct), allCategories, {
      surface: 'category',
      query: searchTerm,
      selectedCategoryId: category.id,
      topSellingIds,
      favoriteProductIds,
      actionPlans: runningCroActionPlans,
      relationshipBoosts,
      customer: {
        productGroupCounts: myPurchaseCounts,
        categoryCounts: myCategoryCounts,
        lastPurchasedAtByProductGroup: myProductLastPurchasedAt,
        lastPurchasedAtByCategory: myCategoryLastPurchasedAt,
        lastProductGroupId: myLastProductGroupId,
      },
      settings: revenueOsSettings || undefined,
      assignment: croAssignment,
    })
  }, [allCategories, category, croAssignment, favoriteProductIds, myCategoryCounts, myCategoryLastPurchasedAt, myLastProductGroupId, myProductLastPurchasedAt, myPurchaseCounts, recommendationAutomationEnabled, relationshipBoosts, retrievedProductGroups, revenueOsSettings, runningCroActionPlans, searchTerm, topSellingIds])

  const revenueOsScoreById = useMemo(
    () => new Map(revenueOsRankedProducts.map((ranked) => [ranked.product.id, ranked.score])),
    [revenueOsRankedProducts],
  )
  const revenueOsCanRank = recommendationAutomationEnabled && croAssignment.rankingEnabled
  // Filter and sort product groups
  const filteredProductGroups = [...retrievedProductGroups].sort((a, b) => {
    const availableA = isCustomerSellableProduct(a), availableB = isCustomerSellableProduct(b)
    if (availableA !== availableB) return availableA ? -1 : 1
    switch (sortBy) {
      case 'price-low':
        return a.price - b.price
      case 'price-high':
        return b.price - a.price
      case 'stock-high':
        return b.stock_count - a.stock_count
      case 'az':
        return a.name.localeCompare(b.name)
      case 'frequently-bought': {
        if (!recommendationAutomationEnabled) return a.name.localeCompare(b.name)
        const mineA = myPurchaseCounts[a.id] || 0
        const mineB = myPurchaseCounts[b.id] || 0
        if (mineA !== mineB) return mineB - mineA
        const relatedA = relationshipBoosts[a.id] || 0
        const relatedB = relationshipBoosts[b.id] || 0
        if (relatedA !== relatedB) return relatedB - relatedA
        const categoryA = myCategoryCounts[a.category_id] || 0
        const categoryB = myCategoryCounts[b.category_id] || 0
        if (categoryA !== categoryB) return categoryB - categoryA
        const rankA = globalRank[a.id] ?? Infinity
        const rankB = globalRank[b.id] ?? Infinity
        if (rankA !== rankB) return rankA - rankB
        return a.name.localeCompare(b.name)
      }
      case 'recommended':
      default: {
        if (!revenueOsCanRank) return a.name.trim().localeCompare(b.name.trim(), undefined, { numeric: true, sensitivity: 'base' })
        if (searchTerm.trim().length > 0) {
          const relevanceA = retrievalScoreById.get(a.id) || 0
          const relevanceB = retrievalScoreById.get(b.id) || 0
          if (relevanceA !== relevanceB) return relevanceB - relevanceA
        }
        const scoreA = revenueOsScoreById.get(a.id) || 0
        const scoreB = revenueOsScoreById.get(b.id) || 0
        if (scoreA !== scoreB) return scoreB - scoreA

        // Rebuy signal first (products this user has personally bought
        // before), then overall popularity rank, then price as a tiebreaker.
        const mineA = myPurchaseCounts[a.id] || 0
        const mineB = myPurchaseCounts[b.id] || 0
        if (mineA !== mineB) return mineB - mineA

        const rankA = globalRank[a.id] ?? Infinity
        const rankB = globalRank[b.id] ?? Infinity
        if (rankA !== rankB) return rankA - rankB

        return a.price - b.price
      }
    }
  })

  const handleImpression = useCallback((product: ProductGroup) => {
    trackRevenueEvent({
      eventType: 'PRODUCT_IMPRESSION', userId: user?.id || null,
      productGroupId: product.id, categoryId: product.category_id,
      surface: 'category_catalog', experimentId: croAssignment.experimentId, variantId: croAssignment.variantId,
      metadata: { sortBy, assignmentMode: croAssignment.mode },
      eventId: ['PRODUCT_IMPRESSION', new Date().toISOString().slice(0, 10), user?.id || getRevenueVisitorId() || 'anonymous', 'category_catalog', croAssignment.variantId || croAssignment.mode, product.id].join(':'),
    })
  }, [user?.id, croAssignment, sortBy])

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
            <p>Loading category products...</p>
          </div>
        </div>
        <Footer />
      </div>
    )
  }

  if (error || !category) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="container mx-auto px-6 py-8">
          <div className="text-center">
            <h1 className="text-2xl font-bold mb-4">Category Not Found</h1>
            <p className="text-muted-foreground mb-6">{error}</p>
            <Button onClick={() => navigate('/products')}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Products
            </Button>
          </div>
        </div>
        <Footer />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted/20">
      <Navbar />
      <main className="mx-auto w-full max-w-5xl px-3 pb-12 pt-5 sm:px-6">
        <Button type="button" variant="ghost" size="sm" onClick={() => navigate('/products')} className="mb-4 px-1 text-sm"><ArrowLeft className="h-4 w-4" /> All products</Button>
        <header className="mb-5">
          <h1 className="text-2xl font-extrabold sm:text-3xl">{category.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{category.description || `Browse ${category.name.toLowerCase()} products by region and availability.`}</p>
        </header>
        <nav aria-label="Product categories" className="mb-4 flex gap-2 overflow-x-auto pb-2">
          <button type="button" onClick={() => navigate('/products')} className="shrink-0 rounded-xl border px-4 py-2 text-xs font-bold">All</button>
          {allCategories.map((item) => <button key={item.id} type="button" onClick={() => navigate(`/category/${item.id}`)} className={`shrink-0 rounded-xl px-4 py-2 text-xs font-bold ${item.id === category.id ? 'bg-purple-600 text-white' : 'border bg-card text-muted-foreground hover:border-purple-300'}`}>{item.name.trim()}</button>)}
        </nav>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-semibold text-muted-foreground">{filteredProductGroups.length} product{filteredProductGroups.length === 1 ? '' : 's'} found</p>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <div className="relative min-w-[180px] flex-1 sm:w-60">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input aria-label={`Search ${category.name} products`} placeholder="Search products..." value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} className="h-10 rounded-xl pl-10" />
            </div>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="h-10 w-40 rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="recommended">Recommended</SelectItem>
                <SelectItem value="frequently-bought">Frequently Bought</SelectItem>
                <SelectItem value="price-low">Lowest price</SelectItem>
                <SelectItem value="price-high">Highest price</SelectItem>
                <SelectItem value="stock-high">Most available</SelectItem>
                <SelectItem value="az">A–Z</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <GroupedProductCatalog categories={[category]} products={filteredProductGroups} selectedCategory={category.id} onImpression={handleImpression} onBuy={handleProductPurchase} />
      </main>
      {recs.length > 0 && <div className="mx-auto max-w-5xl px-4 pb-10"><RecommendationStrip products={recs} surface="category_page" actionType="SHOW_ALTERNATIVE" userId={user?.id} title="You might also like" /></div>}
      <Footer />
    </div>
  )
}
