import { useRef, useState, useEffect } from 'react'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { CheckCircle, CreditCard, Wallet, Loader2, Copy, Download, ChevronDown } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import NavbarAuth from '@/components/NavbarAuth'
import { BackToProducts } from '@/components/ui/back-button'
import { useAuth } from '@/contexts/SimpleAuth'
import {
  processPurchaseSecure,
  getIndividualAccountById,
  getProductGroupById,
  computeDiscountedTotal,
  previewDiscountCode,
  DISCOUNTS_ENABLED,
  type IndividualAccount,
  type PurchasedAccountCredentials,
  type ProductGroup,
} from '@/lib/supabase'
import { useToast } from '@/hooks/use-toast'
import { Input } from '@/components/ui/input'
import { Tag, X } from 'lucide-react'
import { blockStaffPurchase } from '@/lib/staffPurchaseGuard'
import { getRevenueRequestContext, trackRevenueEvent } from '@/lib/revenue-os'
import { isCustomerSellableProduct } from '@/lib/productAvailability'
import { useCurrency } from '@/contexts/CurrencyContext'

const credentialFields: Array<{
  key: keyof PurchasedAccountCredentials
  label: string
  labelClassName: string
}> = [
  { key: 'username', label: 'ID', labelClassName: 'text-white' },
  { key: 'password', label: 'PASSWORD', labelClassName: 'text-rose-400' },
  { key: 'two_fa_code', label: '2FA KEY', labelClassName: 'text-purple-400' },
  { key: 'email', label: 'EMAIL', labelClassName: 'text-emerald-400 underline underline-offset-4' },
  { key: 'email_password', label: 'MAIL PASS', labelClassName: 'text-orange-400' },
  { key: 'recovery_email', label: 'RECOVERY MAIL', labelClassName: 'text-sky-400' },
  { key: 'recovery_email_password', label: 'RECOVERY PASS', labelClassName: 'text-amber-400' },
  { key: 'additional_info', label: 'EXTRA', labelClassName: 'text-cyan-300' },
]

function credentialValue(value: unknown) {
  if (value == null) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value, null, 2)
}

function normalizePurchasedCredentials(
  accountDetails?: { accounts?: PurchasedAccountCredentials[] } | null,
  accounts?: PurchasedAccountCredentials[] | null,
) {
  const rawAccounts = Array.isArray(accounts) && accounts.length
    ? accounts
    : Array.isArray(accountDetails?.accounts)
      ? accountDetails.accounts
      : []

  return rawAccounts.map((item) => ({
    username: credentialValue(item.username),
    password: credentialValue(item.password),
    email: credentialValue(item.email),
    email_password: credentialValue(item.email_password),
    two_fa_code: credentialValue(item.two_fa_code),
    recovery_email: credentialValue(item.recovery_email),
    recovery_email_password: credentialValue(item.recovery_email_password),
    additional_info: credentialValue(item.additional_info),
  })).filter((item) => credentialFields.some((field) => credentialValue(item[field.key])))
}

export default function CheckoutPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, walletBalance, refreshWalletBalance, showBalances, isStaff, isAdmin } = useAuth()
  const { formatPrice } = useCurrency()
  const { toast } = useToast()
  
  // Get data from navigation state - supports both single and bulk purchases
  const { accountId, productGroup: navigationProductGroup, category, quantity = 1, isBulkPurchase = false, croAssignment = null } = location.state || {}
  
  const [account, setAccount] = useState<IndividualAccount | null>(null)
  const [checkoutProductGroup, setCheckoutProductGroup] = useState<ProductGroup | null>(null)
  const [loading, setLoading] = useState(true)
  const [purchasing, setPurchasing] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState('wallet')
  const [paymentDetailsOpen, setPaymentDetailsOpen] = useState(false)
  const [credentialsModalOpen, setCredentialsModalOpen] = useState(false)
  const [purchasedCredentials, setPurchasedCredentials] = useState<PurchasedAccountCredentials[]>([])
  const [completedPurchase, setCompletedPurchase] = useState<{
    orderId?: string
    productName?: string
    quantity?: number
  } | null>(null)
  const paymentAttemptedRef = useRef(false)
  const purchaseCompletedRef = useRef(false)
  const checkoutAttemptRef = useRef(`checkout_${Date.now()}_${crypto.randomUUID()}`)

  // Discount code state - applied on top of any quantity discount tier.
  // The percentOff here is preview-only; the edge function re-validates and
  // re-applies the code server-side before any wallet deduction.
  const [codeInput, setCodeInput] = useState('')
  const [checkingCode, setCheckingCode] = useState(false)
  const [codeError, setCodeError] = useState('')
  const [appliedCode, setAppliedCode] = useState<{ code: string; percentOff: number } | null>(null)
  const productGroup = checkoutProductGroup || navigationProductGroup

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

  const copyCredential = async (value: string, label: string) => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      toast({
        title: 'Copied',
        description: `${label} copied to clipboard.`,
      })
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Copy failed',
        description: 'Your browser blocked clipboard access.',
      })
    }
  }

  const buildCredentialsTxt = () => {
    const lines = [
      'TallyStore Account Credentials',
      completedPurchase?.orderId ? `Order ID: ${completedPurchase.orderId}` : '',
      `Product: ${completedPurchase?.productName || productGroup?.name || 'Purchased account'}`,
      `Quantity: ${completedPurchase?.quantity || purchasedCredentials.length || quantity}`,
      '',
    ].filter(Boolean)

    purchasedCredentials.forEach((credential, index) => {
      lines.push(`Account ${index + 1}`)
      credentialFields.forEach((field) => {
        const value = credentialValue(credential[field.key])
        if (value) lines.push(`${field.label}: ${value}`)
      })
      lines.push('')
    })

    return lines.join('\n')
  }

  const downloadCredentialsTxt = () => {
    if (!purchasedCredentials.length) return
    const blob = new Blob([buildCredentialsTxt()], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const suffix = completedPurchase?.orderId?.slice(0, 8) || Date.now()
    link.href = url
    link.download = `tallystore-credentials-${suffix}.txt`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

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
      if (!navigationProductGroup?.id) {
        navigate('/products')
        return
      }

      const latestProductGroup = await getProductGroupById(navigationProductGroup.id)
      if (!latestProductGroup || !isCustomerSellableProduct(latestProductGroup)) {
        toast({
          variant: "destructive",
          title: "Product unavailable",
          description: "This product is no longer available for purchase.",
        })
        navigate('/products')
        return
      }
      setCheckoutProductGroup(latestProductGroup)
      
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
        } catch (error) {
          console.error('Error loading checkout data:', error)
          toast({
            variant: "destructive",
            title: "Error",
            description: "Failed to load account details"
          })
          navigate('/products')
        } finally {
          setLoading(false)
        }
      } else {
        // For bulk purchases without specific accountId, just refresh wallet and continue
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
  }, [accountId, navigationProductGroup?.id, navigate, refreshWalletBalance, toast])

  useEffect(() => {
    if (!productGroup || !user) return
    trackRevenueEvent({
      eventType: 'PRODUCT_VIEWED',
      userId: user.id,
      productGroupId: productGroup.id,
      categoryId: productGroup.category_id,
      surface: 'checkout',
      experimentId: croAssignment?.experimentId || null,
      variantId: croAssignment?.variantId || null,
      metadata: { quantity, price: productGroup.price, assignmentMode: croAssignment?.mode || 'unknown' },
      eventId: `PRODUCT_VIEWED:${user.id}:checkout:${croAssignment?.variantId || croAssignment?.mode || 'default'}:${productGroup.id}:${quantity}`,
    })
    trackRevenueEvent({
      eventType: 'PAYMENT_PROVIDER_LOADED',
      userId: user.id,
      productGroupId: productGroup.id,
      categoryId: productGroup.category_id,
      surface: 'checkout',
      experimentId: croAssignment?.experimentId || null,
      variantId: croAssignment?.variantId || null,
      metadata: { provider: paymentMethod, quantity, amount: totalAmount, assignmentMode: croAssignment?.mode || 'unknown' },
      eventId: `PAYMENT_PROVIDER_LOADED:${user.id}:checkout:${paymentMethod}:${croAssignment?.variantId || croAssignment?.mode || 'default'}:${productGroup.id}:${quantity}`,
    })
  }, [croAssignment?.experimentId, croAssignment?.mode, croAssignment?.variantId, paymentMethod, productGroup, quantity, totalAmount, user])

  useEffect(() => {
    const checkoutAttemptKey = checkoutAttemptRef.current
    return () => {
      if (!productGroup || !user || purchaseCompletedRef.current || paymentAttemptedRef.current) return
      trackRevenueEvent({
        eventType: 'CHECKOUT_ABANDONED',
        userId: user.id,
        productGroupId: productGroup.id,
        categoryId: productGroup.category_id,
        surface: 'checkout',
        experimentId: croAssignment?.experimentId || null,
        variantId: croAssignment?.variantId || null,
        metadata: { provider: paymentMethod, quantity, amount: totalAmount, assignmentMode: croAssignment?.mode || 'unknown' },
        eventId: `CHECKOUT_ABANDONED:${checkoutAttemptKey}:${productGroup.id}:${quantity}`,
      })
    }
  }, [croAssignment?.experimentId, croAssignment?.mode, croAssignment?.variantId, paymentMethod, productGroup, quantity, totalAmount, user])

  const handlePurchase = async () => {
    if (!productGroup || !user) return
    if (blockStaffPurchase(isStaff, isAdmin, toast)) return

    setPurchasing(true)
    paymentAttemptedRef.current = true
    const idempotencyKey = `purchase_${user.id.substring(0, 8)}_${productGroup.id.substring(0, 8)}_${quantity}_${Date.now()}_${crypto.randomUUID()}`
    
    try {
      // SECURE: Use Edge Function for purchase (server-side processing)
      trackRevenueEvent({
        eventType: 'BUY_CLICKED',
        userId: user.id,
        productGroupId: productGroup.id,
        categoryId: productGroup.category_id,
        surface: 'checkout',
        experimentId: croAssignment?.experimentId || null,
        variantId: croAssignment?.variantId || null,
        eventId: `BUY_CLICKED:checkout:${idempotencyKey}`,
        metadata: {
          quantity,
          amount: totalAmount,
          payment_method: paymentMethod,
          discount_code: appliedCode?.code || null,
          assignmentMode: croAssignment?.mode || 'unknown',
        },
      })
      
      const result = await processPurchaseSecure(productGroup.id, quantity, appliedCode?.code, {
        experimentId: croAssignment?.experimentId || null,
        variantId: croAssignment?.variantId || null,
        assignmentMode: croAssignment?.mode || 'unknown',
        revenueContext: getRevenueRequestContext(),
      }, quantity === 1 ? account?.id || accountId || null : null, totalAmount, idempotencyKey)
      
      if (result.success) {
        purchaseCompletedRef.current = true
        const purchaseType = quantity > 1 ? 'Bulk Purchase' : 'Purchase'
        const accountText = quantity > 1 ? `${quantity} accounts` : '1 account'

        // Refresh wallet balance after successful purchase
        await refreshWalletBalance()

        toast({
          title: `${purchaseType} Successful! 🎉`,
          description: `You've successfully purchased ${accountText} from ${productGroup.name}`,
        })

        const deliveredCredentials = normalizePurchasedCredentials(result.account_details, result.accounts)
        setPurchasedCredentials(deliveredCredentials)
        setCompletedPurchase({
          orderId: result.order_id,
          productName: result.account_details?.product_name || result.product_name || productGroup.name,
          quantity: result.account_details?.quantity || quantity,
        })
        setCredentialsModalOpen(true)

        // If the purchase earned a reward code, surface it prominently
        if (result.reward_code) {
          setTimeout(() => {
            toast({
              title: '🎁 You earned a reward code!',
              description: `You spent ${formatPrice(100000)}+! Use code ${result.reward_code} for 20% off your next purchase under ${formatPrice(12000)}. Valid for one use.`,
              duration: 12000,
            })
          }, 1500)
        }
      } else {
        trackRevenueEvent({
          eventType: 'PAYMENT_FAILED',
          userId: user.id,
          productGroupId: productGroup.id,
          categoryId: productGroup.category_id,
          surface: 'checkout',
          experimentId: croAssignment?.experimentId || null,
          variantId: croAssignment?.variantId || null,
          metadata: { quantity, amount: totalAmount, error: result.error || 'Failed to complete purchase', assignmentMode: croAssignment?.mode || 'unknown' },
          eventId: `PAYMENT_FAILED:checkout:${idempotencyKey}`,
        })
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
      trackRevenueEvent({
        eventType: 'PAYMENT_FAILED',
        userId: user.id,
        productGroupId: productGroup.id,
        categoryId: productGroup.category_id,
        surface: 'checkout',
        experimentId: croAssignment?.experimentId || null,
        variantId: croAssignment?.variantId || null,
        metadata: { quantity, amount: totalAmount, error: error instanceof Error ? error.message : 'Unexpected purchase error', assignmentMode: croAssignment?.mode || 'unknown' },
        eventId: `PAYMENT_FAILED:checkout:${idempotencyKey}`,
      })
      
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
      </div>
    )
  }

  const canAfford = walletBalance >= totalAmount
  const insufficientFunds = !canAfford
  const balanceAfter = walletBalance - totalAmount

  return (
    <div className="min-h-[100dvh] bg-background">
      <NavbarAuth />

      <main className="mx-auto flex min-h-[calc(100dvh-72px)] w-full max-w-xl items-start px-4 pb-20 pt-20 md:items-center md:py-24">
        <Card className="w-full overflow-hidden border-primary/25 bg-card/95 shadow-2xl">
          <CardHeader className="space-y-2 p-4 pb-2 sm:p-5 sm:pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="mb-2 flex items-center gap-2">
                  {category && <Badge variant="secondary" className="max-w-full truncate">{category.name}</Badge>}
                  <Badge variant="outline" className="shrink-0 text-green-600">Available</Badge>
                </div>
                <CardTitle className="truncate text-xl font-black sm:text-2xl">{productGroup.name}</CardTitle>
                <p className="mt-1 truncate text-sm text-muted-foreground">
                  {productGroup.description || (isBulk ? `${quantity} accounts` : account?.username ? `@${account.username}` : 'Instant account delivery')}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-xs text-muted-foreground">Total</p>
                <p className="text-xl font-black text-primary sm:text-2xl">{formatPrice(totalAmount)}</p>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-3 p-4 pt-2 sm:p-5 sm:pt-2">
            <div className="rounded-2xl border bg-muted/30 p-3 sm:p-4">
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Price</p>
                  <p className="truncate font-bold">{formatPrice(productGroup.price)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Quantity</p>
                  <p className="font-bold">{quantity}</p>
                </div>
                <div className="min-w-0 text-right">
                  <p className="text-xs text-muted-foreground">Pay</p>
                  <p className="truncate font-bold text-primary">{formatPrice(totalAmount)}</p>
                </div>
              </div>

              {(discountPct > 0 || appliedCode) && (
                <div className="mt-3 border-t pt-3 text-sm">
                  {discountPct > 0 && (
                    <div className="flex justify-between gap-3 text-green-600">
                      <span className="truncate">Bulk discount ({discountPct}% off)</span>
                      <span className="shrink-0">-{formatPrice(originalTotal - tierTotal)}</span>
                    </div>
                  )}
                  {appliedCode && (
                    <div className="flex justify-between gap-3 text-green-600">
                      <span className="truncate">Code {appliedCode.code}</span>
                      <span className="shrink-0">-{formatPrice(codeDiscountAmount)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <Collapsible open={paymentDetailsOpen} onOpenChange={setPaymentDetailsOpen}>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-2xl border bg-background px-4 py-2.5 text-left"
                >
                  <span className="flex items-center gap-2 font-semibold">
                    <Wallet className="h-4 w-4" />
                    Payment details
                  </span>
                  <span className="flex items-center gap-2 text-sm text-muted-foreground">
                    {showBalances ? formatPrice(walletBalance) : '***'}
                    <ChevronDown className={`h-4 w-4 transition-transform ${paymentDetailsOpen ? 'rotate-180' : ''}`} />
                  </span>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3 pt-3">
                <div className="grid grid-cols-2 gap-3 rounded-2xl border bg-muted/30 p-3 text-sm">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Wallet balance</p>
                    <p className={`truncate font-bold ${canAfford ? 'text-green-600' : 'text-red-600'}`}>
                      {showBalances ? formatPrice(walletBalance) : '***'}
                    </p>
                  </div>
                  <div className="min-w-0 text-right">
                    <p className="text-xs text-muted-foreground">After purchase</p>
                    <p className={`truncate text-xs font-bold ${balanceAfter >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {showBalances ? formatPrice(balanceAfter) : '***'}
                    </p>
                  </div>
                </div>

                {DISCOUNTS_ENABLED && (
                  <div className="space-y-2 rounded-2xl border bg-background p-3">
                    <span className="flex items-center gap-1 text-sm font-medium">
                      <Tag className="h-3.5 w-3.5" />
                      Discount code
                    </span>
                    {discountPct > 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Not available with the {discountPct}% quantity discount.
                      </p>
                    ) : appliedCode ? (
                      <div className="flex items-center justify-between rounded-md border border-green-200 bg-green-50 p-2 px-3">
                        <span className="text-sm font-medium text-green-800">{appliedCode.code} applied</span>
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
                          className="h-10 uppercase"
                          onKeyDown={(e) => e.key === 'Enter' && handleApplyCode()}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleApplyCode}
                          disabled={checkingCode || !codeInput.trim()}
                          className="h-10"
                        >
                          {checkingCode ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Apply'}
                        </Button>
                      </div>
                    )}
                    {codeError && <p className="text-xs text-red-600">{codeError}</p>}
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>

            {insufficientFunds && !completedPurchase && (
              <Alert>
                <AlertDescription>
                  {showBalances
                    ? `You need ${formatPrice(totalAmount - walletBalance)} more to buy this.`
                    : 'Top up your wallet to continue.'}
                </AlertDescription>
              </Alert>
            )}

            {completedPurchase ? (
              <Button className="w-full" size="lg" disabled>
                <CheckCircle className="h-4 w-4 mr-2" />
                Purchase Complete
              </Button>
            ) : insufficientFunds ? (
              <Link to="/wallet" className="block">
                <Button className="w-full" variant="outline" size="lg">
                  <Wallet className="h-4 w-4 mr-2" />
                  Top Up Wallet
                </Button>
              </Link>
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
                    Processing...
                  </>
                ) : (
                  <>
                    <CreditCard className="h-4 w-4 mr-2" />
                    Buy Now
                  </>
                )}
              </Button>
            )}

          </CardContent>
        </Card>
      </main>

      <Dialog open={credentialsModalOpen} onOpenChange={setCredentialsModalOpen}>
        <DialogContent className="max-h-[88vh] w-[calc(100vw-1.5rem)] max-w-3xl overflow-y-auto rounded-3xl border-slate-700/70 bg-[#050818] p-0 text-white shadow-2xl sm:w-full">
          <DialogHeader className="border-b border-white/10 px-5 py-4 text-left sm:px-7">
            <div className="flex items-start justify-between gap-4 pr-8">
              <div className="min-w-0">
                <DialogTitle className="text-2xl font-black text-white">Account Credentials</DialogTitle>
                <DialogDescription className="mt-1 text-sm text-slate-300">
                  Copy each field or download all delivered accounts as TXT.
                </DialogDescription>
              </div>
              <Button
                type="button"
                onClick={downloadCredentialsTxt}
                disabled={!purchasedCredentials.length}
                className="shrink-0 rounded-full bg-purple-500 px-4 text-sm font-bold text-black hover:bg-purple-400 disabled:opacity-50"
              >
                <Download className="mr-2 h-4 w-4" />
                Download TXT
              </Button>
            </div>
          </DialogHeader>

          <div className="space-y-4 px-4 py-5 sm:px-7">
            {purchasedCredentials.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-sm text-slate-300">
                The purchase completed, but no credentials were returned to this screen. Open Order History to view the saved order credentials.
              </div>
            ) : (
              purchasedCredentials.map((credential, index) => {
                const visibleFields = credentialFields
                  .map((field) => ({ ...field, value: credentialValue(credential[field.key]) }))
                  .filter((field) => field.value)

                return (
                  <div key={`${credential.username || 'account'}-${index}`} className="rounded-[28px] border border-slate-700/80 bg-[#070b20] p-4 shadow-xl sm:p-6">
                    <div className="mb-5 flex items-start gap-4">
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-purple-950 text-2xl font-black text-white">
                        {index + 1}
                      </div>
                      <div className="min-w-0 flex-1 rounded-full bg-white/[0.08] px-4 py-3 font-mono text-lg tracking-[0.18em] text-slate-300 sm:text-2xl">
                        <span className="block truncate">username | password | Mail | Mail password | 2fa key |</span>
                      </div>
                    </div>

                    <div className="space-y-4">
                      {visibleFields.map((field) => (
                        <div key={field.key} className="grid grid-cols-[minmax(92px,170px)_1fr_auto] items-center gap-3">
                          <span className={`text-sm font-black uppercase tracking-wide sm:text-lg ${field.labelClassName}`}>
                            {field.label}
                          </span>
                          <div className="min-w-0 rounded-full bg-white/[0.08] px-4 py-3 font-mono text-base text-slate-100 sm:text-xl">
                            <span className="block truncate">{field.value}</span>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => copyCredential(field.value, field.label)}
                            className="h-10 w-10 shrink-0 rounded-xl text-slate-300 hover:bg-white/10 hover:text-white"
                            aria-label={`Copy ${field.label}`}
                          >
                            <Copy className="h-5 w-5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
