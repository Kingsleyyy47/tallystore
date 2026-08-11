import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ArrowLeft, ShoppingCart, Shield, Clock, Star, Check, AlertTriangle, Loader2, Users, Eye, Calendar } from 'lucide-react'
import NavbarAuth from '@/components/NavbarAuth'
import Footer from '@/components/Footer'
import { BackButton, BackToProducts } from '@/components/ui/back-button'
import { useCurrency } from '@/contexts/CurrencyContext'
import { useAuth } from '@/contexts/SimpleAuth'
import { 
  getIndividualAccountById,
  getProductGroupById,
  getCategoryById,
  type IndividualAccount,
  type ProductGroup,
  type Category
} from '@/lib/supabase'

export default function ProductDetailPage() {
  const { productId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { formatPrice } = useCurrency()
  
  // State for real data
  const [account, setAccount] = useState<IndividualAccount | null>(null)
  const [productGroup, setProductGroup] = useState<ProductGroup | null>(null)
  const [category, setCategory] = useState<Category | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Check if user is logged in
  const isLoggedIn = !!user

  useEffect(() => {
    const loadProductData = async () => {
      if (!productId) return
      
      try {
        setLoading(true)
        setError(null)
        console.log('🔄 Loading product data for account ID:', productId)
        
        // Load individual account
        const accountData = await getIndividualAccountById(productId)
        if (!accountData) {
          setError('Product not found')
          setLoading(false)
          return
        }
        
        setAccount(accountData)
        
        // Load product group
        const productGroupData = await getProductGroupById(accountData.product_group_id)
        if (productGroupData) {
          setProductGroup(productGroupData)
          
          // Load category
          const categoryData = await getCategoryById(productGroupData.category_id)
          setCategory(categoryData)
        }
        
        console.log('✅ Product data loaded:', { accountData, productGroupData })
        setLoading(false)
        
      } catch (error) {
        console.error('Error loading product data:', error)
        setError('Failed to load product data')
        setLoading(false)
      }
    }

    loadProductData()
  }, [productId])

  const handlePurchase = () => {
    if (!isLoggedIn) {
      navigate('/login')
      return
    }
    
    // Navigate to checkout with this account
    navigate('/checkout', { 
      state: { 
        accountId: account?.id,
        productGroup,
        category 
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
              <Link to={`/category/${category.name.toLowerCase()}`} className="hover:text-primary">
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
                    <div className="text-6xl mb-4">
                      {category?.name === 'Instagram' && '📷'}
                      {category?.name === 'TikTok' && '🎵'}
                      {category?.name === 'Twitter' && '🐦'}
                      {category?.name === 'Facebook' && '👥'}
                      {!['Instagram', 'TikTok', 'Twitter', 'Facebook'].includes(category?.name || '') && '📱'}
                    </div>
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
                <ShoppingCart className="h-5 w-5 mr-2" />
                {isLoggedIn ? `Purchase for ₦${productGroup.price.toLocaleString()}` : 'Sign In to Purchase'}
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

        {/* Back Button */}
        <div className="mt-12">
          <BackButton />
        </div>
      </div>

      <Footer />
    </div>
  )
}
