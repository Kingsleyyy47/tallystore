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
  History,
  Smartphone,
  Bitcoin,
  Gift,
  Megaphone,
  WalletCards,
  Target,
  BarChart3,
  UserPlus,
  MousePointerClick,
  Sparkles,
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
// import {
//   analyzePromotionGuardrails,
//   analyzeRevenueDataQuality,
//   analyzeRevenueEventDataQuality,
//   applyCroEvaluationDecisions,
//   createProductRankingExperimentFromOpportunity,
//   decayCommercialInsights,
//   deriveBehavioralProductRelationships,
//   deriveCroActionPlans,
//   deriveCroBanditAllocations,
//   deriveCroDriftChecks,
//   deriveCroExperimentEvaluations,
//   deriveCroSimulationRun,
//   deriveRevenueAnomalyChecks,
//   deriveRevenueProductAttributes,
//   deriveRevenueOsRuntimeIntelligence,
//   deriveCatalogueProductRelationships,
//   recordCroExperiment,
//   recordCroEvaluations,
//   recordCroActionPlans,
//   recordCatalogueProductRelationships,
//   recordRevenueProductAttributes,
//   recordRevenueDataQualityFindings,
//   recordRevenueOsRuntimeIntelligence,
//   seedDeterministicRevenueOsModelRegistry,
//   updateCroActionPlanStatus,
// } from '@/lib/revenue-os'
// ── Temporary stubs — revenue-os WIP not yet committed ──────────────────────
const analyzePromotionGuardrails = (..._: any[]) => ([] as any[])
const analyzeRevenueDataQuality = (..._: any[]) => ([] as any[])
const analyzeRevenueEventDataQuality = (..._: any[]) => ([] as any[])
const applyCroEvaluationDecisions = async (..._: any[]) => ({})
const createProductRankingExperimentFromOpportunity = (..._: any[]) => ({})
const decayCommercialInsights = async (..._: any[]) => ({})
const deriveBehavioralProductRelationships = (..._: any[]) => ([])
const deriveCroActionPlans = (..._: any[]) => ([])
const deriveCroBanditAllocations = (..._: any[]) => ({})
const deriveCroDriftChecks = (..._: any[]) => ([])
const deriveCroExperimentEvaluations = (..._: any[]) => ({})
const deriveCroSimulationRun = (..._: any[]) => ({})
const deriveRevenueAnomalyChecks = (..._: any[]) => ([] as any[])
const deriveRevenueProductAttributes = (..._: any[]) => ([])
const deriveRevenueOsRuntimeIntelligence = (..._: any[]) => ({})
const deriveCatalogueProductRelationships = (..._: any[]) => ([])
const recordCroExperiment = async (..._: any[]) => {}
const recordCroEvaluations = async (..._: any[]) => {}
const recordCroActionPlans = async (..._: any[]) => {}
const recordCatalogueProductRelationships = async (..._: any[]) => {}
const recordRevenueProductAttributes = async (..._: any[]) => {}
const recordRevenueDataQualityFindings = async (..._: any[]) => {}
const recordRevenueOsRuntimeIntelligence = async (..._: any[]) => {}
const seedDeterministicRevenueOsModelRegistry = async (..._: any[]) => {}
const updateCroActionPlanStatus = async (..._: any[]) => {}
// ─────────────────────────────────────────────────────────────────────────────

const ADMIN_TABS = [
  { value: 'templates', label: 'Templates' },
  { value: 'sms-products', label: 'SMS Products' },
  { value: 'sms-orders', label: 'SMS Orders' },
  { value: 'products', label: 'Products' },
  { value: 'add-product', label: 'Add Product' },
  { value: 'bulk-upload', label: 'Bulk Upload' },
  { value: 'discount-codes', label: 'Discount Codes' },
  { value: 'categories', label: 'Categories' },
  { value: 'users', label: 'Users' },
  { value: 'sales', label: 'Sales' },
  { value: 'histories', label: 'Transactions' },
  { value: 'email', label: 'Email' },
  { value: 'staff', label: 'Staff Roles' },
] as const

type AdminTabValue = (typeof ADMIN_TABS)[number]['value']

const EXPLICIT_PRODUCT_RELATIONSHIP_TYPES = [
  'COMPATIBLE_WITH',
  'REPLACEMENT_FOR',
  'REQUIRES',
  'COMPLEMENT',
  'SUBSTITUTE',
  'ALTERNATIVE',
  'VARIANT',
  'UPGRADE',
  'DOWNGRADE',
] as const

type ExplicitProductRelationshipType = (typeof EXPLICIT_PRODUCT_RELATIONSHIP_TYPES)[number]
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

type AdminDepositTransaction = {
  id: string
  user_id: string
  type: string
  amount: number
  status?: string | null
  reference?: string | null
  ercas_reference?: string | null
  balance_after?: number | null
  description?: string | null
  created_at: string
  user_email?: string | null
  user_name?: string | null
}

type AdminHistoryKind = 'all' | 'deposits' | 'products' | 'sms' | 'crypto' | 'bills' | 'giftcards' | 'social'

type AdminHistoryRow = {
  id: string
  kind: Exclude<AdminHistoryKind, 'all'>
  date: string
  user_id?: string | null
  user_email?: string | null
  user_name?: string | null
  user_is_staff?: boolean | null
  user_is_admin?: boolean | null
  title: string
  subtitle?: string | null
  amount?: number | null
  status?: string | null
  reference?: string | null
  source: string
  detail?: string | null
  raw?: Record<string, any>
}

function isDepositTransaction(tx: { type?: string | null; amount?: number | null }) {
  const type = String(tx.type || '').toLowerCase()
  const amount = Number(tx.amount || 0)
  if (amount <= 0) return false
  if (/(purchase|order|withdraw|debit|refund|spent)/.test(type)) return false
  return /(topup|top_up|top-up|deposit|credit|wallet)/.test(type)
}

function isCompletedDeposit(status?: string | null) {
  return ['completed', 'success', 'successful', 'credited'].includes(String(status || '').toLowerCase())
}

function formatAdminNaira(value?: number | null) {
  const amount = Number(value || 0)
  return `₦${amount.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`
}

function normalizeStatus(status?: string | null) {
  return String(status || 'unknown').replace(/_/g, ' ')
}

function isPositiveStatus(status?: string | null) {
  return ['completed', 'success', 'successful', 'credited', 'active', 'processing'].includes(String(status || '').toLowerCase())
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

  // Website-wide activity histories
  const [historyRows, setHistoryRows] = useState<AdminHistoryRow[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historySearchQuery, setHistorySearchQuery] = useState('')
  const [historyErrors, setHistoryErrors] = useState<Record<string, string>>({})

  // Sales analytics and recommendation automation
  const [salesOrders, setSalesOrders] = useState<any[]>([])
  const [salesSmsOrders, setSalesSmsOrders] = useState<any[]>([])
  const [salesProfiles, setSalesProfiles] = useState<any[]>([])
  const [salesVisits, setSalesVisits] = useState<any[]>([])
  const [revenueEvents, setRevenueEvents] = useState<any[]>([])
  const [croDecisionRows, setCroDecisionRows] = useState<any[]>([])
  const [croExperimentRows, setCroExperimentRows] = useState<any[]>([])
  const [croInsightRows, setCroInsightRows] = useState<any[]>([])
  const [croRelationshipRows, setCroRelationshipRows] = useState<any[]>([])
  const [revenueQualityRows, setRevenueQualityRows] = useState<any[]>([])
  const [revenueFeatureRows, setRevenueFeatureRows] = useState<any[]>([])
  const [croOpportunityRows, setCroOpportunityRows] = useState<any[]>([])
  const [revenueForecastRows, setRevenueForecastRows] = useState<any[]>([])
  const [croEvaluationRows, setCroEvaluationRows] = useState<any[]>([])
  const [croSimulationRows, setCroSimulationRows] = useState<any[]>([])
  const [croDriftRows, setCroDriftRows] = useState<any[]>([])
  const [croModelRows, setCroModelRows] = useState<any[]>([])
  const [revenueIdentityLinks, setRevenueIdentityLinks] = useState<any[]>([])
  const [croActionPlanRows, setCroActionPlanRows] = useState<any[]>([])
  const [croLifecycleActionRows, setCroLifecycleActionRows] = useState<any[]>([])
  const [communicationPreferenceRows, setCommunicationPreferenceRows] = useState<any[]>([])
  const [salesLoading, setSalesLoading] = useState(false)
  const [salesTargetInput, setSalesTargetInput] = useState('0')
  const [salesTargetSaving, setSalesTargetSaving] = useState(false)
  const [promotionMaxDiscountPct, setPromotionMaxDiscountPct] = useState('20')
  const [promotionMonthlyBudgetNgn, setPromotionMonthlyBudgetNgn] = useState('0')
  const [recommendationAutomationEnabled, setRecommendationAutomationEnabled] = useState(true)
  const [recommendationAutomationSaving, setRecommendationAutomationSaving] = useState(false)
  const [croGlobalEnabled, setCroGlobalEnabled] = useState(true)
  const [croShadowModeEnabled, setCroShadowModeEnabled] = useState(false)
  const [croAutonomyLevel, setCroAutonomyLevel] = useState('2')
  const [croGlobalHoldoutPct, setCroGlobalHoldoutPct] = useState('5')
  const [croExperimentationEnabled, setCroExperimentationEnabled] = useState(true)
  const [croControlSaving, setCroControlSaving] = useState(false)
  const [croActionPlanUpdatingKey, setCroActionPlanUpdatingKey] = useState<string | null>(null)
  const [croMaintenanceEnabled, setCroMaintenanceEnabled] = useState(true)
  const [croMaintenanceSaving, setCroMaintenanceSaving] = useState(false)
  const [croMaintenanceRunning, setCroMaintenanceRunning] = useState(false)
  const [croMaintenanceLastRunAt, setCroMaintenanceLastRunAt] = useState('')
  const [croMaintenanceLastStatus, setCroMaintenanceLastStatus] = useState('never_run')
  const [croMaintenanceLastSummary, setCroMaintenanceLastSummary] = useState<Record<string, any>>({})
  const [croMaintenanceFreezeReason, setCroMaintenanceFreezeReason] = useState('')
  const [lifecycleActionUpdatingKey, setLifecycleActionUpdatingKey] = useState<string | null>(null)
  const [dataQualityScanning, setDataQualityScanning] = useState(false)
  const [productGraphBuilding, setProductGraphBuilding] = useState(false)
  const [explicitRelationshipSaving, setExplicitRelationshipSaving] = useState(false)
  const [explicitRelationshipDraft, setExplicitRelationshipDraft] = useState<{
    fromProductId: string
    toProductId: string
    relationshipType: ExplicitProductRelationshipType
    strength: string
  }>({
    fromProductId: '',
    toProductId: '',
    relationshipType: 'COMPATIBLE_WITH',
    strength: '1',
  })
  const [runtimeIntelligenceRefreshing, setRuntimeIntelligenceRefreshing] = useState(false)
  const [experimentCreatingKey, setExperimentCreatingKey] = useState<string | null>(null)
  const [evaluationRunning, setEvaluationRunning] = useState(false)
  const [salesErrors, setSalesErrors] = useState<Record<string, string>>({})

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

  // SMS Orders management
  type AdminSmsOrder = {
    id: string; reference: string; service_name: string; status: string
    price_ngn: number; created_at: string; cancelled_at?: string; refunded_at?: string
    messages?: any[]; order_type: string; provider_request_id?: string
    profiles?: { email?: string; full_name?: string }
  }
  const [smsOrders, setSmsOrders] = useState<AdminSmsOrder[]>([])
  const [smsOrdersLoading, setSmsOrdersLoading] = useState(false)
  const [smsOrdersCancellingId, setSmsOrdersCancellingId] = useState<string | null>(null)
  const [smsOrdersAutoCancelling, setSmsOrdersAutoCancelling] = useState(false)
  const [smsOrdersFilter, setSmsOrdersFilter] = useState<'all' | 'pending' | 'cancelled' | 'completed'>('all')

  const loadSmsOrders = useCallback(async () => {
    setSmsOrdersLoading(true)
    try {
      const { data, error } = await supabase.functions.invoke('smsbus', { body: { action: 'admin_sms_orders' } })
      if (error) throw error
      if (!data?.success) throw new Error(data?.error || 'Failed to load SMS orders')
      setSmsOrders(data.data || [])
    } catch (err: any) {
      toast({ title: 'Failed to load SMS orders', description: err.message, variant: 'destructive' })
    } finally {
      setSmsOrdersLoading(false)
    }
  }, [toast])

  const adminCancelSmsOrder = useCallback(async (orderId: string) => {
    setSmsOrdersCancellingId(orderId)
    try {
      const { data, error } = await supabase.functions.invoke('smsbus', { body: { action: 'admin_cancel_sms_order', order_id: orderId } })
      if (error) throw error
      if (!data?.success) throw new Error(data?.error || 'Failed to cancel order')
      toast({ title: 'Order cancelled & refunded' })
      await loadSmsOrders()
    } catch (err: any) {
      toast({ title: 'Cancel failed', description: err.message, variant: 'destructive' })
    } finally {
      setSmsOrdersCancellingId(null)
    }
  }, [toast, loadSmsOrders])

  const adminAutoCancelStale = useCallback(async () => {
    setSmsOrdersAutoCancelling(true)
    try {
      const { data, error } = await supabase.functions.invoke('smsbus', { body: { action: 'admin_auto_cancel_stale' } })
      if (error) throw error
      if (!data?.success) throw new Error(data?.error || 'Failed to auto-cancel')
      toast({ title: `Auto-cancelled ${data.cancelled_count ?? 0} stale order(s)` })
      await loadSmsOrders()
    } catch (err: any) {
      toast({ title: 'Auto-cancel failed', description: err.message, variant: 'destructive' })
    } finally {
      setSmsOrdersAutoCancelling(false)
    }
  }, [toast, loadSmsOrders])


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
      } else if (action.action_type === 'add_single_account') {
        const { product_group_id, username, password, email } = action.action_data
        const account = await createIndividualAccount({
          product_group_id,
          username,
          password,
          email,
          status: 'available',
        })
        if (!account) throw new Error('Failed to add account')
        const updatedProductGroups = await getAllProductGroups()
        setProductGroups(updatedProductGroups)
      } else if (action.action_type === 'bulk_upload_accounts') {
        const { product_group_id, parsed_rows } = action.action_data
        const csvRows = Array.isArray(parsed_rows) ? parsed_rows : []
        const result = await processBulkAccountUpload(csvRows, product_group_id)
        if (!result.success) throw new Error(result.error || 'Failed to apply bulk account upload')
        const updatedProductGroups = await getAllProductGroups()
        setProductGroups(updatedProductGroups)
      } else {
        throw new Error(`Unsupported action type: ${action.action_type}`)
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

  const loadAdminHistories = useCallback(async () => {
    setHistoryLoading(true)
    const nextErrors: Record<string, string> = {}

    const readRows = async (label: string, table: string, limit = 1000) => {
      try {
        const { data, error } = await supabase
          .from(table as any)
          .select('*')
          .order('created_at', { ascending: false })
          .limit(limit)

        if (error) throw error
        return (data || []) as any[]
      } catch (err: any) {
        console.warn(`Failed to load ${label}:`, err)
        nextErrors[label] = err?.message || `Could not load ${label}.`
        return [] as any[]
      }
    }

    try {
      const [
        txRows,
        productOrderRows,
        smsOrderRows,
        cryptoTxRows,
        cryptoWithdrawalRows,
        billsRows,
        giftRows,
        socialRows,
      ] = await Promise.all([
        readRows('Deposits', 'transactions', 5000),
        readRows('Product orders', 'orders', 5000),
        readRows('SMS orders', 'sms_orders', 5000),
        readRows('Crypto deposits', 'crypto_transactions', 5000),
        readRows('Crypto withdrawals', 'crypto_withdrawals', 5000),
        readRows('Bills and airtime', 'bills_transactions', 5000),
        readRows('Gift cards and eSIMs', 'bitrefill_orders', 5000),
        readRows('Social boost', 'smm_orders', 5000),
      ])

      const productGroupById = new Map(productGroups.map((group) => [group.id, group]))
      const categoryById = new Map(categories.map((category) => [category.id, category]))
      const smmServiceById = new Map(smmServices.map((service) => [Number(service.id), service]))

      const rows: AdminHistoryRow[] = [
        ...txRows.filter((tx) => isDepositTransaction(tx) && isCompletedDeposit(tx.status)).map((tx): AdminHistoryRow => ({
          id: `deposit-${tx.id}`,
          kind: 'deposits',
          date: tx.created_at,
          user_id: tx.user_id,
          title: tx.description || normalizeStatus(tx.type) || 'Wallet deposit',
          subtitle: tx.ercas_reference ? `Ercas ${tx.ercas_reference}` : 'Wallet funding',
          amount: Number(tx.amount || 0),
          status: tx.status,
          reference: tx.reference || tx.ercas_reference,
          source: 'Wallet deposits',
          detail: tx.balance_after == null ? null : `Balance after ${formatAdminNaira(tx.balance_after)}`,
          raw: tx,
        })),
        ...productOrderRows.map((order): AdminHistoryRow => {
          const group = productGroupById.get(order.product_group_id)
          const category = group?.category_id ? categoryById.get(group.category_id)?.name : null
          const details = order.account_details || {}
          const quantity = Number(details.quantity || 1)
          return {
            id: `product-${order.id}`,
            kind: 'products',
            date: order.created_at,
            user_id: order.user_id,
            title: details.product_name || group?.name || 'Product order',
            subtitle: `${quantity} item${quantity === 1 ? '' : 's'}${details.category || category ? ` • ${details.category || category}` : ''}`,
            amount: Number(order.amount || 0),
            status: order.status,
            reference: `ORD-${String(order.id || '').slice(0, 8).toUpperCase()}`,
            source: 'Product orders',
            detail: order.product_group_id || null,
            raw: order,
          }
        }),
        ...smsOrderRows.map((order): AdminHistoryRow => ({
          id: `sms-${order.id}`,
          kind: 'sms',
          date: order.created_at,
          user_id: order.user_id,
          title: order.service_name || order.service_id || 'SMS number',
          subtitle: [order.order_type?.toUpperCase(), order.phone_number, order.country_code?.toUpperCase()].filter(Boolean).join(' • '),
          amount: Number(order.price_ngn || 0),
          status: order.status,
          reference: order.reference || order.provider_request_id,
          source: 'SMS orders',
          detail: order.refunded_at ? `Refunded ${formatAdminNaira(order.refund_amount_ngn)}` : order.completed_at ? 'Code received' : null,
          raw: order,
        })),
        ...cryptoTxRows.map((tx): AdminHistoryRow => ({
          id: `crypto-tx-${tx.id}`,
          kind: 'crypto',
          date: tx.created_at,
          user_id: tx.user_id,
          title: `${tx.crypto_type || 'Crypto'} ${normalizeStatus(tx.transaction_type || 'deposit')}`,
          subtitle: tx.nowpayments_network || tx.payment_provider || 'Crypto deposit',
          amount: Number(tx.naira_amount || 0),
          status: tx.status,
          reference: tx.payment_reference || tx.nowpayments_payment_id,
          source: 'Crypto deposits',
          detail: tx.crypto_amount ? `${tx.crypto_amount} ${tx.crypto_type || ''}`.trim() : null,
          raw: tx,
        })),
        ...cryptoWithdrawalRows.map((withdrawal): AdminHistoryRow => ({
          id: `crypto-withdrawal-${withdrawal.id}`,
          kind: 'crypto',
          date: withdrawal.created_at,
          user_id: withdrawal.user_id,
          title: `Withdrawal to ${withdrawal.bank_name || 'bank'}`,
          subtitle: [withdrawal.account_name, withdrawal.account_number].filter(Boolean).join(' • '),
          amount: Number(withdrawal.amount || 0),
          status: withdrawal.status,
          reference: withdrawal.payment_reference || withdrawal.sagecloud_reference,
          source: 'Crypto withdrawals',
          detail: withdrawal.net_amount ? `Net ${formatAdminNaira(withdrawal.net_amount)} • Fee ${formatAdminNaira(withdrawal.fee)}` : null,
          raw: withdrawal,
        })),
        ...billsRows.map((bill): AdminHistoryRow => ({
          id: `bill-${bill.id}`,
          kind: 'bills',
          date: bill.created_at,
          user_id: bill.user_id,
          title: `${bill.service_provider || 'Bills'} ${normalizeStatus(bill.transaction_type)}`,
          subtitle: [bill.beneficiary_phone, bill.payment_source].filter(Boolean).join(' • '),
          amount: Number(bill.amount || 0),
          status: bill.status,
          reference: bill.reference || bill.sagecloud_reference,
          source: 'Bills and airtime',
          detail: bill.service_code || null,
          raw: bill,
        })),
        ...giftRows.map((gift): AdminHistoryRow => ({
          id: `gift-${gift.id}`,
          kind: 'giftcards',
          date: gift.created_at,
          user_id: gift.user_id,
          title: gift.product_name || 'Gift card / eSIM',
          subtitle: `${gift.quantity || 1} item${Number(gift.quantity || 1) === 1 ? '' : 's'} • ${gift.payment_source || 'wallet'}`,
          amount: Number(gift.amount_ngn || 0),
          status: gift.status,
          reference: gift.reference || gift.bitrefill_order_id || gift.bitrefill_invoice_id,
          source: 'Gift cards and eSIMs',
          detail: gift.redemption_code || gift.redemption_link ? 'Redemption delivered' : gift.currency ? `${gift.amount_original || ''} ${gift.currency}`.trim() : null,
          raw: gift,
        })),
        ...socialRows.map((order): AdminHistoryRow => {
          const service = smmServiceById.get(Number(order.service_id))
          return {
            id: `social-${order.id}`,
            kind: 'social',
            date: order.created_at,
            user_id: order.user_id,
            title: service?.name || `Social service ${order.service_id || ''}`.trim(),
            subtitle: [service?.platform, `${Number(order.quantity || 0).toLocaleString()} units`, order.link].filter(Boolean).join(' • '),
            amount: Number(order.amount_ngn || 0),
            status: order.status,
            reference: order.reference || order.external_order_id,
            source: 'Social boost',
            detail: order.remains != null ? `${Number(order.remains || 0).toLocaleString()} remains` : null,
            raw: order,
          }
        }),
      ]

      const userIds = Array.from(new Set(rows.map((row) => row.user_id).filter(Boolean))) as string[]
      const profileMap = new Map<string, { email?: string | null; full_name?: string | null; is_staff?: boolean | null; is_admin?: boolean | null }>()

      for (let i = 0; i < userIds.length; i += 500) {
        const slice = userIds.slice(i, i + 500)
        const { data, error } = await supabase
          .from('profiles')
          .select('id,email,full_name,is_staff,is_admin')
          .in('id', slice)

        if (error) {
          nextErrors.Profiles = error.message
          continue
        }

        for (const profile of data || []) {
          profileMap.set(profile.id, profile)
        }
      }

      setHistoryRows(
        rows
          .map((row) => {
            const profile = row.user_id ? profileMap.get(row.user_id) : null
            return {
              ...row,
              user_email: profile?.email || null,
              user_name: profile?.full_name || null,
              user_is_staff: profile?.is_staff ?? null,
              user_is_admin: profile?.is_admin ?? null,
            }
          })
          .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()),
      )
      setHistoryErrors(nextErrors)

      if (Object.keys(nextErrors).length > 0) {
        toast({
          title: 'Some histories could not load',
          description: Object.keys(nextErrors).join(', '),
          variant: 'destructive',
        })
      }
    } finally {
      setHistoryLoading(false)
    }
  }, [categories, productGroups, smmServices, toast])

  useEffect(() => {
    if ((adminTab === 'histories' || adminTab === 'sales') && historyRows.length === 0) {
      loadAdminHistories()
    }
  }, [adminTab, historyRows.length, loadAdminHistories])

  const loadSalesAnalytics = useCallback(async () => {
    setSalesLoading(true)
    const nextErrors: Record<string, string> = {}

    const readRows = async (label: string, table: string, limit = 10000) => {
      try {
        const { data, error } = await supabase
          .from(table as any)
          .select('*')
          .order('created_at', { ascending: false })
          .limit(limit)

        if (error) throw error
        return (data || []) as any[]
      } catch (err: any) {
        console.warn(`Failed to load ${label}:`, err)
        nextErrors[label] = err?.message || `Could not load ${label}.`
        return [] as any[]
      }
    }

    try {
      const [
        orders,
        allProfiles,
        visits,
        events,
        decisions,
        experiments,
        insights,
        relationships,
        qualityRows,
        featureRows,
        opportunityRows,
        forecastRows,
        evaluationRows,
        simulationRows,
        driftRows,
        modelRows,
        identityLinks,
        actionPlanRows,
        lifecycleActionRows,
        communicationPreferences,
        target,
        smsOrders,
        automation,
        croEnabled,
        croShadowMode,
        croLevel,
        croHoldoutPct,
        croExperimentation,
        promoMaxDiscountPct,
        promoMonthlyBudget,
        maintenanceEnabled,
        maintenanceLastRunAt,
        maintenanceLastStatus,
        maintenanceLastSummary,
        maintenanceFreezeReason,
      ] = await Promise.all([
        readRows('Orders', 'orders', 10000),
        readRows('Customers', 'profiles', 10000),
        readRows('Visitors', 'site_visits', 10000),
        readRows('Revenue events', 'revenue_events', 10000),
        readRows('CRO decisions', 'cro_decision_audit', 5000),
        readRows('CRO experiments', 'cro_experiments', 1000),
        readRows('CRO insights', 'cro_commercial_insights', 1000),
        readRows('Product relationships', 'product_relationships', 5000),
        readRows('Data quality checks', 'revenue_data_quality_checks', 1000),
        readRows('Feature snapshots', 'revenue_feature_snapshots', 1000),
        readRows('CRO opportunities', 'cro_opportunities', 1000),
        readRows('Revenue forecasts', 'revenue_forecasts', 1000),
        readRows('Experiment evaluations', 'cro_experiment_evaluations', 1000),
        readRows('Simulation runs', 'cro_simulation_runs', 1000),
        readRows('Drift checks', 'cro_drift_checks', 1000),
        readRows('Model registry', 'cro_model_registry', 1000),
        readRows('Revenue identity links', 'revenue_identity_links', 10000),
        readRows('CRO action plans', 'cro_action_plans', 1000),
        readRows('Lifecycle actions', 'cro_lifecycle_actions', 1000),
        readRows('Communication preferences', 'customer_communication_preferences', 10000),
        getAppSetting('sales_monthly_target_ngn').catch((err) => {
          nextErrors.Target = err?.message || 'Could not load sales target.'
          return null
        }),
        readRows('SMS orders', 'sms_orders', 10000),
        getAppSetting('sales_recommendation_automation_enabled').catch((err) => {
          nextErrors.Automation = err?.message || 'Could not load automation setting.'
          return null
        }),
        getAppSetting('cro_global_enabled').catch(() => 'true'),
        getAppSetting('cro_shadow_mode_enabled').catch(() => 'false'),
        getAppSetting('cro_autonomy_level').catch(() => '2'),
        getAppSetting('cro_global_holdout_pct').catch(() => '5'),
        getAppSetting('cro_experimentation_enabled').catch(() => 'true'),
        getAppSetting('cro_promotion_max_discount_pct').catch(() => '20'),
        getAppSetting('cro_promotion_monthly_budget_ngn').catch(() => '0'),
        getAppSetting('cro_maintenance_enabled').catch(() => 'true'),
        getAppSetting('cro_maintenance_last_run_at').catch(() => ''),
        getAppSetting('cro_maintenance_last_status').catch(() => 'never_run'),
        getAppSetting('cro_maintenance_last_summary').catch(() => '{}'),
        getAppSetting('cro_maintenance_freeze_reason').catch(() => ''),
      ])

      const orderUserIds = Array.from(new Set([
        ...orders.map((order) => order.user_id).filter(Boolean),
        ...smsOrders.map((order) => order.user_id).filter(Boolean),
      ])) as string[]
      const profileById = new Map<string, any>((allProfiles || []).map((profile) => [profile.id, profile]))

      for (let i = 0; i < orderUserIds.length; i += 500) {
        const slice = orderUserIds.slice(i, i + 500)
        try {
          const { data, error } = await supabase
            .from('profiles')
            .select('id,email,full_name,is_staff,is_admin,created_at')
            .in('id', slice)

          if (error) throw error
          for (const profile of data || []) {
            profileById.set(profile.id, profile)
          }
        } catch (err: any) {
          nextErrors.CustomerProfiles = err?.message || 'Could not load order customer profiles.'
        }
      }

      setSalesOrders(orders)
      setSalesSmsOrders(smsOrders)
      setSalesProfiles(Array.from(profileById.values()))
      setSalesVisits(visits)
      setRevenueEvents(events)
      setCroDecisionRows(decisions)
      setCroExperimentRows(experiments)
      setCroInsightRows(insights)
      setCroRelationshipRows(relationships)
      setRevenueQualityRows(qualityRows)
      setRevenueFeatureRows(featureRows)
      setCroOpportunityRows(opportunityRows)
      setRevenueForecastRows(forecastRows)
      setCroEvaluationRows(evaluationRows)
      setCroSimulationRows(simulationRows)
      setCroDriftRows(driftRows)
      setCroModelRows(modelRows)
      setRevenueIdentityLinks(identityLinks)
      setCroActionPlanRows(actionPlanRows)
      setCroLifecycleActionRows(lifecycleActionRows)
      setCommunicationPreferenceRows(communicationPreferences)
      setSalesTargetInput(target || '0')
      setRecommendationAutomationEnabled(automation !== 'false')
      setCroGlobalEnabled(croEnabled !== 'false')
      setCroShadowModeEnabled(croShadowMode === 'true')
      setCroAutonomyLevel(croLevel || '2')
      setCroGlobalHoldoutPct(croHoldoutPct || '5')
      setCroExperimentationEnabled(croExperimentation !== 'false')
      setPromotionMaxDiscountPct(promoMaxDiscountPct || '20')
      setPromotionMonthlyBudgetNgn(promoMonthlyBudget || '0')
      setCroMaintenanceEnabled(maintenanceEnabled !== 'false')
      setCroMaintenanceLastRunAt(maintenanceLastRunAt || '')
      setCroMaintenanceLastStatus(maintenanceLastStatus || 'never_run')
      setCroMaintenanceFreezeReason(maintenanceFreezeReason || '')
      try {
        setCroMaintenanceLastSummary(JSON.parse(maintenanceLastSummary || '{}'))
      } catch {
        setCroMaintenanceLastSummary({})
      }
      setSalesErrors(nextErrors)
    } finally {
      setSalesLoading(false)
    }
  }, [])

  useEffect(() => {
    if (adminTab === 'sales' && salesOrders.length === 0) {
      loadSalesAnalytics()
    }
  }, [adminTab, loadSalesAnalytics, salesOrders.length])

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

  const historySearchMatches = useCallback((row: AdminHistoryRow, query: string) => {
    if (!query) return true
    const haystack = [
      row.user_email,
      row.user_name,
      row.user_id,
      row.kind,
      row.source,
      row.title,
      row.subtitle,
      row.status,
      row.reference,
      row.detail,
    ].join(' ').toLowerCase()
    return haystack.includes(query)
  }, [])

  const salesFilteredHistoryRows = useMemo(() => {
    const query = historySearchQuery.trim().toLowerCase()
    return historyRows
      .filter((row) => !row.user_is_staff && !row.user_is_admin)
      .filter((row) => historySearchMatches(row, query))
  }, [historyRows, historySearchMatches, historySearchQuery])

  const depositHistoryRows = useMemo(() => {
    const query = historySearchQuery.trim().toLowerCase()
    return historyRows
      .filter((row) => row.kind === 'deposits')
      .filter((row) => isCompletedDeposit(row.status))
      .filter((row) => !row.user_is_staff && !row.user_is_admin)
      .filter((row) => historySearchMatches(row, query))
  }, [historyRows, historySearchMatches, historySearchQuery])

  const filteredHistoryRows = depositHistoryRows

  const historyStats = useMemo(() => {
    return depositHistoryRows.reduce(
      (acc, tx) => {
        const amount = Number(tx.amount || 0)
        acc.count += 1
        acc.total += amount
        acc.byKind[tx.kind] = (acc.byKind[tx.kind] || 0) + 1
        acc.completedCount += 1
        acc.completedTotal += amount
        return acc
      },
      {
        count: 0,
        total: 0,
        completedCount: 0,
        completedTotal: 0,
        pendingCount: 0,
        pendingTotal: 0,
        byKind: {} as Record<string, number>,
      },
    )
  }, [depositHistoryRows])

  const visibleHistorySections = useMemo(() => {
    const sections: Array<{
      key: Exclude<AdminHistoryKind, 'all'>
      title: string
      description: string
      icon: ReactNode
    }> = [
      { key: 'deposits', title: 'Deposit History', description: 'Wallet top-ups, credits, and successful deposit records.', icon: <WalletCards className="h-5 w-5" /> },
      { key: 'products', title: 'Product Order History', description: 'Social account product purchases from the main inventory.', icon: <ShoppingBag className="h-5 w-5" /> },
      { key: 'sms', title: 'SMS History', description: 'US/Canada SMS number purchases, cancellations, and refunds.', icon: <PhoneCall className="h-5 w-5" /> },
      { key: 'crypto', title: 'Crypto History', description: 'Crypto sell deposits and crypto balance withdrawals.', icon: <Bitcoin className="h-5 w-5" /> },
      { key: 'bills', title: 'Bills & Airtime History', description: 'Airtime, data, and Nigerian bill payment records.', icon: <Smartphone className="h-5 w-5" /> },
      { key: 'giftcards', title: 'Gift Card & eSIM History', description: 'Bitrefill gift card and eSIM purchases.', icon: <Gift className="h-5 w-5" /> },
      { key: 'social', title: 'Social Boost History', description: 'SMM/social boost orders and their latest statuses.', icon: <Megaphone className="h-5 w-5" /> },
    ]

    return sections.map((section) => ({
      ...section,
      rows: salesFilteredHistoryRows.filter((row) => row.kind === section.key),
      totalRows: historyRows.filter((row) => row.kind === section.key && !row.user_is_staff && !row.user_is_admin).length,
    }))
  }, [historyRows, salesFilteredHistoryRows])

  const salesAnalytics = useMemo(() => {
    const now = new Date()
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const weekStart = new Date(now)
    weekStart.setDate(now.getDate() - 7)
    const monthStart = new Date(now)
    monthStart.setDate(now.getDate() - 30)
    const calendarMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const previousWeekStart = new Date(now)
    previousWeekStart.setDate(now.getDate() - 14)

    const productGroupById = new Map(productGroups.map((group) => [group.id, group]))
    const categoryById = new Map(categories.map((category) => [category.id, category]))
    const profileById = new Map(salesProfiles.map((profile) => [profile.id, profile]))
    const isInternalProfile = (profile: any) => !!profile?.is_staff || !!profile?.is_admin
    const isInternalOrder = (order: any) => {
      const profile = order.user_id ? profileById.get(order.user_id) : null
      return isInternalProfile(profile)
    }
    const completedOrders = salesOrders
      .filter((order) => String(order.status || '').toLowerCase() === 'completed')
      .filter((order) => !isInternalOrder(order))

    const getQuantity = (order: any) => {
      const details = order.account_details || {}
      const quantity = Number(details.quantity || 1)
      return Number.isFinite(quantity) && quantity > 0 ? quantity : 1
    }

    const daily = new Map<string, { date: string; revenue: number; orders: number; units: number }>()
    const products = new Map<string, { id: string; name: string; category: string; revenue: number; orders: number; units: number; stock: number }>()
    const customers = new Map<string, { id: string; email: string; name: string; revenue: number; orders: number; units: number; lastOrder: string }>()
    const categoryTrend = new Map<string, { category: string; recent: number; previous: number; recentUnits: number; previousUnits: number }>()

    for (const order of completedOrders) {
      const createdAt = new Date(order.created_at)
      const day = Number.isNaN(createdAt.getTime()) ? 'Unknown' : format(createdAt, 'yyyy-MM-dd')
      const amount = Number(order.amount || 0)
      const units = getQuantity(order)
      const details = order.account_details || {}
      const group = productGroupById.get(order.product_group_id)
      const categoryName = details.category || (group?.category_id ? categoryById.get(group.category_id)?.name : null) || 'Uncategorized'
      const productId = order.product_group_id || details.product_name || order.id
      const productName = details.product_name || group?.name || 'Unknown product'

      const dailyEntry = daily.get(day) || { date: day, revenue: 0, orders: 0, units: 0 }
      dailyEntry.revenue += amount
      dailyEntry.orders += 1
      dailyEntry.units += units
      daily.set(day, dailyEntry)

      const productEntry = products.get(productId) || {
        id: productId,
        name: productName,
        category: categoryName,
        revenue: 0,
        orders: 0,
        units: 0,
        stock: Number(group?.stock_count || 0),
      }
      productEntry.revenue += amount
      productEntry.orders += 1
      productEntry.units += units
      products.set(productId, productEntry)

      const profile = profileById.get(order.user_id)
      const customerEntry = customers.get(order.user_id) || {
        id: order.user_id,
        email: profile?.email || profile?.full_name || `Customer ${String(order.user_id || '').slice(0, 8)}`,
        name: profile?.full_name || '',
        revenue: 0,
        orders: 0,
        units: 0,
        lastOrder: order.created_at,
      }
      customerEntry.revenue += amount
      customerEntry.orders += 1
      customerEntry.units += units
      if (new Date(order.created_at).getTime() > new Date(customerEntry.lastOrder).getTime()) {
        customerEntry.lastOrder = order.created_at
      }
      customers.set(order.user_id, customerEntry)

      const trendEntry = categoryTrend.get(categoryName) || { category: categoryName, recent: 0, previous: 0, recentUnits: 0, previousUnits: 0 }
      if (createdAt >= weekStart) {
        trendEntry.recent += amount
        trendEntry.recentUnits += units
      } else if (createdAt >= previousWeekStart && createdAt < weekStart) {
        trendEntry.previous += amount
        trendEntry.previousUnits += units
      }
      categoryTrend.set(categoryName, trendEntry)
    }

    const dailyRows = Array.from(daily.values()).sort((a, b) => b.revenue - a.revenue)
    const productRows = Array.from(products.values()).sort((a, b) => b.revenue - a.revenue || b.units - a.units)
    const customerRows = Array.from(customers.values()).sort((a, b) => b.revenue - a.revenue || b.orders - a.orders)
    const trendRows = Array.from(categoryTrend.values())
      .map((trend) => ({
        ...trend,
        growth: trend.previous > 0 ? ((trend.recent - trend.previous) / trend.previous) * 100 : trend.recent > 0 ? 100 : 0,
      }))
      .filter((trend) => trend.recent > 0 || trend.previous > 0)
      .sort((a, b) => b.growth - a.growth || b.recent - a.recent)

    const countProfilesSince = (date: Date) =>
      salesProfiles.filter((profile) => !isInternalProfile(profile) && profile.created_at && new Date(profile.created_at) >= date).length

    const trustedVisits = salesVisits.filter((visit) => !['bot', 'internal'].includes(String(visit.traffic_quality || 'human').toLowerCase()))

    const uniqueVisitorsSince = (date: Date) =>
      new Set(
        trustedVisits
          .filter((visit) => visit.created_at && new Date(visit.created_at) >= date)
          .map((visit) => visit.visitor_id || visit.user_id || visit.id),
      ).size

    const visitsSince = (date: Date) =>
      trustedVisits.filter((visit) => visit.created_at && new Date(visit.created_at) >= date).length

    const trafficQualityCounts = salesVisits.reduce<Record<string, number>>((acc, visit) => {
      const quality = String(visit.traffic_quality || 'human')
      acc[quality] = (acc[quality] || 0) + 1
      return acc
    }, {})

    const monthlyRevenue = completedOrders
      .filter((order) => order.created_at && new Date(order.created_at) >= calendarMonthStart)
      .reduce((sum, order) => sum + Number(order.amount || 0), 0)
    const monthlyTarget = Number(salesTargetInput || 0)

    return {
      totalRevenue: completedOrders.reduce((sum, order) => sum + Number(order.amount || 0), 0),
      totalOrders: completedOrders.length,
      totalUnits: completedOrders.reduce((sum, order) => sum + getQuantity(order), 0),
      bestDay: dailyRows[0] || null,
      bestProduct: productRows[0] || null,
      highSellingProducts: productRows.slice(0, 8),
      bestCustomers: customerRows.slice(0, 8),
      marketTrends: trendRows.slice(0, 8),
      newCustomers: {
        today: countProfilesSince(dayStart),
        week: countProfilesSince(weekStart),
        month: countProfilesSince(monthStart),
      },
      visitors: {
        today: uniqueVisitorsSince(dayStart),
        week: uniqueVisitorsSince(weekStart),
        month: uniqueVisitorsSince(monthStart),
        visitsToday: visitsSince(dayStart),
        visitsWeek: visitsSince(weekStart),
        visitsMonth: visitsSince(monthStart),
        trafficQualityCounts,
      },
      target: {
        monthlyRevenue,
        monthlyTarget,
        progress: monthlyTarget > 0 ? Math.min(100, (monthlyRevenue / monthlyTarget) * 100) : 0,
        remaining: Math.max(0, monthlyTarget - monthlyRevenue),
      },
    }
  }, [categories, productGroups, salesOrders, salesProfiles, salesTargetInput, salesVisits])

  const userEmailById = useMemo(() => {
    return new Map(salesProfiles.map((profile) => [String(profile.id), profile.email || profile.full_name || '']))
  }, [salesProfiles])

  const communicationPreferenceByUserId = useMemo(() => {
    return new Map(communicationPreferenceRows.map((row) => [String(row.user_id), row]))
  }, [communicationPreferenceRows])

  const explicitRelationshipProductOptions = useMemo(() => {
    return [...productGroups]
      .filter((product) => product.is_active !== false)
      .sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')))
      .slice(0, 500)
  }, [productGroups])

  const revenueOsHealth = useMemo(() => {
    const latestByCheck = new Map<string, any>()
    for (const row of revenueQualityRows) {
      const key = `${row.check_key || row.checkKey || 'unknown'}:${row.scope || 'global'}`
      const previous = latestByCheck.get(key)
      const rowTime = row.created_at ? new Date(row.created_at).getTime() : 0
      const previousTime = previous?.created_at ? new Date(previous.created_at).getTime() : -1
      if (!previous || rowTime >= previousTime) latestByCheck.set(key, row)
    }
    const latestQualityRows = Array.from(latestByCheck.values())
    const criticalFailures = latestQualityRows.filter((row) => row.status === 'failed' && row.severity === 'critical')
    const latestLifecycleSnapshot = revenueFeatureRows.find((row) => row.scope_type === 'store' && row.scope_id === 'customer_lifecycle') || null
    const latestAnomalies = croDriftRows
      .filter((row) => String(row.model_key || '').startsWith('anomaly_'))
      .sort((a, b) => new Date(b.created_at || b.period_end || 0).getTime() - new Date(a.created_at || a.period_end || 0).getTime())
      .slice(0, 6)
    const customerLifecycleRows = revenueFeatureRows.filter((row) => row.scope_type === 'customer' && row.features?.lifecycle_stage)
    const customersWithNextCandidates = customerLifecycleRows.filter((row) => Array.isArray(row.features?.next_purchase_candidates) && row.features.next_purchase_candidates.length > 0).length
    const attributionRows = revenueFeatureRows
      .filter((row) => row.scope_type === 'session' && String(row.snapshot_key || '').startsWith('attribution:'))
      .sort((a, b) => Number(b.features?.visitors || 0) - Number(a.features?.visitors || 0))
      .slice(0, 6)
    const sourceEconomicsRows = [...revenueFeatureRows]
      .filter((row) => row.scope_type === 'session' && String(row.snapshot_key || '').startsWith('attribution:') && Number(row.features?.visitors || 0) >= 1)
      .sort((a, b) => Number(b.features?.revenue_per_visitor || 0) - Number(a.features?.revenue_per_visitor || 0))
      .slice(0, 5)
    const deviceRows = revenueFeatureRows
      .filter((row) => row.scope_type === 'session' && String(row.snapshot_key || '').startsWith('device:'))
      .sort((a, b) => Number(b.features?.visitors || 0) - Number(a.features?.visitors || 0))
      .slice(0, 4)
    const productIntelligenceRows = [...revenueFeatureRows]
      .filter((row) => row.scope_type === 'product' && String(row.snapshot_key || '').includes(':30d'))
      .sort((a, b) => Number(b.features?.revenue || b.features?.revenue_30d || 0) - Number(a.features?.revenue || a.features?.revenue_30d || 0))
      .slice(0, 8)
    const promotionFindings = analyzePromotionGuardrails({
      discountCodes,
      orders: salesOrders,
      products: productGroups,
      revenueEvents,
      maxDiscountPct: Number(promotionMaxDiscountPct || 20),
      monthlyBudgetNgn: Number(promotionMonthlyBudgetNgn || 0),
    })
    const promotionFailures = promotionFindings.filter((finding) => finding.status === 'failed')
    const banditRows = revenueFeatureRows
      .filter((row) => row.scope_type === 'store' && String(row.snapshot_key || '').startsWith('bandit:'))
      .sort((a, b) => new Date(b.created_at || b.window_end || 0).getTime() - new Date(a.created_at || a.window_end || 0).getTime())
      .slice(0, 6)
    const lifecycleActionCounts = croLifecycleActionRows.reduce<Record<string, number>>((acc, row) => {
      const status = String(row.status || 'unknown')
      acc[status] = (acc[status] || 0) + 1
      return acc
    }, {})

    return {
      activeExperiments: croExperimentRows.filter((row) => String(row.status || '').toLowerCase() === 'running').length,
      activeInsights: croInsightRows.filter((row) => String(row.status || '').toLowerCase() === 'active').length,
      relationships: croRelationshipRows.length,
      criticalFailures: criticalFailures.length,
      featureSnapshots: revenueFeatureRows.length,
      openOpportunities: croOpportunityRows.filter((row) => ['open', 'watching', 'testing'].includes(String(row.status || '').toLowerCase())).length,
      proposedActionPlans: croActionPlanRows.filter((row) => ['proposed', 'approved', 'running', 'paused'].includes(String(row.status || '').toLowerCase())).length,
      lifecycleActions: croLifecycleActionRows.length,
      lifecycleActionCounts,
      topLifecycleActions: [...croLifecycleActionRows]
        .filter((row) => ['needs_consent', 'queued', 'approved'].includes(String(row.status || '').toLowerCase()))
        .sort((a, b) => Number(b.expected_value || 0) - Number(a.expected_value || 0))
        .slice(0, 6),
      latestForecast: revenueForecastRows[0] || null,
      latestSimulation: croSimulationRows[0] || null,
      latestDrift: croDriftRows[0] || null,
      latestAnomalies,
      latestEvaluations: croEvaluationRows.slice(0, 6),
      modelRegistryCount: croModelRows.length,
      latestLifecycleSnapshot,
      lifecycleCounts: latestLifecycleSnapshot?.features?.lifecycle_counts || {},
      lifecycleCustomerSnapshots: customerLifecycleRows.length,
      customersWithNextCandidates,
      attributionRows,
      sourceEconomicsRows,
      deviceRows,
      productIntelligenceRows,
      banditRows,
      promotionFindings,
      promotionFailures,
      topOpportunities: [...croOpportunityRows]
        .filter((row) => ['open', 'watching', 'testing'].includes(String(row.status || '').toLowerCase()))
        .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0))
        .slice(0, 6),
      topActionPlans: [...croActionPlanRows]
        .filter((row) => ['proposed', 'approved', 'running', 'paused'].includes(String(row.status || '').toLowerCase()))
        .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0))
        .slice(0, 6),
      recentQualityRows: revenueQualityRows.slice(0, 8),
      recentExperiments: croExperimentRows.slice(0, 6),
      recentInsights: croInsightRows.slice(0, 6),
      recentDecisions: croDecisionRows.slice(0, 8),
    }
  }, [croActionPlanRows, croDecisionRows, croDriftRows, croEvaluationRows, croExperimentRows, croInsightRows, croLifecycleActionRows, croModelRows.length, croOpportunityRows, croRelationshipRows, croSimulationRows, discountCodes, productGroups, promotionMaxDiscountPct, promotionMonthlyBudgetNgn, revenueFeatureRows, revenueForecastRows, revenueQualityRows, salesOrders])

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

  const exportHistoryRows = () => {
    const rows = [
      ['Date', 'History', 'Source', 'User', 'User ID', 'Item', 'Details', 'Amount', 'Status', 'Reference'],
      ...filteredHistoryRows.map((row) => [
        row.date ? format(new Date(row.date), 'yyyy-MM-dd HH:mm:ss') : '',
        row.kind,
        row.source,
        row.user_email || row.user_name || 'Unknown user',
        row.user_id || '',
        row.title || '',
        [row.subtitle, row.detail].filter(Boolean).join(' | '),
        String(row.amount || 0),
        row.status || '',
        row.reference || '',
      ]),
    ]

    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `tallystore-transaction-history-${format(new Date(), 'yyyy-MM-dd')}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const handleSaveSalesTarget = async () => {
    const target = Number(salesTargetInput)
    if (!Number.isFinite(target) || target < 0) {
      toast({ title: 'Invalid target', description: 'Enter a valid monthly sales target.', variant: 'destructive' })
      return
    }

    setSalesTargetSaving(true)
    try {
      const ok = await upsertAppSetting('sales_monthly_target_ngn', String(Math.round(target)))
      if (!ok) throw new Error('Could not save sales target')
      toast({ title: 'Sales target saved', description: `Monthly target set to ${formatAdminNaira(target)}.` })
    } catch (err: any) {
      toast({ title: 'Failed to save target', description: err?.message || 'Please try again.', variant: 'destructive' })
    } finally {
      setSalesTargetSaving(false)
    }
  }

  const handleToggleRecommendationAutomation = async (enabled: boolean) => {
    setRecommendationAutomationSaving(true)
    try {
      const ok = await upsertAppSetting('sales_recommendation_automation_enabled', enabled ? 'true' : 'false')
      if (!ok) throw new Error('Could not save automation setting')
      setRecommendationAutomationEnabled(enabled)
      toast({
        title: enabled ? 'Recommendation automation enabled' : 'Recommendation automation disabled',
        description: enabled
          ? 'Customer product ordering will prioritize likely buys and trending products.'
          : 'Customer product ordering will stop using sales-based ranking.',
      })
    } catch (err: any) {
      toast({ title: 'Failed to save automation', description: err?.message || 'Please try again.', variant: 'destructive' })
    } finally {
      setRecommendationAutomationSaving(false)
    }
  }

  const handleSaveCroControls = async () => {
    const autonomy = Math.min(8, Math.max(0, Math.round(Number(croAutonomyLevel || 0))))
    const holdoutPct = Math.min(50, Math.max(0, Number(croGlobalHoldoutPct || 0)))
    if (!Number.isFinite(holdoutPct)) {
      toast({ title: 'Invalid holdout', description: 'Enter a holdout percentage from 0 to 50.', variant: 'destructive' })
      return
    }
    setCroControlSaving(true)
    try {
      const results = await Promise.all([
        upsertAppSetting('cro_global_enabled', croGlobalEnabled ? 'true' : 'false'),
        upsertAppSetting('cro_shadow_mode_enabled', croShadowModeEnabled ? 'true' : 'false'),
        upsertAppSetting('cro_autonomy_level', String(autonomy)),
        upsertAppSetting('cro_global_holdout_pct', String(holdoutPct)),
        upsertAppSetting('cro_experimentation_enabled', croExperimentationEnabled ? 'true' : 'false'),
      ])
      if (results.some((ok) => !ok)) throw new Error('Could not save one or more CRO controls')
      setCroAutonomyLevel(String(autonomy))
      setCroGlobalHoldoutPct(String(holdoutPct))
      toast({
        title: 'Revenue OS controls saved',
        description: croGlobalEnabled
          ? `CRO is active at autonomy level ${autonomy}${croShadowModeEnabled ? ' in shadow mode' : ''} with ${holdoutPct}% holdout.`
          : 'All CRO actions are paused. The store will keep using safe default ranking.',
      })
    } catch (err: any) {
      toast({ title: 'Failed to save CRO controls', description: err?.message || 'Please try again.', variant: 'destructive' })
    } finally {
      setCroControlSaving(false)
    }
  }

  const handleToggleCroMaintenance = async (enabled: boolean) => {
    setCroMaintenanceSaving(true)
    try {
      const ok = await upsertAppSetting('cro_maintenance_enabled', enabled ? 'true' : 'false')
      if (!ok) throw new Error('Could not save maintenance setting')
      setCroMaintenanceEnabled(enabled)
      toast({
        title: enabled ? 'Scheduled Revenue OS enabled' : 'Scheduled Revenue OS paused',
        description: enabled
          ? 'The hourly maintenance job can refresh intelligence and freeze CRO on critical data issues.'
          : 'Manual scans still work, but the scheduled Revenue OS job will skip runs.',
      })
    } catch (err: any) {
      toast({
        title: 'Maintenance setting failed',
        description: err?.message || 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setCroMaintenanceSaving(false)
    }
  }

  const handleRunCroMaintenanceNow = async () => {
    setCroMaintenanceRunning(true)
    try {
      const { data, error } = await supabase.functions.invoke('revenue-os-maintenance', {
        body: { source: 'admin_manual_run' },
      })
      if (error) throw error
      if (data?.success === false) throw new Error(data?.error || 'Maintenance failed')
      const summary = data?.summary || {}
      setCroMaintenanceLastRunAt(new Date().toISOString())
      setCroMaintenanceLastStatus(summary.simulation_recommendation === 'pause' ? 'paused_cro' : data?.skipped ? 'skipped_disabled' : 'ok')
      setCroMaintenanceLastSummary(summary)
      setCroMaintenanceFreezeReason(summary.freeze_reason || '')
      if (summary.simulation_recommendation === 'pause') {
        setCroGlobalEnabled(false)
      }
      await loadSalesAnalytics()
      toast({
        title: summary.simulation_recommendation === 'pause' ? 'Maintenance paused CRO' : data?.skipped ? 'Maintenance skipped' : 'Maintenance complete',
        description: data?.skipped
          ? 'Scheduled Revenue OS maintenance is disabled.'
          : `${Number(summary.findings || 0).toLocaleString()} finding(s), ${Number(summary.opportunities || 0).toLocaleString()} opportunity item(s), ${Number(summary.action_plans || 0).toLocaleString()} action plan(s).`,
        variant: summary.simulation_recommendation === 'pause' ? 'destructive' : 'default',
      })
    } catch (err: any) {
      toast({
        title: 'Maintenance run failed',
        description: err?.message || 'Could not run Revenue OS maintenance.',
        variant: 'destructive',
      })
    } finally {
      setCroMaintenanceRunning(false)
    }
  }

  const handleRunRevenueDataQualityScan = async () => {
    setDataQualityScanning(true)
    try {
      const findings = [
        ...analyzeRevenueDataQuality(productGroups, categories),
        ...analyzeRevenueEventDataQuality({
          revenueEvents,
          orders: salesOrders,
          smsOrders: salesSmsOrders,
          products: productGroups,
          profiles: salesProfiles,
        }),
      ]
      await recordRevenueDataQualityFindings(findings)
      setRevenueQualityRows((previous) => [
        ...findings.map((finding) => ({
          check_key: finding.checkKey,
          severity: finding.severity,
          status: finding.status,
          scope: finding.scope,
          message: finding.message,
          evidence: finding.evidence || {},
          created_at: new Date().toISOString(),
        })),
        ...previous,
      ])

      const criticalFailures = findings.filter((finding) => finding.status === 'failed' && finding.severity === 'critical')
      if (criticalFailures.length > 0) {
        await upsertAppSetting('cro_global_enabled', 'false')
        setCroGlobalEnabled(false)
        toast({
          title: 'Revenue OS paused',
          description: `${criticalFailures.length} critical data issue(s) found. Customer buying still works with safe default ranking.`,
          variant: 'destructive',
        })
      } else {
        toast({
          title: 'Data quality scan complete',
          description: findings.some((finding) => finding.status === 'failed')
            ? 'No critical issues found. Review warnings before increasing autonomy.'
            : 'Catalogue, event, order, payment, and traffic checks passed.',
        })
      }
    } catch (err: any) {
      toast({
        title: 'Data quality scan failed',
        description: err?.message || 'Could not record scan results.',
        variant: 'destructive',
      })
    } finally {
      setDataQualityScanning(false)
    }
  }

  const handleRebuildProductGraph = async () => {
    setProductGraphBuilding(true)
    try {
      const catalogueRelationships = deriveCatalogueProductRelationships(productGroups, categories)
      const behavioralRelationships = deriveBehavioralProductRelationships(revenueEvents, productGroups)
      const relationships = [...catalogueRelationships, ...behavioralRelationships]
      const attributes = deriveRevenueProductAttributes(productGroups, categories)
      await recordRevenueProductAttributes(attributes)
      await recordCatalogueProductRelationships(relationships)
      await loadSalesAnalytics()
      toast({
        title: 'Product graph rebuilt',
        description: relationships.length > 0
          ? `${attributes.length.toLocaleString()} attribute value(s), ${catalogueRelationships.length.toLocaleString()} catalogue, and ${behavioralRelationships.length.toLocaleString()} behavioral relationship(s) were saved from live sellable products.`
          : `${attributes.length.toLocaleString()} attribute value(s) saved. No eligible product relationships were found yet.`,
      })
    } catch (err: any) {
      toast({
        title: 'Product graph rebuild failed',
        description: err?.message || 'Could not save product relationships.',
        variant: 'destructive',
      })
    } finally {
      setProductGraphBuilding(false)
    }
  }

  const handleSaveExplicitProductRelationship = async () => {
    const fromProductId = explicitRelationshipDraft.fromProductId
    const toProductId = explicitRelationshipDraft.toProductId
    const relationshipType = explicitRelationshipDraft.relationshipType
    const strength = Math.min(1, Math.max(0.05, Number(explicitRelationshipDraft.strength || 1)))

    if (!fromProductId || !toProductId) {
      toast({
        title: 'Choose both products',
        description: 'Explicit Revenue OS relationships need a source product and a target product.',
        variant: 'destructive',
      })
      return
    }

    if (fromProductId === toProductId) {
      toast({
        title: 'Relationship not saved',
        description: 'A product cannot point to itself in the product graph.',
        variant: 'destructive',
      })
      return
    }

    setExplicitRelationshipSaving(true)
    try {
      const fromProduct = productGroups.find((product) => product.id === fromProductId)
      const toProduct = productGroups.find((product) => product.id === toProductId)
      const now = new Date().toISOString()
      const { error } = await supabase.from('product_relationships' as any).upsert({
        from_product_group_id: fromProductId,
        to_product_group_id: toProductId,
        relationship_type: relationshipType,
        strength,
        confidence: 1,
        sample_size: 1,
        source: 'EXPLICIT',
        metadata: {
          owner_defined: true,
          created_by: user?.id || null,
          from_product_name: fromProduct?.name || null,
          to_product_name: toProduct?.name || null,
          note: 'Admin-defined relationship. Revenue OS should not infer or overwrite this as behavioural evidence.',
        },
        last_updated: now,
      }, { onConflict: 'from_product_group_id,to_product_group_id,relationship_type,source' })

      if (error) throw error
      await loadSalesAnalytics()
      toast({
        title: 'Explicit relationship saved',
        description: `${fromProduct?.name || 'Product'} now has a ${relationshipType.replace(/_/g, ' ').toLowerCase()} edge to ${toProduct?.name || 'Product'}.`,
      })
    } catch (err: any) {
      toast({
        title: 'Relationship save failed',
        description: err?.message || 'Could not save the explicit product graph edge.',
        variant: 'destructive',
      })
    } finally {
      setExplicitRelationshipSaving(false)
    }
  }

  const handleRefreshRuntimeIntelligence = async () => {
    setRuntimeIntelligenceRefreshing(true)
    try {
      const intelligence = deriveRevenueOsRuntimeIntelligence({
        orders: salesOrders,
        revenueEvents,
        products: productGroups,
        categories,
        profiles: salesProfiles,
        identityLinks: revenueIdentityLinks,
        monthlyTarget: Number(salesTargetInput || 0),
      })

      await recordRevenueOsRuntimeIntelligence(intelligence)
      const actionPlans = deriveCroActionPlans(intelligence.opportunities)
      await recordCroActionPlans(actionPlans)
      const decayedInsights = await decayCommercialInsights(croInsightRows)
      await loadSalesAnalytics()
      toast({
        title: 'Revenue intelligence refreshed',
        description: `${intelligence.featureSnapshots.length.toLocaleString()} feature snapshot(s), ${intelligence.opportunities.length.toLocaleString()} opportunity item(s), ${actionPlans.length.toLocaleString()} action plan(s), ${intelligence.forecasts.length.toLocaleString()} forecast(s), and ${decayedInsights.length.toLocaleString()} memory update(s) recorded.`,
      })
    } catch (err: any) {
      toast({
        title: 'Revenue intelligence failed',
        description: err?.message || 'Could not save Revenue OS runtime intelligence.',
        variant: 'destructive',
      })
    } finally {
      setRuntimeIntelligenceRefreshing(false)
    }
  }

  const handleUpdateCroActionPlanStatus = async (plan: any, nextStatus: 'approved' | 'running' | 'paused' | 'completed' | 'rejected') => {
    const planKey = String(plan.id || plan.action_key || plan.actionKey)
    const currentStatus = String(plan.status || 'proposed').toLowerCase()
    const safeToAutoRun = plan.guardrails?.safe_to_auto_run === true

    if (nextStatus === 'running') {
      if (!croGlobalEnabled) {
        toast({
          title: 'Revenue OS is paused',
          description: 'Enable Revenue OS controls before running action plans.',
          variant: 'destructive',
        })
        return
      }
      if (!safeToAutoRun && currentStatus !== 'approved' && currentStatus !== 'paused') {
        toast({
          title: 'Approval required',
          description: 'Approve this bounded action before it can affect customer placement.',
          variant: 'destructive',
        })
        return
      }
    }

    setCroActionPlanUpdatingKey(planKey)
    try {
      await updateCroActionPlanStatus({
        id: plan.id || null,
        actionKey: plan.action_key || plan.actionKey || null,
        status: nextStatus,
        reviewerId: user?.id || null,
        reason: `admin_${nextStatus}`,
      })
      setCroActionPlanRows((previous) => previous.map((row) => (
        (row.id && row.id === plan.id) || (row.action_key && row.action_key === plan.action_key)
          ? {
              ...row,
              status: nextStatus,
              updated_at: new Date().toISOString(),
            }
          : row
      )))
      toast({
        title: `Action plan ${nextStatus}`,
        description: nextStatus === 'running'
          ? 'This plan can now influence eligible customer surfaces.'
          : 'Revenue OS action plan status updated.',
      })
    } catch (err: any) {
      toast({
        title: 'Action plan update failed',
        description: err?.message || 'Could not update this action plan.',
        variant: 'destructive',
      })
    } finally {
      setCroActionPlanUpdatingKey(null)
    }
  }

  const handleLifecycleActionStatus = async (action: any, nextStatus: 'approved' | 'dismissed' | 'expired' | 'failed') => {
    const actionKey = String(action.id || action.action_key)
    const prefs = communicationPreferenceByUserId.get(String(action.user_id))
    if (nextStatus === 'approved' && action.channel === 'email' && prefs?.email_lifecycle_opt_in !== true) {
      toast({
        title: 'Consent required',
        description: 'This customer has not opted in to lifecycle follow-up emails.',
        variant: 'destructive',
      })
      return
    }

    setLifecycleActionUpdatingKey(actionKey)
    try {
      const { error } = await supabase
        .from('cro_lifecycle_actions' as any)
        .update({
          status: nextStatus,
          updated_at: new Date().toISOString(),
          evidence: {
            ...(action.evidence || {}),
            last_status_changed_at: new Date().toISOString(),
            last_status_changed_by: user?.id || null,
            last_status_change_reason: `admin_${nextStatus}`,
          },
        })
        .eq('id', action.id)
      if (error) throw error
      setCroLifecycleActionRows((previous) => previous.map((row) => row.id === action.id ? { ...row, status: nextStatus, updated_at: new Date().toISOString() } : row))
      toast({ title: `Lifecycle action ${nextStatus}`, description: 'The lifecycle queue was updated.' })
    } catch (err: any) {
      toast({
        title: 'Lifecycle update failed',
        description: err?.message || 'Could not update lifecycle action.',
        variant: 'destructive',
      })
    } finally {
      setLifecycleActionUpdatingKey(null)
    }
  }

  const handleSendLifecycleAction = async (action: any) => {
    const actionKey = String(action.id || action.action_key)
    const prefs = communicationPreferenceByUserId.get(String(action.user_id))
    const to = userEmailById.get(String(action.user_id))
    if (action.status !== 'approved') {
      toast({ title: 'Approve first', description: 'Only approved lifecycle actions can be sent.', variant: 'destructive' })
      return
    }
    if (action.channel !== 'email' || prefs?.email_lifecycle_opt_in !== true) {
      toast({ title: 'Consent required', description: 'The customer must opt in to lifecycle emails before sending.', variant: 'destructive' })
      return
    }
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(to))) {
      toast({ title: 'Missing customer email', description: 'This action has no valid customer email.', variant: 'destructive' })
      return
    }
    const recentSent = croLifecycleActionRows.find((row) => {
      if (row.id === action.id || String(row.user_id) !== String(action.user_id)) return false
      if (String(row.status || '').toLowerCase() !== 'sent') return false
      const sentAt = new Date(String(row.evidence?.sent_at || row.updated_at || row.created_at || ''))
      return Number.isFinite(sentAt.getTime()) && Date.now() - sentAt.getTime() <= 14 * 86400000
    })
    if (recentSent) {
      toast({
        title: 'Frequency cap active',
        description: 'This customer already received a lifecycle email in the last 14 days.',
        variant: 'destructive',
      })
      return
    }

    setLifecycleActionUpdatingKey(actionKey)
    try {
      const actionLabel = String(action.recommended_action || 'follow-up').replace(/_/g, ' ').toLowerCase()
      const product = productGroups.find((group) => group.id === action.product_group_id)
      const message = [
        `Hi, this is a TallyStore follow-up based on your account activity.`,
        product ? `You may want to check ${product.name}.` : `We found a relevant ${actionLabel} for your account.`,
        `This message was only sent because lifecycle follow-up emails are enabled in your profile preferences.`,
        `You can turn follow-up emails off anytime from your TallyStore profile.`,
      ].join('\n\n')
      const html = buildEmailHtml(message)
      const { data, error } = await supabase.functions.invoke('email/send', {
        body: {
          to,
          subject: 'TallyStore follow-up',
          html,
        },
      })
      if (error || data?.success === false) throw new Error(data?.error || error?.message || 'Email failed')
      const { error: updateError } = await supabase
        .from('cro_lifecycle_actions' as any)
        .update({
          status: 'sent',
          updated_at: new Date().toISOString(),
          evidence: {
            ...(action.evidence || {}),
            sent_at: new Date().toISOString(),
            sent_by: user?.id || null,
            sent_to: to,
          },
        })
        .eq('id', action.id)
      if (updateError) throw updateError
      setCroLifecycleActionRows((previous) => previous.map((row) => row.id === action.id ? { ...row, status: 'sent', updated_at: new Date().toISOString() } : row))
      toast({ title: 'Lifecycle email sent', description: `Sent to ${to}.` })
    } catch (err: any) {
      toast({
        title: 'Lifecycle send failed',
        description: err?.message || 'Could not send lifecycle email.',
        variant: 'destructive',
      })
    } finally {
      setLifecycleActionUpdatingKey(null)
    }
  }

  const handleCreateExperimentFromOpportunity = async (opportunity: any) => {
    const key = opportunity.opportunity_key || opportunity.id
    setExperimentCreatingKey(key)
    try {
      const experiment = createProductRankingExperimentFromOpportunity(opportunity)
      await recordCroExperiment(experiment)
      await loadSalesAnalytics()
      toast({
        title: 'Draft experiment created',
        description: `${experiment.experiment_key} is ready for review. Set it to running when you want assignment to begin.`,
      })
    } catch (err: any) {
      toast({
        title: 'Experiment could not be created',
        description: err?.message || 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setExperimentCreatingKey(null)
    }
  }

  const handleRunRevenueEvaluation = async () => {
    setEvaluationRunning(true)
    try {
      const evaluations = deriveCroExperimentEvaluations({
        experiments: croExperimentRows,
        revenueEvents,
        orders: salesOrders,
        smsOrders: salesSmsOrders,
      })
      const simulation = deriveCroSimulationRun({
        decisionRows: croDecisionRows,
        products: productGroups,
      })
      const banditAllocations = deriveCroBanditAllocations({
        experiments: croExperimentRows,
        revenueEvents,
        orders: salesOrders,
        smsOrders: salesSmsOrders,
        minExplorationPct: 0.08,
      })
      const driftChecks = deriveCroDriftChecks(revenueFeatureRows)
      const anomalyChecks = deriveRevenueAnomalyChecks({
        featureRows: revenueFeatureRows,
        revenueEvents,
        orders: salesOrders,
        profiles: salesProfiles,
      })
      const allDriftChecks = [...driftChecks, ...anomalyChecks]
      await recordCroEvaluations({ evaluations, simulation, driftChecks: allDriftChecks })
      if (banditAllocations.length > 0) {
        await recordRevenueOsRuntimeIntelligence({
          featureSnapshots: banditAllocations.map((allocation) => ({
            snapshotKey: allocation.snapshotKey,
            scopeType: 'store',
            scopeId: `bandit:${allocation.experimentKey}`,
            windowStart: null,
            windowEnd: new Date().toISOString(),
            features: {
              experiment_key: allocation.experimentKey,
              surface: allocation.surface,
              recommendation: allocation.recommendation,
              allocation: allocation.allocation,
              evidence: allocation.evidence,
            },
          })),
          opportunities: [],
          insights: [],
          forecasts: [],
        })
      }
      const appliedDecisions = await applyCroEvaluationDecisions(evaluations)
      const promotionFindings = analyzePromotionGuardrails({
        discountCodes,
        orders: salesOrders,
        products: productGroups,
        revenueEvents,
        maxDiscountPct: Number(promotionMaxDiscountPct || 20),
        monthlyBudgetNgn: Number(promotionMonthlyBudgetNgn || 0),
      })
      const criticalPromotionFailures = promotionFindings.filter((finding) => finding.status === 'failed' && finding.severity === 'critical')
      const severeAnomalyFailures = anomalyChecks.filter((check) => check.status === 'drift' && check.driftScore >= 0.5)
      const severeDriftFailures = driftChecks.filter((check) => check.status === 'drift' && check.driftScore >= 0.45)
      await seedDeterministicRevenueOsModelRegistry({
        enabled: croGlobalEnabled,
        shadowMode: croShadowModeEnabled,
        autonomyLevel: Math.min(8, Math.max(0, Math.round(Number(croAutonomyLevel || 0)))),
        explorationPct: 0.05,
        pressureLimit: 3,
        globalHoldoutPct: Math.min(50, Math.max(0, Number(croGlobalHoldoutPct || 0))) / 100,
        experimentationEnabled: croExperimentationEnabled,
      })

      const shouldPauseCro = simulation.recommendation === 'pause' || criticalPromotionFailures.length > 0 || severeAnomalyFailures.length > 0 || severeDriftFailures.length > 0
      const pauseReason = simulation.recommendation === 'pause'
        ? 'audited decisions'
        : criticalPromotionFailures.length > 0
          ? 'promotion settings'
          : severeAnomalyFailures.length > 0
            ? 'revenue anomalies'
            : 'model drift'

      if (shouldPauseCro) {
        await upsertAppSetting('cro_global_enabled', 'false')
        setCroGlobalEnabled(false)
      }

      await loadSalesAnalytics()
      toast({
        title: shouldPauseCro ? 'Evaluation found guardrail risk' : 'Revenue OS evaluation complete',
        description: shouldPauseCro
          ? `CRO has been paused because ${pauseReason} violated guardrails.`
          : `${evaluations.length.toLocaleString()} experiment evaluation(s), ${banditAllocations.length.toLocaleString()} bandit allocation(s), 1 simulation, ${allDriftChecks.length.toLocaleString()} drift/anomaly check(s). Applied ${appliedDecisions.promoted} promotion(s), ${appliedDecisions.rolledBack} rollback(s), ${appliedDecisions.paused} pause(s).`,
        variant: shouldPauseCro ? 'destructive' : 'default',
      })
    } catch (err: any) {
      toast({
        title: 'Evaluation failed',
        description: err?.message || 'Could not save Revenue OS evaluation results.',
        variant: 'destructive',
      })
    } finally {
      setEvaluationRunning(false)
    }
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
              <TabsList className="flex h-auto w-full flex-wrap justify-start gap-2 rounded-2xl p-2">
                {ADMIN_TABS.map((tab) => (
                  <TabsTrigger key={tab.value} value={tab.value} className="min-w-[120px] flex-1 px-3 text-xs lg:flex-none lg:text-sm">
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

            {/* Sales Intelligence */}
            <TabsContent value="sales" className="space-y-6">
              <Card className="overflow-hidden">
                <CardHeader className="border-b bg-gradient-to-r from-emerald-50 via-white to-purple-50 dark:from-emerald-950/25 dark:via-card dark:to-purple-950/25">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-2xl">
                        <BarChart3 className="h-6 w-6 text-primary" />
                        Sales Intelligence
                      </CardTitle>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Best sellers, customer growth, visitor trends, targets, and automated product ranking signals.
                      </p>
                    </div>
                    <Button type="button" variant="outline" onClick={loadSalesAnalytics} disabled={salesLoading}>
                      {salesLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      Refresh sales data
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-6 p-4 md:p-6">
                  {Object.keys(salesErrors).length > 0 && (
                    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                      <p className="font-bold">Some sales sources need attention.</p>
                      <div className="mt-2 grid gap-1 md:grid-cols-2">
                        {Object.entries(salesErrors).map(([label, message]) => (
                          <p key={label} className="break-words">
                            <span className="font-semibold">{label}:</span> {message}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <Card className="bg-purple-50/80 dark:bg-purple-500/10">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-muted-foreground">Total Sales Revenue</p>
                          <DollarSign className="h-5 w-5 text-purple-600" />
                        </div>
                        <p className="mt-2 text-2xl font-black text-purple-700 dark:text-purple-300">{formatAdminNaira(salesAnalytics.totalRevenue)}</p>
                        <p className="text-xs text-muted-foreground">{salesAnalytics.totalOrders.toLocaleString()} completed order(s)</p>
                      </CardContent>
                    </Card>
                    <Card className="bg-emerald-50/80 dark:bg-emerald-500/10">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-muted-foreground">Best Day</p>
                          <TrendingUp className="h-5 w-5 text-emerald-600" />
                        </div>
                        <p className="mt-2 text-xl font-black text-emerald-700 dark:text-emerald-300">
                          {salesAnalytics.bestDay ? formatAdminNaira(salesAnalytics.bestDay.revenue) : 'No sales yet'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {salesAnalytics.bestDay ? `${format(new Date(salesAnalytics.bestDay.date), 'MMM d, yyyy')} • ${salesAnalytics.bestDay.units} units` : 'Waiting for completed orders'}
                        </p>
                      </CardContent>
                    </Card>
                    <Card className="bg-cyan-50/80 dark:bg-cyan-500/10">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-muted-foreground">Best Product</p>
                          <ShoppingBag className="h-5 w-5 text-cyan-600" />
                        </div>
                        <p className="mt-2 truncate text-xl font-black text-cyan-700 dark:text-cyan-300">
                          {salesAnalytics.bestProduct?.name || 'No product yet'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {salesAnalytics.bestProduct ? `${salesAnalytics.bestProduct.units} units • ${formatAdminNaira(salesAnalytics.bestProduct.revenue)}` : 'No completed product orders'}
                        </p>
                      </CardContent>
                    </Card>
                    <Card className="bg-orange-50/80 dark:bg-orange-500/10">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-muted-foreground">Best Customer</p>
                          <Users className="h-5 w-5 text-orange-600" />
                        </div>
                        <p className="mt-2 truncate text-xl font-black text-orange-700 dark:text-orange-300">
                          {salesAnalytics.bestCustomers[0]?.email || 'No customer yet'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {salesAnalytics.bestCustomers[0] ? `${formatAdminNaira(salesAnalytics.bestCustomers[0].revenue)} • ${salesAnalytics.bestCustomers[0].orders} orders` : 'No completed customer orders'}
                        </p>
                      </CardContent>
                    </Card>
                  </div>

                  <Card className="border-purple-200/80 bg-purple-50/50 dark:border-purple-500/20 dark:bg-purple-500/10">
                    <CardHeader className="gap-3 md:flex-row md:items-center md:justify-between">
                      <CardTitle className="flex items-center gap-2">
                        <Shield className="h-5 w-5 text-primary" />
                        Revenue OS Health
                      </CardTitle>
                      <Button type="button" variant="outline" onClick={handleRunRevenueDataQualityScan} disabled={dataQualityScanning}>
                        {dataQualityScanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        Run data scan
                      </Button>
                    </CardHeader>
                    <CardContent className="grid gap-3 text-sm md:grid-cols-4 xl:grid-cols-10">
                      <div className="rounded-xl border bg-background/70 p-3">
                        <p className="text-xs font-semibold text-muted-foreground">Global status</p>
                        <p className="mt-1 text-lg font-black">{croGlobalEnabled ? 'Active' : 'Paused'}</p>
                      </div>
                      <div className="rounded-xl border bg-background/70 p-3">
                        <p className="text-xs font-semibold text-muted-foreground">Autonomy level</p>
                        <p className="mt-1 text-lg font-black">{croAutonomyLevel}/8</p>
                      </div>
                      <div className="rounded-xl border bg-background/70 p-3">
                        <p className="text-xs font-semibold text-muted-foreground">Events captured</p>
                        <p className="mt-1 text-lg font-black">{revenueEvents.length.toLocaleString()}</p>
                      </div>
                      <div className="rounded-xl border bg-background/70 p-3">
                        <p className="text-xs font-semibold text-muted-foreground">Decision audits</p>
                        <p className="mt-1 text-lg font-black">{croDecisionRows.length.toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">{croShadowModeEnabled ? 'Shadow mode on' : 'Live mode'}</p>
                      </div>
                      <div className="rounded-xl border bg-background/70 p-3">
                        <p className="text-xs font-semibold text-muted-foreground">Experiments</p>
                        <p className="mt-1 text-lg font-black">{revenueOsHealth.activeExperiments.toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">running</p>
                      </div>
                      <div className="rounded-xl border bg-background/70 p-3">
                        <p className="text-xs font-semibold text-muted-foreground">Insights</p>
                        <p className="mt-1 text-lg font-black">{revenueOsHealth.activeInsights.toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">active</p>
                      </div>
                      <div className="rounded-xl border bg-background/70 p-3">
                        <p className="text-xs font-semibold text-muted-foreground">Relationships</p>
                        <p className="mt-1 text-lg font-black">{revenueOsHealth.relationships.toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">product graph</p>
                      </div>
                      <div className="rounded-xl border bg-background/70 p-3">
                        <p className="text-xs font-semibold text-muted-foreground">Critical failures</p>
                        <p className={cn('mt-1 text-lg font-black', revenueOsHealth.criticalFailures > 0 ? 'text-destructive' : 'text-emerald-600')}>
                          {revenueOsHealth.criticalFailures.toLocaleString()}
                        </p>
                        <p className="text-xs text-muted-foreground">latest scan</p>
                      </div>
                      <div className="rounded-xl border bg-background/70 p-3">
                        <p className="text-xs font-semibold text-muted-foreground">Features</p>
                        <p className="mt-1 text-lg font-black">{revenueOsHealth.featureSnapshots.toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">snapshots</p>
                      </div>
                      <div className="rounded-xl border bg-background/70 p-3">
                        <p className="text-xs font-semibold text-muted-foreground">Opportunities</p>
                        <p className="mt-1 text-lg font-black">{revenueOsHealth.openOpportunities.toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">open/watch</p>
                      </div>
                    </CardContent>
                  </Card>

                  <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <Target className="h-5 w-5 text-primary" />
                          Sales Target
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                          <Input
                            type="number"
                            min="0"
                            value={salesTargetInput}
                            onChange={(event) => setSalesTargetInput(event.target.value)}
                            placeholder="Monthly target in NGN"
                          />
                          <Button onClick={handleSaveSalesTarget} disabled={salesTargetSaving}>
                            {salesTargetSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                            Save target
                          </Button>
                        </div>
                        <div>
                          <div className="mb-2 flex items-center justify-between text-sm">
                            <span className="font-semibold">This month</span>
                            <span className="text-muted-foreground">
                              {formatAdminNaira(salesAnalytics.target.monthlyRevenue)} / {formatAdminNaira(salesAnalytics.target.monthlyTarget)}
                            </span>
                          </div>
                          <div className="h-3 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-purple-600 to-emerald-500"
                              style={{ width: `${salesAnalytics.target.progress}%` }}
                            />
                          </div>
                          <p className="mt-2 text-xs text-muted-foreground">
                            {salesAnalytics.target.monthlyTarget > 0
                              ? `${salesAnalytics.target.progress.toFixed(1)}% complete • ${formatAdminNaira(salesAnalytics.target.remaining)} remaining`
                              : 'Set a monthly target to track sales progress.'}
                          </p>
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <Sparkles className="h-5 w-5 text-primary" />
                          Recommendation Automation
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="rounded-xl border p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="font-bold">Revenue OS active</p>
                              <p className="text-sm text-muted-foreground">
                                Turn this off for the kill switch. Customer pages use safe default ranking and buying still works.
                              </p>
                            </div>
                            <Switch checked={croGlobalEnabled} onCheckedChange={setCroGlobalEnabled} />
                          </div>
                          <div className="mt-3 rounded-xl border bg-background/70 p-3">
                            <p className="text-xs font-bold uppercase text-muted-foreground">Immutable guardrails</p>
                            <div className="mt-2 flex flex-wrap gap-1">
                              {[
                                'sellable products only',
                                'no invented prices',
                                'no fake scarcity',
                                'no payment record changes',
                                'support issues hand off',
                                'holdout preserved',
                              ].map((guardrail) => (
                                <Badge key={guardrail} variant="outline" className="text-[10px]">
                                  {guardrail}
                                </Badge>
                              ))}
                            </div>
                          </div>
                          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_120px_120px_auto]">
                            <label className="flex items-center justify-between gap-3 rounded-xl bg-muted/40 px-3 py-2 text-sm">
                              <span>
                                <span className="block font-semibold">Shadow mode</span>
                                <span className="text-xs text-muted-foreground">Audit decisions without changing ranking.</span>
                              </span>
                              <Switch checked={croShadowModeEnabled} onCheckedChange={setCroShadowModeEnabled} />
                            </label>
                            <Input
                              type="number"
                              min="0"
                              max="8"
                              value={croAutonomyLevel}
                              onChange={(event) => setCroAutonomyLevel(event.target.value)}
                              placeholder="Level"
                            />
                            <Input
                              type="number"
                              min="0"
                              max="50"
                              value={croGlobalHoldoutPct}
                              onChange={(event) => setCroGlobalHoldoutPct(event.target.value)}
                              placeholder="Holdout %"
                            />
                            <Button type="button" onClick={handleSaveCroControls} disabled={croControlSaving}>
                              {croControlSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                              Save CRO
                            </Button>
                          </div>
                          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-muted/40 px-3 py-2 text-sm">
                            <span>
                              <span className="block font-semibold">Experiment assignment</span>
                              <span className="text-xs text-muted-foreground">When on, running experiments can assign visitors to control or Revenue OS variants.</span>
                            </span>
                            <Switch checked={croExperimentationEnabled} onCheckedChange={setCroExperimentationEnabled} />
                          </div>
                          <div className="mt-3 rounded-xl border bg-background/70 p-3">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <p className="font-bold">Scheduled maintenance</p>
                                <p className="text-xs text-muted-foreground">
                                  Hourly Revenue OS refresh with data-quality freeze, action-plan generation, forecasts, and drift checks.
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <Switch checked={croMaintenanceEnabled} disabled={croMaintenanceSaving} onCheckedChange={handleToggleCroMaintenance} />
                                <Button type="button" size="sm" variant="outline" onClick={handleRunCroMaintenanceNow} disabled={croMaintenanceRunning}>
                                  {croMaintenanceRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                                  Run now
                                </Button>
                              </div>
                            </div>
                            <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                              <div className="rounded-lg bg-muted/40 p-2">
                                <p className="font-semibold text-muted-foreground">Last status</p>
                                <p className={cn('mt-1 font-black capitalize', croMaintenanceLastStatus === 'failed' || croMaintenanceLastStatus === 'paused_cro' ? 'text-destructive' : 'text-emerald-600')}>
                                  {croMaintenanceLastStatus.replace(/_/g, ' ')}
                                </p>
                              </div>
                              <div className="rounded-lg bg-muted/40 p-2">
                                <p className="font-semibold text-muted-foreground">Last run</p>
                                <p className="mt-1 font-black">
                                  {croMaintenanceLastRunAt ? formatDistanceToNow(new Date(croMaintenanceLastRunAt), { addSuffix: true }) : 'Never'}
                                </p>
                              </div>
                              <div className="rounded-lg bg-muted/40 p-2">
                                <p className="font-semibold text-muted-foreground">Last output</p>
                                <p className="mt-1 font-black">
                                  {Number(croMaintenanceLastSummary?.findings || 0).toLocaleString()} checks • {Number(croMaintenanceLastSummary?.action_plans || 0).toLocaleString()} plans • {Number(croMaintenanceLastSummary?.lifecycle_actions || 0).toLocaleString()} lifecycle
                                </p>
                              </div>
                            </div>
                            {croMaintenanceFreezeReason && (
                              <p className="mt-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
                                Freeze reason: {croMaintenanceFreezeReason}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-3 rounded-xl border p-4">
                          <div>
                            <p className="font-bold">Customer product switching</p>
                            <p className="text-sm text-muted-foreground">
                              Uses trending products, top buys, and personal purchase history to reorder customer product lists.
                            </p>
                          </div>
                          <Switch
                            checked={recommendationAutomationEnabled}
                            disabled={recommendationAutomationSaving}
                            onCheckedChange={handleToggleRecommendationAutomation}
                          />
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center text-xs">
                          <div className="rounded-xl border p-3">
                            <p className="font-black text-lg">{salesAnalytics.highSellingProducts.length}</p>
                            <p className="text-muted-foreground">Products ranked</p>
                          </div>
                          <div className="rounded-xl border p-3">
                            <p className="font-black text-lg">{salesAnalytics.marketTrends.length}</p>
                            <p className="text-muted-foreground">Trends found</p>
                          </div>
                          <div className="rounded-xl border p-3">
                            <p className="font-black text-lg">{recommendationAutomationEnabled ? 'On' : 'Off'}</p>
                            <p className="text-muted-foreground">Automation</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  <AdminControlSection
                    title="Revenue OS Safety & Knowledge"
                    description="Audit the deterministic CRO layer before increasing autonomy. These records come from stored events, checks, experiments, and product relationships."
                  >
                    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="text-sm text-muted-foreground">
                        Run these before raising autonomy: clean catalogue data first, then rebuild the product graph from live sellable products.
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Button type="button" variant="outline" onClick={handleRunRevenueDataQualityScan} disabled={dataQualityScanning}>
                          {dataQualityScanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                          Scan data
                        </Button>
                        <Button type="button" variant="outline" onClick={handleRebuildProductGraph} disabled={productGraphBuilding}>
                          {productGraphBuilding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                          Rebuild graph
                        </Button>
                        <Button type="button" variant="outline" onClick={handleRefreshRuntimeIntelligence} disabled={runtimeIntelligenceRefreshing || salesLoading}>
                          {runtimeIntelligenceRefreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
                          Refresh intelligence
                        </Button>
                        <Button type="button" variant="outline" onClick={handleRunRevenueEvaluation} disabled={evaluationRunning || salesLoading}>
                          {evaluationRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
                          Run evaluation
                        </Button>
                      </div>
                    </div>
                    {revenueOsHealth.latestForecast && (
                      <div className="mb-4 grid gap-3 rounded-2xl border bg-background/60 p-4 md:grid-cols-4">
                        <div>
                          <p className="text-xs font-semibold uppercase text-muted-foreground">Monthly forecast</p>
                          <p className="text-2xl font-black">{formatAdminNaira(Number(revenueOsHealth.latestForecast.median_value || 0))}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase text-muted-foreground">Forecast range</p>
                          <p className="font-black">{formatAdminNaira(Number(revenueOsHealth.latestForecast.lower_bound || 0))} - {formatAdminNaira(Number(revenueOsHealth.latestForecast.upper_bound || 0))}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase text-muted-foreground">Target probability</p>
                          <p className="font-black">
                            {revenueOsHealth.latestForecast.probability_to_target == null
                              ? 'No target'
                              : `${Math.round(Number(revenueOsHealth.latestForecast.probability_to_target || 0) * 100)}%`}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase text-muted-foreground">Method</p>
                          <p className="truncate font-black">{revenueOsHealth.latestForecast.method || 'DETERMINISTIC_TRAILING_RATE'}</p>
                        </div>
                      </div>
                    )}
                    <div className="mb-4 grid gap-3 md:grid-cols-5">
                      <div className="rounded-2xl border bg-background/60 p-4">
                        <p className="text-xs font-semibold uppercase text-muted-foreground">Latest simulation</p>
                        <p className={cn('mt-1 text-2xl font-black capitalize', revenueOsHealth.latestSimulation?.recommendation === 'pause' ? 'text-destructive' : revenueOsHealth.latestSimulation?.recommendation === 'safe' ? 'text-emerald-600' : '')}>
                          {revenueOsHealth.latestSimulation?.recommendation || 'No run'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {(revenueOsHealth.latestSimulation?.decisions_evaluated || 0).toLocaleString()} decisions • {(revenueOsHealth.latestSimulation?.sessions_evaluated || 0).toLocaleString()} sessions
                        </p>
                      </div>
                      <div className="rounded-2xl border bg-background/60 p-4">
                        <p className="text-xs font-semibold uppercase text-muted-foreground">Latest drift</p>
                        <p className={cn('mt-1 text-2xl font-black capitalize', revenueOsHealth.latestDrift?.status === 'drift' ? 'text-destructive' : revenueOsHealth.latestDrift?.status === 'stable' ? 'text-emerald-600' : '')}>
                          {revenueOsHealth.latestDrift?.status || 'No check'}
                        </p>
                        <p className="text-xs text-muted-foreground">Score {Number(revenueOsHealth.latestDrift?.drift_score || 0).toFixed(2)}</p>
                      </div>
                      <div className="rounded-2xl border bg-background/60 p-4">
                        <p className="text-xs font-semibold uppercase text-muted-foreground">Model registry</p>
                        <p className="mt-1 text-2xl font-black">{revenueOsHealth.modelRegistryCount.toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">deterministic/model records</p>
                      </div>
                      <div className="rounded-2xl border bg-background/60 p-4">
                        <p className="text-xs font-semibold uppercase text-muted-foreground">Lifecycle engine</p>
                        <p className="mt-1 text-2xl font-black">{Number(revenueOsHealth.lifecycleCustomerSnapshots || 0).toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">
                          {Number(revenueOsHealth.lifecycleCounts?.AT_RISK || 0).toLocaleString()} at risk • {Number(revenueOsHealth.lifecycleCounts?.LAPSED || 0).toLocaleString()} lapsed
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {Number(revenueOsHealth.customersWithNextCandidates || 0).toLocaleString()} with next-purchase candidates
                        </p>
                      </div>
                      <div className="rounded-2xl border bg-background/60 p-4">
                        <p className="text-xs font-semibold uppercase text-muted-foreground">Promotion guardrails</p>
                        <p className={cn('mt-1 text-2xl font-black', revenueOsHealth.promotionFailures.length > 0 ? 'text-destructive' : 'text-emerald-600')}>
                          {revenueOsHealth.promotionFailures.length > 0 ? revenueOsHealth.promotionFailures.length.toLocaleString() : 'Safe'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          max {Number(promotionMaxDiscountPct || 0)}% • budget {formatAdminNaira(Number(promotionMonthlyBudgetNgn || 0))}
                        </p>
                      </div>
                    </div>
                    {revenueOsHealth.latestAnomalies.length > 0 && (
                      <div className="mb-4 rounded-2xl border bg-background/60 p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div>
                            <p className="font-black">Anomaly Freeze Monitor</p>
                            <p className="text-xs text-muted-foreground">Revenue, conversion, and payment-funnel anomalies that can pause CRO automatically.</p>
                          </div>
                          <Badge variant={revenueOsHealth.latestAnomalies.some((row) => row.status === 'drift') ? 'destructive' : 'outline'}>
                            {revenueOsHealth.latestAnomalies.some((row) => row.status === 'drift') ? 'Freeze risk' : 'Watching'}
                          </Badge>
                        </div>
                        <div className="grid gap-3 md:grid-cols-3">
                          {revenueOsHealth.latestAnomalies.slice(0, 3).map((row) => (
                            <div key={row.id || row.check_key} className="rounded-xl border p-3">
                              <div className="flex items-center justify-between gap-2">
                                <p className="truncate text-sm font-black">{String(row.model_key || '').replace(/_/g, ' ')}</p>
                                <Badge variant={row.status === 'drift' ? 'destructive' : row.status === 'watch' ? 'secondary' : 'outline'} className="capitalize">
                                  {row.status}
                                </Badge>
                              </div>
                              <p className="mt-2 text-xs text-muted-foreground">Score {Number(row.drift_score || 0).toFixed(2)}</p>
                              {row.evidence && (
                                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                                  {Object.entries(row.evidence).slice(0, 2).map(([key, value]) => `${key}: ${Number.isFinite(Number(value)) ? Number(value).toLocaleString() : String(value)}`).join(' • ')}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="grid gap-4 xl:grid-cols-4">
                      <div className="space-y-3 rounded-2xl border bg-background/60 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-black">Data Quality</p>
                          <Badge variant={revenueOsHealth.criticalFailures > 0 ? 'destructive' : 'outline'}>
                            {revenueOsHealth.criticalFailures > 0 ? 'Needs review' : 'Stable'}
                          </Badge>
                        </div>
                        {revenueOsHealth.recentQualityRows.length === 0 ? (
                          <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No scan has been recorded yet.</p>
                        ) : revenueOsHealth.recentQualityRows.map((row, index) => (
                          <div key={`${row.check_key || row.checkKey}-${row.scope}-${row.created_at || index}`} className="rounded-xl border p-3">
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-sm font-bold">{row.check_key || row.checkKey || 'quality_check'}</p>
                              <Badge variant={row.severity === 'critical' ? 'destructive' : row.status === 'passed' ? 'default' : 'outline'} className="capitalize">
                                {row.status}
                              </Badge>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">{row.message}</p>
                          </div>
                        ))}
                      </div>

                      <div className="space-y-3 rounded-2xl border bg-background/60 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-black">Experiments</p>
                          <Badge variant="outline">{croExperimentRows.length.toLocaleString()} total</Badge>
                        </div>
                        {revenueOsHealth.recentExperiments.length === 0 ? (
                          <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No CRO experiments recorded yet.</p>
                        ) : revenueOsHealth.recentExperiments.map((experiment) => (
                          <div key={experiment.id} className="rounded-xl border p-3">
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-sm font-bold">{experiment.name || experiment.hypothesis || 'Experiment'}</p>
                              <Badge variant="outline" className="capitalize">{experiment.status || 'draft'}</Badge>
                            </div>
                            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{experiment.hypothesis || 'No hypothesis recorded.'}</p>
                          </div>
                        ))}
                        {revenueOsHealth.latestEvaluations.length > 0 && (
                          <div className="space-y-2 border-t pt-3">
                            <p className="text-xs font-bold uppercase text-muted-foreground">Latest evaluations</p>
                            {revenueOsHealth.latestEvaluations.map((evaluation) => {
                              const evidence = evaluation.evidence || {}
                              const qualityScore = Math.round(Number(evidence.decision_quality_score || 0) * 100)
                              const fdrRisk = Math.round(Number(evidence.false_discovery_risk || 0) * 100)
                              const qValue = Math.round(Number(evidence.multiple_testing_q_value || 0) * 100)
                              const readyChecks = [
                                evidence.sample_size_ready ? 'sample ready' : 'sample waiting',
                                evidence.purchase_sample_ready ? 'purchase ready' : 'purchase waiting',
                                evidence.runtime_ready ? 'runtime ready' : 'runtime waiting',
                                evidence.minimum_practical_effect_passed ? 'MPE passed' : 'MPE waiting',
                                evidence.false_discovery_passed ? 'FDR passed' : 'FDR waiting',
                              ]
                              return (
                                <div key={evaluation.id || evaluation.evaluation_key} className="rounded-xl border p-3">
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="truncate text-xs font-bold">{evaluation.experiment_key}</p>
                                    <Badge variant={['rollback', 'pause'].includes(evaluation.decision) ? 'destructive' : evaluation.decision === 'promote' ? 'default' : 'outline'} className="capitalize">
                                      {String(evaluation.decision || '').replace(/_/g, ' ')}
                                    </Badge>
                                  </div>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {Math.round(Number(evaluation.confidence || 0) * 100)}% confidence • quality {qualityScore}% • FDR {fdrRisk}% / q {qValue}%
                                  </p>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    Sample {Number(evidence.sample_size || 0).toLocaleString()} • purchases {Number(evidence.purchase_sample_size || 0).toLocaleString()} • runtime {Number(evidence.runtime_days || 0).toFixed(1)}d • MPE {formatAdminNaira(Number(evaluation.minimum_practical_effect || 0))}
                                  </p>
                                  <div className="mt-2 flex flex-wrap gap-1">
                                    {readyChecks.map((check) => (
                                      <Badge key={check} variant={check.includes('passed') || check.includes('ready') ? 'secondary' : 'outline'} className="text-[10px]">
                                        {check}
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>

                      <div className="space-y-3 rounded-2xl border bg-background/60 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-black">Commercial Memory</p>
                          <Badge variant="outline">{croRelationshipRows.length.toLocaleString()} graph edges</Badge>
                        </div>
                        <div className="rounded-xl border bg-muted/20 p-3">
                          <div className="mb-3 flex items-center justify-between gap-2">
                            <div>
                              <p className="text-sm font-black">Owner-defined relationship</p>
                              <p className="text-xs text-muted-foreground">Use this for compatibility, replacement, required, or accessory-style edges Revenue OS should not guess.</p>
                            </div>
                            <Badge variant="secondary">EXPLICIT</Badge>
                          </div>
                          <div className="grid gap-2 md:grid-cols-2">
                            <Select
                              value={explicitRelationshipDraft.fromProductId}
                              onValueChange={(value) => setExplicitRelationshipDraft((draft) => ({ ...draft, fromProductId: value }))}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="From product" />
                              </SelectTrigger>
                              <SelectContent>
                                {explicitRelationshipProductOptions.map((product) => (
                                  <SelectItem key={product.id} value={product.id}>
                                    {product.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Select
                              value={explicitRelationshipDraft.toProductId}
                              onValueChange={(value) => setExplicitRelationshipDraft((draft) => ({ ...draft, toProductId: value }))}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="To product" />
                              </SelectTrigger>
                              <SelectContent>
                                {explicitRelationshipProductOptions.map((product) => (
                                  <SelectItem key={product.id} value={product.id}>
                                    {product.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Select
                              value={explicitRelationshipDraft.relationshipType}
                              onValueChange={(value) => setExplicitRelationshipDraft((draft) => ({ ...draft, relationshipType: value as ExplicitProductRelationshipType }))}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {EXPLICIT_PRODUCT_RELATIONSHIP_TYPES.map((type) => (
                                  <SelectItem key={type} value={type}>
                                    {type.replace(/_/g, ' ')}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <div className="flex gap-2">
                              <Input
                                type="number"
                                min="0.05"
                                max="1"
                                step="0.05"
                                value={explicitRelationshipDraft.strength}
                                onChange={(event) => setExplicitRelationshipDraft((draft) => ({ ...draft, strength: event.target.value }))}
                                placeholder="Strength 0.05-1"
                              />
                              <Button type="button" onClick={handleSaveExplicitProductRelationship} disabled={explicitRelationshipSaving}>
                                {explicitRelationshipSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                                Save
                              </Button>
                            </div>
                          </div>
                        </div>
                        {revenueOsHealth.recentInsights.length === 0 ? (
                          <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No proven insights recorded yet.</p>
                        ) : revenueOsHealth.recentInsights.map((insight) => (
                          <div key={insight.id} className="rounded-xl border p-3">
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-sm font-bold">{insight.scope || 'Store insight'}</p>
                              <Badge variant="outline" className="capitalize">{insight.status || 'active'}</Badge>
                            </div>
                            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{insight.finding || 'No finding recorded.'}</p>
                          </div>
                        ))}
                      </div>

                      <div className="space-y-3 rounded-2xl border bg-background/60 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-black">Opportunity Queue</p>
                          <Badge variant="outline">{revenueOsHealth.openOpportunities.toLocaleString()} open</Badge>
                        </div>
                        {revenueOsHealth.topOpportunities.length === 0 ? (
                          <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No revenue opportunities recorded yet.</p>
                        ) : revenueOsHealth.topOpportunities.map((opportunity) => (
                          <div key={opportunity.id || opportunity.opportunity_key} className="rounded-xl border p-3">
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-sm font-bold">{opportunity.type || 'Opportunity'}</p>
                              <Badge variant="outline">{Number(opportunity.priority || 0).toFixed(1)}</Badge>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {opportunity.scope} • {formatAdminNaira(Number(opportunity.expected_value || 0))} EV • {Math.round(Number(opportunity.confidence || 0) * 100)}% confidence
                            </p>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="mt-3 w-full"
                              onClick={() => handleCreateExperimentFromOpportunity(opportunity)}
                              disabled={experimentCreatingKey === (opportunity.opportunity_key || opportunity.id)}
                            >
                              {experimentCreatingKey === (opportunity.opportunity_key || opportunity.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Target className="h-4 w-4" />}
                              Draft experiment
                            </Button>
                          </div>
                        ))}
                      </div>

                      <div className="space-y-3 rounded-2xl border bg-background/60 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-black">Action Plans</p>
                          <Badge variant="outline">{revenueOsHealth.proposedActionPlans.toLocaleString()} active</Badge>
                        </div>
                        {revenueOsHealth.topActionPlans.length === 0 ? (
                          <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Refresh intelligence to convert opportunities into bounded action plans.</p>
                        ) : revenueOsHealth.topActionPlans.map((plan) => {
                          const status = String(plan.status || 'proposed').toLowerCase()
                          const planKey = String(plan.id || plan.action_key || plan.actionKey)
                          const updating = croActionPlanUpdatingKey === planKey
                          return (
                            <div key={plan.id || plan.action_key} className="rounded-xl border p-3">
                              <div className="flex items-center justify-between gap-2">
                                <p className="truncate text-sm font-bold">{String(plan.action_type || 'DO_NOTHING').replace(/_/g, ' ')}</p>
                                <Badge variant={status === 'running' ? 'default' : status === 'paused' || status === 'rejected' ? 'destructive' : 'outline'} className="capitalize">
                                  {plan.status || 'proposed'}
                                </Badge>
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {plan.surface || 'products'} • {plan.scope || 'store'} • {formatAdminNaira(Number(plan.expected_value || 0))} EV
                              </p>
                              <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                                {plan.guardrails?.safe_to_auto_run ? 'Safe for bounded automation after checks.' : 'Requires admin approval before execution.'}
                              </p>
                              <div className="mt-3 grid grid-cols-2 gap-2">
                                {status === 'proposed' && (
                                  <>
                                    <Button type="button" size="sm" variant="outline" onClick={() => handleUpdateCroActionPlanStatus(plan, 'approved')} disabled={updating}>
                                      {updating ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                                      Approve
                                    </Button>
                                    <Button type="button" size="sm" variant="outline" onClick={() => handleUpdateCroActionPlanStatus(plan, 'rejected')} disabled={updating}>
                                      <X className="h-4 w-4" />
                                      Reject
                                    </Button>
                                  </>
                                )}
                                {(status === 'approved' || status === 'paused') && (
                                  <>
                                    <Button type="button" size="sm" onClick={() => handleUpdateCroActionPlanStatus(plan, 'running')} disabled={updating || !croGlobalEnabled}>
                                      {updating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                                      Run
                                    </Button>
                                    <Button type="button" size="sm" variant="outline" onClick={() => handleUpdateCroActionPlanStatus(plan, 'rejected')} disabled={updating}>
                                      <X className="h-4 w-4" />
                                      Reject
                                    </Button>
                                  </>
                                )}
                                {status === 'running' && (
                                  <>
                                    <Button type="button" size="sm" variant="outline" onClick={() => handleUpdateCroActionPlanStatus(plan, 'paused')} disabled={updating}>
                                      {updating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock className="h-4 w-4" />}
                                      Pause
                                    </Button>
                                    <Button type="button" size="sm" variant="outline" onClick={() => handleUpdateCroActionPlanStatus(plan, 'completed')} disabled={updating}>
                                      <CheckCircle2 className="h-4 w-4" />
                                      Complete
                                    </Button>
                                  </>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>

                      <div className="space-y-3 rounded-2xl border bg-background/60 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-black">Lifecycle Queue</p>
                            <p className="text-xs text-muted-foreground">Repeat-purchase and reactivation actions. Outbound rows require consent and review.</p>
                          </div>
                          <Badge variant="outline">{Number(revenueOsHealth.lifecycleActions || 0).toLocaleString()} total</Badge>
                        </div>
                        {revenueOsHealth.topLifecycleActions.length === 0 ? (
                          <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No lifecycle actions queued yet. Scheduled maintenance will populate this from real customer history.</p>
                        ) : revenueOsHealth.topLifecycleActions.map((action) => {
                          const status = String(action.status || 'needs_consent')
                          const prefs = communicationPreferenceByUserId.get(String(action.user_id))
                          const hasLifecycleEmailConsent = action.channel === 'email' && prefs?.email_lifecycle_opt_in === true
                          const updating = lifecycleActionUpdatingKey === String(action.id || action.action_key)
                          return (
                            <div key={action.id || action.action_key} className="rounded-xl border p-3">
                              <div className="flex items-center justify-between gap-2">
                                <p className="truncate text-sm font-bold">{String(action.recommended_action || 'NO_OFFER').replace(/_/g, ' ')}</p>
                                <Badge variant={status === 'needs_consent' ? 'secondary' : status === 'approved' ? 'default' : 'outline'} className="capitalize">
                                  {status.replace(/_/g, ' ')}
                                </Badge>
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {action.lifecycle_stage || 'stage'} • {action.channel || 'email'} • {formatAdminNaira(Number(action.expected_value || 0))} EV
                              </p>
                              <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{action.reason || 'Permissioned lifecycle action.'}</p>
                              <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-muted/40 p-2 text-xs">
                                <span className="truncate">{userEmailById.get(String(action.user_id)) || `Customer ${String(action.user_id || '').slice(0, 8)}`}</span>
                                <Badge variant={hasLifecycleEmailConsent ? 'outline' : 'secondary'}>
                                  {hasLifecycleEmailConsent ? 'consented' : 'no consent'}
                                </Badge>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-1 text-xs">
                                <Badge variant="outline">14d frequency cap</Badge>
                                <Badge variant={Number(action.pressure_score || action.evidence?.lifecycle_pressure_score || 0) > 0 ? 'secondary' : 'outline'}>
                                  pressure {Number(action.pressure_score || action.evidence?.lifecycle_pressure_score || 0)}
                                </Badge>
                              </div>
                              <div className="mt-3 grid grid-cols-2 gap-2">
                                {status === 'needs_consent' && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleLifecycleActionStatus(action, 'dismissed')}
                                    disabled={updating}
                                  >
                                    <X className="h-4 w-4" />
                                    Dismiss
                                  </Button>
                                )}
                                {hasLifecycleEmailConsent && ['needs_consent', 'queued'].includes(status) && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleLifecycleActionStatus(action, 'approved')}
                                    disabled={updating}
                                  >
                                    {updating ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                                    Approve
                                  </Button>
                                )}
                                {status === 'approved' && (
                                  <>
                                    <Button
                                      type="button"
                                      size="sm"
                                      onClick={() => handleSendLifecycleAction(action)}
                                      disabled={updating || !hasLifecycleEmailConsent}
                                    >
                                      {updating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                      Send
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={() => handleLifecycleActionStatus(action, 'dismissed')}
                                      disabled={updating}
                                    >
                                      <X className="h-4 w-4" />
                                      Dismiss
                                    </Button>
                                  </>
                                )}
                              </div>
                            </div>
                          )
                        })}
                        <div className="grid grid-cols-3 gap-2 text-center text-xs">
                          <div className="rounded-xl border p-2">
                            <p className="font-black">{Number(revenueOsHealth.lifecycleActionCounts?.needs_consent || 0).toLocaleString()}</p>
                            <p className="text-muted-foreground">needs consent</p>
                          </div>
                          <div className="rounded-xl border p-2">
                            <p className="font-black">{Number(revenueOsHealth.lifecycleActionCounts?.approved || 0).toLocaleString()}</p>
                            <p className="text-muted-foreground">approved</p>
                          </div>
                          <div className="rounded-xl border p-2">
                            <p className="font-black">{Number(revenueOsHealth.lifecycleActionCounts?.sent || 0).toLocaleString()}</p>
                            <p className="text-muted-foreground">sent</p>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 rounded-2xl border bg-background/60 p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="font-black">Decision Arbitration</p>
                          <p className="text-xs text-muted-foreground">Latest next-best-action decisions with pressure and guardrail context.</p>
                        </div>
                        <Badge variant="outline">{croDecisionRows.length.toLocaleString()} audits</Badge>
                      </div>
                      {revenueOsHealth.recentDecisions.length === 0 ? (
                        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No CRO decisions audited yet.</p>
                      ) : (
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                          {revenueOsHealth.recentDecisions.map((decision) => {
                            const metadata = decision.metadata || {}
                            const action = String(decision.selected_action || metadata.nextBestAction || 'DO_NOTHING')
                            const pressureScore = Number(metadata.pressureScore || 0)
                            return (
                              <div key={decision.id || decision.decision_id} className="rounded-xl border p-3">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="truncate text-sm font-black">{action.replace(/_/g, ' ')}</p>
                                  <Badge variant={action === 'DO_NOTHING' ? 'secondary' : action === 'SUPPORT_HANDOFF' ? 'destructive' : 'outline'}>
                                    {Math.round(Number(decision.confidence || metadata.actionConfidence || 0) * 100)}%
                                  </Badge>
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {decision.surface || 'surface'} • pressure {pressureScore.toFixed(1)}
                                </p>
                                <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                                  {metadata.actionReason || 'highest_scored_action'}
                                </p>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                    <div className="mt-4 rounded-2xl border bg-background/60 p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="font-black">Promotion Guardrails</p>
                          <p className="text-xs text-muted-foreground">Bounded promotion checks for discount percent, budget, expiry, scope, and sellable products.</p>
                        </div>
                        <Badge variant={revenueOsHealth.promotionFailures.length > 0 ? 'destructive' : 'outline'}>
                          {revenueOsHealth.promotionFailures.length > 0 ? 'Review needed' : 'Clear'}
                        </Badge>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        {revenueOsHealth.promotionFindings.slice(0, 8).map((finding, index) => (
                          <div key={`${finding.checkKey}:${finding.code || index}`} className="rounded-xl border p-3">
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-sm font-black">{finding.code || finding.checkKey.replace(/_/g, ' ')}</p>
                              <Badge variant={finding.status === 'failed' ? finding.severity === 'critical' ? 'destructive' : 'secondary' : 'outline'} className="capitalize">
                                {finding.status}
                              </Badge>
                            </div>
                            <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{finding.message}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="mt-4 rounded-2xl border bg-background/60 p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="font-black">Product Commercial Intelligence</p>
                          <p className="text-xs text-muted-foreground">Revenue, conversion efficiency, price position, stock coverage, and reversal risk from real customer activity.</p>
                        </div>
                        <Badge variant="outline">{revenueOsHealth.productIntelligenceRows.length.toLocaleString()} product(s)</Badge>
                      </div>
                      {revenueOsHealth.productIntelligenceRows.length === 0 ? (
                        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Refresh intelligence after product views and purchases to see commercial product health.</p>
                      ) : (
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                          {revenueOsHealth.productIntelligenceRows.map((row) => {
                            const features = row.features || {}
                            const revenue = Number(features.revenue || features.revenue_30d || 0)
                            const views = Number(features.impressions || features.views_30d || 0)
                            const clicks = Number(features.clicks || features.clicks_30d || 0)
                            const daysOfInventory = Number(features.days_of_inventory)
                            return (
                              <div key={row.snapshot_key || row.scope_id} className="rounded-xl border p-3">
                                <div className="flex items-start justify-between gap-2">
                                  <p className="line-clamp-2 text-sm font-black">{features.name || row.scope_id}</p>
                                  <Badge variant={Number(features.reversal_rate || 0) > 0.08 ? 'destructive' : 'outline'}>
                                    {Math.round(Number(features.reversal_rate || 0) * 100)}% rev
                                  </Badge>
                                </div>
                                <p className="mt-2 text-lg font-black">{formatAdminNaira(revenue)}</p>
                                <p className="text-xs text-muted-foreground">
                                  {views.toLocaleString()} views • {clicks.toLocaleString()} clicks • CVR {Math.round(Number(features.order_rate_per_impression || features.conversion_proxy || 0) * 1000) / 10}%
                                </p>
                                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                                  <div className="rounded-lg bg-muted/40 p-2">
                                    <p className="text-muted-foreground">RPI</p>
                                    <p className="font-black">{formatAdminNaira(Number(features.revenue_per_impression || features.revenue_per_view || 0))}</p>
                                  </div>
                                  <div className="rounded-lg bg-muted/40 p-2">
                                    <p className="text-muted-foreground">Price pct.</p>
                                    <p className="font-black">{features.category_price_percentile == null ? '-' : `${Math.round(Number(features.category_price_percentile) * 100)}%`}</p>
                                  </div>
                                  <div className="rounded-lg bg-muted/40 p-2">
                                    <p className="text-muted-foreground">Stock days</p>
                                    <p className="font-black">{Number.isFinite(daysOfInventory) ? Math.round(daysOfInventory).toLocaleString() : '-'}</p>
                                  </div>
                                  <div className="rounded-lg bg-muted/40 p-2">
                                    <p className="text-muted-foreground">Units</p>
                                    <p className="font-black">{Number(features.units_sold || features.units_30d || 0).toLocaleString()}</p>
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                    <div className="mt-4 rounded-2xl border bg-background/60 p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="font-black">Device Funnel Diagnostics</p>
                          <p className="text-xs text-muted-foreground">Conversion and payment health split by device, so mobile and desktop issues do not hide inside one average.</p>
                        </div>
                        <Badge variant="outline">{revenueOsHealth.deviceRows.length.toLocaleString()} device(s)</Badge>
                      </div>
                      {revenueOsHealth.deviceRows.length === 0 ? (
                        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Refresh intelligence after customer events to see device funnel health.</p>
                      ) : (
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                          {revenueOsHealth.deviceRows.map((row) => (
                            <div key={row.snapshot_key || row.scope_id} className="rounded-xl border p-3">
                              <div className="flex items-center justify-between gap-2">
                                <p className="truncate text-sm font-black capitalize">{row.features?.device || 'unknown'}</p>
                                <Badge variant="outline">{Number(row.features?.visitors || 0).toLocaleString()} visitors</Badge>
                              </div>
                              <p className="mt-2 text-xs text-muted-foreground">
                                CVR {Math.round(Number(row.features?.conversion_rate || 0) * 1000) / 10}% • RPV {formatAdminNaira(Number(row.features?.revenue_per_visitor || 0))}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                Pay fail {Math.round(Number(row.features?.payment_failure_rate || 0) * 1000) / 10}% • abandon {Math.round(Number(row.features?.checkout_abandonment_rate || 0) * 1000) / 10}%
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="mt-4 rounded-2xl border bg-background/60 p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="font-black">Attribution & Traffic Quality</p>
                          <p className="text-xs text-muted-foreground">Normalized source/channel performance from trusted first-party events.</p>
                        </div>
                        <Badge variant="outline">
                          {Number(salesAnalytics.visitors.trafficQualityCounts?.bot || 0).toLocaleString()} bot visits filtered
                        </Badge>
                      </div>
                      {revenueOsHealth.attributionRows.length === 0 ? (
                        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Refresh intelligence after new visits to see attribution performance.</p>
                      ) : (
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                          {revenueOsHealth.attributionRows.map((row) => (
                            <div key={row.snapshot_key || row.scope_id} className="rounded-xl border p-3">
                              <div className="flex items-center justify-between gap-2">
                                <p className="truncate text-sm font-black">{row.features?.channel || 'unknown'} / {row.features?.source || 'unknown'}</p>
                                <Badge variant="outline">{Number(row.features?.visitors || 0).toLocaleString()} visitors</Badge>
                              </div>
                              <p className="mt-2 text-xs text-muted-foreground">
                                CVR {Math.round(Number(row.features?.conversion_rate || 0) * 1000) / 10}% • RPV {formatAdminNaira(Number(row.features?.revenue_per_visitor || 0))}
                              </p>
                              {row.features?.campaign && <p className="mt-1 truncate text-xs text-muted-foreground">Campaign: {row.features.campaign}</p>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="mt-4 rounded-2xl border bg-background/60 p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="font-black">Acquisition Source Economics</p>
                          <p className="text-xs text-muted-foreground">First-party source value ranked by revenue per visitor. Spend is not assumed unless you add it later.</p>
                        </div>
                        <Badge variant="outline">{revenueOsHealth.sourceEconomicsRows.length.toLocaleString()} source(s)</Badge>
                      </div>
                      {revenueOsHealth.sourceEconomicsRows.length === 0 ? (
                        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Refresh intelligence after attributed traffic to see source economics.</p>
                      ) : (
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                          {revenueOsHealth.sourceEconomicsRows.map((row) => (
                            <div key={row.snapshot_key || row.scope_id} className="rounded-xl border p-3">
                              <p className="truncate text-sm font-black">{row.features?.source || 'unknown'}</p>
                              <p className="mt-1 truncate text-xs text-muted-foreground">{row.features?.channel || 'unknown'}{row.features?.campaign ? ` • ${row.features.campaign}` : ''}</p>
                              <p className="mt-3 text-lg font-black">{formatAdminNaira(Number(row.features?.revenue_per_visitor || 0))}</p>
                              <p className="text-xs text-muted-foreground">
                                {Number(row.features?.visitors || 0).toLocaleString()} visitors • CVR {Math.round(Number(row.features?.conversion_rate || 0) * 1000) / 10}%
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="mt-4 rounded-2xl border bg-background/60 p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="font-black">Contextual Bandit Allocations</p>
                          <p className="text-xs text-muted-foreground">Safe traffic-weight recommendations for running experiment variants. Bandits allocate among approved variants only.</p>
                        </div>
                        <Badge variant="outline">{revenueOsHealth.banditRows.length.toLocaleString()} snapshot(s)</Badge>
                      </div>
                      {revenueOsHealth.banditRows.length === 0 ? (
                        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Run evaluation after an experiment has traffic to generate allocation advice.</p>
                      ) : (
                        <div className="grid gap-3 lg:grid-cols-2">
                          {revenueOsHealth.banditRows.map((row) => {
                            const allocation = Array.isArray(row.features?.allocation) ? row.features.allocation : []
                            const recommendation = String(row.features?.recommendation || 'insufficient_data')
                            return (
                              <div key={row.snapshot_key || row.id} className="rounded-xl border p-3">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="truncate text-sm font-black">{row.features?.experiment_key || row.scope_id || 'experiment'}</p>
                                  <Badge variant={recommendation === 'pause' ? 'destructive' : recommendation === 'allocate' ? 'default' : 'outline'} className="capitalize">
                                    {recommendation.replace(/_/g, ' ')}
                                  </Badge>
                                </div>
                                <div className="mt-3 space-y-2">
                                  {allocation.length === 0 ? (
                                    <p className="text-xs text-muted-foreground">No variant allocation data yet.</p>
                                  ) : allocation.map((variant: any) => (
                                    <div key={variant.variantId} className="rounded-lg bg-muted/40 p-2">
                                      <div className="flex items-center justify-between gap-2 text-xs">
                                        <span className="truncate font-bold">{variant.variantId}</span>
                                        <span className="font-black">{Math.round(Number(variant.weight || 0) * 100)}%</span>
                                      </div>
                                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-background">
                                        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(Number(variant.weight || 0) * 100)}%` }} />
                                      </div>
                                      <p className="mt-1 text-xs text-muted-foreground">
                                        reward {formatAdminNaira(Number(variant.reward || 0))}/visitor • {Number(variant.visitors || 0).toLocaleString()} visitors • {Math.round(Number(variant.confidence || 0) * 100)}% confidence
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </AdminControlSection>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <AdminControlSection title="High Selling Products" description="Products ranked by completed revenue and units sold.">
                      <div className="space-y-3">
                        {salesAnalytics.highSellingProducts.length === 0 ? (
                          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No completed product sales yet.</p>
                        ) : salesAnalytics.highSellingProducts.map((product, index) => (
                          <div key={product.id} className="flex items-center justify-between gap-3 rounded-xl border p-3">
                            <div className="min-w-0">
                              <p className="truncate font-black">{index + 1}. {product.name}</p>
                              <p className="text-xs text-muted-foreground">{product.category} • {product.units} units • stock {product.stock}</p>
                            </div>
                            <Badge variant="outline" className="whitespace-nowrap">{formatAdminNaira(product.revenue)}</Badge>
                          </div>
                        ))}
                      </div>
                    </AdminControlSection>

                    <AdminControlSection title="Best Customers" description="Customers ranked by completed purchases.">
                      <div className="space-y-3">
                        {salesAnalytics.bestCustomers.length === 0 ? (
                          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No completed customer sales yet.</p>
                        ) : salesAnalytics.bestCustomers.map((customer, index) => (
                          <div key={customer.id} className="flex items-center justify-between gap-3 rounded-xl border p-3">
                            <div className="min-w-0">
                              <p className="truncate font-black">{index + 1}. {customer.email}</p>
                              <p className="text-xs text-muted-foreground">{customer.orders} orders • {customer.units} units • last {formatDistanceToNow(new Date(customer.lastOrder), { addSuffix: true })}</p>
                            </div>
                            <Badge variant="outline" className="whitespace-nowrap">{formatAdminNaira(customer.revenue)}</Badge>
                          </div>
                        ))}
                      </div>
                    </AdminControlSection>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-3">
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <UserPlus className="h-5 w-5 text-primary" />
                          New Customers
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="grid grid-cols-3 gap-2 text-center">
                        <div className="rounded-xl border p-3"><p className="text-2xl font-black">{salesAnalytics.newCustomers.today}</p><p className="text-xs text-muted-foreground">Today</p></div>
                        <div className="rounded-xl border p-3"><p className="text-2xl font-black">{salesAnalytics.newCustomers.week}</p><p className="text-xs text-muted-foreground">7 days</p></div>
                        <div className="rounded-xl border p-3"><p className="text-2xl font-black">{salesAnalytics.newCustomers.month}</p><p className="text-xs text-muted-foreground">30 days</p></div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <MousePointerClick className="h-5 w-5 text-primary" />
                          Visitor Trend
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="grid grid-cols-3 gap-2 text-center">
                        <div className="rounded-xl border p-3"><p className="text-2xl font-black">{salesAnalytics.visitors.today}</p><p className="text-xs text-muted-foreground">{salesAnalytics.visitors.visitsToday} visits</p></div>
                        <div className="rounded-xl border p-3"><p className="text-2xl font-black">{salesAnalytics.visitors.week}</p><p className="text-xs text-muted-foreground">{salesAnalytics.visitors.visitsWeek} visits</p></div>
                        <div className="rounded-xl border p-3"><p className="text-2xl font-black">{salesAnalytics.visitors.month}</p><p className="text-xs text-muted-foreground">{salesAnalytics.visitors.visitsMonth} visits</p></div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle>Market Trends</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {salesAnalytics.marketTrends.length === 0 ? (
                          <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">No weekly trend yet.</p>
                        ) : salesAnalytics.marketTrends.slice(0, 4).map((trend) => (
                          <div key={trend.category} className="flex items-center justify-between rounded-xl border p-3">
                            <div className="min-w-0">
                              <p className="truncate font-bold">{trend.category}</p>
                              <p className="text-xs text-muted-foreground">{trend.recentUnits} units this week</p>
                            </div>
                            <Badge variant={trend.growth >= 0 ? 'default' : 'destructive'}>{trend.growth >= 0 ? '+' : ''}{trend.growth.toFixed(0)}%</Badge>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  </div>

                  <AdminControlSection
                    title="Section Histories"
                    description="Customer activity grouped by website section. Each panel collapses on mobile to save space."
                  >
                    <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="relative w-full md:max-w-md">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={historySearchQuery}
                          onChange={(event) => setHistorySearchQuery(event.target.value)}
                          placeholder="Search customer, product, reference..."
                          className="pl-10"
                        />
                      </div>
                      <Button type="button" variant="outline" onClick={loadAdminHistories} disabled={historyLoading}>
                        {historyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        Refresh histories
                      </Button>
                    </div>

                    <div className="space-y-3">
                      {visibleHistorySections.map((section) => (
                        <AdminControlSection
                          key={section.key}
                          title={`${section.title} (${section.rows.length.toLocaleString()})`}
                          description={section.description}
                        >
                          {section.rows.length === 0 ? (
                            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                              No matching customer records in this section.
                            </p>
                          ) : (
                            <div className="overflow-x-auto rounded-xl border">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Customer</TableHead>
                                    <TableHead>Item</TableHead>
                                    <TableHead>Reference</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-right">Amount</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {section.rows.slice(0, 20).map((row) => (
                                    <TableRow key={row.id}>
                                      <TableCell className="whitespace-nowrap text-sm">
                                        {row.date ? format(new Date(row.date), 'MMM d, yyyy HH:mm') : 'Unknown'}
                                      </TableCell>
                                      <TableCell className="min-w-[220px]">
                                        <p className="font-semibold">{row.user_email || row.user_name || `Customer ${String(row.user_id || '').slice(0, 8)}`}</p>
                                        <p className="font-mono text-xs text-muted-foreground">{row.user_id || '-'}</p>
                                      </TableCell>
                                      <TableCell className="min-w-[260px]">
                                        <p className="font-semibold">{row.title}</p>
                                        {row.subtitle && <p className="max-w-[360px] truncate text-xs text-muted-foreground" title={row.subtitle}>{row.subtitle}</p>}
                                      </TableCell>
                                      <TableCell className="font-mono text-xs">{row.reference || '-'}</TableCell>
                                      <TableCell>
                                        <Badge variant={isPositiveStatus(row.status) ? 'default' : 'outline'} className={cn('capitalize', isPositiveStatus(row.status) && 'bg-emerald-600 hover:bg-emerald-600')}>
                                          {normalizeStatus(row.status)}
                                        </Badge>
                                      </TableCell>
                                      <TableCell className="whitespace-nowrap text-right font-black">
                                        {row.amount == null ? '-' : formatAdminNaira(row.amount)}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          )}
                        </AdminControlSection>
                      ))}
                    </div>
                  </AdminControlSection>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Transaction History */}
            <TabsContent value="histories" className="space-y-6">
              <Card className="overflow-hidden">
                <CardHeader className="border-b bg-gradient-to-r from-purple-50 via-white to-cyan-50 dark:from-purple-950/30 dark:via-card dark:to-cyan-950/20">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-2xl">
                        <History className="h-6 w-6 text-primary" />
                        Transaction History
                      </CardTitle>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Completed customer wallet deposit transactions only. Product, SMS, crypto, bills, gift card, and social histories live under Sales.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" onClick={loadAdminHistories} disabled={historyLoading}>
                        {historyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        Refresh
                      </Button>
                      <Button type="button" variant="outline" onClick={exportHistoryRows} disabled={filteredHistoryRows.length === 0}>
                        <Download className="h-4 w-4" />
                        Export CSV
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5 p-4 md:p-6">
                  <div className="grid gap-3 md:grid-cols-3">
                    <Card className="bg-emerald-50/80 dark:bg-emerald-500/10">
                      <CardContent className="p-4">
                        <p className="text-sm font-semibold text-muted-foreground">Completed Transactions</p>
                        <p className="mt-2 text-2xl font-black text-emerald-700 dark:text-emerald-300">
                          {formatAdminNaira(historyStats.completedTotal)}
                        </p>
                        <p className="text-xs text-muted-foreground">{historyStats.completedCount} record(s)</p>
                      </CardContent>
                    </Card>
                    <Card className="bg-cyan-50/80 dark:bg-cyan-500/10">
                      <CardContent className="p-4">
                        <p className="text-sm font-semibold text-muted-foreground">Customers Funded</p>
                        <p className="mt-2 text-2xl font-black text-cyan-700 dark:text-cyan-300">
                          {new Set(depositHistoryRows.map((row) => row.user_id).filter(Boolean)).size.toLocaleString()}
                        </p>
                        <p className="text-xs text-muted-foreground">Actual non-staff customers</p>
                      </CardContent>
                    </Card>
                    <Card className="bg-purple-50/80 dark:bg-purple-500/10">
                      <CardContent className="p-4">
                        <p className="text-sm font-semibold text-muted-foreground">Latest Transaction</p>
                        <p className="mt-2 truncate text-xl font-black text-purple-700 dark:text-purple-300">
                          {depositHistoryRows[0] ? formatAdminNaira(depositHistoryRows[0].amount) : 'No transactions'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {depositHistoryRows[0]?.date ? formatDistanceToNow(new Date(depositHistoryRows[0].date), { addSuffix: true }) : 'Waiting for completed transactions'}
                        </p>
                      </CardContent>
                    </Card>
                  </div>

                  {Object.keys(historyErrors).length > 0 && (
                    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                      <p className="font-bold">Some history sources need attention.</p>
                      <div className="mt-2 grid gap-1 md:grid-cols-2">
                        {Object.entries(historyErrors).map(([label, message]) => (
                          <p key={label} className="break-words">
                            <span className="font-semibold">{label}:</span> {message}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={historySearchQuery}
                      onChange={(event) => setHistorySearchQuery(event.target.value)}
                      placeholder="Search customer, transaction reference, status..."
                      className="pl-10"
                    />
                  </div>

                  {historyLoading ? (
                    <div className="rounded-2xl border py-16 text-center">
                      <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-primary" />
                      <p className="font-semibold">Loading completed transactions...</p>
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-2xl border">
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Date</TableHead>
                              <TableHead>Customer</TableHead>
                              <TableHead>Reference</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>Balance After</TableHead>
                              <TableHead className="text-right">Amount</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {filteredHistoryRows.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                                  No completed customer transactions match this view.
                                </TableCell>
                              </TableRow>
                            ) : filteredHistoryRows.map((row) => (
                              <TableRow key={row.id}>
                                <TableCell className="whitespace-nowrap text-sm">
                                  {row.date ? format(new Date(row.date), 'MMM d, yyyy HH:mm') : 'Unknown'}
                                  {row.date && (
                                    <p className="text-xs text-muted-foreground">
                                      {formatDistanceToNow(new Date(row.date), { addSuffix: true })}
                                    </p>
                                  )}
                                </TableCell>
                                <TableCell className="min-w-[220px]">
                                  <p className="font-semibold">{row.user_email || row.user_name || `Customer ${String(row.user_id || '').slice(0, 8)}`}</p>
                                  <p className="font-mono text-xs text-muted-foreground">{row.user_id || '-'}</p>
                                </TableCell>
                                <TableCell className="font-mono text-xs">{row.reference || '-'}</TableCell>
                                <TableCell>
                                  <Badge className="bg-emerald-600 capitalize hover:bg-emerald-600">
                                    {normalizeStatus(row.status)}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">{row.detail || '-'}</TableCell>
                                <TableCell className="whitespace-nowrap text-right font-black">
                                  {row.amount == null ? '-' : formatAdminNaira(row.amount)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}
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

            {/* SMS Orders Management */}
            <TabsContent value="sms-orders" className="space-y-6">
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <CardTitle>SMS Orders</CardTitle>
                      <p className="mt-1 text-sm text-muted-foreground">All customer SMS purchases. Auto-cancel cancels pending orders older than 5 minutes with no code.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={loadSmsOrders} disabled={smsOrdersLoading}>
                        {smsOrdersLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                        Refresh
                      </Button>
                      <Button variant="destructive" size="sm" onClick={adminAutoCancelStale} disabled={smsOrdersAutoCancelling || smsOrdersLoading}>
                        {smsOrdersAutoCancelling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}
                        Auto-cancel stale (5 min+)
                      </Button>
                    </div>
                  </div>
                  {/* Filter */}
                  <div className="mt-3 flex gap-2">
                    {(['all', 'pending', 'completed', 'cancelled'] as const).map(f => (
                      <button
                        key={f}
                        onClick={() => setSmsOrdersFilter(f)}
                        className={`rounded-full px-3 py-1 text-xs font-semibold capitalize transition-colors ${smsOrdersFilter === f ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </CardHeader>
                <CardContent>
                  {smsOrders.length === 0 && !smsOrdersLoading && (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                      No SMS orders yet.{' '}
                      <button className="underline" onClick={loadSmsOrders}>Load orders</button>
                    </div>
                  )}
                  {smsOrdersLoading && (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  )}
                  {!smsOrdersLoading && smsOrders.length > 0 && (() => {
                    const isPending = (o: any) => !['completed', 'cancelled', 'expired', 'failed'].includes(o.status)
                    const filtered = smsOrders.filter(o => {
                      if (smsOrdersFilter === 'pending') return isPending(o)
                      if (smsOrdersFilter === 'completed') return o.status === 'completed'
                      if (smsOrdersFilter === 'cancelled') return o.status === 'cancelled'
                      return true
                    })
                    const now = Date.now()
                    return (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b text-left text-xs font-semibold uppercase text-muted-foreground">
                              <th className="pb-2 pr-4">User</th>
                              <th className="pb-2 pr-4">Service</th>
                              <th className="pb-2 pr-4">Amount</th>
                              <th className="pb-2 pr-4">Status</th>
                              <th className="pb-2 pr-4">Time pending</th>
                              <th className="pb-2 pr-4">Refunded</th>
                              <th className="pb-2">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {filtered.map(order => {
                              const pending = isPending(order)
                              const minsPending = Math.floor((now - new Date(order.created_at).getTime()) / 60000)
                              const isStale = pending && minsPending >= 5
                              const hasCode = order.messages && order.messages.length > 0
                              return (
                                <tr key={order.id} className={`text-sm ${isStale && !hasCode ? 'bg-red-50 dark:bg-red-950/20' : ''}`}>
                                  <td className="py-2 pr-4">
                                    <p className="font-medium">{order.profiles?.full_name || '—'}</p>
                                    <p className="text-xs text-muted-foreground">{order.profiles?.email || '—'}</p>
                                  </td>
                                  <td className="py-2 pr-4">{order.service_name}</td>
                                  <td className="py-2 pr-4 font-semibold">₦{Number(order.price_ngn).toLocaleString()}</td>
                                  <td className="py-2 pr-4">
                                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${
                                      order.status === 'completed' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                                      : order.status === 'cancelled' ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                                      : isStale ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                                      : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                                    }`}>
                                      {order.status}
                                    </span>
                                  </td>
                                  <td className="py-2 pr-4 text-xs text-muted-foreground">
                                    {pending
                                      ? <span className={isStale && !hasCode ? 'font-bold text-red-600' : ''}>{minsPending}m ago</span>
                                      : new Date(order.created_at).toLocaleDateString()}
                                  </td>
                                  <td className="py-2 pr-4">
                                    {order.refunded_at
                                      ? <span className="text-xs text-emerald-600">✓ Refunded</span>
                                      : <span className="text-xs text-muted-foreground">—</span>}
                                  </td>
                                  <td className="py-2">
                                    {pending && (
                                      <Button
                                        size="sm"
                                        variant="destructive"
                                        className="h-7 px-2 text-xs"
                                        disabled={smsOrdersCancellingId === order.id}
                                        onClick={() => adminCancelSmsOrder(order.id)}
                                      >
                                        {smsOrdersCancellingId === order.id
                                          ? <Loader2 className="h-3 w-3 animate-spin" />
                                          : 'Cancel & Refund'}
                                      </Button>
                                    )}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                        {filtered.length === 0 && (
                          <p className="py-6 text-center text-sm text-muted-foreground">No {smsOrdersFilter} orders.</p>
                        )}
                      </div>
                    )
                  })()}
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
