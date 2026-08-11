import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Search, ArrowLeft, Loader2, ShoppingCart } from 'lucide-react'
import Navbar from '@/components/NavbarAuth'
import Footer from '@/components/Footer'
import ProductTemplateCard from '@/components/ProductTemplateCard'
import CategorySidebar from '@/components/CategorySidebar'
import { useAuth } from '@/contexts/SimpleAuth'
import {
  getCategories,
  getAllProductGroups,
  getTopSellingProductGroupIds,
  getUserPurchaseHistory,
  type Category,
  type ProductGroup
} from '@/lib/supabase'

export default function CategoryPage() {
  const { categoryId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  // State for real Supabase data
  const [category, setCategory] = useState<Category | null>(null)
  const [productGroups, setProductGroups] = useState<ProductGroup[]>([])
  const [allCategories, setAllCategories] = useState<Category[]>([])
  const [allProductGroups, setAllProductGroups] = useState<ProductGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // UI state
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState('recommended')

  // Personalization data for "Recommended" sort: global popularity rank (best
  // overall sellers) plus this user's own purchase history (rebuy signal).
  // Neither one blocks page load if it fails - sort just falls back to
  // whatever default ordering came back from the DB.
  const [globalRank, setGlobalRank] = useState<Record<string, number>>({})
  const [myPurchaseCounts, setMyPurchaseCounts] = useState<Record<string, number>>({})

  useEffect(() => {
    getTopSellingProductGroupIds(200)
      .then((ids) => {
        const rank: Record<string, number> = {}
        ids.forEach((id, index) => { rank[id] = index })
        setGlobalRank(rank)
      })
      .catch(() => {})

    if (user?.id) {
      getUserPurchaseHistory(user.id)
        .then(({ productGroupCounts }) => setMyPurchaseCounts(productGroupCounts))
        .catch(() => {})
    }
  }, [user?.id])

  // Handle adding products to cart
  const handleAddToCart = (productGroupId: string, quantity: number) => {
    const productGroup = productGroups.find(pg => pg.id === productGroupId)
    
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
          pg.category_id === categoryId && pg.is_active
        )

        setCategory(currentCategory)
        setProductGroups(categoryProductGroups)
        setAllCategories(categoriesData)
        setAllProductGroups(productGroupsData)
        setLoading(false)
        
        console.log('✅ Category data loaded:', {
          category: currentCategory.name,
          productGroups: categoryProductGroups.length
        })
      } catch (error) {
        console.error('❌ Error loading category data:', error)
        setError('Failed to load category data')
        setLoading(false)
      }
    }

    loadData()
  }, [categoryId])

  // Filter and sort product groups
  const filteredProductGroups = productGroups.filter(pg =>
    pg.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    pg.description?.toLowerCase().includes(searchTerm.toLowerCase())
  ).sort((a, b) => {
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
        const rankA = globalRank[a.id] ?? Infinity
        const rankB = globalRank[b.id] ?? Infinity
        if (rankA !== rankB) return rankA - rankB
        return a.name.localeCompare(b.name)
      }
      case 'recommended':
      default: {
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
      <div className="md:flex md:gap-8">
        <aside className="hidden md:block md:w-56 shrink-0">
          <CategorySidebar
            categories={allCategories}
            productGroups={allProductGroups}
            selectedCategory={categoryId}
          />
        </aside>
        <div className="flex-1">
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
              <ShoppingCart className="h-16 w-16 mx-auto text-muted-foreground mb-4 opacity-50" />
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
                onAddToCart={handleAddToCart}
              />
            ))
          )}
        </div>
        </div>
        </div>
      </div>

      <Footer />
    </div>
  )
}
