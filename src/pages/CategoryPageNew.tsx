import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Search, ArrowLeft, Loader2, Package } from 'lucide-react'
import Navbar from '@/components/NavbarAuth'
import Footer from '@/components/Footer'
import ProductTemplateCard from '@/components/ProductTemplateCard'
import { useAuth } from '@/contexts/SimpleAuth'
import { isCustomerSellableProduct } from '@/lib/productAvailability'
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
  auditCroDecision,
  decideNextBestCommerceAction,
  estimatePurchaseIntent,
  getCustomerPressureState,
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
    
    if (productGroup && category) {
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

  const handleProductView = (productGroup: ProductGroup) => {
    if (!category) return
    const isRecommendationClick = !!(
      nextBestAction.selected?.product.id === productGroup.id &&
      ['SHOW_REQUESTED_PRODUCT', 'SHOW_ALTERNATIVE', 'SHOW_UPGRADE', 'SHOW_DOWNGRADE', 'SHOW_COMPLEMENT', 'SHOW_TRENDING', 'POST_PURCHASE_RECOMMENDATION'].includes(nextBestAction.action)
    )

    trackRevenueEvent({
      eventType: isRecommendationClick ? 'RECOMMENDATION_CLICKED' : 'PRODUCT_CLICKED',
      userId: user?.id || null,
      productGroupId: productGroup.id,
      categoryId: productGroup.category_id,
      surface: 'category',
      experimentId: croAssignment.experimentId,
      variantId: croAssignment.variantId,
      metadata: { sortBy, searchTerm, assignmentMode: croAssignment.mode, recommendationAction: isRecommendationClick ? nextBestAction.action : null },
      eventId: `${isRecommendationClick ? 'RECOMMENDATION_CLICKED' : 'PRODUCT_CLICKED'}:${crypto.randomUUID()}:category:${category.id}:${productGroup.id}`,
    })
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
          pg.category_id === categoryId && isCustomerSellableProduct(pg)
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
    return rankProductsForRevenueOs(retrievedProductGroups, allCategories, {
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
  const nextBestAction = useMemo(() => decideNextBestCommerceAction(revenueOsRankedProducts, {
    purchaseIntent: estimatePurchaseIntent({
      query: searchTerm,
      selectedCategoryId: category?.id,
      hasRequestedProduct: searchTerm.trim().length >= 4 && revenueOsRankedProducts.some((ranked) => ranked.reasons.includes('query_relevance')),
      pressure: getCustomerPressureState(),
    }),
    surface: 'category',
    query: searchTerm,
    selectedCategoryId: category?.id,
    customer: {
      productGroupCounts: myPurchaseCounts,
      categoryCounts: myCategoryCounts,
      lastPurchasedAtByProductGroup: myProductLastPurchasedAt,
      lastPurchasedAtByCategory: myCategoryLastPurchasedAt,
      lastProductGroupId: myLastProductGroupId,
    },
    pressure: getCustomerPressureState(),
    settings: revenueOsSettings || undefined,
    assignment: croAssignment,
  }), [category?.id, croAssignment, myCategoryCounts, myCategoryLastPurchasedAt, myLastProductGroupId, myProductLastPurchasedAt, myPurchaseCounts, revenueOsRankedProducts, revenueOsSettings, searchTerm])

  useEffect(() => {
    if (!recommendationAutomationEnabled || revenueOsRankedProducts.length === 0) return
    auditCroDecision({
      userId: user?.id || null,
      surface: 'category',
      selected: nextBestAction.selected || revenueOsRankedProducts[0] || null,
      candidates: revenueOsRankedProducts.slice(0, 12),
      metadata: {
        searchTerm,
        sortBy,
        categoryId: category?.id,
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
  }, [category?.id, croAssignment, nextBestAction, recommendationAutomationEnabled, revenueOsRankedProducts, searchTerm, sortBy, user?.id])

  useEffect(() => {
    if (!revenueOsCanRank || !nextBestAction.selected || nextBestAction.action === 'DO_NOTHING') return
    const today = new Date().toISOString().slice(0, 10)
    const actorKey = user?.id || getRevenueVisitorId() || 'anonymous'
    trackRevenueEvent({
      eventType: 'RECOMMENDATION_SHOWN',
      userId: user?.id || null,
      productGroupId: nextBestAction.selected.product.id,
      categoryId: nextBestAction.selected.product.category_id,
      surface: 'category_next_best_action',
      experimentId: croAssignment.experimentId,
      variantId: croAssignment.variantId,
      metadata: {
        categoryId: category?.id || null,
        action: nextBestAction.action,
        reason: nextBestAction.reason,
        confidence: nextBestAction.confidence,
        expectedValue: nextBestAction.expectedValue,
        pressureScore: nextBestAction.pressureScore,
        arbitration: nextBestAction.arbitration,
        sortBy,
        searchTerm,
      },
      eventId: `RECOMMENDATION_SHOWN:${today}:${actorKey}:category:${category?.id || 'unknown'}:${croAssignment.variantId || croAssignment.mode}:${nextBestAction.action}:${nextBestAction.selected.product.id}`,
    })
  }, [category?.id, croAssignment.experimentId, croAssignment.mode, croAssignment.variantId, nextBestAction, revenueOsCanRank, searchTerm, sortBy, user?.id])

  // Filter and sort product groups
  const filteredProductGroups = [...retrievedProductGroups].sort((a, b) => {
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
        if (!revenueOsCanRank) return a.price - b.price
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

  useEffect(() => {
    if (!category || filteredProductGroups.length === 0) return
    const today = new Date().toISOString().slice(0, 10)
    const actorKey = user?.id || getRevenueVisitorId() || 'anonymous'
    filteredProductGroups.slice(0, 24).forEach((productGroup, index) => {
      trackRevenueEvent({
        eventType: 'PRODUCT_IMPRESSION',
        userId: user?.id || null,
        productGroupId: productGroup.id,
        categoryId: productGroup.category_id,
        surface: 'category',
        experimentId: croAssignment.experimentId,
        variantId: croAssignment.variantId,
        metadata: {
          categoryId: category.id,
          position: index + 1,
          sortBy,
          searchTerm,
          assignmentMode: croAssignment.mode,
        },
        eventId: `PRODUCT_IMPRESSION:${today}:${actorKey}:category:${category.id}:${sortBy}:${searchTerm || 'all'}:${croAssignment.variantId || croAssignment.mode}:${productGroup.id}`,
      })
    })
  }, [category, croAssignment.experimentId, croAssignment.mode, croAssignment.variantId, filteredProductGroups, searchTerm, sortBy, user?.id])

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
      
      {/* Hero Section */}
      <div className="bg-primary text-primary-foreground py-16">
        <div className="container mx-auto px-6">
          <div className="flex items-center gap-4 mb-6">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate('/products')}
              className="bg-primary-foreground/10 hover:bg-primary-foreground/20"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Products
            </Button>
          </div>
          
          <div className="max-w-4xl">
            <h1 className="text-4xl md:text-5xl font-bold mb-4">
              {category.name}
            </h1>
            <p className="text-xl text-primary-foreground/80 mb-6">
              {category.description || `Premium ${category.name.toLowerCase()} with instant delivery`}
            </p>
            <div className="flex items-center gap-4">
              <Badge variant="secondary" className="bg-primary-foreground/20 text-primary-foreground">
                {filteredProductGroups.length} Products Available
              </Badge>
              <Badge variant="secondary" className="bg-primary-foreground/20 text-primary-foreground">
                {filteredProductGroups.reduce((sum, pg) => sum + pg.stock_count, 0)} Accounts In Stock
              </Badge>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto px-6 py-8">
        {/* Search and Filters */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder={`Search ${category.name.toLowerCase()}...`}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          
          <div className="flex items-center gap-4">
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recommended">Recommended for you</SelectItem>
                <SelectItem value="frequently-bought">Frequently Bought</SelectItem>
                <SelectItem value="price-low">Price: Low to High</SelectItem>
                <SelectItem value="price-high">Price: High to Low</SelectItem>
                <SelectItem value="stock-high">Most Available</SelectItem>
                <SelectItem value="az">Alphabetical (A-Z)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Product Templates */}
        <div className="grid gap-3 grid-cols-2 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filteredProductGroups.length === 0 ? (
            <div className="col-span-full text-center py-12">
              <Package className="h-16 w-16 mx-auto text-muted-foreground mb-4 opacity-50" />
              <h3 className="text-xl font-semibold mb-2">No Products Found</h3>
              <p className="text-muted-foreground">
                {searchTerm 
                  ? 'Try adjusting your search terms or browse other categories'
                  : 'This category is currently being stocked. Check back soon!'
                }
              </p>
            </div>
          ) : (
            filteredProductGroups.map((productGroup) => (
              <ProductTemplateCard
                key={productGroup.id}
                productGroup={productGroup}
                category={category}
                onPurchase={handleProductPurchase}
                onView={handleProductView}
              />
            ))
          )}
        </div>
      </div>

      <Footer />
    </div>
  )
}
