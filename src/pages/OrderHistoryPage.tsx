import { useMemo, useState, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert } from '@/components/ui/alert'
import {
  ArrowLeft,
  Calendar,
  CheckCircle,
  Clock,
  Copy,
  Download,
  ExternalLink,
  KeyRound,
  ListFilter,
  Loader2,
  Package,
  ReceiptText,
  RefreshCw,
  Search,
  ShieldAlert,
  ShoppingBag,
  Tags,
  XCircle,
} from 'lucide-react'
import NavbarAuth from '@/components/NavbarAuth'
import Footer from '@/components/Footer'
import WalletBalanceWidget from '@/components/WalletBalanceWidget'
import PageBreadcrumb from '@/components/PageBreadcrumb'
import { useAuth } from '@/contexts/SimpleAuth'
import { useCurrency } from '@/contexts/CurrencyContext'
import { getUserOrders } from '@/lib/supabase'
import {
  getAllProductGroups,
  getCategories,
  getAppSetting,
  getFavoriteProductGroupIds,
  getTopSellingProductGroupIds,
  getUserPurchaseHistory,
  type Category,
  type ProductGroup,
} from '@/lib/supabase'
import { useToast } from '@/hooks/use-toast'
import { RevampCard, RevampPage } from '@/components/RevampLayout'
import ProductTemplateCard from '@/components/ProductTemplateCard'
import { isCustomerSellableProduct } from '@/lib/productAvailability'
import {
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

const statusColors = {
  completed: 'default',
  processing: 'secondary', 
  failed: 'destructive',
  pending: 'outline'
} as const

const statusIcons = {
  completed: CheckCircle,
  processing: RefreshCw,
  failed: XCircle,
  pending: Clock
}

const credentialFields = [
  { keys: ['username', 'id', 'login', 'account_id'], label: 'ID', tone: 'text-slate-700 dark:text-slate-300' },
  { keys: ['password', 'pass'], label: 'PASSWORD', tone: 'text-rose-500' },
  { keys: ['two_fa_code', 'two_factor', 'two_factor_code', '2fa', '2fa_key'], label: '2FA KEY', tone: 'text-purple-500' },
  { keys: ['email', 'mail'], label: 'EMAIL', tone: 'text-emerald-500' },
  { keys: ['email_password', 'mail_password', 'mail_pass', 'mailpass'], label: 'MAIL PASS', tone: 'text-orange-500' },
  { keys: ['recovery', 'recovery_email', 'backup_email'], label: 'RECOVERY', tone: 'text-sky-500' },
  { keys: ['recovery_email_password', 'recovery_password', 'backup_email_password', 'backup_password'], label: 'RECOVERY PASS', tone: 'text-cyan-500' },
  { keys: ['additional_info', 'notes', 'note'], label: 'NOTES', tone: 'text-slate-500 dark:text-slate-400' },
]

function getOrderAccounts(order: any) {
  if (Array.isArray(order?.account_details?.accounts)) {
    return order.account_details.accounts
  }

  if (order?.account_details?.username || order?.account_details?.email || order?.account_details?.password) {
    return [{
      username: order.account_details.username,
      password: order.account_details.password,
      email: order.account_details.email,
      email_password: order.account_details.email_password,
      two_fa_code: order.account_details.two_fa_code,
      additional_info: order.account_details.additional_info,
      recovery: order.account_details.recovery,
      recovery_email: order.account_details.recovery_email,
      recovery_email_password: order.account_details.recovery_email_password,
    }]
  }

  return []
}

function readCredentialValue(account: any, keys: string[]) {
  const key = keys.find((candidate) => account?.[candidate] !== undefined && account?.[candidate] !== null && String(account[candidate]).trim() !== '')
  return key ? String(account[key]) : ''
}

function formatCredentialDisplay(label: string, value: string) {
  if (label !== '2FA KEY') return value
  const compact = value.replace(/\s+/g, '')
  if (compact.length <= 18) return compact
  return `${compact.slice(0, 18)}........`
}

function getOrderProductName(order: any) {
  return order?.account_details?.product_name || order?.product_groups?.name || 'Purchased account'
}

function getOrderPlatform(order: any) {
  return order?.account_details?.category || order?.product_groups?.categories?.name || 'Social Media'
}

function getPlatformLoginUrl(platform: string, productName = '') {
  const value = `${platform} ${productName}`.toLowerCase()

  if (value.includes('facebook') || value.includes('fb ')) return 'https://www.facebook.com/login'
  if (value.includes('instagram') || value.includes(' ig ')) return 'https://www.instagram.com/accounts/login/'
  if (value.includes('tiktok')) return 'https://www.tiktok.com/login'
  if (value.includes('twitter') || value.includes(' x ')) return 'https://x.com/i/flow/login'
  if (value.includes('snapchat')) return 'https://accounts.snapchat.com/accounts/login'
  if (value.includes('telegram')) return 'https://web.telegram.org/'
  if (value.includes('discord')) return 'https://discord.com/login'
  if (value.includes('google') || value.includes('gmail') || value.includes('youtube')) return 'https://accounts.google.com/'
  if (value.includes('amazon')) return 'https://www.amazon.com/ap/signin'
  if (value.includes('netflix')) return 'https://www.netflix.com/login'
  if (value.includes('linkedin')) return 'https://www.linkedin.com/login'
  if (value.includes('pinterest')) return 'https://www.pinterest.com/login/'

  return 'https://www.google.com/search?q=' + encodeURIComponent(`${platform || productName} login`)
}

function buildCredentialText(order: any) {
  const accounts = getOrderAccounts(order)
  const lines = [
    'TallyStore Order Credentials',
    `Order: ${order.id}`,
    `Product: ${getOrderProductName(order)}`,
    `Platform: ${getOrderPlatform(order)}`,
    `Items: ${accounts.length || order?.account_details?.quantity || 1}`,
    '',
  ]

  accounts.forEach((account: any, index: number) => {
    lines.push(`Account ${index + 1}`)
    credentialFields.forEach((field) => {
      const value = readCredentialValue(account, field.keys)
      if (value) lines.push(`${field.label}: ${value}`)
    })
    lines.push('')
  })

  return lines.join('\n')
}

function OrderDetailsView({
  order,
  formatPrice,
  formatDate,
  onCopyAll,
  onDownload,
  onCopyText,
  onOpenLogin,
}: {
  order: any
  formatPrice: (amount: number) => string
  formatDate: (value: string) => { date: string; time: string }
  onCopyAll: (order: any) => void
  onDownload: (order: any) => void
  onCopyText: (text: string, label?: string) => void
  onOpenLogin: (order: any, loginUrl: string) => void
}) {
  const accounts = getOrderAccounts(order)
  const productName = getOrderProductName(order)
  const platform = getOrderPlatform(order)
  const loginUrl = getPlatformLoginUrl(platform, productName)
  const itemCount = accounts.length || order?.account_details?.quantity || 1
  const { date } = formatDate(order.created_at)
  const canAccessCredentials = order.status === 'completed' && accounts.length > 0

  return (
    <div className="max-w-4xl space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Button
          type="button"
          variant="outline"
          className="h-10 min-w-0 justify-center rounded-xl border-purple-400/30 bg-purple-500/10 px-2 text-xs font-black text-purple-700 hover:bg-purple-500/15 dark:text-purple-300 sm:text-sm"
          onClick={() => onCopyAll(order)}
          disabled={!canAccessCredentials}
        >
          <Copy className="h-4 w-4 shrink-0" />
          <span className="truncate">Copy</span>
        </Button>
        <Button
          asChild
          className="h-10 min-w-0 justify-center rounded-xl bg-amber-500 px-2 text-xs font-black text-white shadow-[0_12px_32px_rgba(245,158,11,0.24)] hover:bg-amber-400 sm:text-sm"
        >
          <a href={loginUrl} target="_blank" rel="noopener noreferrer" onClick={() => onOpenLogin(order, loginUrl)}>
            <ExternalLink className="h-4 w-4 shrink-0" />
            <span className="truncate">Login</span>
          </a>
        </Button>
        <Button
          type="button"
          variant="outline"
          className="col-span-2 h-10 min-w-0 justify-center rounded-xl px-2 text-xs font-black sm:col-span-1 sm:text-sm"
          onClick={() => onDownload(order)}
          disabled={!canAccessCredentials}
        >
          <Download className="h-4 w-4 shrink-0" />
          <span>Download</span>
        </Button>
      </div>

      <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-amber-900 dark:text-amber-100 sm:p-4">
        <div className="flex gap-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500 sm:h-5 sm:w-5" />
          <p className="text-xs font-bold leading-5 sm:text-sm sm:leading-6">
            Please kindly use a GOOD VPN to login and add 2-step verification after purchase.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {[
          ['Platform', platform],
          ['Items', String(itemCount)],
          ['Total', formatPrice(Number(order.amount || 0))],
          ['Date', date],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0 rounded-2xl border border-slate-200 bg-slate-100/80 p-3 dark:border-white/10 dark:bg-slate-900 sm:p-4">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{label}</p>
            <p className="mt-1 truncate text-base font-black text-slate-950 dark:text-white sm:mt-2 sm:text-xl">{value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-slate-100/80 p-3 dark:border-white/10 dark:bg-slate-900 sm:p-4">
        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Product</p>
        <p className="mt-2 text-sm font-black leading-6 text-slate-950 dark:text-white sm:text-lg sm:leading-7">
          {productName}
        </p>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-black uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
            Credentials ({accounts.length})
          </h3>
          <Badge variant={statusColors[order.status as keyof typeof statusColors] || 'outline'}>
            {order.status}
          </Badge>
        </div>

        {!canAccessCredentials ? (
          <Card className="rounded-2xl border-slate-200 bg-white/85 dark:border-white/10 dark:bg-white/[0.035]">
            <CardContent className="p-6 text-center">
              <KeyRound className="mx-auto h-10 w-10 text-muted-foreground" />
              <p className="mt-3 font-black">Credentials are not available yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                This order is {order.status}. Completed orders will show the purchased account details here.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {accounts.map((account: any, index: number) => (
              <div key={`${order.id}-${index}`} className="rounded-2xl border border-slate-200 bg-white/90 p-3 shadow-sm dark:border-white/10 dark:bg-slate-950 sm:p-4">
                <div className="grid grid-cols-[1.6rem_minmax(0,1fr)] gap-2 sm:grid-cols-[2rem_minmax(0,1fr)] sm:gap-3">
                  <div className="grid h-7 w-7 place-items-center rounded-lg bg-purple-100 text-xs font-black text-purple-700 dark:bg-purple-500/15 dark:text-purple-200">{index + 1}</div>
                  <div className="min-w-0 space-y-1.5">
                    {credentialFields.map((field) => {
                      const value = readCredentialValue(account, field.keys)
                      if (!value) return null
                      const displayValue = formatCredentialDisplay(field.label, value)

                      return (
                        <div key={field.label} className="grid min-w-0 grid-cols-[4.8rem_minmax(0,1fr)_1.8rem] items-center gap-1.5 text-xs sm:grid-cols-[7rem_minmax(0,1fr)_2rem] sm:gap-2 sm:text-sm">
                          <span className={`truncate text-[10px] font-black uppercase tracking-normal sm:text-[11px] sm:tracking-[0.12em] ${field.tone}`}>
                            {field.label}
                          </span>
                          <span
                            className="min-w-0 truncate rounded-lg bg-slate-100 px-2 py-1.5 font-mono text-xs leading-5 text-slate-800 dark:bg-white/[0.06] dark:text-slate-200 sm:text-sm"
                            title={field.label === '2FA KEY' ? 'Use copy to get the full 2FA key' : value}
                          >
                            {displayValue}
                          </span>
                          <button
                            type="button"
                            onClick={() => onCopyText(value, `${field.label} copied`)}
                            className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-purple-600 dark:hover:bg-white/10 dark:hover:text-purple-300"
                            aria-label={`Copy ${field.label}`}
                          >
                            <Copy className="h-4 w-4" />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white/80 p-4 text-sm text-muted-foreground dark:border-white/10 dark:bg-white/[0.035]">
        <div className="flex items-start gap-3">
          <Calendar className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Purchased on {date}. Keep these credentials private and update security details after login.
          </p>
        </div>
      </div>
    </div>
  )
}

export default function OrderHistoryPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, showBalances } = useAuth()
  const { formatPrice } = useCurrency()
  const { toast } = useToast()
  
  const [orders, setOrders] = useState<any[]>([])
  const [filteredOrders, setFilteredOrders] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null)
  const [recommendationProducts, setRecommendationProducts] = useState<ProductGroup[]>([])
  const [recommendationCategories, setRecommendationCategories] = useState<Category[]>([])
  const [recommendationSettings, setRecommendationSettings] = useState<RevenueOsSettings | null>(null)
  const [recommendationExperiments, setRecommendationExperiments] = useState<any[]>([])

  // Check for purchase success message
  useEffect(() => {
    if (user?.id) {
      trackRevenueEvent({
        eventType: 'PAGE_VIEWED',
        userId: user.id,
        surface: 'order_history',
        metadata: {
          purchase_success: Boolean(location.state?.purchaseSuccess),
        },
      })
    }

    if (location.state?.purchaseSuccess) {
      const accountCount = location.state?.accountCount || 1
      const productName = location.state?.productGroupName || 'account'
      const accountText = accountCount > 1 ? `${accountCount} accounts` : '1 account'
      
      toast({
        title: "Purchase Successful! 🎉",
        description: `You purchased ${accountText} from ${productName}. Open the order details below to copy or download your credentials.`,
        duration: 10000, // Show for 10 seconds instead of default 5
      })
    }
  }, [location.state, toast, user?.id])

  // Load real orders from Supabase
  useEffect(() => {
    const loadOrders = async () => {
      if (!user) return
      
      try {
        setLoading(true)
        const [
          ordersData,
          productGroupsData,
          categoriesData,
          automationSetting,
          revenueSettings,
          experiments,
          actionPlans,
          favoriteIds,
          topSellingIds,
          purchaseHistory,
        ] = await Promise.all([
          getUserOrders(user.id),
          getAllProductGroups(),
          getCategories(),
          getAppSetting('sales_recommendation_automation_enabled'),
          loadRevenueOsSettings(),
          loadRunningCroExperiments(),
          loadRunningCroActionPlans(),
          getFavoriteProductGroupIds(),
          getTopSellingProductGroupIds(16),
          getUserPurchaseHistory(user.id),
        ])
        
        setOrders(ordersData)
        setFilteredOrders(ordersData)
        setRecommendationCategories(categoriesData)
        setRecommendationSettings(revenueSettings)
        setRecommendationExperiments(experiments)

        const completedProductIds = new Set(
          ordersData
            .filter((order: any) => order.status === 'completed' && order.product_group_id)
            .map((order: any) => String(order.product_group_id)),
        )
        const relationshipBoosts = await loadCustomerRelationshipBoosts(
          purchaseHistory.productGroupCounts,
          purchaseHistory.lastPurchasedAtByProductGroup,
        )
        const sellableCandidates = productGroupsData
          .filter(isCustomerSellableProduct)
          .filter((product) => !completedProductIds.has(product.id) || relationshipBoosts[product.id] || favoriteIds.includes(product.id) || topSellingIds.includes(product.id))

        const assignment = resolveCroAssignment({
          surface: 'order_history_post_purchase',
          settings: revenueSettings,
          experiments,
          visitorId: getRevenueVisitorId(),
          userId: user.id,
        })
        const automationEnabled = automationSetting !== 'false' && revenueSettings.enabled && assignment.rankingEnabled
        const ranked = automationEnabled
          ? rankProductsForRevenueOs(sellableCandidates, categoriesData, {
              surface: 'order_history_post_purchase',
              topSellingIds,
              favoriteProductIds: favoriteIds,
              relationshipBoosts,
              actionPlans,
              customer: {
                productGroupCounts: purchaseHistory.productGroupCounts,
                categoryCounts: purchaseHistory.categoryCounts,
                lastPurchasedAtByProductGroup: purchaseHistory.lastPurchasedAtByProductGroup,
                lastPurchasedAtByCategory: purchaseHistory.lastPurchasedAtByCategory,
                lastProductGroupId: purchaseHistory.lastProductGroupId,
              },
              pressure: getCustomerPressureState(),
              settings: revenueSettings,
              assignment,
            }).slice(0, 4).map((rankedProduct) => rankedProduct.product)
          : []
        setRecommendationProducts(ranked)
        trackRevenueEvent({
          eventType: 'PAGE_VIEWED',
          userId: user.id,
          surface: 'order_history_loaded',
          metadata: {
            order_count: ordersData.length,
            completed_count: ordersData.filter((order: any) => order.status === 'completed').length,
            processing_count: ordersData.filter((order: any) => order.status === 'processing').length,
            failed_count: ordersData.filter((order: any) => order.status === 'failed').length,
          },
        })
      } catch (error) {
        console.error('Error loading orders:', error)
        setRecommendationProducts([])
        setRecommendationCategories([])
        setRecommendationSettings(null)
        setRecommendationExperiments([])
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to load order history"
        })
      } finally {
        setLoading(false)
      }
    }

    loadOrders()
  }, [user, toast])

  useEffect(() => {
    // Filter orders based on search and filters
    let filtered = orders

    if (searchTerm) {
      filtered = filtered.filter(order => {
        const searchLower = searchTerm.toLowerCase()
        const productName = order.account_details?.product_name?.toLowerCase() || ''
        const orderId = order.id.toLowerCase()
        
        // Search in accounts array for bulk purchases or direct username for single purchases
        const usernameMatch = order.account_details?.accounts 
          ? order.account_details.accounts.some((account: any) => 
              account.username?.toLowerCase().includes(searchLower)
            )
          : order.account_details?.username?.toLowerCase().includes(searchLower) || false

        return productName.includes(searchLower) || 
               orderId.includes(searchLower) || 
               usernameMatch
      })
    }

    if (statusFilter !== 'all') {
      filtered = filtered.filter(order => order.status === statusFilter)
    }

    if (categoryFilter !== 'all') {
      filtered = filtered.filter(order => getOrderPlatform(order) === categoryFilter)
    }

    setFilteredOrders(filtered)
  }, [orders, searchTerm, statusFilter, categoryFilter])

  useEffect(() => {
    if (!user?.id) return
    const timeout = window.setTimeout(() => {
      if (!searchTerm.trim() && statusFilter === 'all' && categoryFilter === 'all') return
      trackRevenueEvent({
        eventType: searchTerm.trim() ? 'SEARCHED' : 'FILTER_USED',
        userId: user.id,
        surface: 'order_history_filters',
        metadata: {
          search_length: searchTerm.trim().length,
          status_filter: statusFilter,
          category_filter: categoryFilter,
          result_count: filteredOrders.length,
        },
      })
    }, 500)
    return () => window.clearTimeout(timeout)
  }, [categoryFilter, filteredOrders.length, searchTerm, statusFilter, user?.id])

  const copyText = async (text: string, label = 'Copied') => {
    try {
      await navigator.clipboard.writeText(text)
      toast({ title: label })
    } catch {
      toast({
        variant: 'destructive',
        title: 'Copy failed',
        description: 'Please select and copy the text manually.',
      })
    }
  }

  const handleCopyAll = (order: any) => {
    const accountsData = getOrderAccounts(order)
    if (!accountsData.length) {
      toast({
        variant: 'destructive',
        title: 'No credentials found',
        description: 'Please contact support for this order.',
      })
      return
    }

    trackRevenueEvent({
      eventType: 'OFFER_ACCEPTED',
      userId: user?.id || null,
      surface: 'order_credentials_copy_all',
      metadata: {
        order_id: order.id,
        product_group_id: order.product_group_id || null,
        account_count: accountsData.length,
        status: order.status,
      },
    })
    copyText(buildCredentialText(order), 'Credentials copied')
  }

  const handleDownload = (order: any) => {
    const accountsData = getOrderAccounts(order)
    if (!accountsData.length) {
      toast({
        variant: 'destructive',
        title: 'No credentials found',
        description: 'Please contact support for this order.',
      })
      return
    }

    trackRevenueEvent({
      eventType: 'OFFER_ACCEPTED',
      userId: user?.id || null,
      surface: 'order_credentials_download',
      metadata: {
        order_id: order.id,
        product_group_id: order.product_group_id || null,
        account_count: accountsData.length,
        status: order.status,
      },
    })
    const blob = new Blob([buildCredentialText(order)], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${order.id}-credentials.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleOpenLogin = (order: any, loginUrl: string) => {
    trackRevenueEvent({
      eventType: 'OFFER_ACCEPTED',
      userId: user?.id || null,
      surface: 'order_platform_login_opened',
      metadata: {
        order_id: order.id,
        product_group_id: order.product_group_id || null,
        platform: getOrderPlatform(order),
        login_host: (() => {
          try {
            return new URL(loginUrl).host
          } catch {
            return null
          }
        })(),
      },
    })
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return {
      date: date.toLocaleDateString(),
      time: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  }

  const getStats = () => {
    const completed = orders.filter(o => o.status === 'completed').length
    const processing = orders.filter(o => o.status === 'processing').length
    const failed = orders.filter(o => o.status === 'failed').length
    const totalSpent = orders.filter(o => o.status === 'completed').reduce((sum, o) => sum + (o.amount || 0), 0)
    
    return { completed, processing, failed, totalSpent }
  }

  const stats = getStats()
  const availableOrderCategories = useMemo(() => {
    return Array.from(new Set(orders.map(getOrderPlatform).filter(Boolean))).sort((a, b) => a.localeCompare(b))
  }, [orders])

  const recommendationCategoryById = useMemo(() => {
    return new Map(recommendationCategories.map((category) => [category.id, category]))
  }, [recommendationCategories])

  const postPurchaseAssignment = useMemo(() => resolveCroAssignment({
    surface: 'order_history_post_purchase',
    settings: recommendationSettings,
    experiments: recommendationExperiments,
    visitorId: getRevenueVisitorId(),
    userId: user?.id || null,
  }), [recommendationExperiments, recommendationSettings, user?.id])

  useEffect(() => {
    if (categoryFilter !== 'all' && !availableOrderCategories.includes(categoryFilter)) {
      setCategoryFilter('all')
    }
  }, [availableOrderCategories, categoryFilter])

  useEffect(() => {
    if (!user?.id || recommendationProducts.length === 0) return
    const today = new Date().toISOString().slice(0, 10)
    const actorKey = user.id || getRevenueVisitorId() || 'anonymous'
    recommendationProducts.forEach((product, index) => {
      trackRevenueEvent({
        eventType: 'RECOMMENDATION_SHOWN',
        userId: user.id,
        productGroupId: product.id,
        categoryId: product.category_id,
        surface: 'order_history_post_purchase',
        experimentId: postPurchaseAssignment.experimentId,
        variantId: postPurchaseAssignment.variantId,
        metadata: {
          position: index + 1,
          action: 'POST_PURCHASE_RECOMMENDATION',
          assignmentMode: postPurchaseAssignment.mode,
          completedOrderCount: orders.filter((order) => order.status === 'completed').length,
        },
        eventId: `RECOMMENDATION_SHOWN:${today}:${actorKey}:order_history_post_purchase:${postPurchaseAssignment.variantId || postPurchaseAssignment.mode}:${product.id}`,
      })
    })
  }, [orders, postPurchaseAssignment.experimentId, postPurchaseAssignment.mode, postPurchaseAssignment.variantId, recommendationProducts, user?.id])

  const handleRecommendedView = (product: ProductGroup) => {
    trackRevenueEvent({
      eventType: 'RECOMMENDATION_CLICKED',
      userId: user?.id || null,
      productGroupId: product.id,
      categoryId: product.category_id,
      surface: 'order_history_post_purchase',
      experimentId: postPurchaseAssignment.experimentId,
      variantId: postPurchaseAssignment.variantId,
      metadata: {
        action: 'POST_PURCHASE_RECOMMENDATION',
        assignmentMode: postPurchaseAssignment.mode,
      },
    })
    navigate(`/products?category=${encodeURIComponent(product.category_id || '')}`)
  }

  const handleRecommendedPurchase = (productGroupId: string, quantity: number) => {
    const product = recommendationProducts.find((entry) => entry.id === productGroupId)
    if (!product || !isCustomerSellableProduct(product)) return
    const category = recommendationCategoryById.get(product.category_id)

    trackRevenueEvent({
      eventType: 'BUY_CLICKED',
      userId: user?.id || null,
      productGroupId: product.id,
      categoryId: product.category_id,
      surface: 'order_history_post_purchase',
      experimentId: postPurchaseAssignment.experimentId,
      variantId: postPurchaseAssignment.variantId,
      metadata: {
        action: 'POST_PURCHASE_RECOMMENDATION',
        quantity,
        price: product.price,
        assignmentMode: postPurchaseAssignment.mode,
      },
    })

    navigate('/checkout', {
      state: {
        productGroup: product,
        category: category || null,
        quantity,
        isBulkPurchase: quantity > 1,
        croAssignment: postPurchaseAssignment,
      },
    })
  }

  return (
    <div className="min-h-screen bg-background">
      <NavbarAuth />
      
      <div className="mx-auto max-w-7xl px-4 pb-4 pt-8 sm:px-6 lg:px-8">
        <WalletBalanceWidget showRefresh={true} />
      </div>
      
      <RevampPage className="pt-0">
        <PageBreadcrumb items={[{ label: 'Order History' }]} className="mb-5" />
        <section className="rounded-2xl border border-slate-200 bg-white/85 p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.035] sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-purple-100 px-3 py-1 text-[11px] font-black uppercase text-purple-700 dark:bg-purple-500/15 dark:text-purple-200">
                <ReceiptText className="h-3.5 w-3.5" />
                Order History
              </div>
              <h1 className="text-2xl font-black tracking-normal text-slate-950 dark:text-white sm:text-3xl">
                Purchases and credentials
              </h1>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">
                Open completed orders to copy or download the exact account details attached to that purchase.
              </p>
            </div>
            <Button asChild className="hidden shrink-0 rounded-xl font-black sm:inline-flex">
              <Link to="/products">
                <ShoppingBag className="h-4 w-4" />
                Shop
              </Link>
            </Button>
          </div>
        </section>

        {/* Success Alert for New Purchases */}
        {location.state?.purchaseSuccess && (
          <Alert className="mb-6 mt-8 border-green-500 bg-green-50 dark:bg-green-950/50">
            <Download className="h-5 w-5 text-green-600 dark:text-green-400" />
            <div className="ml-2">
              <h3 className="font-semibold text-green-800 dark:text-green-200 mb-1">
                📥 Your Credentials Are Ready!
              </h3>
              <p className="text-sm text-green-700 dark:text-green-300">
                Your purchase is complete. Open your latest order below to view, copy, or download the credentials.
              </p>
            </div>
          </Alert>
        )}

        {selectedOrder ? (
          <section className="mt-8">
            <div className="mb-5 flex items-center gap-3">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="rounded-full"
                onClick={() => setSelectedOrder(null)}
                aria-label="Back to orders"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div className="min-w-0">
                <h2 className="text-2xl font-black tracking-normal">Order Details</h2>
                <p className="truncate text-sm text-muted-foreground">{selectedOrder.id}</p>
              </div>
            </div>

            <OrderDetailsView
              order={selectedOrder}
              formatPrice={formatPrice}
              formatDate={formatDate}
              onCopyAll={handleCopyAll}
              onDownload={handleDownload}
              onCopyText={copyText}
              onOpenLogin={handleOpenLogin}
            />
          </section>
        ) : (
          <>
        {/* Stats */}
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
          <RevampCard className="p-3 sm:p-4">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-green-100 dark:bg-green-500/15">
                  <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-300" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs text-muted-foreground sm:text-sm">Completed</p>
                  <p className="text-xl font-black sm:text-2xl">{stats.completed}</p>
                </div>
              </div>
          </RevampCard>
          
          <RevampCard className="p-3 sm:p-4">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-red-100 dark:bg-red-500/15">
                  <XCircle className="h-4 w-4 text-red-600 dark:text-red-300" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs text-muted-foreground sm:text-sm">Failed</p>
                  <p className="text-xl font-black sm:text-2xl">{stats.failed}</p>
                </div>
              </div>
          </RevampCard>
          
          <RevampCard className="p-3 sm:p-4">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-yellow-100 dark:bg-yellow-500/15">
                  <RefreshCw className="h-4 w-4 text-yellow-600 dark:text-yellow-300" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs text-muted-foreground sm:text-sm">Processing</p>
                  <p className="text-xl font-black sm:text-2xl">{stats.processing}</p>
                </div>
              </div>
          </RevampCard>
          
          <RevampCard className="p-3 sm:p-4">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                  <Tags className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs text-muted-foreground sm:text-sm">Total Spent</p>
                  <p className="truncate text-xl font-black sm:text-2xl">{showBalances ? formatPrice(stats.totalSpent) : '***'}</p>
                </div>
              </div>
          </RevampCard>
        </div>

        {recommendationProducts.length > 0 && (
          <section className="mt-4 rounded-2xl border border-slate-200 bg-white/85 p-3 shadow-sm dark:border-white/10 dark:bg-white/[0.035] sm:p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-black uppercase text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200">
                  <ShoppingBag className="h-3.5 w-3.5" />
                  Recommended next
                </div>
                <h2 className="mt-2 text-lg font-black tracking-normal text-slate-950 dark:text-white sm:text-xl">
                  Pick another product that fits your buying pattern
                </h2>
              </div>
              <Button asChild variant="outline" className="hidden shrink-0 rounded-xl font-black sm:inline-flex">
                <Link to="/products">View all</Link>
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {recommendationProducts.map((product) => {
                const category = recommendationCategoryById.get(product.category_id)
                if (!category) return null
                return (
                  <ProductTemplateCard
                    key={product.id}
                    productGroup={product}
                    category={category}
                    onPurchase={handleRecommendedPurchase}
                    onView={handleRecommendedView}
                  />
                )
              })}
            </div>
          </section>
        )}

        {/* Filters */}
        <Card className="my-4 rounded-2xl border-slate-200 bg-white/85 shadow-sm dark:border-white/10 dark:bg-white/[0.035]">
          <CardContent className="p-3 sm:p-4">
            <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_10rem_10rem]">
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search orders..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="h-11 rounded-xl pl-10"
                  />
                </div>
              </div>
              
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-11 w-full rounded-xl">
                  <ListFilter className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="processing">Processing</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                </SelectContent>
              </Select>
              
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="h-11 w-full rounded-xl">
                  <Tags className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                  <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {availableOrderCategories.map((category) => (
                    <SelectItem key={category} value={category}>{category}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Orders List */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
              <p>Loading your orders...</p>
            </div>
          </div>
        ) : filteredOrders.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <Package className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-semibold mb-2">No Orders Found</h3>
              <p className="text-muted-foreground mb-4">
                {orders.length === 0 
                  ? "You haven't made any purchases yet." 
                  : "No orders match your current filters."}
              </p>
              <Link to="/products">
                <Button>Browse Products</Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {filteredOrders.map((order) => {
              const StatusIcon = statusIcons[order.status as keyof typeof statusIcons]
              const { date, time } = formatDate(order.created_at)
              const productName = getOrderProductName(order)
              const platform = getOrderPlatform(order)
              const accounts = getOrderAccounts(order)
              const itemCount = accounts.length || order.account_details?.quantity || 1
              const firstAccount = accounts[0] || order.account_details || {}
              const previewName = firstAccount.username || firstAccount.email || 'Credentials ready'
              
              return (
                <Card key={order.id} className="overflow-hidden rounded-2xl border-slate-200 bg-white/90 shadow-sm dark:border-white/10 dark:bg-white/[0.035]">
                  <CardContent className="p-3 sm:p-4">
                    <div className="grid grid-cols-[2.6rem_minmax(0,1fr)] gap-3">
                      <div className="grid h-10 w-10 place-items-center rounded-2xl bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-200">
                        <Package className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-[11px] font-bold text-muted-foreground">#{order.id.slice(0, 8)} • {time}</p>
                            <h3 className="mt-0.5 line-clamp-2 text-sm font-black leading-5 text-slate-950 dark:text-white sm:text-base">
                              {productName}
                            </h3>
                          </div>
                          <Badge variant={statusColors[order.status as keyof typeof statusColors]} className="shrink-0 gap-1 px-2 py-1 text-[10px]">
                            <StatusIcon className="h-3 w-3" />
                            {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                          </Badge>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                          <div className="min-w-0 rounded-xl bg-slate-100 px-3 py-2 dark:bg-white/[0.06]">
                            <p className="text-muted-foreground">Amount</p>
                            <p className="truncate font-black text-slate-950 dark:text-white">{formatPrice(order.amount || 0)}</p>
                          </div>
                          <div className="min-w-0 rounded-xl bg-slate-100 px-3 py-2 dark:bg-white/[0.06]">
                            <p className="text-muted-foreground">Date</p>
                            <p className="truncate font-black text-slate-950 dark:text-white">{date}</p>
                          </div>
                          <div className="min-w-0 rounded-xl bg-slate-100 px-3 py-2 dark:bg-white/[0.06]">
                            <p className="text-muted-foreground">Platform</p>
                            <p className="truncate font-black text-slate-950 dark:text-white">{platform}</p>
                          </div>
                          <div className="min-w-0 rounded-xl bg-slate-100 px-3 py-2 dark:bg-white/[0.06]">
                            <p className="text-muted-foreground">Items</p>
                            <p className="truncate font-black text-slate-950 dark:text-white">{itemCount}</p>
                          </div>
                        </div>

                        <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-white/10 dark:bg-white/[0.035]">
                          <div className="min-w-0">
                            <p className="font-bold text-muted-foreground">Preview</p>
                            <p className="truncate font-black text-slate-950 dark:text-white">
                              {previewName.startsWith('@') ? previewName : `@${previewName}`}
                            </p>
                          </div>
                          <Badge variant="outline" className="shrink-0 text-[10px]">
                            {itemCount} {itemCount === 1 ? 'account' : 'accounts'}
                          </Badge>
                        </div>

                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => {
                            trackRevenueEvent({
                              eventType: 'PRODUCT_VIEWED',
                              userId: user?.id || null,
                              productGroupId: order.product_group_id || null,
                              categoryId: order.product_groups?.category_id || null,
                              surface: 'order_history_detail_opened',
                              metadata: {
                                order_id: order.id,
                                status: order.status,
                                has_credentials: getOrderAccounts(order).length > 0,
                              },
                            })
                            setSelectedOrder(order)
                          }}
                          className="mt-3 h-10 w-full rounded-xl font-black"
                        >
                          <ReceiptText className="mr-2 h-4 w-4" />
                          View Details
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
          </>
        )}
      </RevampPage>

      <Footer />
    </div>
  )
}
