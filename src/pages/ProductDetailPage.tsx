import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { PackageCheck, Shield, Check, AlertTriangle, Loader2, Users, Eye, Calendar, Sparkles } from 'lucide-react'
import NavbarAuth from '@/components/NavbarAuth'
import Footer from '@/components/Footer'
import { BackButton, BackToProducts } from '@/components/ui/back-button'
import { useCurrency } from '@/contexts/CurrencyContext'
import { useAuth } from '@/contexts/SimpleAuth'
import { 
  getIndividualAccountById,
  getProductGroupById,
  getCategoryById,
  getAllProductGroups,
  getAvailableAccountIdsByProductGroup,
  getCategories,
  getAppSetting,
  getFavoriteProductGroupIds,
  getRecentlyRestockedProductGroupIds,
  getTopSellingProductGroupIds,
  getUserPurchaseHistory,
  type IndividualAccount,
  type ProductGroup,
  type Category
} from '@/lib/supabase'
import { isCustomerSellableProduct } from '@/lib/productAvailability'
import {
  auditCroDecision,
  decideNextBestCommerceAction,
  getCustomerPressureState,
  getRevenueVisitorId,
  loadCustomerRelationshipBoosts,
  loadRevenueOsSettings,
  loadRunningCroActionPlans,
  loadRunningCroExperiments,
  rankProductsForRevenueOs,
  resolveCroAssignment,
  trackRevenueEvent,
  type RevenueOsSettings,
} from '@/lib/revenue-os'
import CategoryLogo from '@/components/CategoryLogo'
import ProductTemplateCard from '@/components/ProductTemplateCard'

export default function ProductDetailPage() {
  const { productId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { formatPrice } = useCurrency()
  
  // State for real data
  const [account, setAccount] = useState<IndividualAccount | null>(null)
  const [productGroup, setProductGroup] = useState<ProductGroup | null>(null)
  const [category, setCategory] = useState<Category | null>(null)
  const [allProductGroups, setAllProductGroups] = useState<ProductGroup[]>([])
  const [allCategories, setAllCategories] = useState<Category[]>([])
  const [accountMap, setAccountMap] = useState<Record<string, string>>({})
  const [topSellingIds, setTopSellingIds] = useState<string[]>([])
  const [favoriteProductIds, setFavoriteProductIds] = useState<string[]>([])
  const [restockedIds, setRestockedIds] = useState<string[]>([])
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Check if user is logged in
  const isLoggedIn = !!user

  const loadProductData = useCallback(async () => {
    if (!productId) return

    try {
      setLoading(true)
      setError(null)

      const [
        accountData,
        categoriesData,
        productGroupsData,
        accountMapData,
        topSellingData,
        favoriteIds,
        restockedData,
        automationSetting,
        revenueSettings,
        experiments,
        actionPlans,
      ] = await Promise.all([
        getIndividualAccountById(productId),
        getCategories(),
        getAllProductGroups(),
        getAvailableAccountIdsByProductGroup(),
        getTopSellingProductGroupIds(12),
        getFavoriteProductGroupIds(),
        getRecentlyRestockedProductGroupIds(8),
        getAppSetting('sales_recommendation_automation_enabled'),
        loadRevenueOsSettings(),
        loadRunningCroExperiments(),
        loadRunningCroActionPlans(),
      ])

      if (!accountData) {
        setError('Product not found')
        return
      }

      setAccount(accountData)

      const productGroupData = productGroupsData.find((row) => row.id === accountData.product_group_id) || await getProductGroupById(accountData.product_group_id)
      if (!productGroupData || !isCustomerSellableProduct(productGroupData)) {
        setError('Product is no longer available')
        return
      }

      const categoryData = categoriesData.find((row) => row.id === productGroupData.category_id) || await getCategoryById(productGroupData.category_id)
      const automationEnabled = automationSetting !== 'false' && revenueSettings.enabled

      setProductGroup(productGroupData)
      setCategory(categoryData || null)
      setAllCategories(categoriesData)
      setAllProductGroups(productGroupsData.some((row) => row.id === productGroupData.id) ? productGroupsData : [productGroupData, ...productGroupsData])
      setAccountMap(accountMapData)
      setTopSellingIds(automationEnabled ? topSellingData : [])
      setFavoriteProductIds(automationEnabled ? favoriteIds : [])
      setRestockedIds(automationEnabled ? restockedData : [])
      setRecommendationAutomationEnabled(automationEnabled)
      setRevenueOsSettings(revenueSettings)
      setRunningCroExperiments(experiments)
      setRunningCroActionPlans(actionPlans)
    } catch (error) {
      console.error('Error loading product data:', error)
      setError('Failed to load product data')
    } finally {
      setLoading(false)
    }
  }, [productId])

  useEffect(() => {
    loadProductData()
  }, [loadProductData])

  useEffect(() => {
    let cancelled = false

    if (!recommendationAutomationEnabled) {
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

    const loadRelationshipSignals = async () => {
      const currentProductBoosts = productGroup
        ? await loadCustomerRelationshipBoosts({ [productGroup.id]: 1 }, { [productGroup.id]: new Date().toISOString() })
        : {}

      if (!user?.id) {
        if (cancelled) return
        setMyProductGroupCounts({})
        setMyCategoryCounts({})
        setMyProductLastPurchasedAt({})
        setMyCategoryLastPurchasedAt({})
        setMyLastProductGroupId(null)
        setRelationshipBoosts(Object.fromEntries(
          Object.entries(currentProductBoosts).map(([id, boost]) => [id, Number(boost) * 1.4]),
        ))
        return
      }

      const { productGroupCounts, categoryCounts, lastPurchasedAtByProductGroup, lastPurchasedAtByCategory, lastProductGroupId } = await getUserPurchaseHistory(user.id)
      if (cancelled) return

      setMyProductGroupCounts(productGroupCounts)
      setMyCategoryCounts(categoryCounts)
      setMyProductLastPurchasedAt(lastPurchasedAtByProductGroup)
      setMyCategoryLastPurchasedAt(lastPurchasedAtByCategory)
      setMyLastProductGroupId(lastProductGroupId)

      const personalBoosts = await loadCustomerRelationshipBoosts(productGroupCounts, lastPurchasedAtByProductGroup)

      if (cancelled) return
      const mergedBoosts = { ...personalBoosts }
      for (const [id, boost] of Object.entries(currentProductBoosts)) {
        mergedBoosts[id] = Math.max(mergedBoosts[id] || 0, Number(boost) * 1.4)
      }
      setRelationshipBoosts(mergedBoosts)
    }

    loadRelationshipSignals()
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
  }, [productGroup, recommendationAutomationEnabled, user?.id])

  useEffect(() => {
    const refreshVisibleData = () => {
      if (!loading) loadProductData()
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
  }, [loadProductData, loading])

  const croAssignment = useMemo(() => resolveCroAssignment({
    surface: 'product_detail',
    settings: revenueOsSettings,
    experiments: runningCroExperiments,
    visitorId: getRevenueVisitorId(),
    userId: user?.id || null,
  }), [revenueOsSettings, runningCroExperiments, user?.id])

  const categoryById = useMemo(() => {
    return new Map(allCategories.map((entry) => [entry.id, entry]))
  }, [allCategories])

  const activeRelatedProductGroups = useMemo(() => {
    if (!productGroup) return []
    return allProductGroups
      .filter((entry) => entry.id !== productGroup.id)
      .filter(isCustomerSellableProduct)
      .filter((entry) => entry.category_id === productGroup.category_id || relationshipBoosts[entry.id] || favoriteProductIds.includes(entry.id) || topSellingIds.includes(entry.id))
  }, [allProductGroups, favoriteProductIds, productGroup, relationshipBoosts, topSellingIds])

  const rankedRelatedProducts = useMemo(() => {
    if (!recommendationAutomationEnabled || !productGroup) return []
    return rankProductsForRevenueOs(activeRelatedProductGroups, allCategories, {
      surface: 'product_detail',
      selectedCategoryId: productGroup.category_id,
      topSellingIds,
      favoriteProductIds,
      restockedIds,
      relationshipBoosts,
      actionPlans: runningCroActionPlans,
      customer: {
        productGroupCounts: myProductGroupCounts,
        categoryCounts: myCategoryCounts,
        lastPurchasedAtByProductGroup: myProductLastPurchasedAt,
        lastPurchasedAtByCategory: myCategoryLastPurchasedAt,
        lastProductGroupId: myLastProductGroupId,
      },
      settings: revenueOsSettings || undefined,
      assignment: croAssignment,
    }).slice(0, 8)
  }, [activeRelatedProductGroups, allCategories, croAssignment, favoriteProductIds, myCategoryCounts, myCategoryLastPurchasedAt, myLastProductGroupId, myProductGroupCounts, myProductLastPurchasedAt, productGroup, recommendationAutomationEnabled, relationshipBoosts, restockedIds, revenueOsSettings, runningCroActionPlans, topSellingIds])

  const nextBestAction = useMemo(() => decideNextBestCommerceAction(rankedRelatedProducts, {
    purchaseIntent: 0.58,
    surface: 'product_detail',
    selectedCategoryId: productGroup?.category_id,
    requestedProductId: productGroup?.id || null,
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
  }), [croAssignment, myCategoryCounts, myCategoryLastPurchasedAt, myLastProductGroupId, myProductGroupCounts, myProductLastPurchasedAt, productGroup?.category_id, productGroup?.id, rankedRelatedProducts, revenueOsSettings])

  const recommendedProductGroups = useMemo(() => {
    if (!recommendationAutomationEnabled || croAssignment.mode === 'holdout' || croAssignment.mode === 'control') return []
    if (nextBestAction.action === 'DO_NOTHING' || nextBestAction.action === 'CLOSE_PURCHASE') return []
    return rankedRelatedProducts.slice(0, 4).map((ranked) => ranked.product)
  }, [croAssignment.mode, nextBestAction.action, rankedRelatedProducts, recommendationAutomationEnabled])

  useEffect(() => {
    if (!recommendationAutomationEnabled || rankedRelatedProducts.length === 0) return
    auditCroDecision({
      userId: user?.id || null,
      surface: 'product_detail',
      selected: nextBestAction.selected || rankedRelatedProducts[0] || null,
      candidates: rankedRelatedProducts.slice(0, 8),
      metadata: {
        sourceProductGroupId: productGroup?.id || null,
        sourceCategoryId: productGroup?.category_id || null,
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
  }, [croAssignment, nextBestAction, productGroup?.category_id, productGroup?.id, rankedRelatedProducts, recommendationAutomationEnabled, user?.id])

  useEffect(() => {
    if (recommendedProductGroups.length === 0) return
    const today = new Date().toISOString().slice(0, 10)
    const actorKey = user?.id || getRevenueVisitorId() || 'anonymous'
    recommendedProductGroups.forEach((recommended, index) => {
      const ranked = rankedRelatedProducts.find((entry) => entry.product.id === recommended.id)
      trackRevenueEvent({
        eventType: 'RECOMMENDATION_SHOWN',
        userId: user?.id || null,
        productGroupId: recommended.id,
        categoryId: recommended.category_id,
        surface: 'product_detail_related',
        experimentId: croAssignment.experimentId,
        variantId: croAssignment.variantId,
        metadata: {
          sourceProductGroupId: productGroup?.id || null,
          position: index + 1,
          action: ranked?.action || nextBestAction.action,
          reasons: ranked?.reasons?.slice(0, 6) || [],
          assignmentMode: croAssignment.mode,
        },
        eventId: `RECOMMENDATION_SHOWN:${today}:${actorKey}:product_detail:${productGroup?.id || 'unknown'}:${croAssignment.variantId || croAssignment.mode}:${recommended.id}`,
      })
    })
  }, [croAssignment.experimentId, croAssignment.mode, croAssignment.variantId, nextBestAction.action, productGroup?.id, rankedRelatedProducts, recommendedProductGroups, user?.id])

  const handleRecommendedView = useCallback((recommended: ProductGroup) => {
    trackRevenueEvent({
      eventType: 'RECOMMENDATION_CLICKED',
      userId: user?.id || null,
      productGroupId: recommended.id,
      categoryId: recommended.category_id,
      surface: 'product_detail_related',
      experimentId: croAssignment.experimentId,
      variantId: croAssignment.variantId,
      metadata: {
        sourceProductGroupId: productGroup?.id || null,
        assignmentMode: croAssignment.mode,
      },
    })

    const accountId = accountMap[recommended.id]
    if (accountId) {
      navigate(`/product/${accountId}`)
      return
    }

    const recommendedCategory = categoryById.get(recommended.category_id)
    navigate('/checkout', {
      state: {
        productGroup: recommended,
        category: recommendedCategory || null,
        quantity: 1,
        isBulkPurchase: false,
        croAssignment,
      },
    })
  }, [accountMap, categoryById, croAssignment, navigate, productGroup?.id, user?.id])

  const handleRecommendedPurchase = useCallback((productGroupId: string, quantity: number) => {
    if (!isLoggedIn) {
      navigate('/login')
      return
    }
    const recommended = allProductGroups.find((entry) => entry.id === productGroupId)
    if (!recommended || !isCustomerSellableProduct(recommended)) return
    const recommendedCategory = categoryById.get(recommended.category_id)

    trackRevenueEvent({
      eventType: 'BUY_CLICKED',
      userId: user?.id || null,
      productGroupId: recommended.id,
      categoryId: recommended.category_id,
      surface: 'product_detail_related',
      experimentId: croAssignment.experimentId,
      variantId: croAssignment.variantId,
      metadata: {
        price: recommended.price,
        quantity,
        sourceProductGroupId: productGroup?.id || null,
        assignmentMode: croAssignment.mode,
      },
    })

    navigate('/checkout', {
      state: {
        productGroup: recommended,
        category: recommendedCategory || null,
        quantity,
        isBulkPurchase: quantity > 1,
        croAssignment,
      },
    })
  }, [allProductGroups, categoryById, croAssignment, isLoggedIn, navigate, productGroup?.id, user?.id])

  useEffect(() => {
    if (!productGroup) return
    trackRevenueEvent({
      eventType: 'PRODUCT_VIEWED',
      userId: user?.id || null,
      productGroupId: productGroup.id,
      categoryId: productGroup.category_id,
      surface: 'product_detail',
      experimentId: croAssignment.experimentId,
      variantId: croAssignment.variantId,
      metadata: {
        product_name: productGroup.name,
        price: productGroup.price,
        account_id: account?.id || productId || null,
        assignmentMode: croAssignment.mode,
      },
    })
  }, [account?.id, croAssignment.experimentId, croAssignment.mode, croAssignment.variantId, productGroup, productId, user?.id])

  const handlePurchase = () => {
    if (!isLoggedIn) {
      navigate('/login')
      return
    }
    if (!account || !productGroup || !category || !isCustomerSellableProduct(productGroup)) {
      setError('Product is no longer available')
      return
    }

    trackRevenueEvent({
      eventType: 'BUY_CLICKED',
      userId: user?.id || null,
      productGroupId: productGroup.id,
      categoryId: productGroup.category_id,
      surface: 'product_detail',
      experimentId: croAssignment.experimentId,
      variantId: croAssignment.variantId,
      metadata: {
        product_name: productGroup.name,
        price: productGroup.price,
        account_id: account.id,
        assignmentMode: croAssignment.mode,
      },
    })
    
    // Navigate to checkout with this account
    navigate('/checkout', { 
      state: { 
        accountId: account?.id,
        productGroup,
        category,
        croAssignment,
      } 
    })
  }

  // Show loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <NavbarAuth />
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
            <p>Loading product details...</p>
          </div>
        </div>
        <Footer />
      </div>
    )
  }

  // Show error state
  if (error || !account || !productGroup) {
    return (
      <div className="min-h-screen bg-background">
        <NavbarAuth />
        <div className="container mx-auto px-6 pt-24 pb-12">
          <div className="text-center">
            <h1 className="text-2xl font-bold mb-4">Product Not Found</h1>
            <p className="text-muted-foreground mb-6">
              {error || "The product you're looking for doesn't exist."}
            </p>
            <BackToProducts />
          </div>
        </div>
        <Footer />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <NavbarAuth />
      
      <div className="container mx-auto px-6 pt-24 pb-12">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
          <Link to="/" className="hover:text-primary">Home</Link>
          <span>/</span>
          <Link to="/products" className="hover:text-primary">Products</Link>
          <span>/</span>
          {category && (
            <>
              <Link to={`/category/${category.id}`} className="hover:text-primary">
                {category.name}
              </Link>
              <span>/</span>
            </>
          )}
          <span className="text-foreground">@{account.username}</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
          {/* Product Image */}
          <div className="space-y-4">
            <Card className="overflow-hidden">
              <CardContent className="p-0">
                <div className="aspect-square bg-gradient-to-br from-primary/10 to-secondary/10 flex items-center justify-center">
                  <div className="text-center p-8">
                    <CategoryLogo name={category?.name || productGroup.name} className="mx-auto mb-5 h-20 w-20" iconClassName="h-16 w-16" />
                    <h3 className="text-xl font-semibold">@{account.username}</h3>
                    <p className="text-muted-foreground">{category?.name} Account</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Product Details */}
          <div className="space-y-6">
            <div>
              <div className="flex items-center gap-2 mb-4">
                {category && <Badge variant="secondary">{category.name}</Badge>}
                <Badge variant="outline" className="text-green-600">Available</Badge>
              </div>
              
              <h1 className="text-3xl font-bold mb-2">@{account.username}</h1>
              <p className="text-lg text-muted-foreground mb-4">{productGroup.name}</p>
              
              {productGroup.description && (
                <p className="text-muted-foreground">{productGroup.description}</p>
              )}
            </div>

            {/* Price */}
            <div className="flex items-center gap-3">
              <span className="text-3xl font-bold text-primary">{formatPrice(productGroup.price)}</span>
            </div>

            {/* Account Features */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Account Details</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span>{productGroup.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Eye className="h-4 w-4 text-muted-foreground" />
                  <span>{account.status}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span>Active Account</span>
                </div>
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-muted-foreground" />
                  <span>Verified</span>
                </div>
              </div>
            </div>

            {/* Features */}
            {productGroup.features && productGroup.features.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">What's Included</h3>
                <div className="grid gap-2">
                  {productGroup.features.map((feature: string, index: number) => (
                    <div key={index} className="flex items-center gap-2 text-sm">
                      <Check className="h-4 w-4 text-green-600" />
                      <span>{feature}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Purchase Button */}
            <div className="space-y-4 pt-6">
              <Button 
                onClick={handlePurchase}
                className="w-full py-3 text-lg"
                size="lg"
              >
                <PackageCheck className="h-5 w-5 mr-2" />
                {isLoggedIn ? `Buy Now - ${formatPrice(productGroup.price)}` : 'Sign In to Buy'}
              </Button>
              
              {!isLoggedIn && (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    You need to sign in to purchase this account.
                  </AlertDescription>
                </Alert>
              )}
            </div>

            {/* Security Info */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Shield className="h-4 w-4 text-green-600" />
                  <span className="font-medium text-sm">Secure Purchase</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  All account credentials are delivered instantly and securely after payment confirmation.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>

        {recommendedProductGroups.length > 0 && (
          <section className="mt-10 space-y-4 rounded-2xl border bg-card/70 p-4 shadow-sm sm:mt-12 sm:p-5">
            <div className="flex min-w-0 items-center gap-3">
              <div className="min-w-0">
                <div className="mb-1 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 shrink-0 text-primary" />
                  <h2 className="truncate text-lg font-black sm:text-xl">Recommended next</h2>
                </div>
                <p className="line-clamp-2 text-xs text-muted-foreground sm:text-sm">
                  More available options that match what you are viewing.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-4">
              {recommendedProductGroups.map((recommended) => {
                const recommendedCategory = categoryById.get(recommended.category_id) || category
                if (!recommendedCategory) return null
                return (
                  <ProductTemplateCard
                    key={recommended.id}
                    productGroup={recommended}
                    category={recommendedCategory}
                    onPurchase={handleRecommendedPurchase}
                    onView={handleRecommendedView}
                  />
                )
              })}
            </div>
          </section>
        )}

        {/* Back Button */}
        <div className="mt-12">
          <BackButton />
        </div>
      </div>

      <Footer />
    </div>
  )
}
