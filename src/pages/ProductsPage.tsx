import { useState, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Search, Grid, List, Loader2, ShoppingCart } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import Navbar from '@/components/NavbarAuth'
import Footer from '@/components/Footer'
import ProductTemplateCard from '@/components/ProductTemplateCard'
import WalletBalanceWidget from '@/components/WalletBalanceWidget'
import {
  getCategories,
  getAllProductGroups,
  testConnection,
  getRecentlyRestockedProductGroupIds,
  getAvailableAccountIdsByProductGroup,
  getTopSellingProductGroupIds,
  type Category,
  type ProductGroup,
} from '@/lib/supabase'
import CategorySidebar from '@/components/CategorySidebar'

export default function ProductsPage() {
  const navigate = useNavigate()
  
  // State for real Supabase data
  const [categories, setCategories] = useState<Category[]>([])
  const [productGroups, setProductGroups] = useState<ProductGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [restockedIds, setRestockedIds] = useState<string[]>([])
  const [accountMap, setAccountMap] = useState<Record<string, string>>({})
  const [topSellingIds, setTopSellingIds] = useState<string[]>([])

  // Existing UI state
  const [searchTerm, setSearchTerm] = useState('')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')

  // Handle adding to cart (navigate to checkout with quantity)
  const handleAddToCart = (productGroupId: string, quantity: number) => {
    const productGroup = productGroups.find(pg => pg.id === productGroupId)
    const category = categories.find(cat => cat.id === productGroup?.category_id)
    
    if (productGroup && category) {
      navigate('/checkout', {
        state: {
          productGroup,
          category,
          quantity,
          isBulkPurchase: quantity > 1
        }
      })
    }
  }

  // Navigate from a Popular/Refilled/New tile straight to checkout for that
  // product group. We previously tried to route these through the per-account
  // Product Detail page (/product/:accountId), but that depends on looking up
  // a specific individual_accounts row via accountMap - which is unreliable
  // (accounts can be sold/reserved/never-stocked for auto-fulfill products),
  // and silently fell back to the category page whenever the lookup missed.
  // Going straight to checkout with the product group mirrors the "Purchase
  // Now" button elsewhere on this page and always opens the actual product,
  // never a category listing.
  const goToProduct = (productGroup: ProductGroup) => {
    const category = categories.find((cat) => cat.id === productGroup.category_id)
    navigate('/checkout', {
      state: {
        productGroup,
        category,
        quantity: 1,
        isBulkPurchase: false,
      },
    })
  }

  // Load real data from Supabase
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true)
        // Test connection first
        const connectionOk = await testConnection()
        if (!connectionOk) {
          throw new Error('Failed to connect to database')
        }

        // Load categories, product groups, and the account map together so
        // the ranked tiles can link straight to a product on first render
        // instead of racing ahead of the account lookup.
        const [categoriesData, productGroupsData, accountMapData, topSellingData] = await Promise.all([
          getCategories(),
          getAllProductGroups(),
          getAvailableAccountIdsByProductGroup(),
          getTopSellingProductGroupIds(8),
        ])

        setCategories(categoriesData)
        setProductGroups(productGroupsData)
        setAccountMap(accountMapData)
        setTopSellingIds(topSellingData)
        setError(null)

        // Load recently restocked product groups for the "Refilled" section
        getRecentlyRestockedProductGroupIds(4).then(setRestockedIds).catch(err => {
          console.error('Error loading restocked product groups:', err)
        })

      } catch (err) {
        console.error('❌ Error loading data:', err)
        setError(err instanceof Error ? err.message : 'Failed to load data')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [])

  // Refresh data when user returns to page (after purchase)
  useEffect(() => {
    const handleFocus = () => {
      // Reload product groups to get updated stock counts
      getAllProductGroups().then(productGroupsData => {
        setProductGroups(productGroupsData)
      }).catch(err => {
        console.error('Error refreshing product groups:', err)
      })
    }

    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [])

  // Refresh data when user returns to page (for stock updates after purchases)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !loading) {
        const refreshData = async () => {
          try {
            const [categoriesData, productGroupsData] = await Promise.all([
              getCategories(),
              getAllProductGroups()
            ])
            setCategories(categoriesData)
            setProductGroups(productGroupsData)
          } catch (err) {
            console.error('Error refreshing data:', err)
          }
        }
        refreshData()
      }
    }

    const handleFocus = () => {
      if (!loading) {
        const refreshData = async () => {
          try {
            const [categoriesData, productGroupsData] = await Promise.all([
              getCategories(),
              getAllProductGroups()
            ])
            setCategories(categoriesData)
            setProductGroups(productGroupsData)
          } catch (err) {
            console.error('Error refreshing data:', err)
          }
        }
        refreshData()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleFocus)
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleFocus)
    }
  }, [loading])

  // Show loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background to-muted/20">
        <Navbar />
        <div className="container mx-auto px-6 py-32">
          <div className="flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin mr-3" />
            <span className="text-lg">Loading products from database...</span>
          </div>
        </div>
        <Footer />
      </div>
    )
  }

  // Show error state
  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background to-muted/20">
        <Navbar />
        <div className="container mx-auto px-6 py-32">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-red-600 mb-4">Database Connection Error</h2>
            <p className="text-gray-600 mb-4">{error}</p>
            <Button onClick={() => window.location.reload()}>Try Again</Button>
          </div>
        </div>
        <Footer />
      </div>
    )
  }

  // Filter product groups for direct product template display
  const filteredProductGroups = productGroups
    .filter(productGroup => {
      const category = categories.find(cat => cat.id === productGroup.category_id)
      const matchesSearch =
        productGroup.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        productGroup.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        category?.name.toLowerCase().includes(searchTerm.toLowerCase())
      const matchesCategory = selectedCategory === 'all' || productGroup.category_id === selectedCategory
      return matchesSearch && matchesCategory && productGroup.is_active
    })
    .sort((a, b) => {
      // Relevance sort so customers always see purchasable products first.
      // Tier 1 → top seller AND in stock
      // Tier 2 → in stock (not a top seller)
      // Tier 3 → auto-fulfill only (stock = 0 but provider configured)
      // Tier 4 → out of stock, no provider
      const autoFulfill = (pg: ProductGroup) => !!(
        (pg.auto_fulfill_enabled && pg.muabanvia_product_id) ||
        pg.shopclone_product_id ||
        pg.shopviaclone_product_id
      )
      const tierOf = (pg: ProductGroup): number => {
        const inStock = pg.stock_count > 0
        const topSeller = topSellingIds.includes(pg.id)
        if (inStock && topSeller) return 0
        if (inStock) return 1
        if (autoFulfill(pg)) return 2
        return 3
      }
      const tierA = tierOf(a)
      const tierB = tierOf(b)
      if (tierA !== tierB) return tierA - tierB
      // Within same tier: top sellers in sales-rank order, others alphabetical
      if (tierA === 0) {
        return topSellingIds.indexOf(a.id) - topSellingIds.indexOf(b.id)
      }
      return a.name.localeCompare(b.name)
    })

  // Popular Products: real "most bought" ranking computed from completed
  // orders (topSellingIds), in rank order. If there isn't enough real sales
  // data yet to fill 8 slots, top up the rest with a stock-count proxy
  // ("selling fast" = low remaining stock) so the section is never sparse.
  const topSellingProductGroups = topSellingIds
    .map((id) => productGroups.find((pg) => pg.id === id))
    .filter((pg): pg is ProductGroup => !!pg && pg.is_active && pg.stock_count > 0)

  const stockProxyFillIns = [...productGroups]
    .filter(
      (pg) =>
        pg.is_active &&
        pg.stock_count > 0 &&
        !topSellingProductGroups.some((p) => p.id === pg.id),
    )
    .sort((a, b) => a.stock_count - b.stock_count)

  const popularProductGroups = [...topSellingProductGroups, ...stockProxyFillIns].slice(0, 8)

  // Popular Categories: ranked by number of active products, capped at 8.
  const popularCategories = [...categories]
    .map((category) => ({
      category,
      productCount: productGroups.filter((pg) => pg.category_id === category.id && pg.is_active).length,
    }))
    .filter((entry) => entry.productCount > 0)
    .sort((a, b) => b.productCount - a.productCount)
    .slice(0, 8)

  // New: most recently created active product groups, capped at 4.
  const newProductGroups = [...productGroups]
    .filter((pg) => pg.is_active)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 4)

  // Refilled: product groups whose stock was most recently topped up, capped at 4.
  const restockedProductGroups = restockedIds
    .map((id) => productGroups.find((pg) => pg.id === id))
    .filter((pg): pg is ProductGroup => !!pg && pg.is_active)
    .slice(0, 4)

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted/20">
      <Navbar />
      
      {/* Wallet Balance Widget */}
      <div className="container mx-auto px-6 pt-24 pb-2">
        <WalletBalanceWidget showRefresh={true} />
      </div>

      {/* Hero Section: Popular Products + Popular Categories (ranked tiles) */}
      <div className="bg-gradient-to-r from-primary to-primary/80 text-white">
        <div className="container mx-auto px-6 py-10">
          <div className="grid md:grid-cols-2 gap-8">
            <div>
              <h2 className="text-2xl font-bold mb-4">Popular Products</h2>
              {popularProductGroups.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  {popularProductGroups.map((productGroup, index) => (
                    <button
                      key={productGroup.id}
                      type="button"
                      title={productGroup.name}
                      onClick={() => goToProduct(productGroup)}
                      className="flex items-center gap-2 rounded-lg bg-white hover:bg-white/90 transition-colors px-2.5 py-2 text-left overflow-hidden"
                    >
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary shrink-0">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[11px] leading-tight text-gray-900">
                        {productGroup.name}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-white/80 text-sm">No products available yet.</p>
              )}
            </div>

            <div>
              <h2 className="text-2xl font-bold mb-4">Popular Categories</h2>
              {popularCategories.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  {popularCategories.map(({ category }, index) => (
                    <button
                      key={category.id}
                      type="button"
                      title={category.name}
                      onClick={() => navigate(`/category/${category.id}`)}
                      className="flex items-center gap-2 rounded-lg bg-white hover:bg-white/90 transition-colors px-2.5 py-2 text-left overflow-hidden"
                    >
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary shrink-0">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[11px] leading-tight text-gray-900">
                        {category.name}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-white/80 text-sm">No categories available yet.</p>
              )}
            </div>
          </div>

          {/* Refilled + New: same ranked-tile style, same purple band */}
          {(restockedProductGroups.length > 0 || newProductGroups.length > 0) && (
            <div className="grid md:grid-cols-2 gap-8 mt-10 pt-8 border-t border-white/15">
              <div>
                <h2 className="text-2xl font-bold mb-4">Refilled</h2>
                {restockedProductGroups.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2">
                    {restockedProductGroups.map((productGroup, index) => (
                      <button
                        key={productGroup.id}
                        type="button"
                        title={productGroup.name}
                        onClick={() => goToProduct(productGroup)}
                        className="flex items-center gap-2 rounded-lg bg-white hover:bg-white/90 transition-colors px-2.5 py-2 text-left overflow-hidden"
                      >
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary shrink-0">
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[11px] leading-tight text-gray-900">
                          {productGroup.name}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-white/80 text-sm">No recent restocks yet.</p>
                )}
              </div>

              <div>
                <h2 className="text-2xl font-bold mb-4">New</h2>
                {newProductGroups.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2">
                    {newProductGroups.map((productGroup, index) => (
                      <button
                        key={productGroup.id}
                        type="button"
                        title={productGroup.name}
                        onClick={() => goToProduct(productGroup)}
                        className="flex items-center gap-2 rounded-lg bg-white hover:bg-white/90 transition-colors px-2.5 py-2 text-left overflow-hidden"
                      >
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary shrink-0">
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[11px] leading-tight text-gray-900">
                          {productGroup.name}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-white/80 text-sm">No new products yet.</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Filters and Controls */}
      <div className="container mx-auto px-6 py-8">
      <div className="md:flex md:gap-8">
        <aside className="hidden md:block md:w-56 shrink-0">
          <CategorySidebar
            categories={categories}
            productGroups={productGroups}
            selectedCategory={selectedCategory}
            onSelectCategory={setSelectedCategory}
          />
        </aside>
        <div className="flex-1">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <div className="flex items-center gap-4">
            <h2 className="text-2xl font-semibold">Available Products</h2>
            <Badge variant="secondary">{filteredProductGroups.length} products</Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                setLoading(true)
                try {
                  const [categoriesData, productGroupsData] = await Promise.all([
                    getCategories(),
                    getAllProductGroups()
                  ])
                  setCategories(categoriesData)
                  setProductGroups(productGroupsData)
                } catch (err) {
                  console.error('Error manually refreshing data:', err)
                } finally {
                  setLoading(false)
                }
              }}
              disabled={loading}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : '🔄 Refresh Stock'}
            </Button>
          </div>
          
          <div className="flex items-center gap-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search categories..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 w-48"
              />
            </div>

            {/* Category Filter */}
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-3 py-2 border rounded-md bg-background"
            >
              <option value="all">All Categories</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            
            <div className="flex items-center gap-2">
              <Button
                variant={viewMode === 'grid' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setViewMode('grid')}
              >
                <Grid className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === 'list' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setViewMode('list')}
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Product Templates Grid */}
        <div className={`grid gap-3 sm:gap-4 mb-12 ${
          viewMode === 'grid'
            ? 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4'
            : 'grid-cols-1 max-w-4xl mx-auto'
        }`}>
          {filteredProductGroups.length === 0 ? (
            <div className="col-span-full text-center py-12">
              <ShoppingCart className="h-16 w-16 mx-auto text-muted-foreground mb-4 opacity-50" />
              <h3 className="text-xl font-semibold mb-2">No Products Available</h3>
              <p className="text-muted-foreground">
                {searchTerm ? 'Try adjusting your search terms' : 'Check back later for new products'}
              </p>
            </div>
          ) : (
            filteredProductGroups.map((productGroup) => {
              const category = categories.find(cat => cat.id === productGroup.category_id)
              return category ? (
                <ProductTemplateCard
                  key={productGroup.id}
                  productGroup={productGroup}
                  category={category}
                  onAddToCart={handleAddToCart}
                />
              ) : null
            })
          )}
        </div>
        </div>
        </div>
      </div>

      <Footer />
    </div>
  )
}
