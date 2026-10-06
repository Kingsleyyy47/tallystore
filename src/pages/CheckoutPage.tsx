import { useRef, useState, useEffect } from 'react'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { CheckCircle, CreditCard, Wallet, Loader2, Copy, Download, ChevronDown, Minus, Plus, Clock, Info } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import NavbarAuth from '@/components/NavbarAuth'
import CategoryLogo from '@/components/CategoryLogo'
import { BackToProducts } from '@/components/ui/back-button'
import { useAuth } from '@/contexts/SimpleAuth'
import {
  processPurchaseSecure,
  getCustomerPurchaseAttemptStatus,
  getIndividualAccountById,
  getProductGroupById,
  getCategoryById,
  computeDiscountedTotal,
  previewDiscountCode,
  DISCOUNTS_ENABLED,
  supabase,
  type PublicAccount,
  type PurchasedAccountCredentials,
  type ProductGroup,
} from '@/lib/supabase'
import { useToast } from '@/hooks/use-toast'
import { Input } from '@/components/ui/input'
import { Tag, X } from 'lucide-react'
import { blockStaffPurchase } from '@/lib/staffPurchaseGuard'
import { getRevenueRequestContext, trackRevenueEvent } from '@/lib/revenue-os'
import { canAutoFulfillProduct, isCustomerSellableProduct } from '@/lib/productAvailability'
import { useCurrency } from '@/contexts/CurrencyContext'
import { normalizeOrderCredential } from '@/lib/orderCredentials'

const credentialFields: Array<{
  key: keyof PurchasedAccountCredentials
  label: string
  labelClassName: string
}> = [
  { key: 'username', label: 'USERNAME / ID', labelClassName: 'text-white' },
  { key: 'password', label: 'PASSWORD', labelClassName: 'text-rose-400' },
  { key: 'original_line', label: 'ORIGINAL STOCK LINE', labelClassName: 'text-slate-300' },
  { key: 'two_fa_code', label: '2FA KEY', labelClassName: 'text-purple-400' },
  { key: 'email', label: 'EMAIL', labelClassName: 'text-emerald-400 underline underline-offset-4' },
  { key: 'email_password', label: 'MAIL PASS', labelClassName: 'text-orange-400' },
  { key: 'recovery_email', label: 'RECOVERY MAIL', labelClassName: 'text-sky-400' },
  { key: 'recovery_email_password', label: 'RECOVERY PASS', labelClassName: 'text-amber-400' },
  { key: 'additional_info', label: 'EXTRA', labelClassName: 'text-cyan-300' },
]
const CREDENTIAL_FIELDS_PER_PAGE = 3

function credentialValue(value: unknown) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value, null, 2)
}

function checkoutCredentialLabel(field: typeof credentialFields[number], credential: PurchasedAccountCredentials, productName = '') {
  return field.key === 'username' && productName.toLowerCase().includes('discord') && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(credentialValue(credential.username))
    ? 'USERNAME / LOGIN EMAIL' : field.label
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

  return rawAccounts.map((item) => {
    const credential = normalizeOrderCredential(item)
    return {
      username: credentialValue(credential.username),
      password: credentialValue(credential.password),
      original_line: credentialValue(credential.original_line),
      email: credentialValue(credential.email),
      email_password: credentialValue(credential.email_password),
      two_fa_code: credentialValue(credential.two_fa_code),
      recovery_email: credentialValue(credential.recovery_email),
      recovery_email_password: credentialValue(credential.recovery_email_password),
      additional_info: credentialValue(credential.additional_info),
    }
  }).filter((item) => credentialFields.some((field) => credentialValue(item[field.key]).trim()))
}

export default function CheckoutPage() {
  const { user } = useAuth()
  const location = useLocation()
  const checkoutParams = new URLSearchParams(location.search)
  const product = location.state?.productGroup?.id || checkoutParams.get('product') || ''
  const account = location.state?.accountId || checkoutParams.get('account') || ''
  // A change of account removes any previously displayed credentials immediately.
  // Pending purchase recovery stays keyed by user and product within CheckoutAccount,
  // so a different account in the same group still inherits its unresolved hold.
  return <CheckoutAccount key={`${user?.id || 'signed-out'}:${product}:${account}`} />
}

function CheckoutAccount() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, walletBalance, walletLoading, walletBalanceUnavailable, refreshWalletBalance, showBalances, isStaff, isAdmin } = useAuth()
  const { formatPrice } = useCurrency()
  const { toast } = useToast()
  
  // Get data from navigation state - supports both single and bulk purchases
  const { accountId: navigationAccountId, productGroup: navigationProductGroup, category: navigationCategory, croAssignment = null } = location.state || {}
  const checkoutParams = new URLSearchParams(location.search)
  const productId = navigationProductGroup?.id || checkoutParams.get('product')
  const pendingPurchaseStorageKey = user?.id && productId ? `tallystore:pending-purchase:${user.id}:${productId}` : null
  const accountId = navigationAccountId || checkoutParams.get('account')
  const requestedQuantity = Number(location.state?.quantity ?? checkoutParams.get('quantity') ?? 1)
  const [quantity, setQuantity] = useState(() => Number.isSafeInteger(requestedQuantity) && requestedQuantity > 0 ? requestedQuantity : 1)
  const [category, setCategory] = useState(navigationCategory || null)
  
  const [account, setAccount] = useState<PublicAccount | null>(null)
  const [checkoutProductGroup, setCheckoutProductGroup] = useState<ProductGroup | null>(null)
  const [loading, setLoading] = useState(true)
  const [purchasing, setPurchasing] = useState(false)
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null)
  const [purchaseStatusUnknown, setPurchaseStatusUnknown] = useState(false)
  const [serverInsufficientFunds, setServerInsufficientFunds] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState('wallet')
  const [paymentDetailsOpen, setPaymentDetailsOpen] = useState(true)
  const [credentialsModalOpen, setCredentialsModalOpen] = useState(false)
  const [purchasedCredentials, setPurchasedCredentials] = useState<PurchasedAccountCredentials[]>([])
  const [credentialAccountIndex, setCredentialAccountIndex] = useState(0)
  const [credentialFieldPage, setCredentialFieldPage] = useState(0)
  useEffect(() => {
    if (credentialsModalOpen) { setCredentialAccountIndex(0); setCredentialFieldPage(0) }
  }, [credentialsModalOpen, purchasedCredentials])
  const [completedPurchase, setCompletedPurchase] = useState<{
    orderId?: string
    productName?: string
    quantity?: number
  } | null>(null)
  const paymentAttemptedRef = useRef(false)
  const purchaseCompletedRef = useRef(false)
  const checkoutAttemptRef = useRef(`checkout_${Date.now()}_${crypto.randomUUID()}`)
  const purchaseIdempotencyKeyRef = useRef<string | null>(null)
  const pendingSnapshotRef = useRef<{ quantity?: number; expectedAmountNgn?: number }>({})
  const [checkingPurchaseStatus, setCheckingPurchaseStatus] = useState(false)
  const [purchaseCheckMessage, setPurchaseCheckMessage] = useState('')
  const purchaseScopeRef = useRef(pendingPurchaseStorageKey)
  const checkoutMountedRef = useRef(true)
  purchaseScopeRef.current = pendingPurchaseStorageKey
  useEffect(() => {
    checkoutMountedRef.current = true
    return () => { checkoutMountedRef.current = false }
  }, [])

  useEffect(() => {
    purchaseIdempotencyKeyRef.current = null
    pendingSnapshotRef.current = {}
    setPendingOrderId(null)
    setPurchaseStatusUnknown(false)
    setPurchasedCredentials([])
    setCompletedPurchase(null)
    setCredentialsModalOpen(false)
    setPurchaseCheckMessage('')
    setCheckingPurchaseStatus(false)
    setPurchasing(false)
    if (!pendingPurchaseStorageKey) return
    try {
      const saved = JSON.parse(localStorage.getItem(pendingPurchaseStorageKey) || sessionStorage.getItem(pendingPurchaseStorageKey) || 'null')
      purchaseIdempotencyKeyRef.current = typeof saved?.idempotencyKey === 'string' ? saved.idempotencyKey : null
      setPendingOrderId(typeof saved?.orderId === 'string' ? saved.orderId : null)
      setPurchaseStatusUnknown(Boolean(saved?.idempotencyKey))
      if (Number.isInteger(saved?.quantity) && saved.quantity > 0) {
        pendingSnapshotRef.current = { quantity: saved.quantity, expectedAmountNgn: saved.expectedAmountNgn }
        setQuantity(saved.quantity)
      }
    } catch {
      // An unreadable purchase reference cannot prove that no request was sent.
      setPurchaseStatusUnknown(true)
      setPurchaseCheckMessage('This browser could not read your purchase reference. Check your order history or contact support.')
    }
  }, [pendingPurchaseStorageKey])

  const rememberPendingPurchase = (idempotencyKey: string, orderId?: string) => {
    purchaseIdempotencyKeyRef.current = idempotencyKey
    setPendingOrderId(orderId || null)
    setPurchaseStatusUnknown(true)
    if (pendingPurchaseStorageKey) {
      try {
        const snapshot = JSON.stringify({ idempotencyKey, orderId: orderId || null, ...pendingSnapshotRef.current })
        localStorage.setItem(pendingPurchaseStorageKey, snapshot)
        try { sessionStorage.setItem(pendingPurchaseStorageKey, snapshot) } catch { /* Durable copy is already saved. */ }
        return true
      } catch {
        console.error('Could not retain purchase reference in this browser')
      }
    }
    return false
  }

  const clearPendingPurchase = () => {
    purchaseIdempotencyKeyRef.current = null
    pendingSnapshotRef.current = {}
    setPendingOrderId(null)
    setPurchaseStatusUnknown(false)
    setPurchaseCheckMessage('')
    if (pendingPurchaseStorageKey) {
      try { localStorage.removeItem(pendingPurchaseStorageKey) } catch { /* Retain conservatively on storage failure. */ }
      try { sessionStorage.removeItem(pendingPurchaseStorageKey) } catch { /* Retain conservatively on storage failure. */ }
    }
  }

  const checkPendingPurchase = async () => {
    const key = purchaseIdempotencyKeyRef.current
    const scope = pendingPurchaseStorageKey
    if (!key || !productId || checkingPurchaseStatus || purchasing) return
    setCheckingPurchaseStatus(true)
    setPurchaseCheckMessage('')
    const result = await getCustomerPurchaseAttemptStatus(productId, key, pendingOrderId)
    if (!checkoutMountedRef.current || purchaseScopeRef.current !== scope || purchaseIdempotencyKeyRef.current !== key) return
    if (result.state === 'completed') {
      const savedQuantity = pendingSnapshotRef.current.quantity
      clearPendingPurchase()
      purchaseCompletedRef.current = true
      setCompletedPurchase({ orderId: result.order_id, productName: productGroup?.name, quantity: result.quantity || savedQuantity })
      void refreshWalletBalance().catch(() => undefined)
      toast({ title: 'Purchase confirmed', description: 'Your purchased account details are in your order history.' })
    } else if (result.state === 'released') {
      clearPendingPurchase()
      void refreshWalletBalance().catch(() => undefined)
      toast({ title: 'Purchase was not completed', description: 'The wallet hold was released. Review the current price and stock before trying again.' })
    } else {
      if (result.order_id) rememberPendingPurchase(key, result.order_id)
      setPurchaseCheckMessage(result.state === 'review_required'
        ? 'This purchase needs support review. Your original purchase reference is saved; do not place it again.'
        : 'This purchase is still unconfirmed. Your original reference is saved; check again shortly or contact support.')
    }
    setCheckingPurchaseStatus(false)
  }

  // Discount code state - applied on top of any quantity discount tier.
  // The percentOff here is preview-only; the edge function re-validates and
  // re-applies the code server-side before any wallet deduction.
  const [codeInput, setCodeInput] = useState('')
  const [checkingCode, setCheckingCode] = useState(false)
  const [codeError, setCodeError] = useState('')
  const [appliedCode, setAppliedCode] = useState<{ code: string; percentOff: number } | null>(null)
  const [circleStatus, setCircleStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [circleMember, setCircleMember] = useState(false)
  const [circleUserId, setCircleUserId] = useState<string | null>(null)
  const [circleRetry, setCircleRetry] = useState(0)
  const productGroup = checkoutProductGroup || navigationProductGroup

  useEffect(() => {
    if (!user?.id) {
      setCircleStatus('error')
      setCircleUserId(null)
      return
    }

    let active = true
    setCircleStatus('loading')
    setCircleUserId(null)
    setCircleMember(false)
    let timer: number
    const timeout = new Promise<never>((_, reject) => {
      timer = window.setTimeout(() => reject(new Error('Tally Circle status timed out')), 8000)
    })
    void Promise.race([supabase.rpc('get_my_tally_circle_status'), timeout]).then(({ data, error }) => {
      if (!active) return
      if (error || !data || typeof data.enabled !== 'boolean'
        || typeof data.is_member !== 'boolean' || typeof data.discount_active !== 'boolean'
        || data.discount_percent !== (data.discount_active ? 3 : 0)
        || (!data.enabled && (data.is_member || data.discount_active))
        || (data.discount_active && !data.is_member)) {
        setCircleStatus('error')
        return
      }
      setCircleMember(data.enabled && data.is_member && data.discount_active)
      setCircleUserId(user.id)
      setCircleStatus('ready')
    }).catch(() => {
      if (!active) return
      setCircleStatus('error')
    }).finally(() => window.clearTimeout(timer))

    return () => { active = false; window.clearTimeout(timer) }
  }, [user?.id, circleRetry])

  // Calculate total based on quantity, applying any quantity discount tier
  const { total: tierTotal, discountPct, originalTotal } = productGroup
    ? computeDiscountedTotal(productGroup.price, quantity, productGroup.quantity_discount_tiers)
    : { total: 0, discountPct: 0, originalTotal: 0 }

  // Then apply the discount code (if any) on top of the tier price
  const preCircleTotal = appliedCode
    ? Math.round(tierTotal * (1 - appliedCode.percentOff / 100))
    : tierTotal
  const codeDiscountAmount = appliedCode ? tierTotal - preCircleTotal : 0
  const preCircleTotalMinor = Math.round(preCircleTotal * 100)
  const totalAmountMinor = circleStatus === 'ready' && circleUserId === user?.id && circleMember
    ? Math.round(preCircleTotalMinor * 97 / 100)
    : preCircleTotalMinor
  const totalAmount = totalAmountMinor / 100
  const circleSavings = (preCircleTotalMinor - totalAmountMinor) / 100

  const isBulk = quantity > 1
  const maxQuantity = accountId ? 1 : productGroup && canAutoFulfillProduct(productGroup)
    ? 100
    : Math.max(1, Number(productGroup?.stock_count) || 1)

  const changeQuantity = (next: number) => {
    if (purchasing || completedPurchase || purchaseStatusUnknown) return
    setQuantity(Math.max(1, Math.min(maxQuantity, next)))
    purchaseIdempotencyKeyRef.current = null
    setAppliedCode(null)
    setCodeError('')
    setServerInsufficientFunds(false)
  }

  // Keep only public product/account identifiers in the URL so a checkout can
  // survive refresh or a return from wallet funding. Never put credentials here.
  useEffect(() => {
    if (!productId) return
    const url = new URL(window.location.href)
    url.searchParams.set('product', productId)
    url.searchParams.set('quantity', String(quantity))
    if (accountId && quantity === 1) url.searchParams.set('account', accountId)
    else url.searchParams.delete('account')
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }, [accountId, productId, quantity])

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
        if (value.trim()) lines.push(`${checkoutCredentialLabel(field, credential, completedPurchase?.productName || productGroup?.name)}: ${value}`)
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
      const result = await previewDiscountCode(codeInput.trim(), productGroup.id, productGroup.category_id, tierTotal)
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
      if (!productId) {
        navigate('/products')
        return
      }

      const latestProductGroup = await Promise.race([
        getProductGroupById(productId),
        new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 12000)),
      ]).catch(() => null)
      if (!latestProductGroup || !isCustomerSellableProduct(latestProductGroup)) {
        if (purchaseIdempotencyKeyRef.current) { setLoading(false); return }
        toast({
          variant: "destructive",
          title: "Product unavailable",
          description: "This product is no longer available for purchase.",
        })
        navigate('/products')
        return
      }
      setCheckoutProductGroup(latestProductGroup)
      const stock = Number(latestProductGroup.stock_count)
      const latestMaxQuantity = accountId ? 1 : canAutoFulfillProduct(latestProductGroup)
        ? 100
        : Math.max(1, Number.isFinite(stock) ? stock : 1)
      setQuantity((current) => pendingSnapshotRef.current.quantity || Math.max(1, Math.min(current, latestMaxQuantity)))
      if (navigationCategory) setCategory(navigationCategory)
      if (!navigationCategory) {
        void getCategoryById(latestProductGroup.category_id).then(setCategory).catch(() => setCategory(null))
      }
      
      // If we have an accountId, load individual account data
      if (accountId && !purchaseIdempotencyKeyRef.current) {
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
        void refreshWalletBalance().catch(() => undefined)
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
          void refreshWalletBalance().catch(() => undefined)
          setLoading(false)
        } catch (error) {
          console.error('Error refreshing wallet:', error)
          setLoading(false)
        }
      }
    }

    loadData()
  }, [accountId, productId, navigationCategory, navigate, refreshWalletBalance, toast])

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
    if (purchasing || pendingOrderId || purchaseStatusUnknown || purchaseIdempotencyKeyRef.current) return
    if (circleStatus === 'loading' || (circleStatus === 'ready' && circleUserId !== user.id)) return
    if (blockStaffPurchase(isStaff, isAdmin, toast)) return

    // Another tab may have started this product checkout since this page loaded.
    // Reuse its saved reference for status checks instead of overwriting it.
    try {
      const saved = pendingPurchaseStorageKey ? JSON.parse(localStorage.getItem(pendingPurchaseStorageKey) || 'null') : null
      if (typeof saved?.idempotencyKey === 'string') {
        pendingSnapshotRef.current = { quantity: saved.quantity, expectedAmountNgn: saved.expectedAmountNgn }
        rememberPendingPurchase(saved.idempotencyKey, saved.orderId)
        return
      }
    } catch {
      toast({ variant: 'destructive', title: 'Purchase could not start', description: 'This browser could not read the purchase reference. Check order history or enable site storage.' })
      return
    }

    setPurchasing(true)
    setServerInsufficientFunds(false)
    paymentAttemptedRef.current = true
    const idempotencyKey = purchaseIdempotencyKeyRef.current || `purchase_${user.id.substring(0, 8)}_${productGroup.id.substring(0, 8)}_${quantity}_${Date.now()}_${crypto.randomUUID()}`
    purchaseIdempotencyKeyRef.current = idempotencyKey
    const purchaseScope = pendingPurchaseStorageKey
    pendingSnapshotRef.current = { quantity, expectedAmountNgn: totalAmount }
    if (!rememberPendingPurchase(idempotencyKey)) {
      purchaseIdempotencyKeyRef.current = null
      setPurchaseStatusUnknown(false)
      setPurchasing(false)
      toast({ variant: 'destructive', title: 'Purchase could not start', description: 'This browser could not save the purchase reference. Enable site storage and try again.' })
      return
    }
    
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
      if (!checkoutMountedRef.current || purchaseScopeRef.current !== purchaseScope) return
      
      if (result.success) {
        clearPendingPurchase()
        purchaseCompletedRef.current = true
        const purchaseType = quantity > 1 ? 'Bulk Purchase' : 'Purchase'
        const accountText = quantity > 1 ? `${quantity} accounts` : '1 account'

        // Refresh wallet balance after successful purchase
        void refreshWalletBalance().catch(() => undefined)

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
        if (deliveredCredentials.length) setCredentialsModalOpen(true)

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
        if (result.retry_safe !== true) {
          rememberPendingPurchase(idempotencyKey, result.order_id)
          toast({
            title: 'Order being checked',
            description: result.order_id
              ? `Order ${result.order_id} is being checked. See your order history or contact support before trying again.`
              : 'Your purchase status is being checked. See your order history or contact support before trying again.',
          })
          return
        }
        clearPendingPurchase()
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
        } else if (result.error?.includes('Insufficient wallet balance') || result.error?.includes('Insufficient verified funds')) {
          errorTitle = "Insufficient Balance 💰";
          errorDescription = "Please top up your wallet to complete this purchase.";
          setServerInsufficientFunds(true)
          void refreshWalletBalance()
        }
        
        toast({
          variant: "destructive",
          title: errorTitle,
          description: errorDescription
        })
      }
      
    } catch (error) {
      if (!checkoutMountedRef.current || purchaseScopeRef.current !== purchaseScope) return
      console.error('❌ Purchase error:', error)
      rememberPendingPurchase(idempotencyKey)
      toast({
        title: 'Order being checked',
        description: 'We could not confirm the purchase status. Check order history or contact support before placing it again.',
      })
    } finally {
      if (checkoutMountedRef.current && purchaseScopeRef.current === purchaseScope) setPurchasing(false)
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
            <h1 className="text-2xl font-bold mb-4">{purchaseStatusUnknown ? 'Check your purchase' : 'Product Not Found'}</h1>
            <p className="text-muted-foreground mb-6">
              {purchaseStatusUnknown ? 'Your purchase reference is saved even if this product is no longer listed.' : "The product you're trying to purchase doesn't exist."}
            </p>
            {purchaseStatusUnknown && <div className="mb-6 space-y-3"><Button onClick={() => void checkPendingPurchase()} disabled={checkingPurchaseStatus || !purchaseIdempotencyKeyRef.current}>Check purchase status</Button><p className="text-sm text-muted-foreground" role="status">{purchaseCheckMessage}</p><Link className="block underline" to="/orders">Open order history</Link></div>}
            {completedPurchase && <Link className="mb-6 block underline" to="/orders">Purchase confirmed — open order history</Link>}
            <BackToProducts />
          </div>
        </div>
      </div>
    )
  }

  const walletBalanceReady = !walletLoading && !walletBalanceUnavailable
  const circlePriceReady = Boolean(user?.id) && (
    (circleStatus === 'ready' && circleUserId === user?.id) || circleStatus === 'error'
  )
  const canAfford = walletBalanceReady && circlePriceReady && walletBalance >= totalAmount
  const insufficientFunds = walletBalanceReady && circlePriceReady && walletBalance < totalAmount
  const balanceAfter = walletBalance - totalAmount
  const activeCredentialIndex = Math.min(credentialAccountIndex, Math.max(0, purchasedCredentials.length - 1))
  const activeCredential = purchasedCredentials[activeCredentialIndex]
  const activeCredentialFields = activeCredential ? credentialFields
    .map((field) => ({ ...field, label: checkoutCredentialLabel(field, activeCredential, completedPurchase?.productName || productGroup.name), value: credentialValue(activeCredential[field.key]) }))
    .filter((field) => field.value.trim()) : []
  const credentialPageCount = Math.max(1, Math.ceil(activeCredentialFields.length / CREDENTIAL_FIELDS_PER_PAGE))
  const activeCredentialPage = Math.min(credentialFieldPage, credentialPageCount - 1)
  const displayedCredentialFields = activeCredentialFields.slice(activeCredentialPage * CREDENTIAL_FIELDS_PER_PAGE,
    (activeCredentialPage + 1) * CREDENTIAL_FIELDS_PER_PAGE)

  return (
    <div className="min-h-[100dvh] bg-background">
      <NavbarAuth />

      <main className="mx-auto flex min-h-[calc(100dvh-72px)] w-full max-w-md items-start px-3 pb-24 pt-6 sm:px-4 md:items-center md:py-12">
        <Card className="w-full overflow-hidden rounded-3xl border-slate-200 bg-card shadow-2xl dark:border-white/10">
          <CardHeader className="border-b border-slate-100 p-4 dark:border-white/10 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-lg font-bold">Purchase</CardTitle>
              <Link to="/products" className="text-xs font-semibold text-muted-foreground hover:text-primary">Back to products</Link>
            </div>
          </CardHeader>

          <CardContent className="space-y-3 p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-slate-100 dark:bg-white/10"><CategoryLogo name={category?.name || productGroup.name} className="h-9 w-9" iconClassName="h-8 w-8" /></span>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-bold leading-snug">{productGroup.name}</h2>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {category && <Badge variant="secondary" className="rounded-full text-xs">{category.name}</Badge>}
                  <Badge variant="outline" className="rounded-full text-xs text-emerald-600">{canAutoFulfillProduct(productGroup) ? 'Available on demand' : `${productGroup.stock_count} in stock`}</Badge>
                  <Badge variant="outline" className="rounded-full text-xs font-bold text-purple-600">{formatPrice(productGroup.price)} each</Badge>
                </div>
              </div>
            </div>

            <section aria-labelledby="product-instructions-heading" className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-slate-50 p-4 shadow-sm dark:border-violet-400/25 dark:from-violet-500/10 dark:via-slate-900 dark:to-slate-900">
              <div className="mb-3 flex items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-200"><Info className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-violet-700 dark:text-violet-300">Selected product</p>
                  <h3 id="product-instructions-heading" className="text-base font-extrabold leading-tight text-foreground">Product information &amp; instructions</h3>
                </div>
              </div>
              <p className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground [overflow-wrap:anywhere]">{productGroup.description || 'Product details will be shown with your order after purchase.'}</p>
            </section>

            <div className="rounded-2xl bg-slate-50 p-3 dark:bg-white/5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold">Quantity</span>
                <div className="flex items-center gap-1" aria-label="Purchase quantity">
                  <Button type="button" variant="outline" size="icon" className="h-9 w-9 rounded-xl" aria-label="Decrease quantity" disabled={quantity <= 1 || purchasing || !!completedPurchase || purchaseStatusUnknown} onClick={() => changeQuantity(quantity - 1)}>
                    <Minus className="h-4 w-4" />
                  </Button>
                  <span className="min-w-9 text-center font-bold" aria-live="polite">{quantity}</span>
                  <Button type="button" variant="outline" size="icon" className="h-9 w-9 rounded-xl" aria-label="Increase quantity" disabled={quantity >= maxQuantity || purchasing || !!completedPurchase || purchaseStatusUnknown} onClick={() => changeQuantity(quantity + 1)}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {(discountPct > 0 || appliedCode || circleSavings > 0) && (
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
                  {circleSavings > 0 && (
                    <div className="flex justify-between gap-3 text-green-600">
                      <span className="truncate">Tally Circle (3% off)</span>
                      <span className="shrink-0">-{formatPrice(circleSavings)}</span>
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
                    {walletLoading ? 'Checking...' : walletBalanceUnavailable ? 'Unavailable' : showBalances ? formatPrice(walletBalance) : '***'}
                    <ChevronDown className={`h-4 w-4 transition-transform ${paymentDetailsOpen ? 'rotate-180' : ''}`} />
                  </span>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3 pt-3">
                <div className="grid grid-cols-2 gap-3 rounded-2xl border bg-muted/30 p-3 text-sm">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Wallet balance</p>
                    <p className={`truncate font-bold ${!walletBalanceReady ? 'text-muted-foreground' : canAfford ? 'text-green-600' : 'text-red-600'}`}>
                      {walletLoading ? 'Checking...' : walletBalanceUnavailable ? 'Unavailable' : showBalances ? formatPrice(walletBalance) : '***'}
                    </p>
                  </div>
                  <div className="min-w-0 text-right">
                    <p className="text-xs text-muted-foreground">After purchase</p>
                    <p className={`truncate text-xs font-bold ${balanceAfter >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {!walletBalanceReady || !circlePriceReady ? '—' : showBalances ? formatPrice(balanceAfter) : '***'}
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

            {walletBalanceUnavailable && !walletLoading && !completedPurchase && (
              <Alert>
                <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                  <span>Wallet balance is temporarily unavailable. The server will check your funds before any purchase.</span>
                  <Button type="button" variant="outline" size="sm" onClick={() => void refreshWalletBalance()}>
                    Retry balance
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {circleStatus !== 'ready' && !completedPurchase && (
              <Alert>
                <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                  <span>{circleStatus === 'loading'
                    ? 'Checking your Tally Circle price...'
                    : 'Tally Circle status is unavailable. Checkout will use the standard price; the server will confirm the final price before purchase.'}</span>
                  {circleStatus === 'error' && (
                    <Button type="button" variant="outline" size="sm" onClick={() => setCircleRetry((value) => value + 1)}>
                      Retry pricing
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {(insufficientFunds || serverInsufficientFunds) && !completedPurchase && (
              <Alert>
                <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                  <span>{insufficientFunds && showBalances
                    ? `You need ${formatPrice(totalAmount - walletBalance)} more to buy this.`
                    : 'Top up your wallet to continue.'}</span>
                  {serverInsufficientFunds && <Button type="button" variant="outline" size="sm" onClick={() => { setServerInsufficientFunds(false); void refreshWalletBalance() }}>Check balance again</Button>}
                </AlertDescription>
              </Alert>
            )}

            <div className="flex items-center justify-between rounded-2xl bg-purple-50 px-4 py-3 dark:bg-purple-500/10">
              <span className="text-sm font-semibold text-muted-foreground">Total</span>
              <strong className="text-xl font-black text-purple-700 dark:text-purple-300">
                {circlePriceReady ? formatPrice(totalAmount) : circleStatus === 'loading' ? 'Checking...' : 'Unavailable'}
              </strong>
            </div>

            {completedPurchase ? (
              <Button className="w-full" size="lg" disabled>
                <CheckCircle className="h-4 w-4 mr-2" />
                Purchase Complete
              </Button>
            ) : purchaseStatusUnknown && !purchasing ? (
              <Button className="w-full" size="lg" disabled>
                <Clock className="h-4 w-4 mr-2" />
                Order Being Checked
              </Button>
            ) : insufficientFunds || serverInsufficientFunds ? (
              <Link to="/wallet" className="block">
                <Button className="w-full rounded-xl" variant="outline" size="lg">
                  <Wallet className="h-4 w-4 mr-2" />
                  Top Up Wallet
                </Button>
              </Link>
            ) : (
              <Button
                onClick={handlePurchase}
                disabled={purchasing || walletLoading || !circlePriceReady}
                className="w-full rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 font-bold text-white shadow-lg shadow-purple-600/20 hover:from-purple-700 hover:to-indigo-700"
                size="lg"
              >
                {!circlePriceReady ? (
                  <>
                    {circleStatus === 'loading' && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    {circleStatus === 'loading' ? 'Checking Price...' : 'Price Unavailable'}
                  </>
                ) : walletLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Checking Wallet...
                  </>
                ) : purchasing ? (
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
            {completedPurchase && <Link to="/orders" className="block rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-center text-sm font-semibold text-primary">Purchase confirmed — open order history</Link>}
            {purchaseStatusUnknown && !purchasing && (
              <Alert>
                <AlertDescription>
                  A previous purchase for this product is awaiting confirmation{pendingOrderId ? ` (order ${pendingOrderId})` : ''}. Check <Link to="/orders" className="font-semibold underline">order history</Link> or contact support before placing it again.
                  <Button type="button" variant="outline" className="mt-3 w-full" disabled={checkingPurchaseStatus || !purchaseIdempotencyKeyRef.current} onClick={() => void checkPendingPurchase()}>
                    {checkingPurchaseStatus && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Check purchase status
                  </Button>
                  {purchaseCheckMessage && <p className="mt-2 text-sm" role="status">{purchaseCheckMessage}</p>}
                </AlertDescription>
              </Alert>
            )}

          </CardContent>
        </Card>
      </main>

      <Dialog open={credentialsModalOpen} onOpenChange={setCredentialsModalOpen}>
        <DialogContent data-testid="credentials-dialog" className="w-[calc(100vw-1.5rem)] max-w-[340px] gap-0 overflow-hidden rounded-2xl border-slate-700/70 bg-[#050818] p-0 text-white shadow-2xl">
          <DialogHeader className="border-b border-white/10 px-3 py-2.5 pr-10 text-left">
            <DialogTitle className="text-base font-black leading-tight text-white">Account credentials</DialogTitle>
            <DialogDescription className="mt-0.5 text-[11px] text-slate-300">Copy the full value or download every account.</DialogDescription>
          </DialogHeader>

          {purchasedCredentials.length === 0 ? (
            <p className="px-3 py-4 text-xs text-slate-300">The purchase completed, but no credentials were returned here. Open Order History to view the saved credentials.</p>
          ) : (
            <div className="min-w-0 space-y-2 px-3 py-2.5">
              {purchasedCredentials.length > 1 ? <div className="flex items-center justify-between gap-2 text-xs" aria-label="Account navigation">
                <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-slate-200 hover:bg-white/10 hover:text-white"
                  disabled={activeCredentialIndex === 0} onClick={() => { setCredentialAccountIndex(activeCredentialIndex - 1); setCredentialFieldPage(0) }}
                  aria-label="Previous account">Previous</Button>
                <strong className="text-center text-violet-200">Account {activeCredentialIndex + 1} of {purchasedCredentials.length}</strong>
                <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-slate-200 hover:bg-white/10 hover:text-white"
                  disabled={activeCredentialIndex >= purchasedCredentials.length - 1}
                  onClick={() => { setCredentialAccountIndex(activeCredentialIndex + 1); setCredentialFieldPage(0) }}
                  aria-label="Next account">Next</Button>
              </div> : <p className="text-center text-xs font-bold text-violet-200">Account 1</p>}
              <section aria-label={`Account ${activeCredentialIndex + 1}`} className="min-w-0 space-y-1.5 rounded-xl border border-slate-700/80 bg-[#0b1028] p-2">
                {displayedCredentialFields.map((field) => (
                  <div key={field.key} className="flex min-w-0 items-center gap-1.5 rounded-lg bg-white/[0.06] px-2 py-1">
                    <div className="min-w-0 flex-1">
                      <span className={`block truncate text-[10px] font-bold uppercase tracking-wide ${field.labelClassName}`}>{field.label}</span>
                      <span data-testid="credential-value" className="block max-w-full truncate whitespace-nowrap font-mono text-xs leading-4 text-slate-100">{field.value}</span>
                    </div>
                    <Button type="button" variant="ghost" size="icon"
                      onClick={() => copyCredential(field.value, field.label)}
                      className="h-8 w-8 shrink-0 rounded-lg text-slate-300 hover:bg-white/10 hover:text-white"
                      aria-label={`Copy ${field.label} for account ${activeCredentialIndex + 1}`}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </section>
              {credentialPageCount > 1 && <div className="flex items-center justify-between gap-2 text-xs" aria-label="Credential fields navigation">
                <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-slate-200 hover:bg-white/10 hover:text-white"
                  disabled={activeCredentialPage === 0} onClick={() => setCredentialFieldPage(activeCredentialPage - 1)}
                  aria-label="Previous fields">Previous</Button>
                <span className="text-center text-slate-300">Fields {activeCredentialPage * CREDENTIAL_FIELDS_PER_PAGE + 1}–{Math.min((activeCredentialPage + 1) * CREDENTIAL_FIELDS_PER_PAGE, activeCredentialFields.length)} of {activeCredentialFields.length}</span>
                <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-slate-200 hover:bg-white/10 hover:text-white"
                  disabled={activeCredentialPage >= credentialPageCount - 1} onClick={() => setCredentialFieldPage(activeCredentialPage + 1)}
                  aria-label="Next fields">Next</Button>
              </div>}
            </div>
          )}
          <div className="border-t border-white/10 bg-[#050818] px-3 py-2.5">
            <Button type="button" onClick={downloadCredentialsTxt} disabled={!purchasedCredentials.length}
              className="h-9 w-full rounded-xl bg-violet-500 text-xs font-bold text-white hover:bg-violet-400 disabled:opacity-50">
              <Download className="mr-2 h-3.5 w-3.5" />Download all as TXT
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
