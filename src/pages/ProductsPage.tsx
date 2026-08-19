import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Grid,
  Home,
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
import ProductTemplateCard from '@/components/ProductTemplateCard'
import CategorySidebar from '@/components/CategorySidebar'
import { getCategoryStyle } from '@/lib/categoryStyles'
import {
  getAllProductGroups,
  getAvailableAccountIdsByProductGroup,
  getCategories,
  getGlobalActivityFeed,
  getRecentlyRestockedProductGroupIds,
  getTopSellingProductGroupIds,
  testConnection,
  type Category,
  type GlobalActivityItem,
  type ProductGroup,
} from '@/lib/supabase'

type ProductCollection = 'popular' | 'refilled' | 'new'
type SortMode = 'newest' | 'price-low' | 'price-high' | 'stock'

const PAGE_SIZE = 12

function canAutoFulfill(productGroup: ProductGroup) {
  return !!(
    (productGroup.auto_fulfill_enabled && productGroup.muabanvia_product_id) ||
    productGroup.shopclone_product_id ||
    productGroup.shopviaclone_product_id
  )
}

function isPurchasable(productGroup: ProductGroup) {
  return productGroup.stock_count > 0 || canAutoFulfill(productGroup)
}

function maskActivity(item: GlobalActivityItem) {
  if (item.kind === 'deposit') return `${item.maskedName} deposited funds`
  return `${item.maskedName} purchased ${item.label}`
}

export default function ProductsPage() {
  const navigate = useNavigate()
  const [categories, setCategories] = useState<Category[]>([])
  const [productGroups, setProductGroups] = useState<ProductGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [restockedIds, setRestockedIds] = useState<string[]>([])
  const [, setAccountMap] = useState<Record<string, string>>({})
  const [topSellingIds, setTopSellingIds] = useState<string[]>([])
  const [activity, setActivity] = useState<GlobalActivityItem[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [activeCollection, setActiveCollection] = useState<ProductCollection>('popular')
  const [sortMode, setSortMode] = useState<SortMode>('newest')
  const [currentPage, setCurrentPage] = useState(1)

  const loadData = useCallback(async (showPageLoader = false) => {
    try {
      if (showPageLoader) setLoading(true)
      setRefreshing(true)

      const connectionOk = await testConnection()
      if (!connectionOk) throw new Error('Failed to connect to database')

      const [categoriesData, productGroupsData, accountMapData, topSellingData, activityData] = await Promise.all([
        getCategories(),
        getAllProductGroups(),
        getAvailableAccountIdsByProductGroup(),
        getTopSellingProductGroupIds(12),
        getGlobalActivityFeed(6),
      ])

      setCategories(categoriesData)
      setProductGroups(productGroupsData)
      setAccountMap(accountMapData)
      setTopSellingIds(topSellingData)
      setActivity(activityData)
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

  const activeProductGroups = useMemo(
    () => productGroups.filter((productGroup) => productGroup.is_active),
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

  const sortedProductGroups = useMemo(() => {
    const searched = activeProductGroups.filter((productGroup) => {
      const category = categoryForProduct(productGroup)
      const query = searchTerm.trim().toLowerCase()
      const matchesSearch =
        query.length === 0 ||
        productGroup.name.toLowerCase().includes(query) ||
        productGroup.description?.toLowerCase().includes(query) ||
        category?.name.toLowerCase().includes(query)
      const matchesCategory = selectedCategory === 'all' || productGroup.category_id === selectedCategory
      return matchesSearch && matchesCategory
    })

    return searched.sort((a, b) => {
      const aPurchasable = isPurchasable(a)
      const bPurchasable = isPurchasable(b)
      if (aPurchasable !== bPurchasable) return aPurchasable ? -1 : 1

      if (sortMode === 'price-low') return a.price - b.price
      if (sortMode === 'price-high') return b.price - a.price
      if (sortMode === 'stock') return b.stock_count - a.stock_count

      const aTopRank = topSellingIds.indexOf(a.id)
      const bTopRank = topSellingIds.indexOf(b.id)
      if (aTopRank !== -1 || bTopRank !== -1) {
        if (aTopRank === -1) return 1
        if (bTopRank === -1) return -1
        return aTopRank - bTopRank
      }

      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
  }, [activeProductGroups, categoryForProduct, searchTerm, selectedCategory, sortMode, topSellingIds])

  const topSellingProductGroups = useMemo(() => {
    const ranked = topSellingIds
      .map((id) => activeProductGroups.find((productGroup) => productGroup.id === id))
      .filter((productGroup): productGroup is ProductGroup => !!productGroup && isPurchasable(productGroup))

    const fillIns = [...activeProductGroups]
      .filter((productGroup) => isPurchasable(productGroup) && !ranked.some((rankedProduct) => rankedProduct.id === productGroup.id))
      .sort((a, b) => a.stock_count - b.stock_count)

    return [...ranked, ...fillIns].slice(0, 9)
  }, [activeProductGroups, topSellingIds])

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

  const goToProduct = (productGroup: ProductGroup) => {
    const category = categoryForProduct(productGroup)
    navigate('/checkout', {
      state: {
        productGroup,
        category,
        quantity: 1,
        isBulkPurchase: false,
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
        },
      })
    }
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
    <div className="min-h-screen bg-[radial-gradient(circle_at_20%_0%,rgba(168,85,247,0.10),transparent_30rem),linear-gradient(180deg,#ffffff_0%,#f7f9fc_55%,#eef3f8_100%)] text-slate-950 dark:bg-[radial-gradient(circle_at_20%_0%,rgba(126,51,231,0.16),transparent_30rem),linear-gradient(180deg,#05070d_0%,#07111d_100%)] dark:text-white">
      <Navbar />

      <main className="mx-auto w-full max-w-7xl px-4 pb-12 pt-5 sm:px-6 lg:px-8">
        <div className="mb-5 flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
          <Link to="/" className="inline-flex items-center gap-1 transition hover:text-purple-600 dark:hover:text-purple-300">
            <Home className="h-3.5 w-3.5" />
            Home
          </Link>
          <span>/</span>
          <span className="text-slate-800 dark:text-slate-200">Products</span>
        </div>

        <section className="mb-6 overflow-hidden rounded-xl border border-slate-200 bg-white/85 shadow-sm dark:border-white/10 dark:bg-white/[0.035]">
          {(() => {
            const liveItems = (activity.length > 0 ? activity : [
              { kind: 'order', maskedName: 'Marco', label: 'TikTok aged account' } as GlobalActivityItem,
              { kind: 'order', maskedName: 'Emma', label: 'Instagram account' } as GlobalActivityItem,
              { kind: 'order', maskedName: 'Daniel', label: 'Facebook account' } as GlobalActivityItem,
              { kind: 'order', maskedName: 'James', label: 'Netflix VPN' } as GlobalActivityItem,
            ]).slice(0, 5)

            return (
              <>
                <div className="px-4 py-3 sm:hidden">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-black text-slate-950 dark:text-white">
                      <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_18px_rgba(52,211,153,0.9)]" />
                      Live Activity
                    </div>
                    <Link to="/orders" className="text-[11px] font-black text-purple-700 dark:text-purple-300">
                      View all
                    </Link>
                  </div>
                  <div className="grid gap-2">
                    {liveItems.slice(0, 2).map((item, index) => (
                      <div key={`${item.maskedName}-${index}`} className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-slate-100/70 px-3 py-2 text-[11px] font-semibold dark:bg-white/[0.035]">
                        <span className="min-w-0 truncate">{maskActivity(item)}</span>
                        <span className="shrink-0 text-[10px] text-slate-500 dark:text-slate-400">{index === 0 ? '2m ago' : '4m ago'}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="hidden min-w-0 items-center gap-5 overflow-x-auto px-4 py-3 text-xs font-semibold text-slate-600 dark:text-slate-300 sm:flex">
                  <div className="flex shrink-0 items-center gap-2 font-black text-slate-950 dark:text-white">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_18px_rgba(52,211,153,0.9)]" />
                    Live Activity
                  </div>
                  {liveItems.map((item, index) => (
                    <div key={`${item.maskedName}-${index}`} className="flex shrink-0 items-center gap-5">
                      <span className="h-1 w-1 rounded-full bg-purple-500" />
                      <span>{maskActivity(item)}</span>
                    </div>
                  ))}
                  <Link to="/orders" className="ml-auto shrink-0 rounded-lg border border-purple-200 px-3 py-1.5 text-purple-700 hover:bg-purple-50 dark:border-purple-300/20 dark:text-purple-300 dark:hover:bg-white/[0.06]">
                    View all
                  </Link>
                </div>
              </>
            )
          })()}
        </section>

        <section className="mb-7">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="text-xl font-black tracking-normal">Browse Categories</h1>
            <Link to="/products" className="hidden items-center gap-2 text-xs font-black text-purple-700 dark:text-purple-300 sm:inline-flex">
              View all categories
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1 sm:grid sm:grid-cols-4 sm:gap-3 sm:overflow-visible sm:pb-0 lg:grid-cols-8">
            <button
              type="button"
              onClick={() => setSelectedCategory('all')}
              className={`flex min-h-16 min-w-[72px] flex-col items-center justify-center gap-1 rounded-lg border px-2 py-2 text-center transition sm:min-w-0 sm:flex-row sm:justify-start sm:gap-3 sm:p-3 sm:text-left ${
                selectedCategory === 'all'
                  ? 'border-purple-400 bg-purple-600 text-white shadow-lg shadow-purple-600/20'
                  : 'border-slate-200 bg-white/85 hover:bg-white dark:border-white/10 dark:bg-white/[0.035] dark:hover:bg-white/[0.06]'
              }`}
            >
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-purple-500/20 sm:h-9 sm:w-9">
                <LayoutGrid className="h-4 w-4 sm:h-5 sm:w-5" />
              </span>
              <span className="min-w-0">
                <strong className="block max-w-full truncate text-xs sm:text-sm">All</strong>
                <small className={selectedCategory === 'all' ? 'text-white/75' : 'text-slate-500 dark:text-slate-400'}>{activeProductGroups.length}</small>
              </span>
            </button>

            {categoryChips.map(({ category, count }) => {
              const style = getCategoryStyle(category.name)
              const Icon = style.icon
              const active = selectedCategory === category.id
              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => setSelectedCategory(category.id)}
                  className={`flex min-h-16 min-w-[72px] flex-col items-center justify-center gap-1 rounded-lg border px-2 py-2 text-center transition sm:min-w-0 sm:flex-row sm:justify-start sm:gap-3 sm:p-3 sm:text-left ${
                    active
                      ? 'border-purple-400 bg-purple-600 text-white shadow-lg shadow-purple-600/20'
                      : 'border-slate-200 bg-white/85 hover:bg-white dark:border-white/10 dark:bg-white/[0.035] dark:hover:bg-white/[0.06]'
                  }`}
                >
                  <span className={`grid h-8 w-8 place-items-center rounded-lg sm:h-9 sm:w-9 ${active ? 'bg-white/15 text-white' : style.bg}`}>
                    <Icon className={`h-4 w-4 sm:h-5 sm:w-5 ${active ? 'text-white' : style.color}`} />
                  </span>
                  <span className="min-w-0">
                    <strong className="block max-w-full truncate text-xs sm:text-sm">{category.name}</strong>
                    <small className={active ? 'text-white/75' : 'text-slate-500 dark:text-slate-400'}>{count}</small>
                  </span>
                </button>
              )
            })}

            <Link
              to="/products"
              className="flex min-h-16 min-w-[72px] flex-col items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white/85 px-2 py-2 text-center transition hover:bg-white dark:border-white/10 dark:bg-white/[0.035] dark:hover:bg-white/[0.06] sm:min-w-0 sm:flex-row sm:justify-start sm:gap-3 sm:p-3 sm:text-left"
            >
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 dark:bg-white/10 sm:h-9 sm:w-9">
                <MoreHorizontal className="h-4 w-4 sm:h-5 sm:w-5" />
              </span>
              <span className="min-w-0">
                <strong className="block max-w-full truncate text-xs sm:text-sm">More</strong>
                <small className="text-slate-500 dark:text-slate-400">{Math.max(0, categories.length - categoryChips.length)}</small>
              </span>
            </Link>
          </div>
        </section>

        <section className="mb-8">
          <div className="mb-3 flex items-center gap-2">
            {([
              ['popular', 'Popular'],
              ['refilled', 'Refilled'],
              ['new', 'New'],
            ] as Array<[ProductCollection, string]>).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setActiveCollection(value)}
                className={`relative px-4 py-2 text-sm font-black transition ${
                  activeCollection === value ? 'text-purple-700 dark:text-purple-300' : 'text-slate-500 hover:text-slate-950 dark:hover:text-white'
                }`}
              >
                {label}
                {activeCollection === value && <span className="absolute inset-x-3 -bottom-0.5 h-0.5 rounded-full bg-purple-600" />}
              </button>
            ))}
            <Link to="/products" className="ml-auto hidden items-center gap-2 text-xs font-black text-purple-700 dark:text-purple-300 sm:inline-flex">
              View all
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            {collectionGroups[activeCollection].slice(0, 9).map((productGroup) => (
              <button
                key={productGroup.id}
                type="button"
                onClick={() => goToProduct(productGroup)}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white/85 px-4 py-3 text-left text-sm font-black shadow-sm transition hover:border-purple-300 hover:bg-white dark:border-white/10 dark:bg-white/[0.035] dark:hover:border-purple-300/30 dark:hover:bg-white/[0.06]"
                title={productGroup.name}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <Package className="h-4 w-4 shrink-0 text-purple-600 dark:text-purple-300" />
                  <span className="truncate">{productGroup.name}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
              </button>
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

            <div className="grid gap-3 sm:grid-cols-[auto_minmax(210px,1fr)_160px_auto] lg:min-w-[620px]">
              <Button
                variant="outline"
                size="sm"
                onClick={() => loadData(false)}
                disabled={refreshing}
                className="h-10 rounded-lg"
              >
                {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Refresh Stock
              </Button>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Search products..."
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  className="h-10 rounded-lg border-slate-200 bg-white/85 pl-10 dark:border-white/10 dark:bg-white/[0.035]"
                />
              </div>

              <select
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value as SortMode)}
                className="h-10 rounded-lg border border-slate-200 bg-white/85 px-3 text-sm font-semibold outline-none dark:border-white/10 dark:bg-[#080d15]"
              >
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

          <div className="grid gap-5 lg:grid-cols-[210px_minmax(0,1fr)]">
            <aside className="hidden rounded-xl border border-slate-200 bg-white/85 p-3 shadow-sm dark:border-white/10 dark:bg-white/[0.035] lg:block">
              <CategorySidebar
                categories={categories}
                productGroups={activeProductGroups}
                selectedCategory={selectedCategory}
                onSelectCategory={setSelectedCategory}
              />
            </aside>

            <div>
              {pageProductGroups.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white/85 px-5 py-16 text-center shadow-sm dark:border-white/10 dark:bg-white/[0.035]">
                  <Package className="mx-auto h-12 w-12 text-slate-400" />
                  <h3 className="mt-4 text-xl font-black">No products found</h3>
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Try a different category or search term.</p>
                </div>
              ) : (
                <div className={`grid ${
                  viewMode === 'grid'
                    ? 'grid-cols-2 gap-2.5 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4'
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

      <Footer />
    </div>
  )
}
