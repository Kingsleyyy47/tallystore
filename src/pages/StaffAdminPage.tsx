import { useState, useEffect, useCallback, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, Clock, CheckCircle2, XCircle, Settings, Upload, Plus, Tag, Users, BarChart2, Mail, Send, RefreshCw, X, PhoneCall, Star, AlertTriangle, Activity, ShieldCheck } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import Navbar from '@/components/NavbarAuth'
import Footer from '@/components/Footer'
import { useAuth } from '@/contexts/SimpleAuth'
import { useToast } from '@/hooks/use-toast'
import {
  getMyStaffPermissions,
  submitPendingAction,
  type PermissionMap,
  type PermissionKey,
} from '@/lib/staffPermissions'
import {
  supabase,
  getAppSetting,
  getAllProductGroups,
  getCategories,
  searchUsers,
  getDiscountCodes,
  parseCSV,
  getUserCount,
  getAdminSalesStats,
  type ProductGroup,
  type Category,
  type DiscountCode,
} from '@/lib/supabase'
import { format } from 'date-fns'

type StaffSmsProduct = {
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
  is_enabled: boolean
  is_favorite: boolean
  price_override_ngn: number | null
  auto_markup_enabled: boolean
  pricing_mode: 'auto_markup' | 'manual_margin' | 'override'
}

type StaffSmsCatalogResponse = {
  success: boolean
  data?: StaffSmsProduct[]
  error?: string
  configured?: boolean
  global_margin_ngn?: number
  exchange_rate?: number
  exchange_rate_source?: 'override' | 'live' | 'unavailable' | 'unknown'
  round_to_nearest_10?: boolean
}

type StaffHistoryRow = {
  id: string
  source: string
  date: string
  customer: string
  customer_email?: string
  title: string
  subtitle?: string
  amount: number
  status: string
  reference?: string
}

type StaffHistoryResponse = {
  success: boolean
  data?: StaffHistoryRow[]
  error?: string
  warning?: string
}

type StaffRevenueOsSnapshot = {
  success: boolean
  data?: {
    settings: Record<string, string>
    quality: any[]
    opportunities: any[]
    action_plans: any[]
    experiments: any[]
    decisions: any[]
    warning?: string
  }
  error?: string
}

function can(perms: PermissionMap, key: PermissionKey) {
  return perms[key]?.is_enabled === true
}
function autoApproves(perms: PermissionMap, key: PermissionKey) {
  return perms[key]?.is_enabled === true && perms[key]?.auto_approve !== false
}
function hasSettingsPermission(perms: PermissionMap) {
  return can(perms, 'setting_rate') || can(perms, 'setting_referral_pct') || can(perms, 'setting_ercas') || can(perms, 'setting_support_links')
}

export default function StaffAdminPage() {
  const { user } = useAuth()
  const { toast } = useToast()

  const [perms, setPerms] = useState<PermissionMap>({} as PermissionMap)
  const [loadingPerms, setLoadingPerms] = useState(true)

  // Stats
  const [userCount, setUserCount] = useState(0)
  const [salesStats, setSalesStats] = useState({ totalSales: 0, totalRevenue: 0 })

  // Rate / referral settings
  const [ngnUsdRate, setNgnUsdRate] = useState('')
  const [savingRate, setSavingRate] = useState(false)
  const [referralPct, setReferralPct] = useState('5')
  const [savingReferral, setSavingReferral] = useState(false)
  const [ercasEnabled, setErcasEnabled] = useState(false)
  const [savingErcas, setSavingErcas] = useState(false)

  // Support links settings
  const [supportWhatsappUrl, setSupportWhatsappUrl] = useState('')
  const [supportTelegramUrl, setSupportTelegramUrl] = useState('')
  const [supportChannelUrl, setSupportChannelUrl] = useState('')
  const [supportPopupMessage, setSupportPopupMessage] = useState('')
  const [savingSupportLinks, setSavingSupportLinks] = useState(false)

  // Email / broadcast
  const [emailSubject, setEmailSubject] = useState('TallyStore Notification')
  const [emailMessage, setEmailMessage] = useState('')
  const [emailRecipients, setEmailRecipients] = useState<string[]>([])
  const [emailRecipientInput, setEmailRecipientInput] = useState('')
  const [isSendingEmail, setIsSendingEmail] = useState(false)
  const [broadcastJobs, setBroadcastJobs] = useState<any[]>([])
  const [isLoadingJobs, setIsLoadingJobs] = useState(false)
  const [isBroadcasting, setIsBroadcasting] = useState(false)
  const [isDryRun, setIsDryRun] = useState(true)
  const [dryRunResult, setDryRunResult] = useState<any>(null)
  const broadcastPollRef = useRef<NodeJS.Timeout | null>(null)

  // Products / categories
  const [productGroups, setProductGroups] = useState<ProductGroup[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loadingProducts, setLoadingProducts] = useState(false)

  // Add single account
  const [addPgId, setAddPgId] = useState('')
  const [addUsername, setAddUsername] = useState('')
  const [addPassword, setAddPassword] = useState('')
  const [addEmail, setAddEmail] = useState('')
  const [addingAccount, setAddingAccount] = useState(false)

  // Bulk upload
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [bulkPgId, setBulkPgId] = useState('')
  const [bulkUploading, setBulkUploading] = useState(false)
  const [bulkResult, setBulkResult] = useState<{ success: boolean; accountsCreated: number; error?: string; pending?: boolean } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Categories
  const [newCatName, setNewCatName] = useState('')
  const [newCatDesc, setNewCatDesc] = useState('')
  const [addingCat, setAddingCat] = useState(false)

  // Discount codes
  const [discountCodes, setDiscountCodes] = useState<DiscountCode[]>([])
  const [loadingCodes, setLoadingCodes] = useState(false)
  const [newCode, setNewCode] = useState('')
  const [newCodePct, setNewCodePct] = useState('10')
  const [newCodeMaxUses, setNewCodeMaxUses] = useState('')
  const [creatingCode, setCreatingCode] = useState(false)

  // SMS products
  const [smsProducts, setSmsProducts] = useState<StaffSmsProduct[]>([])
  const [smsProductsLoading, setSmsProductsLoading] = useState(false)
  const [smsSearchQuery, setSmsSearchQuery] = useState('')
  const [smsGlobalMargin, setSmsGlobalMargin] = useState('700')
  const [smsKeepAutoApply, setSmsKeepAutoApply] = useState(true)
  const [smsRoundToNearestTen, setSmsRoundToNearestTen] = useState(false)
  const [smsSavingKey, setSmsSavingKey] = useState<string | null>(null)
  const [smsPriceInputs, setSmsPriceInputs] = useState<Record<string, string>>({})
  const [smsMarginInputs, setSmsMarginInputs] = useState<Record<string, string>>({})
  const [smsCatalogNotice, setSmsCatalogNotice] = useState('')

  // SMS Orders management
  type StaffSmsOrder = {
    id: string; reference: string; service_name: string; status: string
    price_ngn: number; created_at: string; cancelled_at?: string; refunded_at?: string
    messages?: any[]; order_type: string; provider_request_id?: string
    profiles?: { email?: string; full_name?: string }
  }
  const [smsOrders, setSmsOrders] = useState<StaffSmsOrder[]>([])
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

  const staffCancelSmsOrder = useCallback(async (orderId: string) => {
    setSmsOrdersCancellingId(orderId)
    try {
      if (!autoApproves(perms, 'tab_sms_orders')) {
        const res = await submitPendingAction('tab_sms_orders', 'sms_cancel_order', `Cancel SMS order ${String(orderId).slice(0, 8)}`, { order_id: orderId })
        if (!res.success) throw new Error(res.error || 'Failed to submit cancellation')
        toast({ title: 'Cancellation submitted for approval' })
        return
      }

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
  }, [perms, toast, loadSmsOrders])

  const staffAutoCancelStale = useCallback(async () => {
    setSmsOrdersAutoCancelling(true)
    try {
      if (!autoApproves(perms, 'tab_sms_orders')) {
        const res = await submitPendingAction('tab_sms_orders', 'sms_auto_cancel_stale', 'Auto-cancel stale SMS orders', {})
        if (!res.success) throw new Error(res.error || 'Failed to submit auto-cancel')
        toast({ title: 'Auto-cancel submitted for approval' })
        return
      }

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
  }, [perms, toast, loadSmsOrders])

  // Users
  const [userQuery, setUserQuery] = useState('')
  const [users, setUsers] = useState<any[]>([])
  const [searchingUsers, setSearchingUsers] = useState(false)
  const [adjustUserId, setAdjustUserId] = useState('')
  const [adjustAmount, setAdjustAmount] = useState('')
  const [adjustType, setAdjustType] = useState<'add' | 'subtract'>('add')
  const [adjustReason, setAdjustReason] = useState('')
  const [adjusting, setAdjusting] = useState(false)

  // Product editing
  const [editingPg, setEditingPg] = useState<ProductGroup | null>(null)
  const [editPrice, setEditPrice] = useState('')
  const [editMua, setEditMua] = useState('')
  const [editShopclone, setEditShopclone] = useState('')
  const [editShopviaclone, setEditShopviaclone] = useState('')
  const [editAutoFulfill, setEditAutoFulfill] = useState(false)
  const [savingPg, setSavingPg] = useState(false)

  // My pending history
  const [myPending, setMyPending] = useState<any[]>([])
  const [loadingPending, setLoadingPending] = useState(false)

  // Histories
  const [depositHistory, setDepositHistory] = useState<StaffHistoryRow[]>([])
  const [salesHistory, setSalesHistory] = useState<StaffHistoryRow[]>([])
  const [loadingDepositHistory, setLoadingDepositHistory] = useState(false)
  const [loadingSalesHistory, setLoadingSalesHistory] = useState(false)
  const [depositHistoryWarning, setDepositHistoryWarning] = useState('')
  const [salesHistoryWarning, setSalesHistoryWarning] = useState('')
  const [revenueOsSnapshot, setRevenueOsSnapshot] = useState<StaffRevenueOsSnapshot['data'] | null>(null)
  const [loadingRevenueOs, setLoadingRevenueOs] = useState(false)
  const [savingRevenueOs, setSavingRevenueOs] = useState(false)
  const [croEnabledDraft, setCroEnabledDraft] = useState(true)
  const [croMaintenanceDraft, setCroMaintenanceDraft] = useState(true)
  const [croShadowDraft, setCroShadowDraft] = useState(true)
  const [croExperimentDraft, setCroExperimentDraft] = useState(false)
  const [croAutonomyDraft, setCroAutonomyDraft] = useState('1')
  const [croHoldoutDraft, setCroHoldoutDraft] = useState('5')
  const [croPromotionMaxDiscountDraft, setCroPromotionMaxDiscountDraft] = useState('20')
  const [croPromotionMonthlyBudgetDraft, setCroPromotionMonthlyBudgetDraft] = useState('0')

  // ── Load permissions ─────────────────────────────────────────────────────
  useEffect(() => {
    getMyStaffPermissions().then(p => {
      setPerms(p)
      setLoadingPerms(false)
    })
  }, [])

  const loadSmsProducts = useCallback(async () => {
    if (!can(perms, 'tab_sms_products')) return
    setSmsProductsLoading(true)
    try {
      const { data, error } = await supabase.functions.invoke<StaffSmsCatalogResponse>('smsbus', {
        body: { action: 'admin_sms_products' },
      })
      if (error) throw error
      if (!data?.success) throw new Error(data?.error || 'Failed to load SMS products')
      const products = data.data || []
      setSmsProducts(products)
      setSmsRoundToNearestTen(data.round_to_nearest_10 === true)
      if (typeof data.global_margin_ngn === 'number') setSmsGlobalMargin(String(data.global_margin_ngn))
      setSmsPriceInputs(Object.fromEntries(products.map((product) => [
        product.service_code,
        product.price_override_ngn === null || product.price_override_ngn === undefined ? '' : String(product.price_override_ngn),
      ])))
      setSmsMarginInputs(Object.fromEntries(products.map((product) => [
        product.service_code,
        String(product.margin_ngn ?? data.global_margin_ngn ?? 700),
      ])))
      setSmsCatalogNotice(data.configured === false ? 'SMS API key is not configured on the deployed function.' : '')
    } catch (err: any) {
      setSmsCatalogNotice(err.message || 'Failed to load SMS products')
      toast({ title: 'Failed to load SMS products', description: err.message, variant: 'destructive' })
    } finally {
      setSmsProductsLoading(false)
    }
  }, [perms, toast])

  const loadDepositHistory = useCallback(async () => {
    if (!can(perms, 'tab_transactions')) return
    setLoadingDepositHistory(true)
    try {
      const { data, error } = await supabase.functions.invoke<StaffHistoryResponse>('manage-staff', {
        body: { action: 'staff_deposit_history' },
      })
      if (error) throw error
      if (!data?.success) throw new Error(data?.error || 'Failed to load deposit history')
      setDepositHistory(data.data || [])
      setDepositHistoryWarning(data.warning || '')
    } catch (err: any) {
      setDepositHistoryWarning('')
      toast({ title: 'Failed to load deposit history', description: err.message, variant: 'destructive' })
    } finally {
      setLoadingDepositHistory(false)
    }
  }, [perms, toast])

  const loadSalesHistory = useCallback(async () => {
    if (!can(perms, 'tab_sales')) return
    setLoadingSalesHistory(true)
    try {
      const { data, error } = await supabase.functions.invoke<StaffHistoryResponse>('manage-staff', {
        body: { action: 'staff_sales_history' },
      })
      if (error) throw error
      if (!data?.success) throw new Error(data?.error || 'Failed to load sales history')
      setSalesHistory(data.data || [])
      setSalesHistoryWarning(data.warning || '')
    } catch (err: any) {
      setSalesHistoryWarning('')
      toast({ title: 'Failed to load sales history', description: err.message, variant: 'destructive' })
    } finally {
      setLoadingSalesHistory(false)
    }
  }, [perms, toast])

  const loadRevenueOsSnapshot = useCallback(async () => {
    if (!can(perms, 'tab_revenue_os')) return
    setLoadingRevenueOs(true)
    try {
      const { data, error } = await supabase.functions.invoke<StaffRevenueOsSnapshot>('manage-staff', {
        body: { action: 'staff_revenue_os_snapshot' },
      })
      if (error) throw error
      if (!data?.success) throw new Error(data?.error || 'Failed to load Revenue OS')
      const snapshot = data.data || null
      const settings = snapshot?.settings || {}
      const freezeReason = String(settings.cro_maintenance_freeze_reason || '').trim()
      setRevenueOsSnapshot(snapshot)
      setCroEnabledDraft(settings.cro_global_enabled !== 'false' && !freezeReason)
      setCroMaintenanceDraft(settings.cro_maintenance_enabled !== 'false')
      setCroShadowDraft(settings.cro_shadow_mode_enabled === 'true')
      setCroExperimentDraft(settings.cro_experimentation_enabled === 'true')
      setCroAutonomyDraft(settings.cro_autonomy_level || '1')
      setCroHoldoutDraft(settings.cro_global_holdout_pct || settings.cro_holdout_percentage || '5')
      setCroPromotionMaxDiscountDraft(settings.cro_promotion_max_discount_pct || '20')
      setCroPromotionMonthlyBudgetDraft(settings.cro_promotion_monthly_budget_ngn || '0')
    } catch (err: any) {
      toast({ title: 'Failed to load Revenue OS', description: err.message, variant: 'destructive' })
    } finally {
      setLoadingRevenueOs(false)
    }
  }, [perms, toast])

  useEffect(() => {
    if (loadingPerms) return

    if (can(perms, 'view_stats')) {
      getUserCount().then(setUserCount)
      getAdminSalesStats().then(setSalesStats)
    }
    if (can(perms, 'setting_rate')) {
      getAppSetting('ngn_usd_rate').then(v => setNgnUsdRate(v || ''))
    }
    if (can(perms, 'setting_referral_pct')) {
      getAppSetting('referral_commission_pct').then(v => setReferralPct(v || '5'))
    }
    if (can(perms, 'setting_ercas')) {
      getAppSetting('ercas_enabled').then(v => setErcasEnabled(v !== 'false'))
    }
    if (can(perms, 'setting_support_links')) {
      Promise.all([
        getAppSetting('support_whatsapp_url'),
        getAppSetting('support_telegram_url'),
        getAppSetting('support_channel_url'),
        getAppSetting('support_popup_message'),
      ]).then(([wa, tg, ch, pm]) => {
        setSupportWhatsappUrl(wa || '')
        setSupportTelegramUrl(tg || '')
        setSupportChannelUrl(ch || '')
        setSupportPopupMessage(pm || '')
      })
    }
    if (can(perms, 'tab_products') || can(perms, 'tab_templates') || can(perms, 'tab_add_product') || can(perms, 'tab_bulk_upload')) {
      setLoadingProducts(true)
      Promise.all([getAllProductGroups(), getCategories()]).then(([pg, cat]) => {
        setProductGroups(pg)
        setCategories(cat)
        setLoadingProducts(false)
      })
    }
    if (can(perms, 'tab_discount_codes')) {
      setLoadingCodes(true)
      getDiscountCodes().then(codes => { setDiscountCodes(codes); setLoadingCodes(false) })
    }
    if (can(perms, 'tab_sms_products')) {
      loadSmsProducts()
    }
    if (can(perms, 'tab_transactions')) {
      loadDepositHistory()
    }
    if (can(perms, 'tab_sales')) {
      loadSalesHistory()
    }
    if (can(perms, 'tab_revenue_os')) {
      loadRevenueOsSnapshot()
    }
  }, [perms, loadingPerms, loadSmsProducts, loadDepositHistory, loadSalesHistory, loadRevenueOsSnapshot])

  const saveRevenueOsControls = async () => {
    if (!can(perms, 'tab_revenue_os')) return
    setSavingRevenueOs(true)
    try {
      const res = await submitPendingAction(
        'tab_revenue_os',
        'cro_update_controls',
        'Update Revenue OS controls',
        {
          settings: {
            cro_global_enabled: croEnabledDraft ? 'true' : 'false',
            cro_maintenance_enabled: croMaintenanceDraft ? 'true' : 'false',
            cro_shadow_mode_enabled: croShadowDraft ? 'true' : 'false',
            cro_experimentation_enabled: croExperimentDraft ? 'true' : 'false',
            cro_autonomy_level: croAutonomyDraft,
            cro_global_holdout_pct: croHoldoutDraft,
            cro_promotion_max_discount_pct: croPromotionMaxDiscountDraft,
            cro_promotion_monthly_budget_ngn: croPromotionMonthlyBudgetDraft,
          },
        },
      )
      if (!res.success) throw new Error(res.error || 'Failed to save Revenue OS controls')
      toast({
        title: res.applied ? 'Revenue OS controls saved' : 'Submitted for approval',
        description: res.applied ? 'Staff Revenue OS control changes are now live.' : 'Admin approval is required before these controls change.',
      })
      if (res.applied) await loadRevenueOsSnapshot()
    } catch (err: any) {
      toast({ title: 'Could not save Revenue OS controls', description: err.message, variant: 'destructive' })
    } finally {
      setSavingRevenueOs(false)
    }
  }

  const loadBroadcastJobs = useCallback(async () => {
    if (!can(perms, 'tab_email')) return
    setIsLoadingJobs(true)
    try {
      const { data, error } = await supabase.functions.invoke('email/broadcast-status', { method: 'GET' })
      if (error) throw error
      if (data?.success) setBroadcastJobs(data.jobs || [])
    } catch (err) {
      console.error('Failed to load broadcast jobs:', err)
    } finally {
      setIsLoadingJobs(false)
    }
  }, [perms])

  useEffect(() => {
    if (!loadingPerms && can(perms, 'tab_email')) loadBroadcastJobs()
  }, [perms, loadingPerms, loadBroadcastJobs])

  useEffect(() => {
    const hasActive = broadcastJobs.some(j => j.status === 'queued' || j.status === 'processing')
    if (hasActive && !broadcastPollRef.current) {
      broadcastPollRef.current = setInterval(loadBroadcastJobs, 5000)
    } else if (!hasActive && broadcastPollRef.current) {
      clearInterval(broadcastPollRef.current)
      broadcastPollRef.current = null
    }
    return () => {
      if (broadcastPollRef.current) {
        clearInterval(broadcastPollRef.current)
        broadcastPollRef.current = null
      }
    }
  }, [broadcastJobs, loadBroadcastJobs])

  const loadMyPending = useCallback(async () => {
    if (!user) return
    setLoadingPending(true)
    const { data } = await supabase
      .from('staff_pending_actions')
      .select('*')
      .eq('staff_id', user.id)
      .order('created_at', { ascending: false })
      .limit(30)
    setMyPending(data || [])
    setLoadingPending(false)
  }, [user])

  useEffect(() => { loadMyPending() }, [loadMyPending])

  // ── Helpers ──────────────────────────────────────────────────────────────
  async function handleSettingChange(
    permKey: PermissionKey,
    settingKey: string,
    value: string,
    label: string,
    onSuccess?: () => void,
  ) {
    const res = await submitPendingAction(permKey, 'upsert_setting', `Set ${label} to ${value}`, { setting_key: settingKey, value })
    if (res.success) {
      if (res.applied) {
      toast({ title: `${label} updated` })
      onSuccess?.()
      } else {
        toast({ title: 'Submitted for approval' })
        loadMyPending()
      }
    } else {
      toast({ variant: 'destructive', title: res.error })
    }
  }

  // ── Support links ─────────────────────────────────────────────────────────
  async function submitSmsAction(actionType: string, label: string, actionData: Record<string, unknown>) {
    const res = await submitPendingAction('tab_sms_products', actionType, label, actionData)
    if (res.success) {
      if (!res.applied) {
        toast({ title: 'Submitted for approval' })
        loadMyPending()
      }
    } else {
      toast({ variant: 'destructive', title: res.error })
    }
    return res
  }

  async function updateSmsProduct(serviceCode: string, updates: Record<string, unknown>, reload = false) {
    const product = smsProducts.find(item => item.service_code === serviceCode)
    setSmsSavingKey(`${serviceCode}-${Object.keys(updates).join('-')}`)
    try {
      const res = await submitSmsAction(
        'sms_update_product',
        `Update SMS product ${product?.service_name || serviceCode}`,
        { service_code: serviceCode, service_name: product?.service_name, ...updates },
      )
      if (!res.success) return
      if (res.applied) {
        setSmsProducts(prev => prev.map(item => item.service_code === serviceCode ? { ...item, ...updates } as StaffSmsProduct : item))
        if (reload) await loadSmsProducts()
        toast({ title: 'SMS product updated' })
      }
    } catch (err: any) {
      toast({ title: 'SMS product update failed', description: err.message, variant: 'destructive' })
    } finally {
      setSmsSavingKey(null)
    }
  }

  async function saveSmsPriceOverride(product: StaffSmsProduct) {
    const raw = smsPriceInputs[product.service_code] ?? ''
    const value = raw.trim() === '' ? null : Number(raw)
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      toast({ title: 'Invalid price', description: 'Enter a valid naira amount or leave it blank.', variant: 'destructive' })
      return
    }
    await updateSmsProduct(product.service_code, { price_override_ngn: value === null ? null : Math.round(value) }, true)
  }

  async function saveSmsMargin(product: StaffSmsProduct) {
    const value = Number(smsMarginInputs[product.service_code] ?? '')
    if (!Number.isFinite(value) || value < 0) {
      toast({ title: 'Invalid markup', description: 'Enter a valid naira markup.', variant: 'destructive' })
      return
    }
    await updateSmsProduct(product.service_code, { margin_ngn: Math.round(value), auto_markup_enabled: true }, true)
  }

  async function applySmsGlobalMarkup() {
    const margin = Number(smsGlobalMargin)
    if (!Number.isFinite(margin) || margin < 0) {
      toast({ title: 'Invalid markup', description: 'Enter a valid naira markup.', variant: 'destructive' })
      return
    }
    setSmsSavingKey('global-markup')
    try {
      const data = await submitSmsAction('sms_apply_markup', `Apply SMS markup NGN ${Math.round(margin).toLocaleString()}`, {
        margin_ngn: Math.round(margin),
        keep_auto_applying: smsKeepAutoApply,
      })
      if (data.success && data.applied) {
        await loadSmsProducts()
        toast({ title: 'SMS markup applied' })
      }
    } catch (err: any) {
      toast({ title: 'Markup failed', description: err.message, variant: 'destructive' })
    } finally {
      setSmsSavingKey(null)
    }
  }

  async function toggleSmsRounding() {
    const next = !smsRoundToNearestTen
    setSmsSavingKey('round-to-10')
    try {
      const res = await submitSmsAction('sms_set_rounding', `${next ? 'Enable' : 'Disable'} SMS rounding`, {
        round_to_nearest_10: next,
      })
      if (res.success && res.applied) {
        setSmsRoundToNearestTen(next)
        await loadSmsProducts()
        toast({ title: next ? 'SMS rounding enabled' : 'SMS rounding disabled' })
      }
    } catch (err: any) {
      toast({ title: 'Rounding update failed', description: err.message, variant: 'destructive' })
    } finally {
      setSmsSavingKey(null)
    }
  }

  async function bulkToggleSmsProducts(isEnabled: boolean) {
    setSmsSavingKey(isEnabled ? 'enable-all' : 'disable-all')
    try {
      const data = await submitSmsAction('sms_bulk_products', `${isEnabled ? 'Enable' : 'Disable'} all SMS products`, { is_enabled: isEnabled })
      if (data.success && data.applied) {
        await loadSmsProducts()
        toast({ title: isEnabled ? 'SMS products enabled' : 'SMS products disabled' })
      }
    } catch (err: any) {
      toast({ title: 'Bulk update failed', description: err.message, variant: 'destructive' })
    } finally {
      setSmsSavingKey(null)
    }
  }

  async function handleSaveSupportLinks() {
    setSavingSupportLinks(true)
    try {
      const settings = {
        support_whatsapp_url: supportWhatsappUrl.trim(),
        support_telegram_url: supportTelegramUrl.trim(),
        support_channel_url: supportChannelUrl.trim(),
        support_popup_message: supportPopupMessage.trim(),
      }

      const res = await submitPendingAction('setting_support_links', 'upsert_settings', 'Update support links', { settings })
      if (res.success) {
        if (res.applied) {
        const { invalidateSupportSettingsCache } = await import('@/hooks/useSupportSettings')
        invalidateSupportSettingsCache()
        toast({ title: 'Support links saved' })
      } else {
          toast({ title: 'Submitted for approval' })
          loadMyPending()
        }
      } else {
        toast({ variant: 'destructive', title: res.error })
      }
    } finally { setSavingSupportLinks(false) }
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
      <div style="text-align:center;margin-top:32px;color:#999;font-size:12px"><p>TallyStore - Your trusted digital marketplace</p></div>
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

    if (!autoApproves(perms, 'tab_email')) {
      const res = await submitPendingAction('tab_email', 'send_email_list', `Send email to ${emailRecipients.length} recipient(s)`, {
        subject: emailSubject,
        message: emailMessage,
        recipients: emailRecipients,
      })
      if (res.success) {
        toast({ title: 'Submitted for approval' })
        setEmailRecipients([])
        setEmailMessage('')
        loadMyPending()
      } else {
        toast({ variant: 'destructive', title: res.error })
      }
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
    if (sentCount > 0) {
      setEmailRecipients([])
      setEmailMessage('')
    }
  }

  const handleBroadcast = async () => {
    if (!emailMessage.trim()) {
      toast({ title: 'Missing message', description: 'Write a message before broadcasting', variant: 'destructive' })
      return
    }

    if (!autoApproves(perms, 'tab_email')) {
      const res = await submitPendingAction('tab_email', 'broadcast_email', 'Broadcast email to opted-in customers', {
        subject: emailSubject,
        message: emailMessage,
      })
      if (res.success) {
        toast({ title: 'Submitted for approval' })
        setEmailMessage('')
        loadMyPending()
      } else {
        toast({ variant: 'destructive', title: res.error })
      }
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

    if (!confirm('This will email all registered users. Continue?')) return
    setIsBroadcasting(true)
    try {
      const { data, error } = await supabase.functions.invoke('email/broadcast', { body: { subject: emailSubject, html } })
      if (error) throw error
      toast({ title: 'Broadcast queued', description: data?.message || 'Processing will start within 1 minute.' })
      setEmailMessage('')
      setDryRunResult(null)
      await loadBroadcastJobs()
    } catch (err: any) {
      toast({ title: 'Broadcast failed', description: err.message, variant: 'destructive' })
    } finally {
      setIsBroadcasting(false)
    }
  }

  // ── Add single account ───────────────────────────────────────────────────
  const handleCancelBroadcast = async (jobId: string) => {
    if (!confirm('Cancel this broadcast? Emails already sent cannot be undone.')) return
    try {
      const { data, error } = await supabase.functions.invoke('email/cancel-broadcast', { body: { jobId } })
      if (error || data?.success === false) throw new Error(data?.error || error?.message || 'Failed to cancel broadcast')
      toast({ title: 'Cancelled', description: 'Broadcast job cancelled.' })
      await loadBroadcastJobs()
    } catch (err: any) {
      toast({ title: 'Cancel failed', description: err.message, variant: 'destructive' })
    }
  }

  async function handleAddAccount() {
    if (!addPgId || !addUsername || !addPassword) return
    setAddingAccount(true)
    try {
      const payload = {
        product_group_id: addPgId,
        username: addUsername,
        password: addPassword,
        email: addEmail || undefined,
      }
      const res = await submitPendingAction(
        'tab_add_product',
        'add_single_account',
        `Add account for ${productGroups.find(pg => pg.id === addPgId)?.name || addPgId}`,
        payload,
      )
      if (!res.success) throw new Error(res.error || 'Failed to submit action')
      if (res.applied) {
        const updatedProductGroups = await getAllProductGroups()
        setProductGroups(updatedProductGroups)
        toast({ title: 'Account added' })
      } else {
        toast({ title: 'Submitted for approval' })
        loadMyPending()
      }
      setAddUsername('')
      setAddPassword('')
      setAddEmail('')
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Failed to add account',
        description: error instanceof Error ? error.message : undefined,
      })
    }
    finally { setAddingAccount(false) }
  }

  // ── Bulk upload ───────────────────────────────────────────────────────────
  async function handleBulkUpload() {
    if (!csvFile || !bulkPgId) return
    setBulkUploading(true)
    setBulkResult(null)
    try {
      const text = await csvFile.text()
      const parsed = parseCSV(text)

      if (parsed.length === 0) {
        const result = { success: false, accountsCreated: 0, error: 'CSV file is empty or invalid' }
        setBulkResult(result)
        toast({ variant: 'destructive', title: 'Upload failed', description: result.error })
        return
      }

      const res = await submitPendingAction(
        'tab_bulk_upload',
        'bulk_upload_accounts',
        `Upload accounts to ${productGroups.find(pg => pg.id === bulkPgId)?.name || bulkPgId}`,
        {
          product_group_id: bulkPgId,
          parsed_rows: parsed,
          csv_rows: parsed.length,
        }
      )
      if (!res.success) throw new Error(res.error || 'Failed to submit action')
      if (res.applied) {
          const result = { success: true, accountsCreated: res.accountsCreated || parsed.length }
          setBulkResult(result)
          const updatedProductGroups = await getAllProductGroups()
          setProductGroups(updatedProductGroups)
          const updatedProduct = updatedProductGroups.find(pg => pg.id === bulkPgId)

          toast({
            title: `Successfully uploaded ${result.accountsCreated} accounts`,
            description: updatedProduct ? `${updatedProduct.stock_count ?? 0} in stock now` : undefined,
          })
          setCsvFile(null)
          if (fileInputRef.current) fileInputRef.current.value = ''
      } else {
        const result = {
          success: false,
          accountsCreated: 0,
          pending: true,
          error: 'Submitted for approval. No accounts have been added yet.',
        }
        setBulkResult(result)
        toast({ title: 'Submitted for approval', description: 'Bulk upload will apply after admin approval.' })
        setCsvFile(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
        loadMyPending()
      }

    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Upload failed', description: e?.message })
    } finally { setBulkUploading(false) }
  }

  // ── Categories ───────────────────────────────────────────────────────────
  async function handleAddCategory() {
    if (!newCatName.trim()) return
    setAddingCat(true)
    try {
      const res = await submitPendingAction('tab_categories', 'create_category', `Create category ${newCatName}`, {
        name: newCatName,
        description: newCatDesc || undefined,
      })
      if (!res.success) throw new Error(res.error || 'Failed to submit action')
      if (res.applied) {
        toast({ title: 'Category created' })
        const cats = await getCategories()
        setCategories(cats)
      } else {
        toast({ title: 'Submitted for approval' })
        loadMyPending()
      }
      setNewCatName(''); setNewCatDesc('')
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Failed to create category',
        description: error instanceof Error ? error.message : undefined,
      })
    }
    finally { setAddingCat(false) }
  }

  // ── Discount codes ────────────────────────────────────────────────────────
  async function handleCreateCode() {
    if (!newCode.trim() || !newCodePct) return
    setCreatingCode(true)
    try {
      const codePayload = {
        code: newCode.toUpperCase(),
        percent_off: parseInt(newCodePct),
        max_uses: newCodeMaxUses ? parseInt(newCodeMaxUses) : undefined,
      }
      const res = await submitPendingAction('tab_discount_codes', 'create_discount_code', `Create discount code ${codePayload.code}`, codePayload)
      if (!res.success) throw new Error(res.error || 'Failed to submit action')
      if (res.applied) {
        toast({ title: 'Code created' })
        const codes = await getDiscountCodes()
        setDiscountCodes(codes)
      } else {
        toast({ title: 'Submitted for approval' })
        loadMyPending()
      }
      setNewCode(''); setNewCodePct('10'); setNewCodeMaxUses('')
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Failed to create code',
        description: error instanceof Error ? error.message : undefined,
      })
    }
    finally { setCreatingCode(false) }
  }

  // ── Open product for editing ──────────────────────────────────────────────
  function openEditPg(pg: ProductGroup) {
    setEditingPg(pg)
    setEditPrice(String(pg.price))
    setEditMua(pg.muabanvia_product_id || '')
    setEditShopclone(pg.shopclone_product_id || '')
    setEditShopviaclone(pg.shopviaclone_product_id || '')
    setEditAutoFulfill(pg.auto_fulfill_enabled ?? false)
  }

  async function handleSavePg() {
    if (!editingPg) return
    setSavingPg(true)
    try {
      const updates = {
        price: parseFloat(editPrice) || editingPg.price,
        muabanvia_product_id: editMua || null,
        shopclone_product_id: editShopclone || null,
        shopviaclone_product_id: editShopviaclone || null,
        auto_fulfill_enabled: editAutoFulfill,
      }
      const res = await submitPendingAction('tab_products', 'update_product_group', `Update product ${editingPg.name}`, {
        id: editingPg.id,
        updates,
      })
      if (!res.success) throw new Error(res.error || 'Failed to submit action')
      if (res.applied) {
        toast({ title: 'Product updated' })
        const pg = await getAllProductGroups()
        setProductGroups(pg)
        setEditingPg(null)
      } else {
        toast({ title: 'Submitted for approval' })
        loadMyPending()
        setEditingPg(null)
      }
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Failed to save',
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setSavingPg(false)
    }
  }

  // ── Users ─────────────────────────────────────────────────────────────────
  async function handleSearchUsers() {
    if (!userQuery.trim()) return
    setSearchingUsers(true)
    try {
      const results = await searchUsers(userQuery)
      setUsers(results)
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Search failed',
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setSearchingUsers(false)
    }
  }

  async function handleAdjustBalance() {
    if (!adjustUserId || !adjustAmount) return
    const amount = parseFloat(adjustAmount)
    if (isNaN(amount)) return
    const targetUser = users.find(u => u.id === adjustUserId)
    if (targetUser?.is_staff || targetUser?.is_admin) {
      toast({
        variant: 'destructive',
        title: 'Customer account required',
        description: 'Balance adjustments are only available for customer accounts.',
      })
      return
    }
    setAdjusting(true)
    try {
      const key: PermissionKey = 'action_adjust_balance'
      const label = `${adjustType === 'add' ? 'Add' : 'Subtract'} ₦${amount.toLocaleString()} ${adjustType === 'add' ? 'to' : 'from'} ${targetUser?.email || adjustUserId}`
      const res = await submitPendingAction(key, 'adjust_balance', label, {
        user_id: adjustUserId, amount: adjustType === 'add' ? amount : -amount, reason: adjustReason,
      })
      if (res.success) {
        toast({ title: res.applied ? 'Balance adjusted' : 'Submitted for approval' })
        if (!res.applied) loadMyPending()
        setAdjustUserId(''); setAdjustAmount(''); setAdjustReason('')
      } else {
        toast({ variant: 'destructive', title: res.error })
      }
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Balance adjustment failed',
        description: error instanceof Error ? error.message : undefined,
      })
    } finally { setAdjusting(false) }
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  const filteredSmsProducts = smsProducts
    .filter((product) => {
      const query = smsSearchQuery.trim().toLowerCase()
      if (!query) return true
      return [product.service_name, product.service_code, product.price_ngn, product.available_count]
        .some((value) => String(value || '').toLowerCase().includes(query))
    })
    .sort((a, b) => Number(b.is_favorite) - Number(a.is_favorite) || a.service_name.localeCompare(b.service_name))

  if (loadingPerms) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  const hasAnyTab =
    can(perms, 'view_stats') || can(perms, 'tab_templates') || can(perms, 'tab_products') ||
    can(perms, 'tab_add_product') || can(perms, 'tab_bulk_upload') || can(perms, 'tab_discount_codes') ||
    can(perms, 'tab_sms_products') || can(perms, 'tab_sms_orders') || can(perms, 'tab_transactions') || can(perms, 'tab_sales') ||
    can(perms, 'tab_revenue_os') || can(perms, 'tab_categories') || can(perms, 'tab_users') || can(perms, 'tab_email') ||
    hasSettingsPermission(perms)

  if (!hasAnyTab) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="container mx-auto px-6 py-32 text-center">
          <Settings className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold mb-2">No permissions assigned yet</h2>
          <p className="text-muted-foreground">Ask your administrator to enable capabilities for your account.</p>
        </div>
        <Footer />
      </div>
    )
  }

  // Build tab list
  const tabs: { key: string; label: string }[] = [
    can(perms, 'view_stats')           && { key: 'stats',    label: 'Overview' },
    can(perms, 'tab_templates')        && { key: 'templates', label: 'Templates' },
    can(perms, 'tab_products')         && { key: 'products',  label: 'Products' },
    can(perms, 'tab_add_product')      && { key: 'add',       label: 'Add Account' },
    can(perms, 'tab_bulk_upload')      && { key: 'bulk',      label: 'Bulk Upload' },
    can(perms, 'tab_sms_products')     && { key: 'sms-products', label: 'SMS Products' },
    can(perms, 'tab_sms_orders')       && { key: 'sms-orders',   label: 'SMS Orders' },
    can(perms, 'tab_transactions')     && { key: 'transactions', label: 'Deposits' },
    can(perms, 'tab_sales')            && { key: 'sales',        label: 'Sales' },
    can(perms, 'tab_revenue_os')       && { key: 'revenue-os',   label: 'Revenue OS' },
    can(perms, 'tab_categories')       && { key: 'categories',label: 'Categories' },
    can(perms, 'tab_discount_codes')   && { key: 'discounts', label: 'Discount Codes' },
    can(perms, 'tab_users')            && { key: 'users',     label: 'Users' },
    can(perms, 'tab_email')            && { key: 'email',     label: 'Email' },
    hasSettingsPermission(perms)        && { key: 'settings', label: 'Settings' },
    { key: 'my-actions', label: 'My Requests' },
  ].filter(Boolean) as { key: string; label: string }[]

  const formatStaffMoney = (amount: number) => `₦${Number(amount || 0).toLocaleString('en-NG')}`
  const formatStaffDate = (value: string) => {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? 'Unknown date' : format(date, 'MMM d, yyyy HH:mm')
  }
  const renderHistoryRows = (
    rows: StaffHistoryRow[],
    loading: boolean,
    emptyLabel: string,
    onRefresh: () => void,
    warning?: string,
  ) => (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-base">{emptyLabel}</CardTitle>
        <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {warning && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{warning}</span>
          </div>
        )}
        {loading ? (
          <div className="grid min-h-32 place-items-center text-sm text-muted-foreground">
            <Loader2 className="mb-2 h-5 w-5 animate-spin" />
            Loading history...
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            No completed customer records found.
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {rows.map((row) => (
              <div key={row.id} className="min-w-0 rounded-xl border bg-card p-3 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">{row.source}</Badge>
                      <Badge variant="outline">{row.status || 'completed'}</Badge>
                    </div>
                    <p className="mt-2 truncate font-semibold">{row.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{row.subtitle || row.reference || 'No reference'}</p>
                  </div>
                  <p className="shrink-0 text-sm font-bold">{formatStaffMoney(row.amount)}</p>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <span className="truncate">{row.customer_email || row.customer}</span>
                  <span className="text-right">{formatStaffDate(row.date)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto max-w-full overflow-x-hidden px-4 pt-24 pb-12">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Staff Workspace</h1>
          <p className="text-muted-foreground text-sm">You can only see and change what your administrator has enabled for you.</p>
        </div>

        <Tabs defaultValue={tabs[0].key} className="space-y-6">
          <TabsList className="flex flex-wrap gap-1 h-auto">
            {tabs.map(t => (
              <TabsTrigger key={t.key} value={t.key}>{t.label}</TabsTrigger>
            ))}
          </TabsList>

          {/* ── Overview / Stats ───────────────────────────────── */}
          {can(perms, 'view_stats') && (
            <TabsContent value="stats" className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <Card><CardContent className="pt-6 text-center"><p className="text-3xl font-bold">{userCount.toLocaleString()}</p><p className="text-muted-foreground text-sm mt-1">Total Users</p></CardContent></Card>
                <Card><CardContent className="pt-6 text-center"><p className="text-3xl font-bold">{salesStats.totalSales.toLocaleString()}</p><p className="text-muted-foreground text-sm mt-1">Total Orders</p></CardContent></Card>
                <Card><CardContent className="pt-6 text-center"><p className="text-3xl font-bold">₦{(salesStats.totalRevenue / 1000).toFixed(0)}k</p><p className="text-muted-foreground text-sm mt-1">Revenue</p></CardContent></Card>
              </div>
            </TabsContent>
          )}

          {can(perms, 'tab_transactions') && (
            <TabsContent value="transactions" className="space-y-4">
              {renderHistoryRows(depositHistory, loadingDepositHistory, 'Completed Deposit History', loadDepositHistory, depositHistoryWarning)}
            </TabsContent>
          )}

          {can(perms, 'tab_sales') && (
            <TabsContent value="sales" className="space-y-4">
              {renderHistoryRows(salesHistory, loadingSalesHistory, 'Completed Sales History', loadSalesHistory, salesHistoryWarning)}
            </TabsContent>
          )}

          {can(perms, 'tab_revenue_os') && (
            <TabsContent value="revenue-os" className="space-y-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Activity className="h-5 w-5" />
                      Revenue OS
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">Bounded CRO controls, data-quality health, and current commercial opportunities.</p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={loadRevenueOsSnapshot} disabled={loadingRevenueOs}>
                    {loadingRevenueOs ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    Refresh
                  </Button>
                </CardHeader>
                <CardContent className="space-y-4">
                  {revenueOsSnapshot?.warning && (
                    <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{revenueOsSnapshot.warning}</span>
                    </div>
                  )}

                  <div className="grid gap-3 md:grid-cols-4">
                    <div className="rounded-xl border bg-card p-3">
                      <p className="text-xs text-muted-foreground">CRO status</p>
                      <p className="mt-1 font-semibold">
                        {String(revenueOsSnapshot?.settings?.cro_maintenance_freeze_reason || '').trim()
                          ? 'Frozen'
                          : revenueOsSnapshot?.settings?.cro_global_enabled === 'false'
                            ? 'Paused'
                            : 'Active'}
                      </p>
                    </div>
                    <div className="rounded-xl border bg-card p-3">
                      <p className="text-xs text-muted-foreground">Autonomy</p>
                      <p className="mt-1 font-semibold">Level {revenueOsSnapshot?.settings?.cro_autonomy_level || '1'}</p>
                    </div>
                    <div className="rounded-xl border bg-card p-3">
                      <p className="text-xs text-muted-foreground">Quality checks</p>
                      <p className="mt-1 font-semibold">{(revenueOsSnapshot?.quality || []).length}</p>
                    </div>
                    <div className="rounded-xl border bg-card p-3">
                      <p className="text-xs text-muted-foreground">Opportunities</p>
                      <p className="mt-1 font-semibold">{(revenueOsSnapshot?.opportunities || []).length}</p>
                    </div>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-[0.9fr_1.1fr]">
                    <div className="rounded-xl border p-4 space-y-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold">CRO active</p>
                          <p className="text-xs text-muted-foreground">Pause all personalized Revenue OS actions.</p>
                        </div>
                        <Switch
                          checked={croEnabledDraft}
                          onCheckedChange={setCroEnabledDraft}
                          disabled={!!String(revenueOsSnapshot?.settings?.cro_maintenance_freeze_reason || '').trim()}
                        />
                      </div>
                      {String(revenueOsSnapshot?.settings?.cro_maintenance_freeze_reason || '').trim() && (
                        <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-xs font-semibold text-destructive">
                          Frozen by guardrail: {String(revenueOsSnapshot?.settings?.cro_maintenance_freeze_reason || '').trim()}
                        </p>
                      )}
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold">Scheduled checks</p>
                          <p className="text-xs text-muted-foreground">Allow maintenance to refresh intelligence and freeze on critical failures.</p>
                        </div>
                        <Switch checked={croMaintenanceDraft} onCheckedChange={setCroMaintenanceDraft} />
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold">Shadow mode</p>
                          <p className="text-xs text-muted-foreground">Record decisions without showing risky interventions.</p>
                        </div>
                        <Switch checked={croShadowDraft} onCheckedChange={setCroShadowDraft} />
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold">Experiments</p>
                          <p className="text-xs text-muted-foreground">Allow running CRO experiments to assign visitors to approved variants.</p>
                        </div>
                        <Switch checked={croExperimentDraft} onCheckedChange={setCroExperimentDraft} />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-medium text-muted-foreground">Autonomy 0-8</label>
                          <Input value={croAutonomyDraft} onChange={(event) => setCroAutonomyDraft(event.target.value)} inputMode="numeric" />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-muted-foreground">Holdout %</label>
                          <Input value={croHoldoutDraft} onChange={(event) => setCroHoldoutDraft(event.target.value)} inputMode="decimal" />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-medium text-muted-foreground">Max promo %</label>
                          <Input value={croPromotionMaxDiscountDraft} onChange={(event) => setCroPromotionMaxDiscountDraft(event.target.value)} inputMode="decimal" />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-muted-foreground">Promo budget ₦</label>
                          <Input value={croPromotionMonthlyBudgetDraft} onChange={(event) => setCroPromotionMonthlyBudgetDraft(event.target.value)} inputMode="numeric" />
                        </div>
                      </div>
                      <Button type="button" onClick={saveRevenueOsControls} disabled={savingRevenueOs} className="w-full">
                        {savingRevenueOs ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                        {autoApproves(perms, 'tab_revenue_os') ? 'Save controls' : 'Submit controls'}
                      </Button>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-xl border p-4">
                        <p className="mb-3 font-semibold">Latest Quality</p>
                        <div className="space-y-2">
                          {(revenueOsSnapshot?.quality || []).slice(0, 4).map((row) => (
                            <div key={row.id || row.check_key} className="rounded-lg bg-muted/40 p-2 text-xs">
                              <div className="flex items-center justify-between gap-2">
                                <span className="truncate font-medium">{row.check_key || 'quality_check'}</span>
                                <Badge variant={row.severity === 'critical' ? 'destructive' : 'outline'}>{row.severity || row.status || 'info'}</Badge>
                              </div>
                              <p className="mt-1 line-clamp-2 text-muted-foreground">{row.message || 'No message'}</p>
                            </div>
                          ))}
                          {(!revenueOsSnapshot?.quality || revenueOsSnapshot.quality.length === 0) && <p className="text-sm text-muted-foreground">No checks loaded.</p>}
                        </div>
                      </div>
                      <div className="rounded-xl border p-4">
                        <p className="mb-3 font-semibold">Top Opportunities</p>
                        <div className="space-y-2">
                          {(revenueOsSnapshot?.opportunities || []).slice(0, 4).map((row) => (
                            <div key={row.id || row.opportunity_key} className="rounded-lg bg-muted/40 p-2 text-xs">
                              <div className="flex items-center justify-between gap-2">
                                <span className="truncate font-medium">{row.type || row.opportunity_key || 'opportunity'}</span>
                                <Badge variant="outline">{Number(row.priority || 0).toFixed(2)}</Badge>
                              </div>
                              <p className="mt-1 line-clamp-2 text-muted-foreground">{row.scope || row.status || 'Revenue opportunity'}</p>
                            </div>
                          ))}
                          {(!revenueOsSnapshot?.opportunities || revenueOsSnapshot.opportunities.length === 0) && <p className="text-sm text-muted-foreground">No opportunities loaded.</p>}
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {/* ── Templates ─────────────────────────────────────── */}
          {can(perms, 'tab_templates') && (
            <TabsContent value="templates" className="space-y-4">
              <Card>
                <CardHeader><CardTitle>Product Templates</CardTitle></CardHeader>
                <CardContent>
                  {loadingProducts ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                    <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                      {productGroups.map(pg => {
                        const cat = categories.find(c => c.id === pg.category_id)
                        return (
                          <div key={pg.id} className="flex items-center justify-between p-3 rounded-lg border text-sm">
                            <div>
                              <p className="font-medium">{pg.name}</p>
                              <p className="text-muted-foreground text-xs">{cat?.name} · ₦{pg.price.toLocaleString()} · {pg.stock_count ?? 0} in stock</p>
                            </div>
                            <Badge variant={pg.is_active ? 'default' : 'secondary'}>{pg.is_active ? 'Active' : 'Inactive'}</Badge>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {/* ── Products ──────────────────────────────────────── */}
          {can(perms, 'tab_products') && (
            <TabsContent value="products" className="space-y-4">
              {/* Edit panel */}
              {editingPg && (
                <Card className="border-primary">
                  <CardHeader>
                    <CardTitle className="text-base">Editing: {editingPg.name}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">Price (₦)</label>
                      <Input type="number" value={editPrice} onChange={e => setEditPrice(e.target.value)} placeholder="Price" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">MUA / BanVia Product ID</label>
                      <Input value={editMua} onChange={e => setEditMua(e.target.value)} placeholder="MUA product ID" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">ShopClone Product ID</label>
                      <Input value={editShopclone} onChange={e => setEditShopclone(e.target.value)} placeholder="ShopClone product ID" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">ShopViaClone Product ID</label>
                      <Input value={editShopviaclone} onChange={e => setEditShopviaclone(e.target.value)} placeholder="ShopViaClone product ID" />
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="text-xs font-medium text-muted-foreground">Auto-Fulfill</label>
                      <button
                        type="button"
                        onClick={() => setEditAutoFulfill(v => !v)}
                        className={`w-10 h-5 rounded-full transition-colors ${editAutoFulfill ? 'bg-primary' : 'bg-gray-300'}`}
                      >
                        <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform mx-0.5 ${editAutoFulfill ? 'translate-x-5' : 'translate-x-0'}`} />
                      </button>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button onClick={handleSavePg} disabled={savingPg}>
                        {savingPg ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        Save Changes
                      </Button>
                      <Button variant="outline" onClick={() => setEditingPg(null)}>Cancel</Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader><CardTitle>Products & Stock</CardTitle></CardHeader>
                <CardContent>
                  {loadingProducts ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                    <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                      {productGroups.map(pg => {
                        const cat = categories.find(c => c.id === pg.category_id)
                        return (
                          <div key={pg.id} className="flex items-center justify-between p-3 rounded-lg border text-sm">
                            <div>
                              <p className="font-medium">{pg.name}</p>
                              <p className="text-muted-foreground text-xs">{cat?.name} · ₦{pg.price.toLocaleString()}</p>
                              <div className="flex gap-2 mt-1 flex-wrap">
                                {pg.muabanvia_product_id && <span className="text-xs text-blue-500">MUA: {pg.muabanvia_product_id}</span>}
                                {pg.shopclone_product_id && <span className="text-xs text-purple-500">SC: {pg.shopclone_product_id}</span>}
                                {pg.shopviaclone_product_id && <span className="text-xs text-green-500">SVC: {pg.shopviaclone_product_id}</span>}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant={(pg.stock_count ?? 0) > 0 ? 'default' : 'destructive'}>
                                {pg.stock_count ?? 0} in stock
                              </Badge>
                              <Button size="sm" variant="outline" onClick={() => openEditPg(pg)}>Edit</Button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {/* ── Add Single Account ───────────────────────────── */}
          {can(perms, 'tab_add_product') && (
            <TabsContent value="add" className="space-y-4">
              <Card>
                <CardHeader><CardTitle>Add Single Account</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  {loadingProducts ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                    <>
                      <div>
                        <label className="text-sm font-medium mb-1 block">Product</label>
                        <Select value={addPgId} onValueChange={setAddPgId}>
                          <SelectTrigger><SelectValue placeholder="Select product..." /></SelectTrigger>
                          <SelectContent>
                            {productGroups.map(pg => (
                              <SelectItem key={pg.id} value={pg.id}>{pg.name}{!pg.is_active ? ' (inactive)' : ''}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Input placeholder="Username" value={addUsername} onChange={e => setAddUsername(e.target.value)} />
                      <Input placeholder="Password" value={addPassword} onChange={e => setAddPassword(e.target.value)} />
                      <Input placeholder="Email (optional)" value={addEmail} onChange={e => setAddEmail(e.target.value)} />
                      <Button onClick={handleAddAccount} disabled={addingAccount || !addPgId || !addUsername || !addPassword}>
                        {addingAccount ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                        Add Account
                      </Button>
                    </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {/* ── Bulk Upload ───────────────────────────────────── */}
          {can(perms, 'tab_bulk_upload') && (
            <TabsContent value="bulk" className="space-y-4">
              <Card>
                <CardHeader><CardTitle>Bulk Upload via CSV</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  {loadingProducts ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                    <>
                      <div>
                        <label className="text-sm font-medium mb-1 block">Select Product</label>
                        <Select value={bulkPgId} onValueChange={setBulkPgId}>
                          <SelectTrigger><SelectValue placeholder="Choose product group..." /></SelectTrigger>
                          <SelectContent>
                            {productGroups.map(pg => (
                              <SelectItem key={pg.id} value={pg.id}>{pg.name}{!pg.is_active ? ' (inactive)' : ''}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-1 block">CSV File</label>
                        <p className="text-xs text-muted-foreground mb-2">Columns: username, password, email (optional)</p>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept=".csv,.txt"
                          onChange={e => setCsvFile(e.target.files?.[0] || null)}
                          className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:cursor-pointer"
                        />
                      </div>
                      {bulkResult && (
                        <div className={`p-3 rounded-lg text-sm ${
                          bulkResult.pending
                            ? 'bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300'
                            : bulkResult.success
                            ? 'bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300'
                            : 'bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300'
                        }`}>
                          {bulkResult.pending
                            ? bulkResult.error
                            : bulkResult.success
                            ? `Added ${bulkResult.accountsCreated} accounts.`
                            : `Upload failed: ${bulkResult.error || 'No accounts were added.'}`}
                        </div>
                      )}
                      <Button onClick={handleBulkUpload} disabled={bulkUploading || !csvFile || !bulkPgId}>
                        {bulkUploading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
                        Upload
                      </Button>
                    </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {/* ── Categories ────────────────────────────────────── */}
          {can(perms, 'tab_sms_products') && (
            <TabsContent value="sms-products" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <PhoneCall className="h-5 w-5" />
                    SMS Products
                  </CardTitle>
                  {!autoApproves(perms, 'tab_sms_products') && (
                    <Badge variant="outline" className="w-fit flex items-center gap-1">
                      <Clock className="h-3 w-3" /> Requires approval
                    </Badge>
                  )}
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                    <Input value={smsSearchQuery} onChange={e => setSmsSearchQuery(e.target.value)} placeholder="Search SMS products..." className="lg:max-w-xs" />
                    <Input type="number" min="0" value={smsGlobalMargin} onChange={e => setSmsGlobalMargin(e.target.value)} placeholder="Default markup" className="lg:max-w-[160px]" />
                    <label className="flex items-center gap-2 text-sm text-muted-foreground">
                      <input type="checkbox" checked={smsKeepAutoApply} onChange={e => setSmsKeepAutoApply(e.target.checked)} />
                      Keep auto-applying
                    </label>
                    <Button onClick={applySmsGlobalMarkup} disabled={smsSavingKey === 'global-markup'} variant="outline">
                      {smsSavingKey === 'global-markup' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      {autoApproves(perms, 'tab_sms_products') ? 'Apply markup' : 'Submit markup'}
                    </Button>
                    <Button onClick={toggleSmsRounding} disabled={smsSavingKey === 'round-to-10'} variant={smsRoundToNearestTen ? 'default' : 'outline'}>
                      {smsSavingKey === 'round-to-10' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      Round up to 10
                    </Button>
                    <Button onClick={() => bulkToggleSmsProducts(true)} disabled={smsSavingKey === 'enable-all'} variant="outline">Enable all</Button>
                    <Button onClick={() => bulkToggleSmsProducts(false)} disabled={smsSavingKey === 'disable-all'} variant="outline">Disable all</Button>
                    <Button onClick={loadSmsProducts} disabled={smsProductsLoading} variant="outline" size="sm">
                      <RefreshCw className={`h-4 w-4 ${smsProductsLoading ? 'animate-spin' : ''}`} />
                    </Button>
                  </div>

                  {smsCatalogNotice && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                      {smsCatalogNotice}
                    </div>
                  )}

                  <div className="rounded-lg border">
                    <div className="grid grid-cols-[1fr_140px_220px_90px] gap-3 border-b px-4 py-3 text-xs font-semibold uppercase text-muted-foreground max-lg:hidden">
                      <span>Product</span>
                      <span>Cost</span>
                      <span>Customer price override</span>
                      <span className="text-right">Enabled</span>
                    </div>
                    {smsProductsLoading ? (
                      <div className="flex items-center justify-center p-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
                    ) : filteredSmsProducts.length === 0 ? (
                      <p className="p-6 text-center text-sm text-muted-foreground">No SMS products found.</p>
                    ) : (
                      <div className="divide-y">
                        {filteredSmsProducts.map(product => {
                          const rowSaving = smsSavingKey?.startsWith(product.service_code)
                          return (
                            <div key={product.service_code} className="grid gap-4 p-4 lg:grid-cols-[1fr_140px_220px_90px] lg:items-center">
                              <div className="min-w-0">
                                <div className="flex items-start gap-2">
                                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" disabled={rowSaving} onClick={() => updateSmsProduct(product.service_code, { is_favorite: !product.is_favorite })}>
                                    <Star className={`h-4 w-4 ${product.is_favorite ? 'fill-yellow-400 text-yellow-500' : 'text-muted-foreground'}`} />
                                  </Button>
                                  <div className="min-w-0">
                                    <p className="truncate font-semibold">{product.service_name}</p>
                                    <p className="text-xs text-muted-foreground">
                                      {product.available_count.toLocaleString()} available - {Number(product.customer_buy_count || 0).toLocaleString()} buys - {product.service_code}
                                    </p>
                                  </div>
                                </div>
                                <div className="mt-3 flex flex-wrap items-center gap-2 pl-10">
                                  <Switch checked={product.auto_markup_enabled} disabled={rowSaving} onCheckedChange={(checked) => updateSmsProduct(product.service_code, { auto_markup_enabled: checked }, true)} />
                                  <span className="text-sm text-muted-foreground">Auto-markup</span>
                                  <Input type="number" min="0" className="h-9 w-28" value={smsMarginInputs[product.service_code] ?? ''} onChange={e => setSmsMarginInputs(prev => ({ ...prev, [product.service_code]: e.target.value }))} />
                                  <Button type="button" variant="outline" size="sm" disabled={rowSaving} onClick={() => saveSmsMargin(product)}>Save margin</Button>
                                </div>
                              </div>

                              <div>
                                <p className="text-xs font-semibold uppercase text-muted-foreground">Cost</p>
                                <p className="font-bold">${Number(product.provider_cost_usd || 0).toFixed(2)}</p>
                                <p className="text-xs text-muted-foreground">NGN {Number(product.provider_cost_ngn || 0).toLocaleString()}</p>
                              </div>

                              <div className="flex min-w-0 items-center gap-2">
                                <Input type="number" min="0" placeholder={`Auto NGN ${Number(product.price_ngn || 0).toLocaleString()}`} value={smsPriceInputs[product.service_code] ?? ''} onChange={e => setSmsPriceInputs(prev => ({ ...prev, [product.service_code]: e.target.value }))} />
                                <Button type="button" variant="outline" disabled={rowSaving} onClick={() => saveSmsPriceOverride(product)}>
                                  {rowSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : autoApproves(perms, 'tab_sms_products') ? 'Save' : 'Submit'}
                                </Button>
                              </div>

                              <div className="flex items-center justify-between gap-2 lg:justify-end">
                                <Badge variant={product.pricing_mode === 'override' ? 'default' : 'secondary'} className="whitespace-nowrap">
                                  NGN {Number(product.price_ngn || 0).toLocaleString()}
                                </Badge>
                                <Switch checked={product.is_enabled} disabled={rowSaving} onCheckedChange={(checked) => updateSmsProduct(product.service_code, { is_enabled: checked })} />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {can(perms, 'tab_categories') && (
            <TabsContent value="categories" className="space-y-4">
              <Card>
                <CardHeader><CardTitle>Add Category</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <Input placeholder="Category name" value={newCatName} onChange={e => setNewCatName(e.target.value)} />
                  <Input placeholder="Description (optional)" value={newCatDesc} onChange={e => setNewCatDesc(e.target.value)} />
                  <Button onClick={handleAddCategory} disabled={addingCat || !newCatName.trim()}>
                    {addingCat ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                    Create Category
                  </Button>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Existing Categories</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {categories.map(c => (
                      <div key={c.id} className="flex items-center justify-between p-3 rounded-lg border text-sm">
                        <p className="font-medium">{c.name}</p>
                        {c.description && <p className="text-muted-foreground text-xs">{c.description}</p>}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {/* ── Discount Codes ────────────────────────────────── */}
          {can(perms, 'tab_discount_codes') && (
            <TabsContent value="discounts" className="space-y-4">
              <Card>
                <CardHeader><CardTitle>Create Discount Code</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex gap-2">
                    <Input placeholder="CODE" value={newCode} onChange={e => setNewCode(e.target.value.toUpperCase())} className="flex-1" />
                    <Input type="number" placeholder="% off" value={newCodePct} onChange={e => setNewCodePct(e.target.value)} className="w-24" />
                    <Input type="number" placeholder="Max uses" value={newCodeMaxUses} onChange={e => setNewCodeMaxUses(e.target.value)} className="w-28" />
                  </div>
                  <Button onClick={handleCreateCode} disabled={creatingCode || !newCode.trim()}>
                    {creatingCode ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Tag className="h-4 w-4 mr-2" />}
                    Create Code
                  </Button>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Active Codes</CardTitle></CardHeader>
                <CardContent>
                  {loadingCodes ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                    <div className="space-y-2">
                      {discountCodes.map(dc => (
                        <div key={dc.id} className="flex items-center justify-between p-3 rounded-lg border text-sm">
                          <div>
                            <p className="font-mono font-medium">{dc.code}</p>
                            <p className="text-muted-foreground text-xs">{dc.percent_off}% off · {dc.used_count}/{dc.max_uses ?? '∞'} uses</p>
                          </div>
                          <Button
                            size="sm"
                            variant={dc.is_active ? 'outline' : 'default'}
                            onClick={async () => {
                              const res = await submitPendingAction(
                                'tab_discount_codes',
                                'toggle_discount_code',
                                `${dc.is_active ? 'Disable' : 'Enable'} discount code ${dc.code}`,
                                { id: dc.id, is_active: !dc.is_active },
                              )
                              if (res.success && res.applied) {
                                const codes = await getDiscountCodes()
                                setDiscountCodes(codes)
                              } else if (res.success) {
                                toast({ title: 'Submitted for approval' })
                                loadMyPending()
                              } else {
                                toast({ variant: 'destructive', title: res.error || 'Failed to update code' })
                              }
                            }}
                          >
                            {dc.is_active ? 'Disable' : 'Enable'}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {/* ── Users ─────────────────────────────────────────── */}
          {can(perms, 'tab_users') && (
            <TabsContent value="users" className="space-y-4">
              <Card>
                <CardHeader><CardTitle>Search Users</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Email or name..."
                      value={userQuery}
                      onChange={e => setUserQuery(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleSearchUsers()}
                    />
                    <Button onClick={handleSearchUsers} disabled={searchingUsers}>
                      {searchingUsers ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {users.map(u => (
                      <div key={u.id} className="p-3 rounded-lg border text-sm">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium">{u.email}</p>
                            <p className="text-muted-foreground text-xs">Balance: ₦{(u.wallet_balance || 0).toLocaleString()}</p>
                          </div>
                          {can(perms, 'action_adjust_balance') && (
                            <Button size="sm" variant="outline" onClick={() => setAdjustUserId(u.id)} disabled={u.is_staff || u.is_admin}>
                              Adjust Balance
                            </Button>
                          )}
                        </div>
                        {adjustUserId === u.id && can(perms, 'action_adjust_balance') && (
                          <div className="mt-3 space-y-2 border-t pt-3">
                            <div className="flex gap-2">
                              <Button size="sm" variant={adjustType === 'add' ? 'default' : 'outline'} onClick={() => setAdjustType('add')}>Add</Button>
                              <Button size="sm" variant={adjustType === 'subtract' ? 'default' : 'outline'} onClick={() => setAdjustType('subtract')}>Subtract</Button>
                            </div>
                            <Input type="number" placeholder="Amount (₦)" value={adjustAmount} onChange={e => setAdjustAmount(e.target.value)} />
                            <Input placeholder="Reason (optional)" value={adjustReason} onChange={e => setAdjustReason(e.target.value)} />
                            <div className="flex gap-2">
                              <Button size="sm" onClick={handleAdjustBalance} disabled={adjusting}>
                                {adjusting ? <Loader2 className="h-4 w-4 animate-spin" /> : autoApproves(perms, 'action_adjust_balance') ? 'Apply' : 'Submit for Approval'}
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => setAdjustUserId('')}>Cancel</Button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {/* ── Settings ──────────────────────────────────────── */}
          {can(perms, 'tab_email') && (
            <TabsContent value="email" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Mail className="h-5 w-5" />
                    Compose Email
                  </CardTitle>
                  {!autoApproves(perms, 'tab_email') && (
                    <Badge variant="outline" className="w-fit flex items-center gap-1">
                      <Clock className="h-3 w-3" /> Requires approval
                    </Badge>
                  )}
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="text-sm font-medium mb-1 block">Subject</label>
                    <Input value={emailSubject} onChange={e => setEmailSubject(e.target.value)} placeholder="Email subject line" />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Message</label>
                    <Textarea value={emailMessage} onChange={e => setEmailMessage(e.target.value)} placeholder="Write your email message here..." rows={7} />
                  </div>
                  <div className="border rounded-lg p-4 space-y-3">
                    <label className="text-sm font-medium block">Targeted Recipients</label>
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
                        <Button variant="ghost" size="sm" onClick={() => setEmailRecipients([])}>Clear all</Button>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <Button
                      onClick={handleSendToList}
                      disabled={isSendingEmail || emailRecipients.length === 0 || !emailMessage.trim()}
                      variant="outline"
                      className="flex-1"
                    >
                      {isSendingEmail ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                      {autoApproves(perms, 'tab_email') ? `Send to List (${emailRecipients.length})` : 'Submit Targeted Email'}
                    </Button>
                    <div className="flex items-center gap-2 flex-1">
                      <Button onClick={handleBroadcast} disabled={isBroadcasting || !emailMessage.trim()} className="flex-1">
                        {isBroadcasting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Mail className="h-4 w-4 mr-2" />}
                        {autoApproves(perms, 'tab_email') ? (isDryRun ? 'Dry Run' : 'Broadcast to Opted-In Customers') : 'Submit Broadcast'}
                      </Button>
                      {autoApproves(perms, 'tab_email') && (
                        <label className="flex items-center gap-1.5 text-xs whitespace-nowrap cursor-pointer">
                          <input type="checkbox" checked={isDryRun} onChange={e => { setIsDryRun(e.target.checked); setDryRunResult(null) }} className="rounded" />
                          Test mode
                        </label>
                      )}
                    </div>
                  </div>
                  {dryRunResult && (
                    <div className="p-3 bg-blue-50 dark:bg-blue-950 rounded-lg text-sm text-blue-700 dark:text-blue-300">
                      Opted-in recipients: <strong>{dryRunResult.totalRecipients?.toLocaleString()}</strong>
                    </div>
                  )}
                </CardContent>
              </Card>

              {autoApproves(perms, 'tab_email') && (
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2"><Send className="h-5 w-5" /> Broadcast Jobs</CardTitle>
                      <Button variant="outline" size="sm" onClick={loadBroadcastJobs} disabled={isLoadingJobs}>
                        <RefreshCw className={`h-4 w-4 mr-1 ${isLoadingJobs ? 'animate-spin' : ''}`} /> Refresh
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {broadcastJobs.length === 0 ? (
                      <p className="text-muted-foreground text-sm">No broadcast jobs yet.</p>
                    ) : (
                      <div className="space-y-3">
                        {broadcastJobs.map(job => {
                          const processed = (job.sent_count || 0) + (job.failed_count || 0)
                          const total = job.total_recipients || 1
                          const isActive = job.status === 'queued' || job.status === 'processing'

                          return (
                            <div key={job.id} className="flex items-center justify-between p-3 rounded-lg border text-sm">
                              <div>
                                <p className="font-medium">{job.subject}</p>
                                <p className="text-muted-foreground text-xs">
                                  {job.status} · {processed}/{total} processed · {format(new Date(job.created_at), 'dd MMM HH:mm')}
                                </p>
                              </div>
                              {isActive && (
                                <Button variant="outline" size="sm" onClick={() => handleCancelBroadcast(job.id)}>
                                  Cancel
                                </Button>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          )}

          {hasSettingsPermission(perms) && (
            <TabsContent value="settings" className="space-y-4">
              {can(perms, 'setting_rate') && (
                <Card>
                  <CardHeader>
                    <CardTitle>NGN/USD Rate</CardTitle>
                    {!autoApproves(perms, 'setting_rate') && <Badge variant="outline" className="w-fit flex items-center gap-1"><Clock className="h-3 w-3" /> Requires approval</Badge>}
                  </CardHeader>
                  <CardContent className="flex gap-2">
                    <Input type="number" value={ngnUsdRate} onChange={e => setNgnUsdRate(e.target.value)} placeholder="e.g. 1600" className="max-w-xs" />
                    <Button onClick={async () => {
                      if (!ngnUsdRate || isNaN(parseFloat(ngnUsdRate))) return
                      setSavingRate(true)
                      await handleSettingChange('setting_rate', 'ngn_usd_rate', ngnUsdRate, 'NGN/USD rate')
                      setSavingRate(false)
                    }} disabled={savingRate}>
                      {savingRate ? <Loader2 className="h-4 w-4 animate-spin" /> : autoApproves(perms, 'setting_rate') ? 'Save' : 'Submit'}
                    </Button>
                  </CardContent>
                </Card>
              )}
              {can(perms, 'setting_referral_pct') && (
                <Card>
                  <CardHeader>
                    <CardTitle>Referral Commission %</CardTitle>
                    {!autoApproves(perms, 'setting_referral_pct') && <Badge variant="outline" className="w-fit flex items-center gap-1"><Clock className="h-3 w-3" /> Requires approval</Badge>}
                  </CardHeader>
                  <CardContent className="flex gap-2">
                    <Input type="number" value={referralPct} onChange={e => setReferralPct(e.target.value)} placeholder="e.g. 5" className="max-w-xs" />
                    <Button onClick={async () => {
                      const val = parseFloat(referralPct)
                      if (isNaN(val) || val < 0 || val > 100) return
                      setSavingReferral(true)
                      await handleSettingChange('setting_referral_pct', 'referral_commission_pct', referralPct, 'referral commission')
                      setSavingReferral(false)
                    }} disabled={savingReferral}>
                      {savingReferral ? <Loader2 className="h-4 w-4 animate-spin" /> : autoApproves(perms, 'setting_referral_pct') ? 'Save' : 'Submit'}
                    </Button>
                  </CardContent>
                </Card>
              )}
              {can(perms, 'setting_ercas') && (
                <Card>
                  <CardHeader>
                    <CardTitle>Ercas Pay Gateway</CardTitle>
                    {!autoApproves(perms, 'setting_ercas') && <Badge variant="outline" className="w-fit flex items-center gap-1"><Clock className="h-3 w-3" /> Requires approval</Badge>}
                  </CardHeader>
                  <CardContent className="flex items-center gap-4">
                    <span className="text-sm">{ercasEnabled ? 'Enabled' : 'Disabled'}</span>
                    <Button onClick={async () => {
                      setSavingErcas(true)
                      const newVal = !ercasEnabled
                      await handleSettingChange('setting_ercas', 'ercas_enabled', String(newVal), 'Ercas Pay', () => setErcasEnabled(newVal))
                      setSavingErcas(false)
                    }} disabled={savingErcas} variant={ercasEnabled ? 'destructive' : 'default'} size="sm">
                      {savingErcas ? <Loader2 className="h-4 w-4 animate-spin" /> : ercasEnabled ? 'Disable' : 'Enable'}
                    </Button>
                  </CardContent>
                </Card>
              )}
              {can(perms, 'setting_support_links') && (
              <Card>
                <CardHeader>
                  <CardTitle>Support Links</CardTitle>
                  {!autoApproves(perms, 'setting_support_links') && <Badge variant="outline" className="w-fit flex items-center gap-1"><Clock className="h-3 w-3" /> Requires approval</Badge>}
                  <p className="text-sm text-muted-foreground">Leave a field blank to hide that channel across the site.</p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <label className="text-sm font-medium">WhatsApp support URL</label>
                    <Input placeholder="https://wa.me/..." value={supportWhatsappUrl} onChange={e => setSupportWhatsappUrl(e.target.value)} className="mt-1" />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Telegram support URL</label>
                    <Input placeholder="https://t.me/..." value={supportTelegramUrl} onChange={e => setSupportTelegramUrl(e.target.value)} className="mt-1" />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Join channel URL</label>
                    <Input placeholder="https://t.me/... or WhatsApp channel" value={supportChannelUrl} onChange={e => setSupportChannelUrl(e.target.value)} className="mt-1" />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Login popup message</label>
                    <textarea
                      rows={3}
                      placeholder="Message shown on login popup..."
                      value={supportPopupMessage}
                      onChange={e => setSupportPopupMessage(e.target.value)}
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                  </div>
                  <Button onClick={handleSaveSupportLinks} disabled={savingSupportLinks} size="sm">
                    {savingSupportLinks ? <Loader2 className="h-4 w-4 animate-spin" /> : autoApproves(perms, 'setting_support_links') ? 'Save' : 'Submit'}
                  </Button>
                </CardContent>
              </Card>
              )}
            </TabsContent>
          )}

          {/* ── My Pending Actions ────────────────────────────── */}
          <TabsContent value="my-actions" className="space-y-4">
            <Card>
              <CardHeader><CardTitle>My Submitted Requests</CardTitle></CardHeader>
              <CardContent>
                {loadingPending ? <Loader2 className="h-5 w-5 animate-spin" /> : myPending.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No requests yet.</p>
                ) : (
                  <div className="space-y-2">
                    {myPending.map(action => (
                      <div key={action.id} className="flex items-center justify-between p-3 rounded-lg border text-sm">
                        <div>
                          <p className="font-medium">{action.action_label}</p>
                          <p className="text-muted-foreground text-xs">{format(new Date(action.created_at), 'dd MMM yyyy HH:mm')}</p>
                        </div>
                        <Badge variant={action.status === 'approved' ? 'default' : action.status === 'rejected' ? 'destructive' : 'secondary'}>
                          {action.status === 'approved' && <CheckCircle2 className="h-3 w-3 mr-1" />}
                          {action.status === 'rejected' && <XCircle className="h-3 w-3 mr-1" />}
                          {action.status === 'pending' && <Clock className="h-3 w-3 mr-1" />}
                          {action.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* SMS Orders */}
          <TabsContent value="sms-orders" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle>SMS Orders</CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">All customer SMS purchases. Auto-cancel clears pending orders older than 5 minutes with no code received.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={loadSmsOrders} disabled={smsOrdersLoading}>
                      {smsOrdersLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                      Refresh
                    </Button>
                    <Button variant="destructive" size="sm" onClick={staffAutoCancelStale} disabled={smsOrdersAutoCancelling || smsOrdersLoading}>
                      {smsOrdersAutoCancelling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}
                      Auto-cancel stale (5 min+)
                    </Button>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  {(['all', 'pending', 'completed', 'cancelled'] as const).map(f => (
                    <button key={f} onClick={() => setSmsOrdersFilter(f)}
                      className={`rounded-full px-3 py-1 text-xs font-semibold capitalize transition-colors ${smsOrdersFilter === f ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}>
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
                                    <Button size="sm" variant="destructive" className="h-7 px-2 text-xs"
                                      disabled={smsOrdersCancellingId === order.id}
                                      onClick={() => staffCancelSmsOrder(order.id)}>
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
      <Footer />
    </div>
  )
}
