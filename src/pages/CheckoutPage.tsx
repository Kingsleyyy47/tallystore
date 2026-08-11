import { useState, useEffect } from 'react'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { CheckCircle, CreditCard, Wallet, ArrowLeft, Shield, Clock, Loader2, Users, Eye, Calendar } from 'lucide-react'
import NavbarAuth from '@/components/NavbarAuth'
import Footer from '@/components/Footer'
import { BackButton, BackToProducts } from '@/components/ui/back-button'
import WalletBalanceWidget from '@/components/WalletBalanceWidget'
import { useAuth } from '@/contexts/SimpleAuth'
import {
  processPurchaseSecure,
  getIndividualAccountById,
  computeDiscountedTotal,
  previewDiscountCode,
  DISCOUNTS_ENABLED,
  type IndividualAccount,
  type ProductGroup,
  type Category
} from '@/lib/supabase'
import { useToast } from '@/hooks/use-toast'
import { Input } from '@/components/ui/input'
import { Tag, X } from 'lucide-react'

export default function CheckoutPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, walletBalance, refreshWalletBalance } = useAuth()
  const { toast } = useToast()
  
  // Get data from navigation state - supports both single and bulk purchases
  const { accountId, productGroup, category, quantity = 1, isBulkPurchase = false } = location.state || {}
  
  const [account, setAccount] = useState<IndividualAccount | null>(null)
  const [loading, setLoading] = useState(true)
  const [purchasing, setPurchasing] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState('wallet')

  // Discount code state - applied on top of any quantity discount tier.
  // The percentOff here is preview-only; the edge function re-validates and
  // re-applies the code server-side before any wallet deduction.
  const [codeInput, setCodeInput] = useState('')
  const [checkingCode, setCheckingCode] = useState(false)
  const [codeError, setCodeError] = useState('')
  const [appliedCode, setAppliedCode] = useState<{ code: string; percentOff: number } | null>(null)

  // Calculate total based on quantity, applying any quantity discount tier
  const { total: tierTotal, discountPct, originalTotal } = productGroup
    ? computeDiscountedTotal(productGroup.price, quantity, productGroup.quantity_discount_tiers)
    : { total: 0, discountPct: 0, originalTotal: 0 }

  // Then apply the discount code (if any) on top of the tier price
  const totalAmount = appliedCode
    ? Math.round(tierTotal * (1 - appliedCode.percentOff / 100))
    : tierTotal
  const codeDiscountAmount = appliedCode ? tierTotal - totalAmount : 0

  const isBulk = quantity > 1 || isBulkPurchase

  const handleApplyCode = async () => {
    if (!codeInput.trim() || !productGroup) return
    if (discountPct > 0) {
      setCodeError('Discount codes can\'t be combined with the bulk quantity discount already applied to this order.')
      return
    }
    setCheckingCode(true)
    setCodeError('')
    try {
      const result = await previewDiscountCode(codeInput.trim(), productGroup.id, category?.id || null, tierTotal)
      if (result.valid && result.percentOff) {
        setAppliedCode({ code: codeInput.trim().toUpperCase(), percentOff: result.percentOff })
        setCodeError('')
      } else {
        setAppliedCode(null)
        setCodeError(result.error || 'Invalid discount code')
      }
    } catch (error) {
      setAppliedCode(null)
      setCodeError('Could not verify code, please try again')
    } finally {
      setCheckingCode(false)
    }
  }

  const handleRemoveCode = () => {
    setAppliedCode(null)
    setCodeInput('')
    setCodeError('')
  }

  useEffect(() => {
    const loadData = async () => {
      // For bulk purchases, we only need productGroup. For individual purchases, we need accountId
      if (!productGroup) {
        console.log('❌ CheckoutPage: No productGroup provided, redirecting to products');
        navigate('/products')
        return
      }
      
      // If we have an accountId, load individual account data
      if (accountId) {
        try {
          setLoading(true)
          
          // Load the specific account details
          const accountData = await getIndividualAccountById(accountId)
          if (!accountData) {
            toast({
              variant: "destructive",
            title: "Error",
            description: "Account not found or no longer available"
          })
          navigate('/products')
          return
        }
        
        setAccount(accountData)
        
        // Refresh wallet balance
        await refreshWalletBalance()
        setLoading(false)
        } catch (error) {
          console.error('Error loading checkout data:', error)
          toast({
            variant: "destructive", 
            title: "Error",
            description: "Failed to load account details"
          })
          navigate('/products')
        }
      } else {
        // For bulk purchases without specific accountId, just refresh wallet and continue
        console.log('✅ CheckoutPage: Bulk purchase mode, no accountId needed');
        try {
          await refreshWalletBalance()
          setLoading(false)
        } catch (error) {
          console.error('Error refreshing wallet:', error)
          setLoading(false)
        }
      }
    }

    loadData()
  }, [accountId, productGroup, navigate, refreshWalletBalance, toast])

  const handlePurchase = async () => {
    if (!productGroup || !user) return

    setPurchasing(true)
    
    try {
      // SECURE: Use Edge Function for purchase (server-side processing)
      console.log('🔄 Processing secure purchase for', quantity, 'accounts from product group:', productGroup.id)
      
      const result = await processPurchaseSecure(productGroup.id, quantity, appliedCode?.code)
      
      if (result.success) {
        const purchaseType = quantity > 1 ? 'Bulk Purchase' : 'Purchase'
        const accountText = quantity > 1 ? `${quantity} accounts` : '1 account'

        // Refresh wallet balance after successful purchase
        await refreshWalletBalance()

        toast({
          title: `${purchaseType} Successful! 🎉`,
          description: `You've successfully purchased ${accountText} from ${productGroup.name}`,
        })

        // If the purchase earned a reward code, surface it prominently
        if (result.reward_code) {
          setTimeout(() => {
            toast({
              title: '🎁 You earned a reward code!',
              description: `You spent ₦100,000+! Use code ${result.reward_code} for 20% off your next purchase under ₦12,000. Valid for one use.`,
              duration: 12000,
            })
          }, 1500)
        }

        // Redirect to orders with success message
        navigate('/orders', {
          state: {
            purchaseSuccess: true,
            bulkPurchase: quantity > 1,
            accountCount: quantity,
            productGroupName: productGroup.name,
            rewardCode: result.reward_code || null,
          }
        })
      } else {
        // Parse error message for better user experience
        let errorTitle = "Purchase Failed";
        let errorDescription = result.error || "Failed to complete purchase";
        
        if (result.error?.includes('OUT_OF_STOCK')) {
          errorTitle = "Out of Stock 📦";
          errorDescription = result.error.replace('OUT_OF_STOCK: ', '');
        } else if (result.error?.includes('INSUFFICIENT_STOCK')) {
          errorTitle = "Limited Stock Available 📦";
          errorDescription = result.error.replace('INSUFFICIENT_STOCK: ', '');
        } else if (result.error?.includes('Insufficient wallet balance')) {
          errorTitle = "Insufficient Balance 💰";
          errorDescription = "Please top up your wallet to complete this purchase.";
        }
        
        toast({
          variant: "destructive",
          title: errorTitle,
          description: errorDescription
        })
      }
      
    } catch (error) {
      console.error('❌ Purchase error:', error)
      
      // Parse error for better messaging
      let errorTitle = "Purchase Failed";
      let errorDescription = "An unexpected error occurred during purchase";
      
      if (error instanceof Error) {
        if (error.message.includes('OUT_OF_STOCK')) {
          errorTitle = "Out of Stock 📦";
          errorDescription = error.message.replace('OUT_OF_STOCK: ', '');
        } else if (error.message.includes('INSUFFICIENT_STOCK')) {
          errorTitle = "Limited Stock Available 📦";
          errorDescription = error.message.replace('INSUFFICIENT_STOCK: ', '');
        } else if (error.message.includes('Insufficient wallet balance')) {
          errorTitle = "Insufficient Balance 💰";
          errorDescription = "Please top up your wallet to complete this purchase.";
        } else {
          errorDescription = error.message;
        }
      }
      
      toast({
        variant: "destructive",
        title: errorTitle,
        description: errorDescription
      })
    } finally {
      setPurchasing(false)
    }
  }

  // Show loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <NavbarAuth />
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
            <p>Loading checkout details...</p>
          </div>
        </div>
        <Footer />
      </div>
    )
  }

  // Show error state if no product group data
  if (!productGroup) {
    return (
      <div className="min-h-screen bg-background">
        <NavbarAuth />
        <div className="container mx-auto px-6 pt-24 pb-12">
          <div className="text-center">
            <h1 className="text-2xl font-bold mb-4">Product Not Found</h1>
            <p className="text-muted-foreground mb-6">
              The product you're trying to purchase doesn't exist.
            </p>
            <BackToProducts />
          </div>
        </div>
        <Footer />
      </div>
    )
  }

  const canAfford = walletBalance >= totalAmount
  const insufficientFunds = !canAfford

  return (
    <div className="min-h-screen bg-background">
      <NavbarAuth />
      
      {/* Wallet Balance Widget */}
      <div className="container mx-auto px-6 pt-24 pb-4">
        <WalletBalanceWidget showRefresh={true} />
      </div>
      
      <div className="container mx-auto px-6 pb-12">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Complete Your Purchase</h1>
          <p className="text-muted-foreground">Review your order and payment details</p>
        </div>

        <div className="max-w-4xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Product Details */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span>Account Details</span>
                {category && <Badge variant="secondary">{category.name}</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-center p-6 bg-gradient-to-br from-primary/10 to-secondary/10 rounded-lg">
                <div className="text-4xl mb-2">
                  {category?.name === 'Instagram' && '📷'}
                  {category?.name === 'TikTok' && '🎵'}
                  {category?.name === 'Twitter' && '🐦'}
                  {category?.name === 'Facebook' && '👥'}
                  {!['Instagram', 'TikTok', 'Twitter', 'Facebook'].includes(category?.name || '') && '📱'}
                </div>
                {isBulk ? (
                  <>
                    <h3 className="text-xl font-semibold">{productGroup.name}</h3>
                    <p className="text-muted-foreground">Purchasing {quantity} accounts</p>
                  </>
                ) : (
                  <>
                    <h3 className="text-xl font-semibold">@{account?.username}</h3>
                    <p className="text-muted-foreground">{productGroup.name}</p>
                  </>
                )}
              </div>

              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Category:</span>
                  <span>{category?.name || 'Social Media'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Product Type:</span>
                  <span>{productGroup.name}</span>
                </div>
                {isBulk ? (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Quantity:</span>
                    <span>{quantity} accounts</span>
                  </div>
                ) : (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Status:</span>
                    <Badge variant="outline" className="text-green-600">Available</Badge>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Verification:</span>
                  <span className="flex items-center gap-1">
                    <Shield className="h-4 w-4 text-green-600" />
                    Verified
                  </span>
                </div>
              </div>

              {productGroup.features && productGroup.features.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-medium">What's Included:</h4>
                  <div className="space-y-1">
                    {productGroup.features.map((feature: string, index: number) => (
                      <div key={index} className="flex items-center gap-2 text-sm">
                        <CheckCircle className="h-4 w-4 text-green-600" />
                        <span>{feature}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Payment Details */}
          <Card>
            <CardHeader>
              <CardTitle>Payment Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Order Summary */}
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span>Price per Account:</span>
                  <span>₦{productGroup.price.toLocaleString()}</span>
                </div>
                {quantity > 1 && (
                  <div className="flex justify-between">
                    <span>Quantity:</span>
                    <span>{quantity} accounts</span>
                  </div>
                )}
                {discountPct > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Bulk discount ({discountPct}% off):</span>
                    <span>-₦{(originalTotal - tierTotal).toLocaleString()}</span>
                  </div>
                )}
                {appliedCode && (
                  <div className="flex justify-between text-green-600">
                    <span>Code "{appliedCode.code}" ({appliedCode.percentOff}% off):</span>
                    <span>-₦{codeDiscountAmount.toLocaleString()}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Processing Fee:</span>
                  <span>₦0</span>
                </div>
                <Separator />
                <div className="flex justify-between text-lg font-semibold">
                  <span>Total:</span>
                  <span className="text-primary">₦{totalAmount.toLocaleString()}</span>
                </div>
              </div>

              {/* Discount Code - paused store-wide alongside bulk quantity discounts (DISCOUNTS_ENABLED in src/lib/supabase.ts) while a better bundle/promo solution is worked out */}
              {DISCOUNTS_ENABLED && (
              <div className="space-y-2">
                <span className="text-sm font-medium flex items-center gap-1">
                  <Tag className="h-3.5 w-3.5" />
                  Discount Code
                </span>
                {discountPct > 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Not available — this order already has a {discountPct}% bulk quantity discount applied.
                  </p>
                ) : appliedCode ? (
                  <div className="flex items-center justify-between p-2 px-3 bg-green-50 border border-green-200 rounded-md">
                    <span className="text-sm text-green-800 font-medium">{appliedCode.code} applied</span>
                    <button
                      type="button"
                      onClick={handleRemoveCode}
                      className="text-green-700 hover:text-green-900"
                      aria-label="Remove discount code"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Input
                      value={codeInput}
                      onChange={(e) => setCodeInput(e.target.value)}
                      placeholder="Enter code"
                      className="uppercase"
                      onKeyDown={(e) => e.key === 'Enter' && handleApplyCode()}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleApplyCode}
                      disabled={checkingCode || !codeInput.trim()}
                    >
                      {checkingCode ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Apply'}
                    </Button>
                  </div>
                )}
                {codeError && <p className="text-sm text-red-600">{codeError}</p>}
              </div>
              )}

              {/* Wallet Balance */}
              <div className="p-4 bg-muted rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="flex items-center gap-2">
                    <Wallet className="h-4 w-4" />
                    Your Wallet Balance
                  </span>
                  <span className={`font-medium ${canAfford ? 'text-green-600' : 'text-red-600'}`}>
                    ₦{walletBalance.toLocaleString()}
                  </span>
                </div>
                {insufficientFunds && (
                  <p className="text-sm text-red-600">
                    Insufficient funds. You need ₦{(totalAmount - walletBalance).toLocaleString()} more.
                  </p>
                )}
              </div>

              {/* Purchase Button */}
              <div className="space-y-4">
                {insufficientFunds ? (
                  <div className="space-y-3">
                    <Alert>
                      <AlertDescription>
                        You don't have enough balance to complete this purchase. Please top up your wallet first.
                      </AlertDescription>
                    </Alert>
                    <Link to="/wallet">
                      <Button className="w-full" variant="outline">
                        <Wallet className="h-4 w-4 mr-2" />
                        Top Up Wallet
                      </Button>
                    </Link>
                  </div>
                ) : (
                  <Button 
                    onClick={handlePurchase}
                    disabled={purchasing}
                    className="w-full"
                    size="lg"
                  >
                    {purchasing ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Processing Purchase...
                      </>
                    ) : (
                      <>
                        <CreditCard className="h-4 w-4 mr-2" />
                        Complete Purchase
                      </>
                    )}
                  </Button>
                )}
              </div>

              {/* Security Info */}
              <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Shield className="h-4 w-4 text-green-600" />
                  <span className="font-medium text-sm text-green-800">Secure Purchase</span>
                </div>
                <p className="text-xs text-green-700">
                  Account credentials will be delivered instantly after payment confirmation.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Back Button */}
        <div className="mt-8 text-center">
          <BackButton />
        </div>
      </div>

      <Footer />
    </div>
  )
}
