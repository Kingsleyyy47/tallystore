import { useState, useEffect, useCallback, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, Clock, CheckCircle2, XCircle, Settings, Upload, Plus, Tag, Users, BarChart2, Mail, Send, RefreshCw, X } from 'lucide-react'
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
  upsertAppSetting,
  getAllProductGroups,
  getCategories,
  searchUsers,
  adminAdjustBalance,
  getDiscountCodes,
  createDiscountCode,
  setDiscountCodeActive,
  createCategory,
  createIndividualAccount,
  updateProductGroup,
  parseCSV,
  processBulkAccountUpload,
  getUserCount,
  getAdminSalesStats,
  type ProductGroup,
  type Category,
  type DiscountCode,
} from '@/lib/supabase'
import { format } from 'date-fns'

function can(perms: PermissionMap, key: PermissionKey) {
  return perms[key]?.is_enabled === true
}
function autoApproves(perms: PermissionMap, key: PermissionKey) {
  return perms[key]?.auto_approve !== false
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
  const [bulkResult, setBulkResult] = useState<{ success: boolean; accountsCreated: number; error?: string } | null>(null)
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

  // ── Load permissions ─────────────────────────────────────────────────────
  useEffect(() => {
    getMyStaffPermissions().then(p => {
      setPerms(p)
      setLoadingPerms(false)
    })
  }, [])

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
  }, [perms, loadingPerms])

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
    if (autoApproves(perms, permKey)) {
      const ok = await upsertAppSetting(settingKey, value)
      if (!ok) {
        toast({ variant: 'destructive', title: `Failed to update ${label}` })
        return
      }
      toast({ title: `${label} updated` })
      onSuccess?.()
    } else {
      const res = await submitPendingAction(permKey, 'upsert_setting', `Set ${label} to ${value}`, { setting_key: settingKey, value })
      if (res.success) { toast({ title: 'Submitted for approval' }); loadMyPending() }
      else toast({ variant: 'destructive', title: res.error })
    }
  }

  // ── Support links ─────────────────────────────────────────────────────────
  async function handleSaveSupportLinks() {
    setSavingSupportLinks(true)
    try {
      const settings = {
        support_whatsapp_url: supportWhatsappUrl.trim(),
        support_telegram_url: supportTelegramUrl.trim(),
        support_channel_url: supportChannelUrl.trim(),
        support_popup_message: supportPopupMessage.trim(),
      }

      if (autoApproves(perms, 'setting_support_links')) {
        const results = await Promise.all(Object.entries(settings).map(([key, value]) => upsertAppSetting(key, value)))
        if (results.some(ok => !ok)) {
          toast({ variant: 'destructive', title: 'Failed to save support links' })
          return
        }
        const { invalidateSupportSettingsCache } = await import('@/hooks/useSupportSettings')
        invalidateSupportSettingsCache()
        toast({ title: 'Support links saved' })
      } else {
        const res = await submitPendingAction('setting_support_links', 'upsert_settings', 'Update support links', { settings })
        if (res.success) {
          toast({ title: 'Submitted for approval' })
          loadMyPending()
        } else {
          toast({ variant: 'destructive', title: res.error })
        }
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
        <a href="https://tallystore.org/dashboard" style="background:linear-gradient(135deg,#7c3aed,#3b82f6);color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">Go to Dashboard</a>
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
      const res = await submitPendingAction('tab_email', 'broadcast_email', 'Broadcast email to all users', {
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
      const account = await createIndividualAccount({ product_group_id: addPgId, username: addUsername, password: addPassword, email: addEmail || undefined, status: 'available' })
      if (!account) throw new Error('Account was not added')
      const updatedProductGroups = await getAllProductGroups()
      setProductGroups(updatedProductGroups)
      toast({ title: 'Account added' })
      setAddUsername(''); setAddPassword(''); setAddEmail('')
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

      const result = await processBulkAccountUpload(parsed, bulkPgId)
      setBulkResult(result)

      if (result.success) {
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
        toast({ variant: 'destructive', title: 'Upload failed', description: result.error })
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
      const category = await createCategory(newCatName, newCatName, newCatDesc || undefined)
      if (!category) throw new Error('Category was not created')
      toast({ title: 'Category created' })
      setNewCatName(''); setNewCatDesc('')
      const cats = await getCategories()
      setCategories(cats)
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
      const result = await createDiscountCode({
        code: newCode.toUpperCase(),
        percent_off: parseInt(newCodePct),
        max_uses: newCodeMaxUses ? parseInt(newCodeMaxUses) : undefined,
      })
      if (!result.success) throw new Error(result.error || 'Failed to create code')
      toast({ title: 'Code created' })
      setNewCode(''); setNewCodePct('10'); setNewCodeMaxUses('')
      const codes = await getDiscountCodes()
      setDiscountCodes(codes)
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
      const updated = await updateProductGroup(editingPg.id, {
        price: parseFloat(editPrice) || editingPg.price,
        muabanvia_product_id: editMua || null,
        shopclone_product_id: editShopclone || null,
        shopviaclone_product_id: editShopviaclone || null,
        auto_fulfill_enabled: editAutoFulfill,
      })
      if (!updated) throw new Error('Product was not updated')
      toast({ title: 'Product updated' })
      const pg = await getAllProductGroups()
      setProductGroups(pg)
      setEditingPg(null)
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
    setAdjusting(true)
    try {
      const key: PermissionKey = 'action_adjust_balance'
      const su = users.find(u => u.id === adjustUserId)
      const label = `${adjustType === 'add' ? 'Add' : 'Subtract'} ₦${amount.toLocaleString()} ${adjustType === 'add' ? 'to' : 'from'} ${su?.email || adjustUserId}`
      if (autoApproves(perms, key)) {
        const result = await adminAdjustBalance(adjustUserId, adjustType === 'add' ? amount : -amount, adjustReason || 'Staff adjustment', user?.email || 'staff')
        if (result.success) {
          toast({ title: 'Balance adjusted' })
          setAdjustUserId(''); setAdjustAmount(''); setAdjustReason('')
        } else toast({ variant: 'destructive', title: 'Balance adjustment failed' })
      } else {
        const res = await submitPendingAction(key, 'adjust_balance', label, {
          user_id: adjustUserId, amount: adjustType === 'add' ? amount : -amount, reason: adjustReason,
        })
        if (res.success) { toast({ title: 'Submitted for approval' }); loadMyPending(); setAdjustUserId(''); setAdjustAmount(''); setAdjustReason('') }
        else toast({ variant: 'destructive', title: res.error })
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
    can(perms, 'tab_categories') || can(perms, 'tab_users') || can(perms, 'tab_email') ||
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
    can(perms, 'tab_categories')       && { key: 'categories',label: 'Categories' },
    can(perms, 'tab_discount_codes')   && { key: 'discounts', label: 'Discount Codes' },
    can(perms, 'tab_users')            && { key: 'users',     label: 'Users' },
    can(perms, 'tab_email')            && { key: 'email',     label: 'Email' },
    hasSettingsPermission(perms)        && { key: 'settings', label: 'Settings' },
    { key: 'my-actions', label: 'My Requests' },
  ].filter(Boolean) as { key: string; label: string }[]

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto px-4 pt-24 pb-12">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Staff Panel</h1>
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
                            {productGroups.filter(pg => pg.is_active).map(pg => (
                              <SelectItem key={pg.id} value={pg.id}>{pg.name}</SelectItem>
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
                            {productGroups.filter(pg => pg.is_active).map(pg => (
                              <SelectItem key={pg.id} value={pg.id}>{pg.name}</SelectItem>
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
                          bulkResult.success
                            ? 'bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300'
                            : 'bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300'
                        }`}>
                          {bulkResult.success
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
                              const ok = await setDiscountCodeActive(dc.id, !dc.is_active)
                              if (ok) {
                                const codes = await getDiscountCodes()
                                setDiscountCodes(codes)
                              } else {
                                toast({ variant: 'destructive', title: 'Failed to update code' })
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
                            <Button size="sm" variant="outline" onClick={() => setAdjustUserId(u.id)}>
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
                        {autoApproves(perms, 'tab_email') ? (isDryRun ? 'Dry Run' : 'Broadcast to All Users') : 'Submit Broadcast'}
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
                      Total recipients: <strong>{dryRunResult.totalRecipients?.toLocaleString()}</strong>
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
        </Tabs>
      </div>
      <Footer />
    </div>
  )
}
