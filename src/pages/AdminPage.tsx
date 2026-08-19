import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Settings,
  Plus,
  Upload,
  Users,
  ShoppingBag,
  TrendingUp,
  Edit,
  Trash2,
  Eye,
  DollarSign,
  Loader2,
  Search,
  Download,
  AlertTriangle,
  Mail,
  Send,
  XCircle,
  RefreshCw,
  CheckCircle2,
  Clock,
  ChevronDown,
  X,
  Tag,
  Shield,
  UserCheck,
  UserX,
  ToggleLeft,
  ToggleRight,
  Star,
  PhoneCall,
} from 'lucide-react'
import { PERMISSIONS, type PermissionKey } from '@/lib/staffPermissions'
import Navbar from '@/components/NavbarAuth'
import Footer from '@/components/Footer'
import AdminAlerts from '@/components/AdminAlerts'
import { 
  getCategories, 
  getAllProductGroups, 
  getIndividualAccounts,
  getIndividualAccountsCount,
  createCategory, 
  updateCategory, 
  deleteCategory,
  createProductGroup,
  updateProductGroup,
  deleteProductGroup,
  archiveProductGroup,
  restoreProductGroup,
  createIndividualAccount,
  deleteIndividualAccount,
  updateIndividualAccount,
  getUserCount,
  getAdminSalesStats,
  bulkCreateIndividualAccounts,
  parseCSV,
  createProductTemplate,
  processBulkAccountUpload,
  getAllUsers,
  searchUsers,
  getUserTransactions,
  getUserOrdersAdmin,
  adminAdjustBalance,
  getAppSetting,
  upsertAppSetting,
  getProductSuggestions,
  computeAndUpsertTrendSuggestions,
  dismissSuggestion,
  acceptSuggestion,
  manualRestock,
  getDiscountCodes,
  createDiscountCode,
  setDiscountCodeActive,
  type Category,
  type ProductGroup,
  type IndividualAccount,
  type ProductTemplate,
  type ProductSuggestion,
  type DiscountCode,
  supabase
} from '@/lib/supabase'
import { format, formatDistanceToNow } from 'date-fns'
import { useAuth } from '@/contexts/SimpleAuth'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

const ADMIN_TABS = [
  { value: 'templates', label: 'Templates' },
  { value: 'sms-products', label: 'SMS Products' },
  { value: 'products', label: 'Products' },
  { value: 'add-product', label: 'Add Product' },
  { value: 'bulk-upload', label: 'Bulk Upload' },
  { value: 'discount-codes', label: 'Discount Codes' },
  { value: 'categories', label: 'Categories' },
  { value: 'users', label: 'Users' },
  { value: 'email', label: 'Email' },
  { value: 'staff', label: 'Staff Roles' },
] as const

type AdminTabValue = (typeof ADMIN_TABS)[number]['value']
import { clearExchangeRateCache } from '@/hooks/useExchangeRate'
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table'
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'

type AdminSmsProduct = {
  service_id: string
  service_code: string
  service_name: string
  provider_cost_usd: number
  provider_cost_ngn: number
  margin_ngn: number
  exchange_rate: number
  price_ngn: number
  available_count: number
  customer_buy_count?: number
  recommended_score?: number
  is_enabled: boolean
  is_favorite: boolean
  price_override_ngn: number | null
  auto_markup_enabled: boolean
  pricing_mode: 'auto_markup' | 'manual_margin' | 'override'
}

type AdminSmsDiagnostics = {
  provider_host?: string
  provider_base_configured?: boolean
  configured?: boolean
  country_id?: number
  verification_ok?: boolean
  verification_services?: number
  verification_country_services?: number
  prices_ok?: boolean
  prices_services?: number
  prices_country_services?: number
  selected_source?: string
}

type AdminSmsCatalogResponse = {
  success: boolean
  data?: AdminSmsProduct[]
  error?: string
  configured?: boolean
  diagnostics?: AdminSmsDiagnostics | null
  global_margin_ngn?: number
  exchange_rate?: number
  exchange_rate_source?: 'override' | 'live' | 'fallback' | 'unknown'
  round_to_nearest_10?: boolean
}

// Mock admin stats
const mockStats = {
  totalUsers: 1247,
  totalProducts: 89,
  totalSales: 45,
  revenue: 285000,
  pendingOrders: 3,
  lowStock: 12
}

function AdminControlSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)

  return (
    <Card className="overflow-hidden rounded-2xl border-slate-200 bg-white/90 shadow-sm dark:border-white/10 dark:bg-card/90">
      <CardHeader className="p-0">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left md:cursor-default md:px-5"
        >
          <span className="min-w-0">
            <CardTitle className="truncate text-base md:text-lg">{title}</CardTitle>
            {description && (
              <span className="mt-1 hidden text-xs leading-5 text-muted-foreground md:block">
                {description}
              </span>
            )}
          </span>
          <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform md:hidden', open && 'rotate-180')} />
        </button>
      </CardHeader>
      <CardContent className={cn('space-y-4 px-4 pb-4 pt-0 md:block md:px-5 md:pb-5', open ? 'block' : 'hidden')}>
        {description && (
          <p className="text-xs leading-5 text-muted-foreground md:hidden">{description}</p>
        )}
        {children}
      </CardContent>
    </Card>
  )
}

export default function AdminPage() {
  const { user } = useAuth()
  const { toast } = useToast()

  // Real data state
  const [categories, setCategories] = useState<Category[]>([])
  const [productGroups, setProductGroups] = useState<ProductGroup[]>([])
  const [individualAccounts, setIndividualAccounts] = useState<IndividualAccount[]>([])
  const [individualAccountsCount, setIndividualAccountsCount] = useState<number>(0)
  const [userCount, setUserCount] = useState<number>(0)
  const [salesStats, setSalesStats] = useState({ totalSales: 0, totalRevenue: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // User management state
  const [users, setUsers] = useState<any[]>([])
  const [userSearchQuery, setUserSearchQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [selectedUser, setSelectedUser] = useState<any>(null)
  const [viewUserOpen, setViewUserOpen] = useState(false)
  const [adjustBalanceOpen, setAdjustBalanceOpen] = useState(false)
  const [adjustmentAmount, setAdjustmentAmount] = useState('')
  const [adjustmentReason, setAdjustmentReason] = useState('')
  const [adjustmentType, setAdjustmentType] = useState<'add' | 'subtract'>('add')
  const [userTransactions, setUserTransactions] = useState<any[]>([])
  const [userOrders, setUserOrders] = useState<any[]>([])
  const [isAdjusting, setIsAdjusting] = useState(false)

  // Referral commission setting
  const [referralCommissionPct, setReferralCommissionPct] = useState('5')
  const [savingReferralPct, setSavingReferralPct] = useState(false)
  const [loadingReferralPct, setLoadingReferralPct] = useState(true)

  // NGN/USD rate override setting
  const [ngnUsdRate, setNgnUsdRate] = useState('')
  const [savingNgnUsdRate, setSavingNgnUsdRate] = useState(false)
  const [loadingNgnUsdRate, setLoadingNgnUsdRate] = useState(true)

  // Ercas Pay gateway toggle
  const [ercasEnabled, setErcasEnabled] = useState(false)
  const [savingErcasEnabled, setSavingErcasEnabled] = useState(false)
  const [loadingErcasEnabled, setLoadingErcasEnabled] = useState(true)

  // Support links settings
  const [supportWhatsappUrl, setSupportWhatsappUrl] = useState('')
  const [supportTelegramUrl, setSupportTelegramUrl] = useState('')
  const [supportChannelUrl, setSupportChannelUrl] = useState('')
  const [supportPopupMessage, setSupportPopupMessage] = useState('')
  const [savingSupportLinks, setSavingSupportLinks] = useState(false)
  const [loadingSupportLinks, setLoadingSupportLinks] = useState(true)

  // Bitrefill gift card markup setting
  const [bitrefillMarkupPct, setBitrefillMarkupPct] = useState('0')
  const [savingBitrefillMarkup, setSavingBitrefillMarkup] = useState(false)
  const [loadingBitrefillMarkup, setLoadingBitrefillMarkup] = useState(true)

  // Bitrefill catalog curation (blocked products)
  const [bitrefillBlocklist, setBitrefillBlocklist] = useState<{ product_id: string; name: string }[]>([])
  const [loadingBitrefillBlocklist, setLoadingBitrefillBlocklist] = useState(true)
  const [savingBitrefillBlocklist, setSavingBitrefillBlocklist] = useState(false)
  const [bitrefillCurationQuery, setBitrefillCurationQuery] = useState('')
  const [bitrefillCurationResults, setBitrefillCurationResults] = useState<{ product_id: string; name: string }[]>([])
  const [bitrefillCurationSearching, setBitrefillCurationSearching] = useState(false)

  // UI state
  const [adminTab, setAdminTab] = useState<AdminTabValue>('templates')
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [newProduct, setNewProduct] = useState({
    title: '',
    category: '',
    price: '',
    username: '',
    password: '',
    email: '',
    description: ''
  })
  const [newCategory, setNewCategory] = useState({
    name: '',
    description: ''
  })
  const [newTemplate, setNewTemplate] = useState({
    productName: '',
    description: '',
    price: '',
    categoryId: ''
  })
  const [selectedTemplate, setSelectedTemplate] = useState<string>('')
  const [viewingAccount, setViewingAccount] = useState<IndividualAccount | null>(null)
  const [editingAccount, setEditingAccount] = useState<IndividualAccount | null>(null)
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [editingTemplate, setEditingTemplate] = useState<any | null>(null)

  // Product suggestions ("trending category" panel)
  const [productSuggestions, setProductSuggestions] = useState<ProductSuggestion[]>([])
  const [isCheckingTrends, setIsCheckingTrends] = useState(false)
  const [restockingId, setRestockingId] = useState<string | null>(null)
  const [restockQty, setRestockQty] = useState<Record<string, number>>({})

  // SMM Services management
  const [smmServices, setSmmServices] = useState<any[]>([])
  const [smmServicesLoading, setSmmServicesLoading] = useState(false)
  const [smmServicesQuery, setSmmServicesQuery] = useState('')
  const [smmTogglingId, setSmmTogglingId] = useState<number | null>(null)
  const [smmSyncing, setSmmSyncing] = useState(false)
  const [smmExpandedPlatforms, setSmmExpandedPlatforms] = useState<Set<string>>(new Set())

  // DaisySMS product catalog curation
  const [smsProducts, setSmsProducts] = useState<AdminSmsProduct[]>([])
  const [smsProductsLoading, setSmsProductsLoading] = useState(false)
  const [smsSavingKey, setSmsSavingKey] = useState<string | null>(null)
  const [smsSearchQuery, setSmsSearchQuery] = useState('')
  const [smsGlobalMargin, setSmsGlobalMargin] = useState('700')
  const [smsKeepAutoApply, setSmsKeepAutoApply] = useState(true)
  const [smsPriceInputs, setSmsPriceInputs] = useState<Record<string, string>>({})
  const [smsMarginInputs, setSmsMarginInputs] = useState<Record<string, string>>({})
  const [smsDiagnostics, setSmsDiagnostics] = useState<AdminSmsDiagnostics | null>(null)
  const [smsCatalogNotice, setSmsCatalogNotice] = useState('')
  const [smsExchangeRateSource, setSmsExchangeRateSource] = useState<'override' | 'live' | 'fallback' | 'unknown'>('unknown')
  const [smsRoundToNearestTen, setSmsRoundToNearestTen] = useState(false)

  // Email / Broadcast state
  const [emailSubject, setEmailSubject] = useState('TallyStore Notification')
  const [emailMessage, setEmailMessage] = useState('')
  const [emailRecipients, setEmailRecipients] = useState<string[]>([])
  const [emailRecipientInput, setEmailRecipientInput] = useState('')
  const [isSendingEmail, setIsSendingEmail] = useState(false)
  const [broadcastJobs, setBroadcastJobs] = useState<any[]>([])
  const [isBroadcasting, setIsBroadcasting] = useState(false)
  const [isDryRun, setIsDryRun] = useState(false)
  const [dryRunResult, setDryRunResult] = useState<any>(null)
  const [isLoadingJobs, setIsLoadingJobs] = useState(false)
  const broadcastPollRef = useRef<NodeJS.Timeout | null>(null)

  // Discount codes / flash sales state
  const [discountCodes, setDiscountCodes] = useState<DiscountCode[]>([])
  const [isLoadingCodes, setIsLoadingCodes] = useState(false)
  const [newCode, setNewCode] = useState('')
  const [newCodePercent, setNewCodePercent] = useState('10')
  const [newCodeScope, setNewCodeScope] = useState<'store' | 'category' | 'product'>('store')
  const [newCodeCategoryId, setNewCodeCategoryId] = useState('')
  const [newCodeProductGroupId, setNewCodeProductGroupId] = useState('')
  const [newCodeMaxUses, setNewCodeMaxUses] = useState('')
  const [newCodeExpiresAt, setNewCodeExpiresAt] = useState('')
  const [isCreatingCode, setIsCreatingCode] = useState(false)

  // ── Staff roles state ──────────────────────────────────────────────────
  const [staffUsers, setStaffUsers] = useState<any[]>([])
  const [staffSearchQuery, setStaffSearchQuery] = useState('')
  const [staffSearchResults, setStaffSearchResults] = useState<any[]>([])
  const [staffSearching, setStaffSearching] = useState(false)
  const [staffPermissionsMap, setStaffPermissionsMap] = useState<Record<string, Record<string, { is_enabled: boolean; auto_approve: boolean }>>>({})
  const [savingStaffPerm, setSavingStaffPerm] = useState<string | null>(null)
  const [pendingActions, setPendingActions] = useState<any[]>([])
  const [loadingPendingActions, setLoadingPendingActions] = useState(false)
  const [approvingAction, setApprovingAction] = useState<string | null>(null)
  const [expandedStaffUser, setExpandedStaffUser] = useState<string | null>(null)

  const loadDiscountCodes = useCallback(async () => {
    setIsLoadingCodes(true)
    try {
      const codes = await getDiscountCodes()
      setDiscountCodes(codes)
    } catch (err) {
      console.error('Failed to load discount codes:', err)
    } finally {
      setIsLoadingCodes(false)
    }
  }, [])

  useEffect(() => {
    loadDiscountCodes()
  }, [loadDiscountCodes])

  const handleCreateDiscountCode = async () => {
    if (!newCode.trim()) {
      toast({ variant: 'destructive', title: 'Error', description: 'Enter a code' })
      return
    }
    const pct = parseInt(newCodePercent, 10)
    if (!pct || pct < 1 || pct > 100) {
      toast({ variant: 'destructive', title: 'Error', description: 'Percent off must be between 1 and 100' })
      return
    }
    setIsCreatingCode(true)
    try {
      const result = await createDiscountCode({
        code: newCode.trim(),
        percent_off: pct,
        category_id: newCodeScope === 'category' ? (newCodeCategoryId || null) : null,
        product_group_id: newCodeScope === 'product' ? (newCodeProductGroupId || null) : null,
        max_uses: newCodeMaxUses ? parseInt(newCodeMaxUses, 10) : null,
        expires_at: newCodeExpiresAt ? new Date(newCodeExpiresAt).toISOString() : null,
      })
      if (result.success) {
        toast({ title: 'Discount code created', description: `${newCode.trim().toUpperCase()} is now active` })
        setNewCode('')
        setNewCodePercent('10')
        setNewCodeScope('store')
        setNewCodeCategoryId('')
        setNewCodeProductGroupId('')
        setNewCodeMaxUses('')
        setNewCodeExpiresAt('')
        await loadDiscountCodes()
      } else {
        toast({ variant: 'destructive', title: 'Error', description: result.error || 'Failed to create code' })
      }
    } catch (err) {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to create code' })
    } finally {
      setIsCreatingCode(false)
    }
  }

  const handleToggleCodeActive = async (id: string, isActive: boolean) => {
    const ok = await setDiscountCodeActive(id, isActive)
    if (ok) {
      setDiscountCodes(prev => prev.map(c => c.id === id ? { ...c, is_active: isActive } : c))
    } else {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to update code' })
    }
  }

  // ==================== EMAIL / BROADCAST HANDLERS ====================

  const loadBroadcastJobs = useCallback(async () => {
    try {
      setIsLoadingJobs(true)
      const { data, error } = await supabase.functions.invoke('email/broadcast-status', { method: 'GET' })
      if (error) throw error
      if (data?.success) setBroadcastJobs(data.jobs || [])
    } catch (err) {
      console.error('Failed to load broadcast jobs:', err)
    } finally {
      setIsLoadingJobs(false)
    }
  }, [])

  // Poll for active jobs
  useEffect(() => {
    const hasActive = broadcastJobs.some(j => j.status === 'queued' || j.status === 'processing')
    if (hasActive && !broadcastPollRef.current) {
      broadcastPollRef.current = setInterval(loadBroadcastJobs, 5000)
    } else if (!hasActive && broadcastPollRef.current) {
      clearInterval(broadcastPollRef.current)
      broadcastPollRef.current = null
    }
    return () => { if (broadcastPollRef.current) clearInterval(broadcastPollRef.current) }
  }, [broadcastJobs, loadBroadcastJobs])

  // ==================== SUPPORT LINKS SETTINGS ====================

  useEffect(() => {
    const loadSupportLinks = async () => {
      setLoadingSupportLinks(true)
      try {
        const [wa, tg, ch, pm] = await Promise.all([
          getAppSetting('support_whatsapp_url'),
          getAppSetting('support_telegram_url'),
          getAppSetting('support_channel_url'),
          getAppSetting('support_popup_message'),
        ])
        setSupportWhatsappUrl(wa || '')
        setSupportTelegramUrl(tg || '')
        setSupportChannelUrl(ch || '')
        setSupportPopupMessage(pm || '')
      } catch (err) {
        console.error('Failed to load support links:', err)
      } finally {
        setLoadingSupportLinks(false)
      }
    }
    loadSupportLinks()
  }, [])

  // ==================== REFERRAL SETTINGS ====================

  useEffect(() => {
    const loadReferralPct = async () => {
      setLoadingReferralPct(true)
      try {
        const value = await getAppSetting('referral_commission_pct')
        if (value) setReferralCommissionPct(value)
      } catch (err) {
        console.error('Failed to load referral commission %:', err)
      } finally {
        setLoadingReferralPct(false)
      }
    }
    loadReferralPct()
  }, [])

  // ==================== PRODUCT SUGGESTIONS ====================
  // "Trending category, want to add a product?" panel - trigger is your own
  // store's sales velocity (see computeAndUpsertTrendSuggestions). Accepting
  // a suggestion only creates a draft product; it never spends money by
  // itself - see handleTestStock for the explicit, separate buy action.

  const loadProductSuggestions = useCallback(async () => {
    try {
      const data = await getProductSuggestions('pending')
      setProductSuggestions(data)
    } catch (err) {
      console.error('Failed to load product suggestions:', err)
    }
  }, [])

  useEffect(() => {
    loadProductSuggestions()
  }, [loadProductSuggestions])

  const handleCheckTrends = async () => {
    setIsCheckingTrends(true)
    try {
      const created = await computeAndUpsertTrendSuggestions()
      await loadProductSuggestions()
      toast({
        title: created.length > 0 ? `${created.length} new trend(s) found` : 'No new trends',
        description: created.length > 0
          ? 'Check the Product Suggestions panel below.'
          : "Nothing crossed the trending threshold since the last check.",
      })
    } catch (err) {
      console.error('Failed to check trends:', err)
      toast({ title: 'Failed to check trends', variant: 'destructive' })
    } finally {
      setIsCheckingTrends(false)
    }
  }

  const handleDismissSuggestion = async (id: string) => {
    const ok = await dismissSuggestion(id)
    if (ok) {
      setProductSuggestions(prev => prev.filter(s => s.id !== id))
      toast({ title: 'Dismissed', description: "Won't resurface for a few days unless the trend continues." })
    }
  }

  const handleAcceptSuggestion = async (suggestion: ProductSuggestion) => {
    const newProduct = await acceptSuggestion(suggestion.id)
    if (newProduct) {
      setProductSuggestions(prev => prev.filter(s => s.id !== suggestion.id))
      const updatedProductGroups = await getAllProductGroups()
      setProductGroups(updatedProductGroups)
      setEditingTemplate(newProduct)
      toast({
        title: 'Draft product created',
        description: 'Fill in a provider ID below, then use "Test Stock" to buy a small batch.',
      })
    } else {
      toast({ title: 'Failed to create draft product', variant: 'destructive' })
    }
  }

  const handleTestStock = async (productGroupId: string) => {
    const quantity = restockQty[productGroupId] || 10
    setRestockingId(productGroupId)
    try {
      const result = await manualRestock(productGroupId, quantity)
      if (result.success) {
        const updatedProductGroups = await getAllProductGroups()
        setProductGroups(updatedProductGroups)
        toast({ title: `Bought ${result.bought} unit(s)`, description: 'Stock count updated.' })
      } else {
        toast({ title: 'Test stock purchase failed', description: result.error, variant: 'destructive' })
      }
    } catch (err) {
      console.error('Test stock purchase failed:', err)
      toast({ title: 'Test stock purchase failed', variant: 'destructive' })
    } finally {
      setRestockingId(null)
    }
  }

  const handleSaveSupportLinks = async () => {
    setSavingSupportLinks(true)
    try {
      await Promise.all([
        upsertAppSetting('support_whatsapp_url', supportWhatsappUrl.trim()),
        upsertAppSetting('support_telegram_url', supportTelegramUrl.trim()),
        upsertAppSetting('support_channel_url', supportChannelUrl.trim()),
        upsertAppSetting('support_popup_message', supportPopupMessage.trim()),
      ])
      // Bust the in-memory cache so changes take effect immediately
      const { invalidateSupportSettingsCache } = await import('@/hooks/useSupportSettings')
      invalidateSupportSettingsCache()
      toast({ title: 'Support links saved' })
    } catch (err) {
      toast({ title: 'Failed to save', variant: 'destructive' })
    } finally {
      setSavingSupportLinks(false)
    }
  }

  const handleSaveReferralPct = async () => {
    const pct = parseFloat(referralCommissionPct)
    if (isNaN(pct) || pct < 0 || pct > 100) {
      toast({ title: 'Invalid value', description: 'Enter a percentage between 0 and 100', variant: 'destructive' })
      return
    }
    setSavingReferralPct(true)
    try {
      const ok = await upsertAppSetting('referral_commission_pct', pct.toString())
      if (ok) {
        toast({ title: 'Saved', description: `Referral commission set to ${pct}%` })
      } else {
        toast({ title: 'Failed to save', description: 'Please try again', variant: 'destructive' })
      }
    } finally {
      setSavingReferralPct(false)
    }
  }

  // ==================== NGN/USD RATE SETTINGS ====================

  useEffect(() => {
    const loadRate = async () => {
      setLoadingNgnUsdRate(true)
      try {
        const value = await getAppSetting('ngn_usd_rate')
        if (value) setNgnUsdRate(value)
      } catch (err) {
        console.error('Failed to load NGN/USD rate override:', err)
      } finally {
        setLoadingNgnUsdRate(false)
      }
    }
    loadRate()
  }, [])

  const handleSaveNgnUsdRate = async () => {
    const rate = parseFloat(ngnUsdRate)
    if (isNaN(rate) || rate <= 0) {
      toast({ title: 'Invalid value', description: 'Enter a positive NGN-per-USD rate', variant: 'destructive' })
      return
    }
    setSavingNgnUsdRate(true)
    try {
      const ok = await upsertAppSetting('ngn_usd_rate', rate.toString())
      if (ok) {
        // useExchangeRate caches the rate in sessionStorage for an hour;
        // clear it so this browser picks up the new rate immediately
        // instead of appearing to do nothing until the cache expires.
        clearExchangeRateCache()
        toast({ title: 'Saved', description: `NGN/USD rate set to ₦${rate} per $1` })
      } else {
        toast({ title: 'Failed to save', description: 'Please try again', variant: 'destructive' })
      }
    } finally {
      setSavingNgnUsdRate(false)
    }
  }

  const handleClearNgnUsdRate = async () => {
    setSavingNgnUsdRate(true)
    try {
      const ok = await upsertAppSetting('ngn_usd_rate', '')
      if (ok) {
        clearExchangeRateCache()
        setNgnUsdRate('')
        toast({ title: 'Cleared', description: 'Now using the live exchange rate' })
      }
    } finally {
      setSavingNgnUsdRate(false)
    }
  }

  // ==================== ERCAS PAY TOGGLE ====================

  useEffect(() => {
    const loadErcasEnabled = async () => {
      setLoadingErcasEnabled(true)
      try {
        const value = await getAppSetting('ercas_enabled')
        setErcasEnabled(value === 'true')
      } catch (err) {
        console.error('Failed to load ercas_enabled:', err)
      } finally {
        setLoadingErcasEnabled(false)
      }
    }
    loadErcasEnabled()
  }, [])

  const handleToggleErcas = async () => {
    setSavingErcasEnabled(true)
    const next = !ercasEnabled
    try {
      const ok = await upsertAppSetting('ercas_enabled', next ? 'true' : 'false')
      if (ok) {
        setErcasEnabled(next)
        toast({ title: next ? 'Ercas Pay enabled' : 'Ercas Pay disabled', description: next ? 'Customers can now top up via Ercas Pay.' : 'Only PocketFi is shown to customers.' })
      } else {
        toast({ title: 'Failed to save', description: 'Please try again', variant: 'destructive' })
      }
    } catch (err) {
      toast({ title: 'Error', description: 'Could not save setting', variant: 'destructive' })
    } finally {
      setSavingErcasEnabled(false)
    }
  }

  // ==================== STAFF ROLES MANAGEMENT ====================

  const loadStaffUsers = useCallback(async () => {
    const { data } = await supabase
      .from('profiles')
      .select('id, email, is_staff, wallet_balance')
      .eq('is_staff', true)
    setStaffUsers(data || [])
  }, [])

  useEffect(() => { loadStaffUsers() }, [loadStaffUsers])

  const loadPendingActions = useCallback(async () => {
    setLoadingPendingActions(true)
    const { data } = await supabase
      .from('staff_pending_actions')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
    setPendingActions(data || [])
    setLoadingPendingActions(false)
  }, [])

  useEffect(() => { loadPendingActions() }, [loadPendingActions])

  const loadStaffPermsForUser = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from('staff_permissions')
      .select('permission_key, is_enabled, auto_approve')
      .eq('user_id', userId)
    const map: Record<string, { is_enabled: boolean; auto_approve: boolean }> = {}
    for (const row of data || []) map[row.permission_key] = { is_enabled: row.is_enabled, auto_approve: row.auto_approve }
    setStaffPermissionsMap(prev => ({ ...prev, [userId]: map }))
  }, [])

  const handleGrantStaff = async (userId: string) => {
    await supabase.from('profiles').update({ is_staff: true }).eq('id', userId)
    loadStaffUsers()
    setStaffSearchResults(prev => prev.map(u => u.id === userId ? { ...u, is_staff: true } : u))
    toast({ title: 'Staff role granted' })
  }

  const handleRevokeStaff = async (userId: string) => {
    await supabase.from('profiles').update({ is_staff: false }).eq('id', userId)
    loadStaffUsers()
    toast({ title: 'Staff role revoked' })
  }

  const handleToggleStaffPerm = async (
    userId: string,
    permKey: string,
    field: 'is_enabled' | 'auto_approve',
    value: boolean,
  ) => {
    setSavingStaffPerm(`${userId}-${permKey}-${field}`)
    const current = staffPermissionsMap[userId]?.[permKey] || { is_enabled: false, auto_approve: true }
    const updated = { ...current, [field]: value }
    await supabase
      .from('staff_permissions')
      .upsert({ user_id: userId, permission_key: permKey, ...updated }, { onConflict: 'user_id,permission_key' })
    setStaffPermissionsMap(prev => ({
      ...prev,
      [userId]: { ...prev[userId], [permKey]: updated },
    }))
    setSavingStaffPerm(null)
  }

  const handleSearchForStaff = async () => {
    if (!staffSearchQuery.trim()) return
    setStaffSearching(true)
    const results = await searchUsers(staffSearchQuery)
    setStaffSearchResults(results)
    setStaffSearching(false)
  }

  const handleApproveAction = async (action: any) => {
    setApprovingAction(action.id)
    try {
      if (action.action_type === 'upsert_setting') {
        const { setting_key, value } = action.action_data
        await upsertAppSetting(setting_key, value)
      } else if (action.action_type === 'upsert_settings') {
        const { settings } = action.action_data
        const entries = Object.entries(settings || {}) as [string, string][]
        const results = await Promise.all(entries.map(([key, value]) => upsertAppSetting(key, value)))
        if (results.some(ok => !ok)) throw new Error('Failed to update one or more settings')
        if (entries.some(([key]) => key.startsWith('support_'))) {
          const { invalidateSupportSettingsCache } = await import('@/hooks/useSupportSettings')
          invalidateSupportSettingsCache()
        }
      } else if (action.action_type === 'send_email_list') {
        const { subject, message, recipients } = action.action_data
        const html = buildEmailHtml(message || '')
        for (const to of recipients || []) {
          const { data, error } = await supabase.functions.invoke('email/send', { body: { to, subject, html } })
          if (error || !data?.success) throw new Error(data?.error || error?.message || `Failed to send email to ${to}`)
        }
      } else if (action.action_type === 'broadcast_email') {
        const { subject, message } = action.action_data
        const html = buildEmailHtml(message || '')
        const { data, error } = await supabase.functions.invoke('email/broadcast', { body: { subject, html } })
        if (error || !data?.success) throw new Error(data?.error || error?.message || 'Failed to queue broadcast')
      } else if (action.action_type === 'adjust_balance') {
        const { user_id, amount, reason } = action.action_data
        await adminAdjustBalance(user_id, amount, reason || 'Approved staff action', user?.email || 'admin')
      }
      await supabase
        .from('staff_pending_actions')
        .update({ status: 'approved', reviewed_at: new Date().toISOString(), reviewed_by: user?.id })
        .eq('id', action.id)
      toast({ title: 'Action approved and applied' })
      loadPendingActions()
    } catch {
      toast({ variant: 'destructive', title: 'Failed to apply action' })
    } finally {
      setApprovingAction(null)
    }
  }

  const handleRejectAction = async (actionId: string) => {
    await supabase
      .from('staff_pending_actions')
      .update({ status: 'rejected', reviewed_at: new Date().toISOString(), reviewed_by: user?.id })
      .eq('id', actionId)
    toast({ title: 'Action rejected' })
    loadPendingActions()
  }

  // ==================== SMM SERVICES MANAGEMENT ====================

  // Load ALL services (no limit) grouped by platform so admin can bulk-manage
  const loadSmmServices = useCallback(async (query: string) => {
    setSmmServicesLoading(true)
    try {
      let q = supabase
        .from('smm_services')
        .select('id, external_id, name, platform, price_ngn, is_active')
        .order('platform')
        .order('name')
      if (query.trim()) q = q.ilike('name', `%${query.trim()}%`)
      const { data, error } = await q
      if (error) throw error
      setSmmServices(data || [])
    } catch (err) {
      toast({ title: 'Failed to load services', variant: 'destructive' })
    } finally {
      setSmmServicesLoading(false)
    }
  }, [])

  const handleToggleSmmService = async (id: number, currentlyActive: boolean) => {
    setSmmTogglingId(id)
    try {
      const { error } = await supabase.from('smm_services').update({ is_active: !currentlyActive }).eq('id', id)
      if (error) throw error
      setSmmServices(prev => prev.map(s => s.id === id ? { ...s, is_active: !currentlyActive } : s))
    } catch (err) {
      toast({ title: 'Failed to update service', variant: 'destructive' })
    } finally {
      setSmmTogglingId(null)
    }
  }

  // Bulk toggle all services for a platform (or all platforms when platform='')
  const handleBulkTogglePlatform = async (platform: string, makeActive: boolean) => {
    setSmmServicesLoading(true)
    try {
      let q = supabase.from('smm_services').update({ is_active: makeActive })
      if (platform) q = (q as any).eq('platform', platform)
      const { error } = await q
      if (error) throw error
      setSmmServices(prev =>
        prev.map(s => (!platform || s.platform === platform) ? { ...s, is_active: makeActive } : s)
      )
      toast({ title: makeActive ? 'All shown' : 'All hidden', description: platform ? `${platform} services updated` : 'All services updated' })
    } catch (err) {
      toast({ title: 'Bulk update failed', variant: 'destructive' })
    } finally {
      setSmmServicesLoading(false)
    }
  }

  const handleSmmSync = async () => {
    setSmmSyncing(true)
    try {
      const { data, error } = await supabase.functions.invoke('smm-sync-services')
      if (error) throw error
      toast({ title: 'Sync complete', description: `${data?.stats?.processed || 0} services updated` })
      loadSmmServices(smmServicesQuery)
    } catch (err: any) {
      toast({ title: 'Sync failed', description: err.message, variant: 'destructive' })
    } finally {
      setSmmSyncing(false)
    }
  }

  // ==================== DAISYSMS PRODUCT CATALOG ====================

  const loadSmsProducts = useCallback(async () => {
    setSmsProductsLoading(true)
    try {
      const { data, error } = await supabase.functions.invoke<AdminSmsCatalogResponse>('smsbus', {
        body: { action: 'admin_sms_products' },
      })
      if (error) throw error
      if (!data?.success) throw new Error(data?.error || 'Failed to load SMS products')
      const products = data.data || []
      const diagnostics = data.diagnostics || null
      setSmsProducts(products)
      setSmsDiagnostics(diagnostics)
      setSmsExchangeRateSource(data.exchange_rate_source || 'unknown')
      setSmsRoundToNearestTen(data.round_to_nearest_10 === true)
      if (data.configured === false || diagnostics?.configured === false) {
        setSmsCatalogNotice('DaisySMS API key is not configured on the deployed smsbus function.')
      } else if (products.length === 0) {
        const verification = diagnostics?.verification_services ?? 0
        const verificationCountry = diagnostics?.verification_country_services ?? 0
        const prices = diagnostics?.prices_services ?? 0
        const pricesCountry = diagnostics?.prices_country_services ?? 0
        setSmsCatalogNotice(`Daisy returned 0 USA products. Verification ${verification}/${verificationCountry}; prices ${prices}/${pricesCountry}; source ${diagnostics?.selected_source || 'none'}.`)
      } else {
        setSmsCatalogNotice('')
      }
      if (typeof data.global_margin_ngn === 'number') setSmsGlobalMargin(String(data.global_margin_ngn))
      setSmsPriceInputs(Object.fromEntries(products.map((product) => [
        product.service_code,
        product.price_override_ngn === null || product.price_override_ngn === undefined ? '' : String(product.price_override_ngn),
      ])))
      setSmsMarginInputs(Object.fromEntries(products.map((product) => [
        product.service_code,
        String(product.margin_ngn ?? data.global_margin_ngn ?? 700),
      ])))
    } catch (err: any) {
      toast({
        title: 'Failed to load SMS products',
        description: err.message || 'Run the SMS product settings migration, then try again.',
        variant: 'destructive',
      })
      setSmsCatalogNotice(err.message || 'Failed to load SMS products.')
    } finally {
      setSmsProductsLoading(false)
    }
  }, [toast])

  useEffect(() => {
    loadSmsProducts()
  }, [loadSmsProducts])

  const updateSmsProduct = async (serviceCode: string, updates: Record<string, unknown>, reload = false) => {
    setSmsSavingKey(`${serviceCode}-${Object.keys(updates).join('-')}`)
    try {
      const product = smsProducts.find((item) => item.service_code === serviceCode)
      const { data, error } = await supabase.functions.invoke<{ success: boolean; error?: string }>('smsbus', {
        body: {
          action: 'admin_update_sms_product',
          service_code: serviceCode,
          service_name: product?.service_name,
          ...updates,
        },
      })
      if (error) throw error
      if (!data?.success) throw new Error(data?.error || 'Failed to update SMS product')
      setSmsProducts(prev => prev.map(item => item.service_code === serviceCode ? { ...item, ...updates } as AdminSmsProduct : item))
      if (reload) await loadSmsProducts()
    } catch (err: any) {
      toast({ title: 'SMS product update failed', description: err.message || 'Please try again', variant: 'destructive' })
    } finally {
      setSmsSavingKey(null)
    }
  }

  const saveSmsPriceOverride = async (product: AdminSmsProduct) => {
    const raw = smsPriceInputs[product.service_code] ?? ''
    const value = raw.trim() === '' ? null : Number(raw)
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      toast({ title: 'Invalid price', description: 'Enter a valid naira amount or leave it blank.', variant: 'destructive' })
      return
    }
    await updateSmsProduct(product.service_code, { price_override_ngn: value === null ? null : Math.round(value) }, true)
    toast({ title: value === null ? 'Override cleared' : 'Price override saved' })
  }

  const saveSmsMargin = async (product: AdminSmsProduct) => {
    const value = Number(smsMarginInputs[product.service_code] ?? '')
    if (!Number.isFinite(value) || value < 0) {
      toast({ title: 'Invalid markup', description: 'Enter a valid naira markup.', variant: 'destructive' })
      return
    }
    await updateSmsProduct(product.service_code, { margin_ngn: Math.round(value), auto_markup_enabled: true }, true)
    toast({ title: 'Product markup saved' })
  }

  const applySmsGlobalMarkup = async () => {
    const margin = Number(smsGlobalMargin)
    if (!Number.isFinite(margin) || margin < 0) {
      toast({ title: 'Invalid markup', description: 'Enter a valid naira markup.', variant: 'destructive' })
      return
    }
    setSmsSavingKey('global-markup')
    try {
      const { data, error } = await supabase.functions.invoke<{ success: boolean; error?: string; count?: number }>('smsbus', {
        body: { action: 'admin_apply_sms_markup', margin_ngn: Math.round(margin), keep_auto_applying: smsKeepAutoApply },
      })
      if (error) throw error
      if (!data?.success) throw new Error(data?.error || 'Failed to apply markup')
      await loadSmsProducts()
      toast({ title: 'SMS markup applied', description: `${data.count || 0} product(s) updated.` })
    } catch (err: any) {
      toast({ title: 'Markup failed', description: err.message || 'Please try again', variant: 'destructive' })
    } finally {
      setSmsSavingKey(null)
    }
  }

  const toggleSmsRounding = async () => {
    const next = !smsRoundToNearestTen
    setSmsSavingKey('round-to-10')
    try {
      const { data, error } = await supabase.functions.invoke<{ success: boolean; error?: string; round_to_nearest_10?: boolean }>('smsbus', {
        body: { action: 'admin_set_sms_rounding', round_to_nearest_10: next },
      })
      if (error) throw error
      if (!data?.success) throw new Error(data?.error || 'Failed to update rounding')
      setSmsRoundToNearestTen(next)
      await loadSmsProducts()
      toast({
        title: next ? 'SMS rounding enabled' : 'SMS rounding disabled',
        description: next ? 'Auto-markup prices now round up to the next 10.' : 'Auto-markup prices now use the exact naira calculation.',
      })
    } catch (err: any) {
      toast({ title: 'Rounding update failed', description: err.message || 'Please try again', variant: 'destructive' })
    } finally {
      setSmsSavingKey(null)
    }
  }

  const bulkToggleSmsProducts = async (isEnabled: boolean) => {
    setSmsSavingKey(isEnabled ? 'enable-all' : 'disable-all')
    try {
      const { data, error } = await supabase.functions.invoke<{ success: boolean; error?: string; count?: number }>('smsbus', {
        body: { action: 'admin_bulk_sms_products', is_enabled: isEnabled },
      })
      if (error) throw error
      if (!data?.success) throw new Error(data?.error || 'Failed to update products')
      await loadSmsProducts()
      toast({ title: isEnabled ? 'SMS products enabled' : 'SMS products disabled', description: `${data.count || 0} product(s) updated.` })
    } catch (err: any) {
      toast({ title: 'Bulk update failed', description: err.message || 'Please try again', variant: 'destructive' })
    } finally {
      setSmsSavingKey(null)
    }
  }

  const filteredSmsProducts = useMemo(() => {
    const query = smsSearchQuery.trim().toLowerCase()
    return smsProducts
      .filter((product) => {
        if (!query) return true
        return [product.service_name, product.service_code, product.price_ngn, product.available_count]
          .some((value) => String(value || '').toLowerCase().includes(query))
      })
      .sort((a, b) => Number(b.is_favorite) - Number(a.is_favorite) || a.service_name.localeCompare(b.service_name))
  }, [smsProducts, smsSearchQuery])

  const favoriteSmsProducts = useMemo(
    () => filteredSmsProducts.filter((product) => product.is_favorite),
    [filteredSmsProducts],
  )

  const renderSmsProductRow = (product: AdminSmsProduct) => {
    const rowSaving = smsSavingKey?.startsWith(product.service_code)
    return (
      <div key={product.service_code} className="grid gap-4 border-b py-4 last:border-b-0 lg:grid-cols-[minmax(180px,1.3fr)_220px_minmax(240px,1fr)_90px] lg:items-center">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              title={product.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
              disabled={rowSaving}
              onClick={() => updateSmsProduct(product.service_code, { is_favorite: !product.is_favorite })}
            >
              <Star className={`h-4 w-4 ${product.is_favorite ? 'fill-yellow-400 text-yellow-500' : 'text-muted-foreground'}`} />
            </Button>
            <div className="min-w-0">
              <p className="truncate font-semibold">{product.service_name}</p>
              <p className="text-xs text-muted-foreground">
                {product.available_count.toLocaleString()} available · {Number(product.customer_buy_count || 0).toLocaleString()} buys · {product.service_code}
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 pl-10">
            <Switch
              checked={product.auto_markup_enabled}
              disabled={rowSaving}
              onCheckedChange={(checked) => updateSmsProduct(product.service_code, { auto_markup_enabled: checked }, true)}
            />
            <span className="text-sm text-muted-foreground">Auto-markup</span>
            <Input
              type="number"
              min="0"
              className="h-9 w-28"
              value={smsMarginInputs[product.service_code] ?? ''}
              onChange={(event) => setSmsMarginInputs(prev => ({ ...prev, [product.service_code]: event.target.value }))}
            />
            <Button type="button" variant="outline" size="sm" disabled={rowSaving} onClick={() => saveSmsMargin(product)}>
              Save margin
            </Button>
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase text-muted-foreground">DaisySMS cost</p>
          <p className="font-bold">${Number(product.provider_cost_usd || 0).toFixed(2)}</p>
          <p className="text-xs text-muted-foreground">
            NGN {Number(product.provider_cost_ngn || 0).toLocaleString()} at {Number(product.exchange_rate || 0).toLocaleString()} / USD
          </p>
        </div>

        <div className="flex min-w-0 items-center gap-2">
          <Input
            type="number"
            min="0"
            placeholder={`Auto NGN ${Number(product.price_ngn || 0).toLocaleString()}`}
            value={smsPriceInputs[product.service_code] ?? ''}
            onChange={(event) => setSmsPriceInputs(prev => ({ ...prev, [product.service_code]: event.target.value }))}
          />
          <Button type="button" variant="outline" disabled={rowSaving} onClick={() => saveSmsPriceOverride(product)}>
            {rowSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
          </Button>
        </div>

        <div className="flex items-center justify-between gap-2 lg:justify-end">
          <Badge variant={product.pricing_mode === 'override' ? 'default' : 'secondary'} className="whitespace-nowrap">
            NGN {Number(product.price_ngn || 0).toLocaleString()}
          </Badge>
          <Switch
            checked={product.is_enabled}
            disabled={rowSaving}
            onCheckedChange={(checked) => updateSmsProduct(product.service_code, { is_enabled: checked })}
          />
        </div>
      </div>
    )
  }

  // ==================== BITREFILL GIFT CARD SETTINGS ====================

  useEffect(() => {
    const loadBitrefillMarkup = async () => {
      setLoadingBitrefillMarkup(true)
      try {
        const value = await getAppSetting('bitrefill_markup_pct')
        if (value) setBitrefillMarkupPct(value)
      } catch (err) {
        console.error('Failed to load Bitrefill markup %:', err)
      } finally {
        setLoadingBitrefillMarkup(false)
      }
    }
    const loadBitrefillBlocklist = async () => {
      setLoadingBitrefillBlocklist(true)
      try {
        const value = await getAppSetting('bitrefill_blocked_products')
        if (value) {
          const parsed = JSON.parse(value)
          if (Array.isArray(parsed)) setBitrefillBlocklist(parsed)
        }
      } catch (err) {
        console.error('Failed to load Bitrefill blocklist:', err)
      } finally {
        setLoadingBitrefillBlocklist(false)
      }
    }
    loadBitrefillMarkup()
    loadBitrefillBlocklist()
  }, [])

  const handleSaveBitrefillMarkup = async () => {
    const pct = parseFloat(bitrefillMarkupPct)
    if (isNaN(pct) || pct < 0) {
      toast({ title: 'Invalid value', description: 'Enter a percentage of 0 or more', variant: 'destructive' })
      return
    }
    setSavingBitrefillMarkup(true)
    try {
      const ok = await upsertAppSetting('bitrefill_markup_pct', pct.toString())
      if (ok) {
        toast({ title: 'Saved', description: `Gift card markup set to ${pct}%` })
      } else {
        toast({ title: 'Failed to save', description: 'Please try again', variant: 'destructive' })
      }
    } finally {
      setSavingBitrefillMarkup(false)
    }
  }

  const handleBitrefillCurationSearch = async () => {
    if (!bitrefillCurationQuery.trim()) return
    setBitrefillCurationSearching(true)
    setBitrefillCurationResults([])
    try {
      const { data, error } = await supabase.functions.invoke('bitrefill-catalog', {
        body: { action: 'search', query: bitrefillCurationQuery, limit: 24 },
      })
      if (error) throw error
      if (!data?.success) throw new Error(data?.error || 'Search failed')
      const products = (data.data?.data || []) as { product_id: string; name: string }[]
      setBitrefillCurationResults(products)
    } catch (err: any) {
      toast({ title: 'Search failed', description: err.message || 'Please try again', variant: 'destructive' })
    } finally {
      setBitrefillCurationSearching(false)
    }
  }

  const saveBitrefillBlocklist = async (next: { product_id: string; name: string }[]) => {
    setSavingBitrefillBlocklist(true)
    try {
      const ok = await upsertAppSetting('bitrefill_blocked_products', JSON.stringify(next))
      if (ok) {
        setBitrefillBlocklist(next)
      } else {
        toast({ title: 'Failed to save', description: 'Please try again', variant: 'destructive' })
      }
    } finally {
      setSavingBitrefillBlocklist(false)
    }
  }

  const handleBlockBitrefillProduct = (product: { product_id: string; name: string }) => {
    if (bitrefillBlocklist.some(p => p.product_id === product.product_id)) return
    saveBitrefillBlocklist([...bitrefillBlocklist, product])
  }

  const handleUnblockBitrefillProduct = (productId: string) => {
    saveBitrefillBlocklist(bitrefillBlocklist.filter(p => p.product_id !== productId))
  }

  const buildEmailHtml = (message: string) =>
    `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <div style="background:linear-gradient(135deg,#7c3aed,#3b82f6);padding:24px;border-radius:12px;color:white;text-align:center;margin-bottom:24px">
        <h1 style="margin:0;font-size:24px">TallyStore</h1>
      </div>
      <div style="padding:16px;line-height:1.6;color:#333">
        ${message.replace(/\n/g, '<br/>')}
      </div>
      <div style="text-align:center;margin-top:24px">
        <a href="https://tallystore.org/dashboard" style="background:linear-gradient(135deg,#7c3aed,#3b82f6);color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">Go to Wallet</a>
      </div>
      <div style="text-align:center;margin-top:32px;color:#999;font-size:12px"><p>TallyStore — Your trusted digital marketplace</p></div>
    </div>`

  const addEmailRecipient = () => {
    const email = emailRecipientInput.trim().toLowerCase()
    if (!email) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({ title: 'Invalid email', description: 'Please enter a valid email address', variant: 'destructive' })
      return
    }
    if (emailRecipients.includes(email)) {
      toast({ title: 'Duplicate', description: 'This email is already in the list', variant: 'destructive' })
      return
    }
    setEmailRecipients(prev => [...prev, email])
    setEmailRecipientInput('')
  }

  const handleSendToList = async () => {
    if (emailRecipients.length === 0 || !emailMessage.trim()) {
      toast({ title: 'Missing info', description: 'Add recipients and a message', variant: 'destructive' })
      return
    }
    setIsSendingEmail(true)
    const html = buildEmailHtml(emailMessage)
    let sentCount = 0
    let failCount = 0
    for (const to of emailRecipients) {
      try {
        const { data, error } = await supabase.functions.invoke('email/send', { body: { to, subject: emailSubject, html } })
        if (error || !data?.success) failCount++
        else sentCount++
      } catch { failCount++ }
    }
    setIsSendingEmail(false)
    toast({ title: 'Done', description: `Sent: ${sentCount}, Failed: ${failCount}` })
    if (sentCount > 0) { setEmailRecipients([]); setEmailMessage('') }
  }

  const handleBroadcast = async () => {
    if (!emailMessage.trim()) {
      toast({ title: 'Missing message', description: 'Write a message before broadcasting', variant: 'destructive' })
      return
    }
    const html = buildEmailHtml(emailMessage)

    if (isDryRun) {
      setIsBroadcasting(true)
      try {
        const { data, error } = await supabase.functions.invoke('email/broadcast', { body: { subject: emailSubject, html, dryRun: true } })
        if (error) throw error
        setDryRunResult(data)
      } catch (err: any) {
        toast({ title: 'Dry run failed', description: err.message, variant: 'destructive' })
      } finally {
        setIsBroadcasting(false)
      }
      return
    }

    if (!confirm(`This will email ALL registered users. The emails will be sent automatically in the background — you can close this page. Continue?`)) return
    setIsBroadcasting(true)
    try {
      const { data, error } = await supabase.functions.invoke('email/broadcast', { body: { subject: emailSubject, html } })
      if (error) throw error
      toast({ title: 'Broadcast queued!', description: data?.message || 'Processing will start within 1 minute.' })
      setEmailMessage('')
      setDryRunResult(null)
      await loadBroadcastJobs()
    } catch (err: any) {
      toast({ title: 'Broadcast failed', description: err.message, variant: 'destructive' })
    } finally {
      setIsBroadcasting(false)
    }
  }

  const handleCancelBroadcast = async (jobId: string) => {
    if (!confirm('Cancel this broadcast? Emails already sent cannot be undone.')) return
    try {
      const { data, error } = await supabase.functions.invoke('email/cancel-broadcast', { body: { jobId } })
      if (error) throw error
      toast({ title: 'Cancelled', description: 'Broadcast job cancelled.' })
      await loadBroadcastJobs()
    } catch (err: any) {
      toast({ title: 'Cancel failed', description: err.message, variant: 'destructive' })
    }
  }

  const getJobStatusBadge = (status: string) => {
    switch (status) {
      case 'queued': return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200"><Clock className="h-3 w-3 mr-1" /> Queued</Badge>
      case 'processing': return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200"><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Processing</Badge>
      case 'completed': return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200"><CheckCircle2 className="h-3 w-3 mr-1" /> Completed</Badge>
      case 'cancelled': return <Badge variant="outline" className="bg-gray-50 text-gray-500 border-gray-200"><XCircle className="h-3 w-3 mr-1" /> Cancelled</Badge>
      case 'failed': return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" /> Failed</Badge>
      default: return <Badge variant="outline">{status}</Badge>
    }
  }

  // Load real data
  useEffect(() => {
    loadAllData()
    loadBroadcastJobs()
  }, [])

  const loadAllData = async () => {
    try {
      setLoading(true)
      setError(null)

      const [categoriesData, productGroupsData, accountsData, accountsCountData, userCountData, salesStatsData] = await Promise.all([
        getCategories(),
        getAllProductGroups(),
        getIndividualAccounts(),
        getIndividualAccountsCount(),
        getUserCount(),
        getAdminSalesStats()
      ])

      setCategories(categoriesData)
      setProductGroups(productGroupsData)
      setIndividualAccounts(accountsData)
      setIndividualAccountsCount(accountsCountData)
      setUserCount(userCountData)
      setSalesStats(salesStatsData)

      console.log('✅ Admin data loaded:', {
        categories: categoriesData.length,
        productGroups: productGroupsData.length,
        accounts: accountsCountData,
        users: userCountData,
        sales: salesStatsData.totalSales,
        revenue: salesStatsData.totalRevenue
      })

    } catch (err) {
      console.error('❌ Error loading admin data:', err)
      setError('Failed to load admin data')
    } finally {
      setLoading(false)
    }
  }

  // Add new category
  const handleAddCategory = async () => {
    if (!newCategory.name) {
      alert('Please fill in category name')
      return
    }

    try {
      const category = await createCategory(
        newCategory.name.toLowerCase().replace(/\s+/g, '-'),
        newCategory.name,
        newCategory.description
      )

      if (category) {
        setCategories(prev => [...prev, category])
        setNewCategory({ name: '', description: '' })
        alert('Category created successfully!')
      }
    } catch (error) {
      console.error('Error creating category:', error)
      alert(`Failed to create category: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  // Delete category
  const handleDeleteCategory = async (categoryId: string) => {
    if (!confirm('Are you sure you want to delete this category?')) return

    try {
      const success = await deleteCategory(categoryId)
      if (success) {
        setCategories(prev => prev.filter(cat => cat.id !== categoryId))
        alert('Category deleted successfully!')
      }
    } catch (error) {
      console.error('Error deleting category:', error)
      alert('Failed to delete category')
    }
  }

  // Edit category
  const handleEditCategory = (category: Category) => {
    setEditingCategory(category)
  }

  // Update category
  const handleUpdateCategory = async (updatedCategory: Category) => {
    try {
      const success = await updateCategory(updatedCategory.id, {
        name: updatedCategory.name,
        description: updatedCategory.description
      })
      
      if (success) {
        setCategories(prev => 
          prev.map(cat => cat.id === updatedCategory.id ? updatedCategory : cat)
        )
        setEditingCategory(null)
        alert('Category updated successfully!')
      } else {
        alert('Failed to update category')
      }
    } catch (error) {
      console.error('Error updating category:', error)
      alert('Failed to update category')
    }
  }

  // View account details
  const handleViewAccount = (account: IndividualAccount) => {
    setViewingAccount(account)
  }

  // Edit account
  const handleEditAccount = (account: IndividualAccount) => {
    setEditingAccount(account)
  }

  // Delete account
  const handleDeleteAccount = async (accountId: string) => {
    if (!confirm('Are you sure you want to delete this account? This action cannot be undone.')) return

    try {
      const success = await deleteIndividualAccount(accountId)
      if (success) {
        setIndividualAccounts(prev => prev.filter(acc => acc.id !== accountId))
        // Reload product groups to update stock counts
        const updatedProductGroups = await getAllProductGroups()
        setProductGroups(updatedProductGroups)
        alert('Account deleted successfully!')
      } else {
        alert('Failed to delete account')
      }
    } catch (error) {
      console.error('Error deleting account:', error)
      alert('Failed to delete account')
    }
  }

  // Update account
  const handleUpdateAccount = async (updatedAccount: IndividualAccount) => {
    try {
      const result = await updateIndividualAccount(updatedAccount.id, {
        username: updatedAccount.username,
        password: updatedAccount.password,
        email: updatedAccount.email,
        email_password: updatedAccount.email_password,
        two_fa_code: updatedAccount.two_fa_code,
        status: updatedAccount.status,
        additional_info: updatedAccount.additional_info
      })

      if (result) {
        // Update local state with the updated account
        setIndividualAccounts(prev => 
          prev.map(acc => acc.id === result.id ? result : acc)
        )
        setEditingAccount(null)
        alert('Account updated successfully!')
      } else {
        alert('Failed to update account')
      }
    } catch (error) {
      console.error('Error updating account:', error)
      alert('Failed to update account')
    }
  }

  // Edit template
  const handleEditTemplate = (template: any) => {
    setEditingTemplate(template)
  }

  // Delete template
  const handleDeleteTemplate = async (templateId: string) => {
    if (!confirm('Are you sure you want to delete this product template? This action cannot be undone.')) return

    try {
      const success = await deleteProductGroup(templateId)
      if (success) {
        setProductGroups(prev => prev.filter(pg => pg.id !== templateId))
        alert('Product template deleted successfully!')
      } else {
        alert('Failed to delete product template. This template may have existing orders or accounts associated with it.')
      }
    } catch (error: any) {
      console.error('Error deleting product template:', error)
      const errorMessage = error?.message || 'Failed to delete product template'
      alert(errorMessage)
    }
  }

  // Archive template
  const handleArchiveTemplate = async (templateId: string) => {
    if (!confirm('Archive this product template? It will be hidden from customers but preserved for existing orders.')) return

    try {
      const success = await archiveProductGroup(templateId)
      if (success) {
        // Refresh the data to reflect the change
        const updatedGroups = await getAllProductGroups()
        setProductGroups(updatedGroups)
        alert('Product template archived successfully!')
      } else {
        alert('Failed to archive product template')
      }
    } catch (error: any) {
      console.error('Error archiving product template:', error)
      alert('Failed to archive product template')
    }
  }

  // Restore template
  const handleRestoreTemplate = async (templateId: string) => {
    if (!confirm('Restore this product template? It will be visible to customers again.')) return

    try {
      const success = await restoreProductGroup(templateId)
      if (success) {
        // Refresh the data to reflect the change
        const updatedGroups = await getAllProductGroups()
        setProductGroups(updatedGroups)
        alert('Product template restored successfully!')
      } else {
        alert('Failed to restore product template')
      }
    } catch (error: any) {
      console.error('Error restoring product template:', error)
      alert('Failed to restore product template')
    }
  }

  // Update template
  const handleUpdateTemplate = async (updatedTemplate: any) => {
    try {
      const result = await updateProductGroup(updatedTemplate.id, {
        name: updatedTemplate.name,
        description: updatedTemplate.description,
        price: updatedTemplate.price,
        category_id: updatedTemplate.category_id,
        muabanvia_product_id: updatedTemplate.muabanvia_product_id || null,
        auto_fulfill_enabled: !!updatedTemplate.auto_fulfill_enabled,
        shopclone_product_id: updatedTemplate.shopclone_product_id || null,
        shopviaclone_product_id: updatedTemplate.shopviaclone_product_id || null,
        auto_restock_enabled: !!updatedTemplate.auto_restock_enabled,
        restock_buffer_days: updatedTemplate.restock_buffer_days || 3,
        quantity_discount_tiers: Array.isArray(updatedTemplate.quantity_discount_tiers)
          ? updatedTemplate.quantity_discount_tiers.filter(
              (t: any) => t && t.min_qty > 0 && t.discount_pct > 0
            )
          : []
      })

      if (result) {
        // Update local state with the updated template
        setProductGroups(prev => 
          prev.map(pg => pg.id === result.id ? result : pg)
        )
        setEditingTemplate(null)
        alert('Product template updated successfully!')
      } else {
        alert('Failed to update product template')
      }
    } catch (error) {
      console.error('Error updating product template:', error)
      alert('Failed to update product template')
    }
  }

  // Handle CSV upload
  const handleCsvUpload = async () => {
    if (!csvFile) {
      alert('Please select a CSV file')
      return
    }

    if (!selectedTemplate) {
      alert('Please select a product template')
      return
    }

    try {
      const text = await csvFile.text()
      const csvData = parseCSV(text)

      if (csvData.length === 0) {
        alert('CSV file is empty or invalid')
        return
      }

      console.log('Processing CSV upload for template:', selectedTemplate)
      console.log('CSV data sample:', csvData[0])

      // Use the new bulk account upload function
      const result = await processBulkAccountUpload(csvData, selectedTemplate)

      if (result.success) {
        alert(`Successfully uploaded ${result.accountsCreated} accounts!`)
        
        // Reload data to show updated accounts and stock counts
        await loadAllData()
        
        // Reset form
        setCsvFile(null)
        setSelectedTemplate('')
      } else {
        alert(`Upload failed: ${result.error}`)
      }

    } catch (error) {
      console.error('Error processing CSV:', error)
      alert('Failed to process CSV file')
    }
  }

  // Handle creating a new product template
  const handleCreateTemplate = async () => {
    if (!newTemplate.productName || !newTemplate.categoryId || !newTemplate.price) {
      alert('Please fill in all required fields')
      return
    }

    try {
      const template: ProductTemplate = {
        productName: newTemplate.productName,
        description: newTemplate.description,
        price: parseFloat(newTemplate.price),
        categoryId: newTemplate.categoryId
      }

      const productGroup = await createProductTemplate(template)
      
      if (productGroup) {
        setProductGroups(prev => [...prev, productGroup])
        setNewTemplate({
          productName: '',
          description: '',
          price: '',
          categoryId: ''
        })
        alert('Product template created successfully!')
      } else {
        alert('Failed to create product template')
      }
    } catch (error) {
      console.error('Error creating product template:', error)
      alert('Failed to create product template')
    }
  }

  // Calculate stats from real data
  const stats = {
    totalUsers: userCount,
    totalProducts: individualAccountsCount,
    totalSales: salesStats.totalSales,
    revenue: salesStats.totalRevenue,
    pendingOrders: 0, // Add order tracking later
    lowStock: productGroups.filter(pg => pg.stock_count < 5).length
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background to-muted/20">
        <Navbar />
        <div className="container mx-auto px-6 py-32">
          <div className="flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin mr-3" />
            <span className="text-lg">Loading admin dashboard...</span>
          </div>
        </div>
        <Footer />
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background to-muted/20">
        <Navbar />
        <div className="container mx-auto px-6 py-32">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-red-600 mb-4">Error Loading Admin Data</h2>
            <p className="text-gray-600 mb-4">{error}</p>
            <Button onClick={loadAllData}>Retry</Button>
          </div>
        </div>
        <Footer />
      </div>
    )
  }

  const handleCsvFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    setCsvFile(file || null)
  }

  // ==================== USER MANAGEMENT HANDLERS ====================

  // Search users
  const handleSearchUsers = async () => {
    if (!userSearchQuery.trim()) {
      toast({
        title: "Search required",
        description: "Please enter an email or name to search",
        variant: "destructive"
      })
      return
    }

    try {
      setIsSearching(true)
      const results = await searchUsers(userSearchQuery)
      setUsers(results)
      toast({
        title: "Search complete",
        description: `Found ${results.length} user(s)`
      })
    } catch (error: any) {
      toast({
        title: "Search failed",
        description: error.message,
        variant: "destructive"
      })
    } finally {
      setIsSearching(false)
    }
  }

  // View user details
  const handleViewUser = async (user: any) => {
    try {
      setSelectedUser(user)
      
      // Load user transactions and orders
      const [transactions, orders] = await Promise.all([
        getUserTransactions(user.id),
        getUserOrdersAdmin(user.id)
      ])
      
      setUserTransactions(transactions)
      setUserOrders(orders)
      setViewUserOpen(true)
    } catch (error: any) {
      toast({
        title: "Error loading user details",
        description: error.message,
        variant: "destructive"
      })
    }
  }

  // Open balance adjustment modal
  const handleAdjustBalance = (user: any) => {
    setSelectedUser(user)
    setAdjustmentAmount('')
    setAdjustmentReason('')
    setAdjustmentType('add')
    setAdjustBalanceOpen(true)
  }

  // Submit balance adjustment
  const handleSubmitAdjustment = async () => {
    if (!adjustmentAmount || !adjustmentReason || !selectedUser) {
      toast({
        title: "Validation error",
        description: "Please fill in all fields",
        variant: "destructive"
      })
      return
    }

    const amount = parseFloat(adjustmentAmount)
    if (isNaN(amount) || amount === 0) {
      toast({
        title: "Invalid amount",
        description: "Please enter a valid amount",
        variant: "destructive"
      })
      return
    }

    // Calculate actual adjustment (negative for deduction)
    const adjustment = adjustmentType === 'add' ? amount : -amount

    try {
      setIsAdjusting(true)
      
      const result = await adminAdjustBalance(
        selectedUser.id,
        adjustment,
        adjustmentReason,
        user?.email || 'admin'
      )

      if (result.success) {
        // Update local user list
        setUsers(prev => prev.map(u => 
          u.id === selectedUser.id 
            ? { ...u, wallet_balance: result.newBalance }
            : u
        ))

        toast({
          title: "Balance adjusted successfully!",
          description: `New balance: ₦${result.newBalance.toLocaleString()}`
        })

        // Close modal and reset
        setAdjustBalanceOpen(false)
        setAdjustmentAmount('')
        setAdjustmentReason('')
        setSelectedUser(null)
      }
    } catch (error: any) {
      toast({
        title: "Adjustment failed",
        description: error.message,
        variant: "destructive"
      })
    } finally {
      setIsAdjusting(false)
    }
  }

  // Calculate new balance preview
  const calculateNewBalance = () => {
    if (!selectedUser || !adjustmentAmount) return '0'
    const current = selectedUser.wallet_balance || 0
    const amount = parseFloat(adjustmentAmount) || 0
    const adjustment = adjustmentType === 'add' ? amount : -amount
    return (current + adjustment).toLocaleString()
  }

  // Calculate total spent by user
  const calculateTotalSpent = (orders: any[]) => {
    return orders.reduce((sum, order) => sum + (order.amount || 0), 0).toLocaleString()
  }

  const handleAddProduct = async () => {
    if (!newProduct.title || !newProduct.category || !newProduct.price || !newProduct.username || !newProduct.password) {
      alert('Please fill in all required fields (title, category, price, username, password)')
      return
    }

    try {
      // Find the selected category by ID
      const category = categories.find(cat => cat.id === newProduct.category)

      if (!category) {
        alert('Selected category not found')
        return
      }

      // Find or create the product group
      let productGroup = productGroups.find(pg => 
        pg.category_id === category.id
      )

      if (!productGroup) {
        productGroup = await createProductGroup({
          category_id: category.id,
          name: `${category.name} - General`,
          description: newProduct.description || `${category.name} social media accounts`,
          price: parseFloat(newProduct.price),
          features: [],
          stock_count: 0,
          is_active: true
        })
        if (productGroup) {
          setProductGroups(prev => [...prev, productGroup])
        }
      }

      if (!productGroup) {
        alert('Failed to create or find product group')
        return
      }

      // Create the individual account
      const accountData = {
        product_group_id: productGroup.id,
        username: newProduct.username,
        password: newProduct.password,
        email: newProduct.email || '',
        email_password: '',
        two_fa_code: '',
        additional_info: null,
        status: 'available' as const
      }

      const createdAccount = await createIndividualAccount(accountData)
      
      if (createdAccount) {
        setIndividualAccounts(prev => [...prev, createdAccount])
        
        // Reload product groups to get updated stock counts
        const updatedProductGroups = await getAllProductGroups()
        setProductGroups(updatedProductGroups)
        
        // Reset form
        setNewProduct({
          title: '',
          category: '',
          price: '',
          username: '',
          password: '',
          email: '',
          description: ''
        })
        
        alert('Product added successfully!')
      } else {
        alert('Failed to create product')
      }
    } catch (error) {
      console.error('Error adding product:', error)
      alert('Failed to add product')
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted/20">
      <Navbar />
      
      {/* Add padding-top to account for fixed navbar */}
      <div className="pt-20 sm:pt-24">
        <div className="container mx-auto max-w-full overflow-x-hidden px-4 sm:px-6 py-6 sm:py-8">
          <div className="max-w-7xl mx-auto">
            {/* Header */}
            <div className="mb-6 sm:mb-8">
              <h1 className="text-2xl sm:text-3xl font-bold mb-2">Admin Workspace</h1>
              <p className="text-sm sm:text-base text-muted-foreground">
                Manage products, categories, and view analytics
              </p>
            </div>

            <section className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {/* Support Links Settings */}
              <AdminControlSection
                title="Support Links"
                description="Set your WhatsApp, Telegram, and channel URLs. Leave blank to hide a channel. Changes appear site-wide immediately."
              >
                {loadingSupportLinks ? (
                  <p className="text-sm text-muted-foreground">Loading...</p>
                ) : (
                  <>
                    <div>
                      <Label htmlFor="supportWhatsapp">WhatsApp support URL</Label>
                      <Input
                        id="supportWhatsapp"
                        placeholder="https://wa.me/234XXXXXXXXXX?text=..."
                        value={supportWhatsappUrl}
                        onChange={(e) => setSupportWhatsappUrl(e.target.value)}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="supportTelegram">Telegram support URL</Label>
                      <Input
                        id="supportTelegram"
                        placeholder="https://t.me/YourSupportHandle"
                        value={supportTelegramUrl}
                        onChange={(e) => setSupportTelegramUrl(e.target.value)}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="supportChannel">Join channel URL</Label>
                      <Input
                        id="supportChannel"
                        placeholder="https://t.me/YourChannel or WhatsApp channel link"
                        value={supportChannelUrl}
                        onChange={(e) => setSupportChannelUrl(e.target.value)}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="supportPopup">Login popup message</Label>
                      <textarea
                        id="supportPopup"
                        rows={3}
                        placeholder="Message shown in the login welcome popup..."
                        value={supportPopupMessage}
                        onChange={(e) => setSupportPopupMessage(e.target.value)}
                        className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      />
                    </div>
                    <Button onClick={handleSaveSupportLinks} disabled={savingSupportLinks}>
                      {savingSupportLinks ? 'Saving...' : 'Save support links'}
                    </Button>
                  </>
                )}
              </AdminControlSection>

            {/* Referral Settings */}
              <AdminControlSection title="Referral Settings">
                <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                  <div className="flex-1">
                    <Label htmlFor="referralPct">Commission % (per referred purchase)</Label>
                    <Input
                      id="referralPct"
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={referralCommissionPct}
                      onChange={(e) => setReferralCommissionPct(e.target.value)}
                      disabled={loadingReferralPct}
                    />
                  </div>
                  <Button onClick={handleSaveReferralPct} disabled={savingReferralPct || loadingReferralPct}>
                    {savingReferralPct ? 'Saving...' : 'Save'}
                  </Button>
                </div>
              </AdminControlSection>

            {/* NGN/USD Exchange Rate Settings */}
              <AdminControlSection title="Exchange Rate Settings">
                <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                  <div className="flex-1">
                    <Label htmlFor="ngnUsdRate">NGN per $1 (leave blank to use the live rate)</Label>
                    <Input
                      id="ngnUsdRate"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="e.g. 1600"
                      value={ngnUsdRate}
                      onChange={(e) => setNgnUsdRate(e.target.value)}
                      disabled={loadingNgnUsdRate}
                    />
                  </div>
                  <Button onClick={handleSaveNgnUsdRate} disabled={savingNgnUsdRate || loadingNgnUsdRate}>
                    {savingNgnUsdRate ? 'Saving...' : 'Save'}
                  </Button>
                  <Button variant="outline" onClick={handleClearNgnUsdRate} disabled={savingNgnUsdRate || loadingNgnUsdRate}>
                    Use Live Rate
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  When set, this overrides the live rate everywhere USD prices are shown to customers.
                </p>
              </AdminControlSection>

            {/* Ercas Pay Gateway Toggle */}
              <AdminControlSection title="Payment Gateways">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">Ercas Pay</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {ercasEnabled
                        ? 'Enabled — customers can choose Ercas Pay or PocketFi when topping up.'
                        : 'Disabled — customers see PocketFi (bank transfer) only.'}
                    </p>
                  </div>
                  <Button
                    variant={ercasEnabled ? 'default' : 'outline'}
                    size="sm"
                    onClick={handleToggleErcas}
                    disabled={loadingErcasEnabled || savingErcasEnabled}
                    className="min-w-[90px]"
                  >
                    {savingErcasEnabled ? 'Saving...' : ercasEnabled ? 'Enabled' : 'Disabled'}
                  </Button>
                </div>
              </AdminControlSection>

            {/* Bitrefill Gift Card Markup */}
              <AdminControlSection title="Gift Card Markup">
                <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                  <div className="flex-1">
                    <Label htmlFor="bitrefillMarkup">Markup % added on top of Bitrefill's price</Label>
                    <Input
                      id="bitrefillMarkup"
                      type="number"
                      min="0"
                      step="0.1"
                      placeholder="e.g. 5"
                      value={bitrefillMarkupPct}
                      onChange={(e) => setBitrefillMarkupPct(e.target.value)}
                      disabled={loadingBitrefillMarkup}
                    />
                  </div>
                  <Button onClick={handleSaveBitrefillMarkup} disabled={savingBitrefillMarkup || loadingBitrefillMarkup}>
                    {savingBitrefillMarkup ? 'Saving...' : 'Save'}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Currently 0% — customers are charged Bitrefill's raw NGN-converted price with no margin.
                  Set this above 0 to add your profit margin to every gift card purchase. Applied server-side
                  in purchase-bitrefill, and shown to customers on the Gift Cards page before they buy.
                </p>
              </AdminControlSection>

            {/* Bitrefill Catalog Curation */}
              <div className="md:col-span-2 xl:col-span-1">
                <AdminControlSection title="Gift Card Catalog Curation">
                <p className="text-xs text-muted-foreground">
                  Search Bitrefill's catalog and block specific brands you don't want customers to see.
                  Blocked products are filtered out everywhere the catalog is shown — nothing is deleted,
                  you can unblock anytime.
                </p>
                <div className="flex gap-2">
                  <Input
                    placeholder='Search a brand, e.g. "Amazon"'
                    value={bitrefillCurationQuery}
                    onChange={(e) => setBitrefillCurationQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleBitrefillCurationSearch()}
                  />
                  <Button onClick={handleBitrefillCurationSearch} disabled={bitrefillCurationSearching}>
                    {bitrefillCurationSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  </Button>
                </div>
                {bitrefillCurationResults.length > 0 && (
                  <div className="border rounded-lg divide-y max-h-60 overflow-y-auto">
                    {bitrefillCurationResults.map((p) => {
                      const blocked = bitrefillBlocklist.some(b => b.product_id === p.product_id)
                      return (
                        <div key={p.product_id} className="flex items-center justify-between px-3 py-2">
                          <span className="text-sm truncate">{p.name}</span>
                          {blocked ? (
                            <Badge variant="outline" className="text-xs">Blocked</Badge>
                          ) : (
                            <Button size="sm" variant="outline" disabled={savingBitrefillBlocklist} onClick={() => handleBlockBitrefillProduct(p)}>
                              Block
                            </Button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
                <div>
                  <p className="text-sm font-medium mb-2">
                    Currently blocked ({loadingBitrefillBlocklist ? '...' : bitrefillBlocklist.length})
                  </p>
                  {bitrefillBlocklist.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No products blocked — the full Bitrefill catalog is visible to customers.</p>
                  ) : (
                    <div className="border rounded-lg divide-y max-h-60 overflow-y-auto">
                      {bitrefillBlocklist.map((p) => (
                        <div key={p.product_id} className="flex items-center justify-between px-3 py-2">
                          <span className="text-sm truncate">{p.name}</span>
                          <Button size="sm" variant="ghost" disabled={savingBitrefillBlocklist} onClick={() => handleUnblockBitrefillProduct(p.product_id)}>
                            Unblock
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                </AdminControlSection>
              </div>

            {/* Social Boost Service Visibility */}
              <div className="md:col-span-2 xl:col-span-3">
                <AdminControlSection
                  title="Social Boost Service Visibility"
                  description="Hide entire platforms or individual services. Changes survive syncs."
                >
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="hidden md:block" />
                  <div className="flex gap-2 flex-wrap">
                    <Button size="sm" variant="outline" onClick={handleSmmSync} disabled={smmSyncing}>
                      {smmSyncing ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Syncing...</> : <><RefreshCw className="h-3 w-3 mr-1" />Sync Panel</>}
                    </Button>
                    {smmServices.length > 0 && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => handleBulkTogglePlatform('', true)} disabled={smmServicesLoading}>Show All</Button>
                        <Button size="sm" variant="destructive" onClick={() => handleBulkTogglePlatform('', false)} disabled={smmServicesLoading}>Hide All</Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-orange-300 text-orange-700 hover:bg-orange-50"
                          disabled={smmServicesLoading}
                          onClick={async () => {
                            const followerServices = smmServices.filter(s =>
                              s.name?.toLowerCase().includes('follow') || s.name?.toLowerCase().includes('follower')
                            )
                            for (const s of followerServices) {
                              if (s.is_active) await handleToggleSmmService(s.id, true)
                            }
                            toast({ title: `Blocked ${followerServices.length} followers services` })
                          }}
                        >
                          Block Followers
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                {/* Load / search */}
                <div className="flex gap-2">
                  <Input
                    placeholder='Filter by name, e.g. "followers" — leave blank to load all'
                    value={smmServicesQuery}
                    onChange={(e) => setSmmServicesQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && loadSmmServices(smmServicesQuery)}
                  />
                  <Button onClick={() => loadSmmServices(smmServicesQuery)} disabled={smmServicesLoading}>
                    {smmServicesLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  </Button>
                </div>

                {smmServices.length === 0 && !smmServicesLoading && (
                  <p className="text-xs text-muted-foreground">Click the search button (leave blank) to load all services.</p>
                )}

                {/* Grouped by platform */}
                {smmServices.length > 0 && (() => {
                  const grouped: Record<string, any[]> = {}
                  smmServices.forEach(s => {
                    const p = s.platform || 'other'
                    if (!grouped[p]) grouped[p] = []
                    grouped[p].push(s)
                  })
                  return Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([platform, services]) => {
                    const allVisible = services.every(s => s.is_active)
                    const allHidden = services.every(s => !s.is_active)
                    const isExpanded = smmExpandedPlatforms.has(platform)
                    return (
                      <div key={platform} className="border rounded-lg overflow-hidden">
                        {/* Platform header row */}
                        <div className="flex items-center justify-between px-3 py-2 bg-muted/40 gap-3">
                          <button
                            className="flex items-center gap-2 flex-1 text-left"
                            onClick={() => setSmmExpandedPlatforms(prev => {
                              const next = new Set(prev)
                              if (next.has(platform)) {
                                next.delete(platform)
                              } else {
                                next.add(platform)
                              }
                              return next
                            })}
                          >
                            <span className="font-medium capitalize text-sm">{platform}</span>
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">{services.length}</Badge>
                            <span className="text-xs text-muted-foreground">
                              {allVisible ? '● all visible' : allHidden ? '○ all hidden' : `${services.filter(s => s.is_active).length} visible`}
                            </span>
                            <span className="text-xs text-muted-foreground ml-auto">{isExpanded ? '▲' : '▼'}</span>
                          </button>
                          <div className="flex gap-1.5 shrink-0">
                            <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => handleBulkTogglePlatform(platform, true)} disabled={smmServicesLoading || allVisible}>Show all</Button>
                            <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => handleBulkTogglePlatform(platform, false)} disabled={smmServicesLoading || allHidden}>Hide all</Button>
                          </div>
                        </div>
                        {/* Individual services (collapsed by default) */}
                        {isExpanded && (
                          <div className="divide-y">
                            {services.map(svc => (
                              <div key={svc.id} className="flex items-center justify-between px-3 py-1.5 gap-3">
                                <p className="text-xs flex-1 truncate text-muted-foreground">{svc.name}</p>
                                <Button
                                  size="sm"
                                  variant={svc.is_active ? 'ghost' : 'outline'}
                                  onClick={() => handleToggleSmmService(svc.id, svc.is_active)}
                                  disabled={smmTogglingId === svc.id}
                                  className="h-6 text-xs px-2 shrink-0"
                                >
                                  {smmTogglingId === svc.id ? <Loader2 className="h-3 w-3 animate-spin" /> : svc.is_active ? 'Hide' : 'Show'}
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })
                })()}
                </AdminControlSection>
              </div>

            {/* Product Suggestions ("trending category" panel) */}
              <div className="md:col-span-2 xl:col-span-3">
                <AdminControlSection title="Product Suggestions">
                <div className="mb-3 flex justify-end">
                  <Button size="sm" onClick={handleCheckTrends} disabled={isCheckingTrends}>
                    {isCheckingTrends ? 'Checking...' : 'Check Trends'}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  Flags categories whose sales are growing fast in your own store and suggests
                  adding a new product based on your best template in that category. Accepting
                  never spends money by itself - it just creates a draft you can fill in and test.
                </p>
                {productSuggestions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No pending suggestions. Click "Check Trends" to scan recent sales.</p>
                ) : (
                  <div className="space-y-3">
                    {productSuggestions.map((s) => (
                      <div key={s.id} className="border rounded-lg p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div>
                          <p className="font-medium">{s.suggested_name}</p>
                          <p className="text-xs text-muted-foreground">{s.categories?.name ? `${s.categories.name} · ` : ''}{s.reason}</p>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => handleDismissSuggestion(s.id)}>
                            Not now
                          </Button>
                          <Button size="sm" onClick={() => handleAcceptSuggestion(s)}>
                            Add product
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                </AdminControlSection>
              </div>
            </section>

          {/* View Account Modal */}
          {viewingAccount && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white dark:bg-gray-800 rounded-lg p-4 sm:p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
                <h2 className="text-lg sm:text-xl font-bold mb-4">Account Details</h2>
                <div className="space-y-3 text-sm sm:text-base">
                  <div><strong>Username:</strong> @{viewingAccount.username}</div>
                  <div><strong>Password:</strong> {viewingAccount.password}</div>
                  {viewingAccount.email && <div><strong>Email:</strong> {viewingAccount.email}</div>}
                  {viewingAccount.email_password && <div><strong>Email Password:</strong> {viewingAccount.email_password}</div>}
                  {viewingAccount.two_fa_code && <div><strong>2FA Code:</strong> {viewingAccount.two_fa_code}</div>}
                  <div><strong>Status:</strong> <Badge variant={viewingAccount.status === 'available' ? 'default' : 'secondary'}>{viewingAccount.status}</Badge></div>
                  <div><strong>Created:</strong> {new Date(viewingAccount.created_at).toLocaleString()}</div>
                  {viewingAccount.additional_info && (
                    <div><strong>Additional Info:</strong> <pre className="text-xs bg-gray-100 dark:bg-gray-700 p-2 rounded mt-1">{JSON.stringify(viewingAccount.additional_info, null, 2)}</pre></div>
                  )}
                </div>
                <div className="flex gap-2 mt-6">
                  <Button onClick={() => setViewingAccount(null)} variant="outline" className="flex-1">
                    Close
                  </Button>
                  <Button onClick={() => {
                    setViewingAccount(null)
                    setEditingAccount(viewingAccount)
                  }} className="flex-1">
                    Edit
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Edit Category Modal */}
          {editingCategory && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white dark:bg-gray-800 rounded-lg p-4 sm:p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
                <h2 className="text-lg sm:text-xl font-bold mb-4">Edit Category</h2>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium block mb-1">Category Name</label>
                    <Input
                      value={editingCategory.name}
                      onChange={(e) => setEditingCategory({...editingCategory, name: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium block mb-1">Description</label>
                    <Input
                      value={editingCategory.description || ''}
                      onChange={(e) => setEditingCategory({...editingCategory, description: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium block mb-1">Status</label>
                    <Select 
                      value={editingCategory.is_active ? 'active' : 'inactive'} 
                      onValueChange={(value) => 
                        setEditingCategory({...editingCategory, is_active: value === 'active'})
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex gap-2 mt-6">
                  <Button onClick={() => setEditingCategory(null)} variant="outline" className="flex-1">
                    Cancel
                  </Button>
                  <Button onClick={() => handleUpdateCategory(editingCategory)} className="flex-1">
                    Save Changes
                  </Button>
                </div>
              </div>
            </div>
          )}
          {editingAccount && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white dark:bg-gray-800 rounded-lg p-4 sm:p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
                <h2 className="text-lg sm:text-xl font-bold mb-4">Edit Account</h2>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium block mb-1">Username</label>
                    <Input
                      value={editingAccount.username}
                      onChange={(e) => setEditingAccount({...editingAccount, username: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium block mb-1">Password</label>
                    <Input
                      value={editingAccount.password}
                      onChange={(e) => setEditingAccount({...editingAccount, password: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium block mb-1">Email</label>
                    <Input
                      value={editingAccount.email || ''}
                      onChange={(e) => setEditingAccount({...editingAccount, email: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium block mb-1">Email Password</label>
                    <Input
                      value={editingAccount.email_password || ''}
                      onChange={(e) => setEditingAccount({...editingAccount, email_password: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium block mb-1">2FA Code</label>
                    <Input
                      value={editingAccount.two_fa_code || ''}
                      onChange={(e) => setEditingAccount({...editingAccount, two_fa_code: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium block mb-1">Status</label>
                    <Select 
                      value={editingAccount.status} 
                      onValueChange={(value: 'available' | 'sold' | 'reserved') => 
                        setEditingAccount({...editingAccount, status: value})
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="available">Available</SelectItem>
                        <SelectItem value="reserved">Reserved</SelectItem>
                        <SelectItem value="sold">Sold</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex gap-2 mt-6">
                  <Button onClick={() => setEditingAccount(null)} variant="outline" className="flex-1">
                    Cancel
                  </Button>
                  <Button onClick={() => handleUpdateAccount(editingAccount)} className="flex-1">
                    Save Changes
                  </Button>
                </div>
              </div>
            </div>
          )}
          {editingTemplate && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white dark:bg-gray-800 rounded-lg p-4 sm:p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
                <h2 className="text-lg sm:text-xl font-bold mb-4">Edit Product Template</h2>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium block mb-1">Product Name</label>
                    <Input
                      value={editingTemplate.name}
                      onChange={(e) => setEditingTemplate({...editingTemplate, name: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium block mb-1">Description</label>
                    <Textarea
                      value={editingTemplate.description}
                      onChange={(e) => setEditingTemplate({...editingTemplate, description: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium block mb-1">Price (₦)</label>
                    <Input
                      type="number"
                      value={editingTemplate.price}
                      onChange={(e) => setEditingTemplate({...editingTemplate, price: parseFloat(e.target.value)})}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium block mb-1">Category</label>
                    <Select 
                      value={editingTemplate.category_id} 
                      onValueChange={(value) => 
                        setEditingTemplate({...editingTemplate, category_id: value})
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.map((category) => (
                          <SelectItem key={category.id} value={category.id}>
                            {category.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="border-t pt-4">
                    <label className="text-sm font-medium block mb-1">MuaBanVia Auto-Fulfillment</label>
                    <p className="text-xs text-muted-foreground mb-2">
                      When enabled, if pre-stocked accounts run out, the shortfall is purchased
                      live from MuaBanVia using the product ID below.
                    </p>
                    <Input
                      placeholder="MuaBanVia product ID (optional)"
                      value={editingTemplate.muabanvia_product_id || ''}
                      onChange={(e) => setEditingTemplate({...editingTemplate, muabanvia_product_id: e.target.value})}
                      className="mb-2"
                    />
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="auto_fulfill_enabled"
                        checked={!!editingTemplate.auto_fulfill_enabled}
                        onChange={(e) => setEditingTemplate({...editingTemplate, auto_fulfill_enabled: e.target.checked})}
                      />
                      <label htmlFor="auto_fulfill_enabled" className="text-sm">
                        Enable auto-fulfillment for this product
                      </label>
                    </div>
                  </div>
                  <div className="border-t pt-4">
                    <label className="text-sm font-medium block mb-1">ShopClone Fallback</label>
                    <p className="text-xs text-muted-foreground mb-2">
                      Tried next if MuaBanVia is disabled, not configured, or fails. Leave
                      blank to skip ShopClone for this product.
                    </p>
                    <Input
                      placeholder="ShopClone product ID (optional)"
                      value={editingTemplate.shopclone_product_id || ''}
                      onChange={(e) => setEditingTemplate({...editingTemplate, shopclone_product_id: e.target.value})}
                    />
                  </div>
                  <div className="border-t pt-4">
                    <label className="text-sm font-medium block mb-1">ShopViaClone22 Fallback</label>
                    <p className="text-xs text-muted-foreground mb-2">
                      Tried last, if MuaBanVia and ShopClone are both unavailable or fail.
                      Leave blank to skip ShopViaClone22 for this product. If every configured
                      provider fails, the purchase simply fails as out of stock.
                    </p>
                    <Input
                      placeholder="ShopViaClone22 product ID (optional)"
                      value={editingTemplate.shopviaclone_product_id || ''}
                      onChange={(e) => setEditingTemplate({...editingTemplate, shopviaclone_product_id: e.target.value})}
                    />
                  </div>
                  <div className="border-t pt-4">
                    <label className="text-sm font-medium block mb-1">Proactive Auto-Restock</label>
                    <p className="text-xs text-muted-foreground mb-2">
                      When enabled, a scheduled job buys ahead of demand for this product
                      (based on recent sales speed) instead of waiting for stock to hit zero.
                      Uses whichever provider IDs above are filled in, in the same order.
                    </p>
                    <div className="flex items-center gap-2 mb-2">
                      <input
                        type="checkbox"
                        id="auto_restock_enabled"
                        checked={!!editingTemplate.auto_restock_enabled}
                        onChange={(e) => setEditingTemplate({...editingTemplate, auto_restock_enabled: e.target.checked})}
                      />
                      <label htmlFor="auto_restock_enabled" className="text-sm">
                        Enable proactive auto-restock for this product
                      </label>
                    </div>
                    <Input
                      type="number"
                      min={1}
                      placeholder="Buffer days (default 3)"
                      value={editingTemplate.restock_buffer_days ?? 3}
                      onChange={(e) => setEditingTemplate({...editingTemplate, restock_buffer_days: parseFloat(e.target.value) || 3})}
                    />
                  </div>
                  <div className="border-t pt-4">
                    <label className="text-sm font-medium block mb-1">Buy More, Save More</label>
                    <p className="text-xs text-muted-foreground mb-2">
                      Quantity discount tiers - customers buying at least this many units get
                      this % off the total automatically, applied at checkout and shown on the
                      product card. Leave a row's quantity at 0 to disable it.
                    </p>
                    <div className="space-y-2">
                      {[0, 1, 2].map((i) => {
                        const tiers = editingTemplate.quantity_discount_tiers || []
                        const tier = tiers[i] || { min_qty: 0, discount_pct: 0 }
                        const updateTier = (field: 'min_qty' | 'discount_pct', value: number) => {
                          const next = [...(editingTemplate.quantity_discount_tiers || [])]
                          next[i] = { ...tier, [field]: value }
                          setEditingTemplate({ ...editingTemplate, quantity_discount_tiers: next })
                        }
                        return (
                          <div key={i} className="flex items-center gap-2">
                            <Input
                              type="number"
                              min={0}
                              placeholder="Min qty"
                              className="w-28"
                              value={tier.min_qty || ''}
                              onChange={(e) => updateTier('min_qty', parseInt(e.target.value) || 0)}
                            />
                            <span className="text-xs text-muted-foreground">units gets</span>
                            <Input
                              type="number"
                              min={0}
                              max={100}
                              placeholder="% off"
                              className="w-24"
                              value={tier.discount_pct || ''}
                              onChange={(e) => updateTier('discount_pct', parseInt(e.target.value) || 0)}
                            />
                            <span className="text-xs text-muted-foreground">% off</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                  {editingTemplate.id && (
                    <div className="border-t pt-4">
                      <label className="text-sm font-medium block mb-1">Test Stock (manual one-off buy)</label>
                      <p className="text-xs text-muted-foreground mb-2">
                        Buys a small batch right now using whichever provider IDs above are
                        filled in. Useful for testing a brand-new product before turning on
                        auto-restock. This spends real money - it's a separate, explicit action.
                      </p>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={1}
                          max={100}
                          className="w-28"
                          placeholder="Qty"
                          value={restockQty[editingTemplate.id] ?? 10}
                          onChange={(e) => setRestockQty({...restockQty, [editingTemplate.id]: parseInt(e.target.value) || 10})}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={restockingId === editingTemplate.id}
                          onClick={() => handleTestStock(editingTemplate.id)}
                        >
                          {restockingId === editingTemplate.id ? 'Buying...' : 'Test Stock'}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex gap-2 mt-6">
                  <Button onClick={() => setEditingTemplate(null)} variant="outline" className="flex-1">
                    Cancel
                  </Button>
                  <Button onClick={() => handleUpdateTemplate(editingTemplate)} className="flex-1">
                    Save Changes
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Balance Adjustment Modal */}
          <Dialog open={adjustBalanceOpen} onOpenChange={setAdjustBalanceOpen}>
            <DialogContent className="max-w-md w-[95vw] sm:w-full">
              <DialogHeader>
                <DialogTitle>Adjust User Balance</DialogTitle>
                <DialogDescription className="break-words">
                  Modify wallet balance for {selectedUser?.email}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                {/* Current Balance Display */}
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-sm text-muted-foreground mb-1">Current Balance</p>
                  <p className="text-2xl font-bold">
                    ₦{(selectedUser?.wallet_balance || 0).toLocaleString()}
                  </p>
                </div>

                {/* Adjustment Type Selector */}
                <div className="space-y-2">
                  <Label>Action</Label>
                  <Select value={adjustmentType} onValueChange={(value: 'add' | 'subtract') => setAdjustmentType(value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="add">Add Funds (Credit)</SelectItem>
                      <SelectItem value="subtract">Deduct Funds (Debit)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Amount Input */}
                <div className="space-y-2">
                  <Label>Amount (₦)</Label>
                  <Input
                    type="number"
                    placeholder="5000"
                    value={adjustmentAmount}
                    onChange={(e) => setAdjustmentAmount(e.target.value)}
                    min="1"
                  />
                </div>

                {/* Reason Textarea */}
                <div className="space-y-2">
                  <Label>Reason (Required)</Label>
                  <Textarea
                    placeholder="e.g., Refund for order #123, Compensation, Manual top-up..."
                    value={adjustmentReason}
                    onChange={(e) => setAdjustmentReason(e.target.value)}
                    rows={3}
                  />
                </div>

                {/* Preview */}
                {adjustmentAmount && (
                  <div className="p-4 bg-muted rounded-lg border-2 border-primary/20">
                    <p className="text-sm font-semibold mb-2">Preview:</p>
                    <div className="space-y-1 text-sm">
                      <p>
                        Current: ₦{(selectedUser?.wallet_balance || 0).toLocaleString()}
                      </p>
                      <p className={adjustmentType === 'add' ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                        {adjustmentType === 'add' ? '+' : '-'}₦{parseFloat(adjustmentAmount || '0').toLocaleString()}
                      </p>
                      <p className="font-bold border-t pt-1 mt-1">
                        New Balance: ₦{calculateNewBalance()}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button 
                  variant="outline" 
                  onClick={() => setAdjustBalanceOpen(false)}
                  disabled={isAdjusting}
                >
                  Cancel
                </Button>
                <Button 
                  onClick={handleSubmitAdjustment} 
                  disabled={!adjustmentAmount || !adjustmentReason || isAdjusting}
                >
                  {isAdjusting ? 'Processing...' : (adjustmentType === 'add' ? 'Add Funds' : 'Deduct Funds')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* User Details Modal */}
          <Dialog open={viewUserOpen} onOpenChange={setViewUserOpen}>
            <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto w-[95vw] sm:w-full">
              <DialogHeader>
                <DialogTitle>User Details</DialogTitle>
                <DialogDescription>
                  Complete account information and activity
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-6">
                {/* Account Information Card */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Account Information</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm text-muted-foreground">Email</p>
                        <p className="font-mono text-sm">{selectedUser?.email}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Full Name</p>
                        <p>{selectedUser?.full_name || 'Not set'}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Wallet Balance</p>
                        <p className="text-lg font-bold">
                          ₦{(selectedUser?.wallet_balance || 0).toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Account Status</p>
                        <div className="mt-1">
                          {selectedUser?.is_admin ? (
                            <Badge>Admin</Badge>
                          ) : (
                            <Badge variant="secondary">Customer</Badge>
                          )}
                        </div>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">User ID</p>
                        <p className="font-mono text-xs">{selectedUser?.id}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Joined Date</p>
                        <p>{selectedUser?.created_at && format(new Date(selectedUser.created_at), 'PPP')}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Recent Transactions Card */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center justify-between">
                      <span>Recent Transactions</span>
                      <Badge variant="outline">{userTransactions.length} total</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {userTransactions.length === 0 ? (
                      <p className="text-center text-muted-foreground py-4">No transactions found</p>
                    ) : (
                      <div className="space-y-2">
                        {userTransactions.slice(0, 5).map((tx) => (
                          <div key={tx.id} className="flex items-center justify-between p-3 border rounded-lg">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <Badge 
                                  variant={
                                    tx.type === 'TOP_UP' || tx.type === 'ADMIN_CREDIT' 
                                      ? 'default' 
                                      : 'secondary'
                                  }
                                >
                                  {tx.type}
                                </Badge>
                                <span className="text-sm text-muted-foreground">
                                  {format(new Date(tx.created_at), 'MMM d, HH:mm')}
                                </span>
                              </div>
                              <p className="text-sm">{tx.description || 'No description'}</p>
                            </div>
                            <div className="text-right">
                              <p className={`font-bold ${
                                tx.type === 'TOP_UP' || tx.type === 'ADMIN_CREDIT' 
                                  ? 'text-green-600' 
                                  : 'text-red-600'
                              }`}>
                                {tx.type === 'TOP_UP' || tx.type === 'ADMIN_CREDIT' ? '+' : '-'}
                                ₦{(tx.amount || 0).toLocaleString()}
                              </p>
                            </div>
                          </div>
                        ))}
                        {userTransactions.length > 5 && (
                          <p className="text-sm text-muted-foreground text-center pt-2">
                            Showing 5 of {userTransactions.length} transactions
                          </p>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Order History Card */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center justify-between">
                      <span>Order History</span>
                      <Badge variant="outline">{userOrders.length} orders</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {userOrders.length === 0 ? (
                      <p className="text-center text-muted-foreground py-4">No orders found</p>
                    ) : (
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4 p-4 bg-muted rounded-lg">
                          <div>
                            <p className="text-sm text-muted-foreground">Total Orders</p>
                            <p className="text-2xl font-bold">{userOrders.length}</p>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">Total Spent</p>
                            <p className="text-2xl font-bold">₦{calculateTotalSpent(userOrders)}</p>
                          </div>
                        </div>
                        
                        <div className="space-y-2">
                          {userOrders.slice(0, 5).map((order) => (
                            <div key={order.id} className="flex items-center justify-between p-3 border rounded-lg">
                              <div className="flex-1">
                                <p className="font-medium">
                                  {order.product_groups?.name || 'Unknown Product'}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                  {format(new Date(order.created_at), 'MMM d, yyyy')} • 
                                  Order #{order.id.slice(0, 8)}
                                </p>
                              </div>
                              <div className="text-right">
                                <p className="font-bold">₦{(order.amount || 0).toLocaleString()}</p>
                                <Badge variant={order.status === 'completed' ? 'default' : 'secondary'}>
                                  {order.status}
                                </Badge>
                              </div>
                            </div>
                          ))}
                          {userOrders.length > 5 && (
                            <p className="text-sm text-muted-foreground text-center pt-2">
                              Showing 5 of {userOrders.length} orders
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setViewUserOpen(false)}>
                  Close
                </Button>
                <Button onClick={() => {
                  setViewUserOpen(false)
                  handleAdjustBalance(selectedUser)
                }}>
                  <DollarSign className="h-4 w-4 mr-2" />
                  Adjust Balance
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Stats Overview */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Total Users</p>
                    <p className="text-2xl font-bold">{stats.totalUsers.toLocaleString()}</p>
                  </div>
                  <Users className="h-8 w-8 text-blue-500" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Total Products</p>
                    <p className="text-2xl font-bold">{stats.totalProducts}</p>
                  </div>
                  <ShoppingBag className="h-8 w-8 text-green-500" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Total Sales</p>
                    <p className="text-2xl font-bold">{stats.totalSales}</p>
                  </div>
                  <TrendingUp className="h-8 w-8 text-purple-500" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Revenue</p>
                    <p className="text-2xl font-bold">₦{stats.revenue.toLocaleString()}</p>
                  </div>
                  <DollarSign className="h-8 w-8 text-orange-500" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Admin Alerts Section */}
          <div className="mb-8">
            <AdminAlerts />
          </div>

          {/* Main Content */}
          <Tabs value={adminTab} onValueChange={(value) => setAdminTab(value as AdminTabValue)} className="space-y-6">
            <div className="rounded-xl border border-border bg-card/70 p-3 shadow-sm md:hidden">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Admin menu</p>
              <Select value={adminTab} onValueChange={(value) => setAdminTab(value as AdminTabValue)}>
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="Choose admin section" />
                </SelectTrigger>
                <SelectContent>
                  {ADMIN_TABS.map((tab) => (
                    <SelectItem key={tab.value} value={tab.value}>
                      {tab.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="hidden w-full pb-2 md:block">
              <TabsList className="grid w-full grid-cols-5 gap-1 lg:grid-cols-10">
                {ADMIN_TABS.map((tab) => (
                  <TabsTrigger key={tab.value} value={tab.value} className="min-w-0 px-2 text-xs lg:text-sm">
                    <span className="truncate">{tab.label}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            {/* Product Templates Management */}
            <TabsContent value="templates" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Product Templates</CardTitle>
                  <p className="text-muted-foreground">
                    Create and manage product templates for bulk account uploads
                  </p>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Create New Template */}
                  <div className="border rounded-lg p-6">
                    <h3 className="text-lg font-medium mb-4">Create New Product Template</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium mb-2 block">Product Name</label>
                        <Input
                          placeholder="e.g., Instagram Premium Accounts"
                          value={newTemplate.productName}
                          onChange={(e) => setNewTemplate({ ...newTemplate, productName: e.target.value })}
                        />
                      </div>

                      <div>
                        <label className="text-sm font-medium mb-2 block">Category</label>
                        <Select 
                          value={newTemplate.categoryId} 
                          onValueChange={(value) => setNewTemplate({ ...newTemplate, categoryId: value })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select category" />
                          </SelectTrigger>
                          <SelectContent>
                            {categories.map((category) => (
                              <SelectItem key={category.id} value={category.id}>
                                {category.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <label className="text-sm font-medium mb-2 block">Price (₦)</label>
                        <Input
                          type="number"
                          placeholder="2500"
                          value={newTemplate.price}
                          onChange={(e) => setNewTemplate({ ...newTemplate, price: e.target.value })}
                        />
                      </div>

                      <div>
                        <label className="text-sm font-medium mb-2 block">Description</label>
                        <Textarea
                          placeholder="Describe this product template..."
                          value={newTemplate.description}
                          onChange={(e) => setNewTemplate({ ...newTemplate, description: e.target.value })}
                          rows={3}
                        />
                      </div>
                    </div>

                    <Button onClick={handleCreateTemplate} className="mt-4">
                      <Plus className="h-4 w-4 mr-2" />
                      Create Template
                    </Button>
                  </div>

                  {/* Existing Templates */}
                  <div>
                    <h3 className="text-lg font-medium mb-4">Existing Product Templates</h3>
                    <div className="space-y-3">
                      {productGroups.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                          <ShoppingBag className="h-12 w-12 mx-auto mb-4 opacity-50" />
                          <p>No product templates found. Create one above.</p>
                        </div>
                      ) : (
                        productGroups.map((template) => {
                          const category = categories.find(cat => cat.id === template.category_id)
                          const isArchived = template.is_active === false
                          return (
                            <div
                              key={template.id}
                              className={`flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 border rounded-lg gap-3 ${isArchived ? 'bg-gray-50 dark:bg-gray-800/50 opacity-75' : ''}`}
                            >
                              <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-2 mb-2">
                                  <h4 className={`font-medium break-words ${isArchived ? 'text-gray-500' : ''}`}>
                                    {template.name}
                                  </h4>
                                  <Badge variant="outline" className="whitespace-nowrap">{category?.name || 'Unknown'}</Badge>
                                  {isArchived && (
                                    <Badge variant="secondary">Archived</Badge>
                                  )}
                                  <Badge variant={template.stock_count > 0 ? 'default' : 'secondary'} className="whitespace-nowrap">
                                    {template.stock_count} in stock
                                  </Badge>
                                </div>
                                <p className={`text-sm text-muted-foreground break-words ${isArchived ? 'text-gray-400' : ''}`}>
                                  {template.description} • ₦{template.price.toLocaleString()}
                                </p>
                              </div>
                              <div className="flex items-center gap-2 flex-wrap sm:flex-shrink-0">
                                <Button 
                                  variant="outline" 
                                  size="sm"
                                  onClick={() => handleEditTemplate(template)}
                                >
                                  <Edit className="h-4 w-4 sm:mr-1" />
                                  <span className="hidden sm:inline">Edit</span>
                                </Button>
                                {isArchived ? (
                                  <Button 
                                    variant="outline" 
                                    size="sm"
                                    onClick={() => handleRestoreTemplate(template.id)}
                                    className="text-green-600 hover:text-green-700 whitespace-nowrap"
                                  >
                                    Restore
                                  </Button>
                                ) : (
                                  <>
                                    <Button 
                                      variant="outline" 
                                      size="sm"
                                      onClick={() => handleArchiveTemplate(template.id)}
                                      className="text-orange-600 hover:text-orange-700 whitespace-nowrap"
                                    >
                                      Archive
                                    </Button>
                                    <Button 
                                      variant="outline" 
                                      size="sm"
                                      onClick={() => handleDeleteTemplate(template.id)}
                                      className="text-red-600 hover:text-red-700"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </>
                                )}
                              </div>
                            </div>
                          )
                        })
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* DaisySMS Product Curation */}
            <TabsContent value="sms-products" className="space-y-6">
              <Card>
                <CardHeader>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <PhoneCall className="h-5 w-5 text-primary" />
                        DaisySMS Products
                      </CardTitle>
                      <p className="text-muted-foreground">
                        Enable what customers can buy, set favorites, and override naira pricing per product.
                      </p>
                    </div>
                    <Button type="button" variant="outline" onClick={loadSmsProducts} disabled={smsProductsLoading}>
                      {smsProductsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      Sync DaisySMS
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge variant="outline" className="rounded-md px-3 py-2">
                      Showing DaisySMS cost in NGN
                    </Badge>
                    <div className="relative min-w-[220px] flex-1">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={smsSearchQuery}
                        onChange={(event) => setSmsSearchQuery(event.target.value)}
                        placeholder="Search products..."
                        className="pl-9"
                      />
                    </div>
                    <Input
                      type="number"
                      min="0"
                      value={smsGlobalMargin}
                      onChange={(event) => setSmsGlobalMargin(event.target.value)}
                      placeholder="NGN e.g. 1000"
                      className="w-40"
                    />
                    <label className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Checkbox
                        checked={smsKeepAutoApply}
                        onCheckedChange={(checked) => setSmsKeepAutoApply(checked === true)}
                      />
                      Keep auto-applying on future syncs
                    </label>
                    <Button type="button" variant="outline" disabled={smsSavingKey === 'global-markup'} onClick={applySmsGlobalMarkup}>
                      {smsSavingKey === 'global-markup' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      Markup
                    </Button>
                    <Button
                      type="button"
                      variant={smsRoundToNearestTen ? 'default' : 'outline'}
                      disabled={smsSavingKey === 'round-to-10'}
                      onClick={toggleSmsRounding}
                      title="Round auto-markup prices up to the next 10, for example 982 becomes 990"
                    >
                      {smsSavingKey === 'round-to-10' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      Round up to 10
                    </Button>
                    <Button type="button" variant="outline" disabled={smsSavingKey === 'enable-all'} onClick={() => bulkToggleSmsProducts(true)}>
                      Enable all ({smsProducts.length})
                    </Button>
                    <Button type="button" variant="outline" disabled={smsSavingKey === 'disable-all'} onClick={() => bulkToggleSmsProducts(false)}>
                      Disable all ({smsProducts.length})
                    </Button>
                  </div>

                  {(smsCatalogNotice || smsDiagnostics) && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                      <p className="font-semibold">{smsCatalogNotice || 'DaisySMS sync diagnostics'}</p>
                      {smsDiagnostics && (
                        <p className="mt-1 text-xs opacity-90">
                          Host: {smsDiagnostics.provider_host || 'unknown'} · Rate source: {smsExchangeRateSource} · Rounding: {smsRoundToNearestTen ? 'up to 10' : 'off'} · Country: {smsDiagnostics.country_id || 'unknown'} · getPricesVerification: {smsDiagnostics.verification_services ?? 0} · getPrices: {smsDiagnostics.prices_services ?? 0}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="rounded-lg border border-yellow-200 bg-yellow-50/40">
                    <div className="flex items-center justify-between border-b border-yellow-200 px-4 py-3">
                      <h3 className="flex items-center gap-2 font-semibold text-yellow-900">
                        <Star className="h-4 w-4 fill-yellow-400 text-yellow-500" />
                        Favorites ({favoriteSmsProducts.length})
                      </h3>
                    </div>
                    <div className="px-4">
                      {smsProductsLoading && smsProducts.length === 0 ? (
                        <div className="flex items-center justify-center py-10 text-muted-foreground">
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Loading DaisySMS products...
                        </div>
                      ) : favoriteSmsProducts.length === 0 ? (
                        <p className="py-6 text-sm text-muted-foreground">No favorites yet. Star products below to push them up on the customer list.</p>
                      ) : (
                        favoriteSmsProducts.map(renderSmsProductRow)
                      )}
                    </div>
                  </div>

                  <div className="rounded-lg border">
                    <div className="grid gap-4 border-b bg-muted/40 px-4 py-3 text-xs font-semibold uppercase text-muted-foreground lg:grid-cols-[minmax(180px,1.3fr)_220px_minmax(240px,1fr)_90px]">
                      <span>Product</span>
                      <span>Cost</span>
                      <span>Customer price override</span>
                      <span className="lg:text-right">Enabled</span>
                    </div>
                    <div className="px-4">
                      {smsProductsLoading && smsProducts.length === 0 ? (
                        <div className="flex items-center justify-center py-12 text-muted-foreground">
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Syncing DaisySMS products...
                        </div>
                      ) : filteredSmsProducts.length === 0 ? (
                        <p className="py-10 text-center text-sm text-muted-foreground">No SMS products match your search.</p>
                      ) : (
                        filteredSmsProducts.map(renderSmsProductRow)
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Products Management */}
            <TabsContent value="products" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Product Management</CardTitle>
                  <p className="text-muted-foreground">
                    View and manage all products in your inventory ({individualAccountsCount.toLocaleString()} total accounts)
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {individualAccounts.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <ShoppingBag className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <p>No products found. Add some products using the tabs above.</p>
                      </div>
                    ) : (
                      individualAccounts.map((account) => {
                        const productGroup = productGroups.find(pg => pg.id === account.product_group_id)
                        const category = categories.find(cat => cat.id === productGroup?.category_id)
                        
                        return (
                          <div
                            key={account.id}
                            className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 border rounded-lg gap-4"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-2 mb-2">
                                <h3 className="font-medium break-all">@{account.username}</h3>
                                <Badge variant={account.status === 'available' ? 'default' : account.status === 'sold' ? 'secondary' : 'destructive'}>
                                  {account.status}
                                </Badge>
                                {account.additional_info?.followers && (
                                  <Badge variant="outline" className="whitespace-nowrap">{parseInt(account.additional_info.followers).toLocaleString()} followers</Badge>
                                )}
                              </div>
                              <div className="text-sm text-muted-foreground space-y-1 sm:space-y-0 sm:space-x-4">
                                <span className="block sm:inline">Category: {category?.name || 'Unknown'}</span>
                                <span className="block sm:inline">Price: ₦{productGroup?.price?.toLocaleString() || '0'}</span>
                                <span className="block sm:inline">Added: {new Date(account.created_at).toLocaleDateString()}</span>
                                {account.email && <span className="block sm:inline break-all">Email: {account.email}</span>}
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-2 sm:flex-shrink-0">
                              <Button 
                                variant="outline" 
                                size="sm"
                                onClick={() => handleViewAccount(account)}
                                title="View details"
                              >
                                <Eye className="h-4 w-4 sm:mr-1" />
                                <span className="hidden sm:inline">View</span>
                              </Button>
                              <Button 
                                variant="outline" 
                                size="sm"
                                onClick={() => handleEditAccount(account)}
                                title="Edit account"
                              >
                                <Edit className="h-4 w-4 sm:mr-1" />
                                <span className="hidden sm:inline">Edit</span>
                              </Button>
                              <Button 
                                variant="outline" 
                                size="sm"
                                onClick={() => handleDeleteAccount(account.id)}
                                className="text-red-600 hover:text-red-700"
                                title="Delete account"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Add Single Product */}
            <TabsContent value="add-product" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Plus className="h-5 w-5" />
                    Add New Product
                  </CardTitle>
                  <p className="text-muted-foreground">
                    Add a single product manually to your inventory
                  </p>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <div>
                        <label className="text-sm font-medium mb-2 block">Product Title</label>
                        <Input
                          placeholder="e.g., @lifestyle_influencer"
                          value={newProduct.title}
                          onChange={(e) => setNewProduct({ ...newProduct, title: e.target.value })}
                        />
                      </div>

                      <div>
                        <label className="text-sm font-medium mb-2 block">Category</label>
                        <Select 
                          value={newProduct.category} 
                          onValueChange={(value) => setNewProduct({ ...newProduct, category: value })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select category" />
                          </SelectTrigger>
                          <SelectContent>
                            {categories.length === 0 ? (
                              <SelectItem value="" disabled>No categories available</SelectItem>
                            ) : (
                              categories.map((category) => (
                                <SelectItem key={category.id} value={category.id}>
                                  {category.name}
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <label className="text-sm font-medium mb-2 block">Price (₦)</label>
                        <Input
                          type="number"
                          placeholder="Enter price"
                          value={newProduct.price}
                          onChange={(e) => setNewProduct({ ...newProduct, price: e.target.value })}
                        />
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <label className="text-sm font-medium mb-2 block">Username</label>
                        <Input
                          placeholder="Account username"
                          value={newProduct.username}
                          onChange={(e) => setNewProduct({ ...newProduct, username: e.target.value })}
                        />
                      </div>

                      <div>
                        <label className="text-sm font-medium mb-2 block">Password</label>
                        <Input
                          type="password"
                          placeholder="Account password"
                          value={newProduct.password}
                          onChange={(e) => setNewProduct({ ...newProduct, password: e.target.value })}
                        />
                      </div>

                      <div>
                        <label className="text-sm font-medium mb-2 block">Email (Optional)</label>
                        <Input
                          type="email"
                          placeholder="Associated email"
                          value={newProduct.email}
                          onChange={(e) => setNewProduct({ ...newProduct, email: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="text-sm font-medium mb-2 block">Description</label>
                    <Textarea
                      placeholder="Product description..."
                      value={newProduct.description}
                      onChange={(e) => setNewProduct({ ...newProduct, description: e.target.value })}
                      rows={4}
                    />
                  </div>

                  <Button onClick={handleAddProduct} className="w-full">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Product
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Bulk CSV Upload */}
            <TabsContent value="bulk-upload" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Upload className="h-5 w-5" />
                    Bulk Account Upload
                  </CardTitle>
                  <p className="text-muted-foreground">
                    Upload CSV files with account credentials to an existing product template
                  </p>
                </CardHeader>
                <CardContent className="space-y-6">
                  
                  {/* Template Selection */}
                  <div>
                    <label className="text-sm font-medium mb-2 block">Select Product Template</label>
                    <Select 
                      value={selectedTemplate} 
                      onValueChange={setSelectedTemplate}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Choose a product template" />
                      </SelectTrigger>
                      <SelectContent>
                        {productGroups.map((template) => {
                          const category = categories.find(cat => cat.id === template.category_id)
                          return (
                            <SelectItem key={template.id} value={template.id}>
                              {template.name} ({category?.name}) - ₦{template.price.toLocaleString()}
                            </SelectItem>
                          )
                        })}
                      </SelectContent>
                    </Select>
                    {selectedTemplate && (
                      <p className="text-sm text-muted-foreground mt-2">
                        Accounts will be added to: {productGroups.find(pg => pg.id === selectedTemplate)?.name}
                      </p>
                    )}
                  </div>

                  <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center">
                    <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-medium mb-2">Upload CSV File</h3>
                    <p className="text-muted-foreground mb-4">
                      Choose a CSV file with account credentials
                    </p>
                    
                    <input
                      type="file"
                      accept=".csv"
                      onChange={handleCsvFileChange}
                      className="mb-4"
                    />
                    
                    {csvFile && (
                      <div className="mt-4 p-3 bg-muted rounded-lg">
                        <p className="text-sm font-medium">Selected: {csvFile.name}</p>
                        <p className="text-sm text-muted-foreground">
                          Size: {(csvFile.size / 1024).toFixed(1)} KB
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="space-y-4">
                    <h4 className="font-medium">CSV Format Requirements:</h4>
                    <div className="bg-muted p-4 rounded-lg text-sm">
                      <p className="font-medium mb-2">Required columns:</p>
                      <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                        <li><strong>password</strong> - Account password (required)</li>
                        <li><strong>email</strong> OR <strong>username</strong> - Account identifier (at least one required)</li>
                      </ul>
                      <p className="font-medium mb-2 mt-4">Optional columns:</p>
                      <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                        <li><strong>email_password</strong> - Email account password</li>
                        <li><strong>two_fa</strong> or <strong>two_fa_code</strong> - Two-factor authentication code</li>
                        <li><strong>recovery_email</strong> - Recovery email address</li>
                        <li><strong>recovery_email_password</strong> - Recovery email password</li>
                        <li><strong>username</strong> - Account username (if email is primary identifier)</li>
                      </ul>
                      <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-950 rounded border border-blue-200 dark:border-blue-800">
                        <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
                          💡 Sample CSV format:
                        </p>
                        <code className="text-xs text-blue-700 dark:text-blue-300 block mt-1">
                          username,password,email,email_password,two_fa,recovery_email,recovery_email_password<br/>
                          john_doe,pass123,john@email.com,emailpass123,123456,recovery@email.com,recpass123<br/>
                          jane_smith,mypass,jane@email.com,,,,
                        </code>
                      </div>
                    </div>
                  </div>

                  <Button 
                    onClick={handleCsvUpload} 
                    disabled={!csvFile || !selectedTemplate}
                    className="w-full"
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    Upload Accounts to Template
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Discount Codes / Flash Sales */}
            <TabsContent value="discount-codes" className="space-y-6">
              <div className="bg-amber-100 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-800 rounded-md p-3 text-sm text-amber-800 dark:text-amber-300">
                Paused store-wide (alongside bulk quantity discounts) while a better bundle/promo solution is worked out.
                Codes created here still save to the database, but checkout won't apply them until DISCOUNTS_ENABLED is flipped back on.
              </div>
              <Card>
                <CardHeader>
                  <CardTitle>Create Discount Code</CardTitle>
                  <p className="text-muted-foreground">
                    Store-wide, category, or single-product codes. Validated and applied server-side at checkout.
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium mb-1 block">Code</label>
                      <Input
                        value={newCode}
                        onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                        placeholder="e.g. SAVE20"
                        className="uppercase"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1 block">Percent Off (1-100)</label>
                      <Input
                        type="number"
                        min={1}
                        max={100}
                        value={newCodePercent}
                        onChange={(e) => setNewCodePercent(e.target.value)}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-sm font-medium mb-1 block">Applies To</label>
                    <Select value={newCodeScope} onValueChange={(v: any) => setNewCodeScope(v)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="store">Entire Store</SelectItem>
                        <SelectItem value="category">One Category</SelectItem>
                        <SelectItem value="product">One Product</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {newCodeScope === 'category' && (
                    <div>
                      <label className="text-sm font-medium mb-1 block">Category</label>
                      <Select value={newCodeCategoryId} onValueChange={setNewCodeCategoryId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a category" />
                        </SelectTrigger>
                        <SelectContent>
                          {categories.map((cat) => (
                            <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {newCodeScope === 'product' && (
                    <div>
                      <label className="text-sm font-medium mb-1 block">Product</label>
                      <Select value={newCodeProductGroupId} onValueChange={setNewCodeProductGroupId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a product" />
                        </SelectTrigger>
                        <SelectContent>
                          {productGroups.map((pg) => (
                            <SelectItem key={pg.id} value={pg.id}>{pg.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium mb-1 block">Max Uses (optional)</label>
                      <Input
                        type="number"
                        min={1}
                        value={newCodeMaxUses}
                        onChange={(e) => setNewCodeMaxUses(e.target.value)}
                        placeholder="Unlimited"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1 block">Expires At (optional)</label>
                      <Input
                        type="datetime-local"
                        value={newCodeExpiresAt}
                        onChange={(e) => setNewCodeExpiresAt(e.target.value)}
                      />
                    </div>
                  </div>

                  <Button onClick={handleCreateDiscountCode} disabled={isCreatingCode} className="w-full">
                    {isCreatingCode ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                    Create Discount Code
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>Existing Codes</CardTitle>
                    <Button variant="outline" size="sm" onClick={loadDiscountCodes} disabled={isLoadingCodes}>
                      <RefreshCw className={`h-4 w-4 mr-1 ${isLoadingCodes ? 'animate-spin' : ''}`} /> Refresh
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {discountCodes.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <Tag className="h-10 w-10 mx-auto mb-3 opacity-40" />
                      <p>No discount codes yet</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Code</TableHead>
                            <TableHead>Off</TableHead>
                            <TableHead>Scope</TableHead>
                            <TableHead>Uses</TableHead>
                            <TableHead>Expires</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {discountCodes.map((c) => {
                            const scopeLabel = c.product_group_id
                              ? productGroups.find(p => p.id === c.product_group_id)?.name || 'Product'
                              : c.category_id
                              ? categories.find(cat => cat.id === c.category_id)?.name || 'Category'
                              : 'Entire Store'
                            const expired = c.expires_at ? new Date(c.expires_at) < new Date() : false
                            const usedUp = c.max_uses ? c.used_count >= c.max_uses : false
                            return (
                              <TableRow key={c.id}>
                                <TableCell className="font-mono font-medium">{c.code}</TableCell>
                                <TableCell>{c.percent_off}%</TableCell>
                                <TableCell className="text-sm">{scopeLabel}</TableCell>
                                <TableCell className="text-sm">
                                  {c.used_count}{c.max_uses ? ` / ${c.max_uses}` : ''}
                                </TableCell>
                                <TableCell className="text-sm">
                                  {c.expires_at ? format(new Date(c.expires_at), 'MMM d, yyyy') : 'Never'}
                                </TableCell>
                                <TableCell>
                                  {!c.is_active ? (
                                    <Badge variant="secondary">Disabled</Badge>
                                  ) : expired ? (
                                    <Badge variant="destructive">Expired</Badge>
                                  ) : usedUp ? (
                                    <Badge variant="destructive">Used Up</Badge>
                                  ) : (
                                    <Badge className="bg-green-600">Active</Badge>
                                  )}
                                </TableCell>
                                <TableCell>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleToggleCodeActive(c.id, !c.is_active)}
                                  >
                                    {c.is_active ? 'Disable' : 'Enable'}
                                  </Button>
                                </TableCell>
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Categories Management */}
            <TabsContent value="categories" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Category Management</CardTitle>
                  <p className="text-muted-foreground">
                    Manage product categories and organization
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {categories.map((category) => (
                      <div
                        key={category.id}
                        className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 border rounded-lg gap-3"
                      >
                        <div className="flex-1 min-w-0">
                          <h3 className="font-medium break-words">{category.name}</h3>
                          <p className="text-sm text-muted-foreground break-words">
                            {category.description} • {productGroups.filter(pg => pg.category_id === category.id).length} product groups
                          </p>
                        </div>
                        
                        <div className="flex items-center gap-2 sm:flex-shrink-0">
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => handleEditCategory(category)}
                            title="Edit category"
                          >
                            <Edit className="h-4 w-4 sm:mr-1" />
                            <span className="hidden sm:inline">Edit</span>
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => handleDeleteCategory(category.id)}
                            className="text-red-600 hover:text-red-700"
                            title="Delete category"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                    
                    {/* Add new category form */}
                    <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 mt-4">
                      <h3 className="font-medium mb-4">Add New Category</h3>
                      <div className="space-y-4">
                        <div>
                          <label className="text-sm font-medium mb-2 block">Category Name</label>
                          <Input
                            placeholder="e.g., Instagram Accounts"
                            value={newCategory.name}
                            onChange={(e) => setNewCategory({...newCategory, name: e.target.value})}
                          />
                        </div>
                        <div>
                          <label className="text-sm font-medium mb-2 block">Description</label>
                          <Input
                            placeholder="e.g., High-quality Instagram accounts"
                            value={newCategory.description}
                            onChange={(e) => setNewCategory({...newCategory, description: e.target.value})}
                          />
                        </div>
                        <Button onClick={handleAddCategory} className="w-full">
                          <Plus className="h-4 w-4 mr-2" />
                          Add Category
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Users Management */}
            <TabsContent value="users" className="space-y-6">
              {/* Search Bar */}
              <Card>
                <CardHeader>
                  <CardTitle>User Management</CardTitle>
                  <p className="text-muted-foreground">
                    Search users and manage wallet balances
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-2">
                    <Input
                      type="text"
                      placeholder="Search by email or name..."
                      value={userSearchQuery}
                      onChange={(e) => setUserSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSearchUsers()}
                      className="flex-1"
                    />
                    <Button onClick={handleSearchUsers} disabled={isSearching}>
                      <Search className="h-4 w-4 mr-2" />
                      {isSearching ? 'Searching...' : 'Search'}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Users Table */}
              <Card>
                <CardContent className="p-0">
                  {users.length === 0 ? (
                    <div className="text-center py-16 px-4">
                      <Search className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-50" />
                      <h3 className="text-lg font-semibold mb-2">Search for Users</h3>
                      <p className="text-muted-foreground mb-4">
                        Enter an email address or name in the search box above to find users
                      </p>
                      <div className="inline-flex items-center gap-2 text-sm text-muted-foreground bg-muted px-4 py-2 rounded-lg">
                        <kbd className="px-2 py-1 bg-background border rounded text-xs">Enter</kbd>
                        <span>or click Search to begin</span>
                      </div>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Email</TableHead>
                          <TableHead>Full Name</TableHead>
                          <TableHead>Wallet Balance</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Joined</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {users.map((user) => (
                          <TableRow key={user.id}>
                            <TableCell className="font-mono text-sm">
                              {user.email}
                            </TableCell>
                            <TableCell>{user.full_name || '-'}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="font-mono">
                                ₦{(user.wallet_balance || 0).toLocaleString()}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {user.is_admin ? (
                                <Badge>Admin</Badge>
                              ) : (
                                <Badge variant="secondary">Customer</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {format(new Date(user.created_at), 'MMM d, yyyy')}
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-2 whitespace-nowrap">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleViewUser(user)}
                                >
                                  <Eye className="h-4 w-4 md:mr-1" />
                                  <span className="hidden md:inline">View</span>
                                </Button>
                                <Button
                                  variant="default"
                                  size="sm"
                                  onClick={() => handleAdjustBalance(user)}
                                >
                                  <DollarSign className="h-4 w-4 md:mr-1" />
                                  <span className="hidden md:inline">Adjust</span>
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* User stats summary */}
              <Card>
                <CardContent className="p-6">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
                    <div>
                      <p className="text-2xl font-bold">{users.length}</p>
                      <p className="text-sm text-muted-foreground">Total Users Shown</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold">
                        ₦{users.reduce((sum, u) => sum + (u.wallet_balance || 0), 0).toLocaleString()}
                      </p>
                      <p className="text-sm text-muted-foreground">Total Balance</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold">
                        {users.filter(u => u.is_admin).length}
                      </p>
                      <p className="text-sm text-muted-foreground">Admins</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Email / Broadcast */}
            <TabsContent value="email" className="space-y-6">
              {/* Compose Card */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Mail className="h-5 w-5" />
                    Compose Email
                  </CardTitle>
                  <p className="text-muted-foreground">Send targeted emails or broadcast to all users</p>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Subject */}
                  <div>
                    <label className="text-sm font-medium mb-1 block">Subject</label>
                    <Input value={emailSubject} onChange={e => setEmailSubject(e.target.value)} placeholder="Email subject line" />
                  </div>

                  {/* Message */}
                  <div>
                    <label className="text-sm font-medium mb-1 block">Message</label>
                    <Textarea
                      value={emailMessage}
                      onChange={e => setEmailMessage(e.target.value)}
                      placeholder="Write your email message here... (plain text — will be wrapped in TallyStore branded template)"
                      rows={8}
                    />
                  </div>

                  {/* Recipients for targeted send */}
                  <div className="border rounded-lg p-4 space-y-3">
                    <label className="text-sm font-medium block">Targeted Recipients (optional)</label>
                    <div className="flex gap-2">
                      <Input
                        value={emailRecipientInput}
                        onChange={e => setEmailRecipientInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addEmailRecipient() } }}
                        placeholder="user@example.com"
                        className="flex-1"
                      />
                      <Button variant="outline" size="sm" onClick={addEmailRecipient}><Plus className="h-4 w-4" /></Button>
                    </div>
                    {emailRecipients.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-2">
                          {emailRecipients.map((email, idx) => (
                            <Badge key={idx} variant="secondary" className="flex items-center gap-1 px-2 py-1">
                              {email}
                              <button onClick={() => setEmailRecipients(prev => prev.filter((_, i) => i !== idx))}>
                                <X className="h-3 w-3" />
                              </button>
                            </Badge>
                          ))}
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">{emailRecipients.length} recipient(s)</span>
                          <Button variant="ghost" size="sm" onClick={() => setEmailRecipients([])}>Clear all</Button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="flex flex-col sm:flex-row gap-3 pt-2">
                    <Button
                      onClick={handleSendToList}
                      disabled={isSendingEmail || emailRecipients.length === 0 || !emailMessage.trim()}
                      variant="outline"
                      className="flex-1"
                    >
                      {isSendingEmail ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                      Send to List ({emailRecipients.length})
                    </Button>

                    <div className="flex items-center gap-2 flex-1">
                      <Button
                        onClick={handleBroadcast}
                        disabled={isBroadcasting || !emailMessage.trim()}
                        className="flex-1 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                      >
                        {isBroadcasting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Mail className="h-4 w-4 mr-2" />}
                        {isDryRun ? 'Dry Run (Preview)' : 'Broadcast to All Users'}
                      </Button>
                      <label className="flex items-center gap-1.5 text-xs whitespace-nowrap cursor-pointer">
                        <input type="checkbox" checked={isDryRun} onChange={e => { setIsDryRun(e.target.checked); setDryRunResult(null) }} className="rounded" />
                        Test mode
                      </label>
                    </div>
                  </div>

                  {/* Dry run result */}
                  {dryRunResult && (
                    <div className="p-4 bg-blue-50 dark:bg-blue-950 rounded-lg border border-blue-200 dark:border-blue-800">
                      <p className="font-medium text-blue-800 dark:text-blue-200 mb-1">Dry Run Result</p>
                      <p className="text-sm text-blue-700 dark:text-blue-300">Total recipients: <strong>{dryRunResult.totalRecipients?.toLocaleString()}</strong></p>
                      {dryRunResult.sampleRecipients?.length > 0 && (
                        <details className="mt-2">
                          <summary className="text-xs text-blue-600 dark:text-blue-400 cursor-pointer">Sample recipients ({dryRunResult.sampleRecipients.length})</summary>
                          <div className="mt-1 max-h-32 overflow-y-auto text-xs text-blue-600 dark:text-blue-400 space-y-0.5">
                            {dryRunResult.sampleRecipients.map((e: string, i: number) => <div key={i}>{e}</div>)}
                          </div>
                        </details>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Broadcast Jobs */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2"><Send className="h-5 w-5" /> Broadcast Jobs</CardTitle>
                      <p className="text-muted-foreground text-sm mt-1">Track progress of mass email broadcasts</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={loadBroadcastJobs} disabled={isLoadingJobs}>
                      <RefreshCw className={`h-4 w-4 mr-1 ${isLoadingJobs ? 'animate-spin' : ''}`} /> Refresh
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {broadcastJobs.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Mail className="h-12 w-12 mx-auto mb-3 opacity-40" />
                      <p>No broadcast jobs yet</p>
                      <p className="text-sm">Use the compose card above to send your first broadcast</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {broadcastJobs.map(job => {
                        const processed = job.sent_count + job.failed_count
                        const total = job.total_recipients || 1
                        const pct = Math.round((processed / total) * 100)
                        const isActive = job.status === 'queued' || job.status === 'processing'

                        return (
                          <div key={job.id} className="border rounded-lg p-4 space-y-3">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <p className="font-medium truncate">{job.subject}</p>
                                <p className="text-xs text-muted-foreground">
                                  Created {job.created_at ? formatDistanceToNow(new Date(job.created_at), { addSuffix: true }) : 'unknown'}
                                </p>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                {getJobStatusBadge(job.status)}
                                {isActive && (
                                  <Button variant="ghost" size="sm" onClick={() => handleCancelBroadcast(job.id)}>
                                    <XCircle className="h-4 w-4 text-red-500" />
                                  </Button>
                                )}
                              </div>
                            </div>

                            {/* Progress bar */}
                            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                              <div
                                className={`h-2 rounded-full transition-all duration-500 ${
                                  job.status === 'completed' ? 'bg-green-500' :
                                  job.status === 'cancelled' ? 'bg-gray-400' :
                                  job.status === 'failed' ? 'bg-red-500' :
                                  'bg-blue-500'
                                }`}
                                style={{ width: `${Math.min(pct, 100)}%` }}
                              />
                            </div>

                            {/* Stats */}
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                              <span className="text-green-600 font-medium">{job.sent_count.toLocaleString()} sent</span>
                              <span className="text-red-500">{job.failed_count.toLocaleString()} failed</span>
                              <span>of {total.toLocaleString()} total</span>
                              <span className="font-medium">{pct}%</span>
                              {job.started_at && !job.completed_at && (
                                <span>{formatDistanceToNow(new Date(job.started_at))} elapsed</span>
                              )}
                              {job.completed_at && (
                                <span>Completed in {formatDistanceToNow(new Date(job.started_at!), { addSuffix: false })}</span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Staff Roles Tab ──────────────────────────────────────────── */}
            <TabsContent value="staff" className="space-y-6">

              {/* Pending Approvals */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2"><Clock className="h-5 w-5" /> Pending Approvals</CardTitle>
                      <p className="text-muted-foreground text-sm mt-1">Staff actions waiting for your review</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={loadPendingActions} disabled={loadingPendingActions}>
                      <RefreshCw className={`h-4 w-4 mr-1 ${loadingPendingActions ? 'animate-spin' : ''}`} /> Refresh
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {loadingPendingActions ? (
                    <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
                  ) : pendingActions.length === 0 ? (
                    <p className="text-muted-foreground text-sm">No pending actions — you're all caught up.</p>
                  ) : (
                    <div className="space-y-3">
                      {pendingActions.map(action => (
                        <div key={action.id} className="flex items-center justify-between p-3 rounded-lg border">
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-sm">{action.action_label}</p>
                            <p className="text-xs text-muted-foreground">By {action.staff_email} · {format(new Date(action.created_at), 'dd MMM HH:mm')}</p>
                          </div>
                          <div className="flex items-center gap-2 ml-3 shrink-0">
                            <Button
                              size="sm"
                              onClick={() => handleApproveAction(action)}
                              disabled={approvingAction === action.id}
                              className="bg-green-600 hover:bg-green-700"
                            >
                              {approvingAction === action.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleRejectAction(action.id)}
                              className="border-red-300 text-red-600 hover:bg-red-50"
                            >
                              <XCircle className="h-3 w-3 mr-1" /> Reject
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Grant staff role */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><UserCheck className="h-5 w-5" /> Grant Staff Access</CardTitle>
                  <p className="text-muted-foreground text-sm">Search a user by email and give them the staff role</p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Search by email..."
                      value={staffSearchQuery}
                      onChange={e => setStaffSearchQuery(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleSearchForStaff()}
                    />
                    <Button onClick={handleSearchForStaff} disabled={staffSearching}>
                      {staffSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    </Button>
                  </div>
                  {staffSearchResults.length > 0 && (
                    <div className="space-y-2">
                      {staffSearchResults.map((u: any) => (
                        <div key={u.id} className="flex items-center justify-between p-3 rounded-lg border text-sm">
                          <div>
                            <p className="font-medium">{u.email}</p>
                            <p className="text-muted-foreground text-xs">Balance: ₦{(u.wallet_balance || 0).toLocaleString()}</p>
                          </div>
                          {u.is_staff ? (
                            <Button size="sm" variant="outline" className="border-red-300 text-red-600" onClick={() => handleRevokeStaff(u.id)}>
                              <UserX className="h-3.5 w-3.5 mr-1" /> Revoke Staff
                            </Button>
                          ) : (
                            <Button size="sm" onClick={() => handleGrantStaff(u.id)}>
                              <UserCheck className="h-3.5 w-3.5 mr-1" /> Grant Staff
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Permission matrix for each staff user */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5" /> Staff Permissions</CardTitle>
                  <p className="text-muted-foreground text-sm">Toggle what each staff member can see and do. "Auto-approve" means changes apply instantly; off means they go into the pending queue above.</p>
                </CardHeader>
                <CardContent className="space-y-4">
                  {staffUsers.length === 0 ? (
                    <p className="text-muted-foreground text-sm">No staff members yet. Grant someone the staff role above.</p>
                  ) : (
                    staffUsers.map((su: any) => {
                      const isExpanded = expandedStaffUser === su.id
                      const userPerms = staffPermissionsMap[su.id] || {}
                      return (
                        <div key={su.id} className="border rounded-lg overflow-hidden">
                          <button
                            className="w-full flex items-center justify-between p-3 text-sm font-medium hover:bg-muted/50 transition-colors"
                            onClick={() => {
                              if (!isExpanded) loadStaffPermsForUser(su.id)
                              setExpandedStaffUser(isExpanded ? null : su.id)
                            }}
                          >
                            <span className="flex items-center gap-2">
                              <Shield className="h-4 w-4 text-primary" />
                              {su.email}
                            </span>
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-red-300 text-red-600 h-7 text-xs"
                                onClick={e => { e.stopPropagation(); handleRevokeStaff(su.id) }}
                              >
                                <UserX className="h-3 w-3 mr-1" /> Revoke
                              </Button>
                              <span className="text-muted-foreground">{isExpanded ? '▲' : '▼'}</span>
                            </div>
                          </button>
                          {isExpanded && (
                            <div className="border-t divide-y">
                              {/* Group by permission group */}
                              {(['Overview', 'Tabs', 'Settings', 'Actions'] as const).map(group => {
                                const groupPerms = PERMISSIONS.filter(p => p.group === group)
                                return (
                                  <div key={group} className="p-3 space-y-2">
                                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{group}</p>
                                    {groupPerms.map(p => {
                                      const perm = userPerms[p.key] || { is_enabled: false, auto_approve: true }
                                      const savingKey = `${su.id}-${p.key}`
                                      return (
                                        <div key={p.key} className="flex items-center justify-between py-1">
                                          <div className="min-w-0 flex-1 mr-4">
                                            <p className="text-sm font-medium">{p.label}</p>
                                            <p className="text-xs text-muted-foreground">{p.description}</p>
                                          </div>
                                          <div className="flex items-center gap-3 shrink-0">
                                            {/* Enable/Disable */}
                                            <button
                                              className="flex items-center gap-1 text-xs"
                                              onClick={() => handleToggleStaffPerm(su.id, p.key, 'is_enabled', !perm.is_enabled)}
                                              disabled={savingStaffPerm === `${savingKey}-is_enabled`}
                                            >
                                              {perm.is_enabled
                                                ? <ToggleRight className="h-5 w-5 text-green-600" />
                                                : <ToggleLeft className="h-5 w-5 text-muted-foreground" />}
                                              <span className={perm.is_enabled ? 'text-green-700 font-medium' : 'text-muted-foreground'}>
                                                {perm.is_enabled ? 'On' : 'Off'}
                                              </span>
                                            </button>
                                            {/* Auto-approve (only when enabled) */}
                                            {perm.is_enabled && (
                                              <button
                                                className="flex items-center gap-1 text-xs border rounded px-2 py-0.5"
                                                onClick={() => handleToggleStaffPerm(su.id, p.key, 'auto_approve', !perm.auto_approve)}
                                                disabled={savingStaffPerm === `${savingKey}-auto_approve`}
                                                title={perm.auto_approve ? 'Click to require approval' : 'Click to auto-approve'}
                                              >
                                                {perm.auto_approve
                                                  ? <><CheckCircle2 className="h-3 w-3 text-blue-500" /> Auto</>
                                                  : <><Clock className="h-3 w-3 text-orange-500" /> Approve</>}
                                              </button>
                                            )}
                                          </div>
                                        </div>
                                      )
                                    })}
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })
                  )}
                </CardContent>
              </Card>
            </TabsContent>

          </Tabs>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  )
}
