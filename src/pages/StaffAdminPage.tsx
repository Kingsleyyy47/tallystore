import { useState, useEffect, useCallback, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, Clock, CheckCircle2, XCircle, Settings, Upload, Plus, Tag, Users, BarChart2, Mail } from 'lucide-react'
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
  const [bulkResult, setBulkResult] = useState<{ added: number; skipped: number } | null>(null)
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
      await upsertAppSetting(settingKey, value)
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
      if (autoApproves(perms, 'setting_support_links' as PermissionKey)) {
        await Promise.all([
          upsertAppSetting('support_whatsapp_url', supportWhatsappUrl.trim()),
          upsertAppSetting('support_telegram_url', supportTelegramUrl.trim()),
          upsertAppSetting('support_channel_url', supportChannelUrl.trim()),
          upsertAppSetting('support_popup_message', supportPopupMessage.trim()),
        ])
        const { invalidateSupportSettingsCache } = await import('@/hooks/useSupportSettings')
        invalidateSupportSettingsCache()
        toast({ title: 'Support links saved' })
      } else {
        const payload = { support_whatsapp_url: supportWhatsappUrl.trim(), support_telegram_url: supportTelegramUrl.trim(), support_channel_url: supportChannelUrl.trim(), support_popup_message: supportPopupMessage.trim() }
        const res = await submitPendingAction('setting_support_links' as PermissionKey, 'upsert_support_links', 'Update support links', payload)
        if (res.success) { toast({ title: 'Submitted for approval' }); loadMyPending() }
        else toast({ variant: 'destructive', title: res.error })
      }
    } finally { setSavingSupportLinks(false) }
  }

  // ── Add single account ───────────────────────────────────────────────────
  async function handleAddAccount() {
    if (!addPgId || !addUsername || !addPassword) return
    setAddingAccount(true)
    try {
      await createIndividualAccount({ product_group_id: addPgId, username: addUsername, password: addPassword, email: addEmail || undefined })
      toast({ title: 'Account added' })
      setAddUsername(''); setAddPassword(''); setAddEmail('')
    } catch { toast({ variant: 'destructive', title: 'Failed to add account' }) }
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
      const result = await processBulkAccountUpload(bulkPgId, parsed)
      setBulkResult(result)
      toast({ title: `Done! Added ${result.added}, skipped ${result.skipped}` })
      setCsvFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Upload failed', description: e?.message })
    } finally { setBulkUploading(false) }
  }

  // ── Categories ───────────────────────────────────────────────────────────
  async function handleAddCategory() {
    if (!newCatName.trim()) return
    setAddingCat(true)
    try {
      await createCategory(newCatName, newCatName, newCatDesc || undefined)
      toast({ title: 'Category created' })
      setNewCatName(''); setNewCatDesc('')
      const cats = await getCategories()
      setCategories(cats)
    } catch { toast({ variant: 'destructive', title: 'Failed to create category' }) }
    finally { setAddingCat(false) }
  }

  // ── Discount codes ────────────────────────────────────────────────────────
  async function handleCreateCode() {
    if (!newCode.trim() || !newCodePct) return
    setCreatingCode(true)
    try {
      await createDiscountCode({
        code: newCode.toUpperCase(),
        percent_off: parseInt(newCodePct),
        max_uses: newCodeMaxUses ? parseInt(newCodeMaxUses) : undefined,
        is_active: true,
      })
      toast({ title: 'Code created' })
      setNewCode(''); setNewCodePct('10'); setNewCodeMaxUses('')
      const codes = await getDiscountCodes()
      setDiscountCodes(codes)
    } catch { toast({ variant: 'destructive', title: 'Failed to create code' }) }
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
      await updateProductGroup(editingPg.id, {
        price: parseFloat(editPrice) || editingPg.price,
        muabanvia_product_id: editMua || null,
        shopclone_product_id: editShopclone || null,
        shopviaclone_product_id: editShopviaclone || null,
        auto_fulfill_enabled: editAutoFulfill,
      })
      toast({ title: 'Product updated' })
      const pg = await getAllProductGroups()
      setProductGroups(pg)
      setEditingPg(null)
    } catch {
      toast({ variant: 'destructive', title: 'Failed to save' })
    } finally {
      setSavingPg(false)
    }
  }

  // ── Users ─────────────────────────────────────────────────────────────────
  async function handleSearchUsers() {
    if (!userQuery.trim()) return
    setSearchingUsers(true)
    const results = await searchUsers(userQuery)
    setUsers(results)
    setSearchingUsers(false)
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
        const result = await adminAdjustBalance(adjustUserId, adjustType === 'add' ? amount : -amount, adjustReason || 'Staff adjustment')
        if (result.success) {
          toast({ title: 'Balance adjusted' })
          setAdjustUserId(''); setAdjustAmount(''); setAdjustReason('')
        } else toast({ variant: 'destructive', title: result.error })
      } else {
        const res = await submitPendingAction(key, 'adjust_balance', label, {
          user_id: adjustUserId, amount: adjustType === 'add' ? amount : -amount, reason: adjustReason,
        })
        if (res.success) { toast({ title: 'Submitted for approval' }); loadMyPending(); setAdjustUserId(''); setAdjustAmount(''); setAdjustReason('') }
        else toast({ variant: 'destructive', title: res.error })
      }
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
    can(perms, 'tab_categories') || can(perms, 'tab_users') ||
    can(perms, 'setting_rate') || can(perms, 'setting_referral_pct') || can(perms, 'setting_ercas')

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
    (can(perms, 'setting_rate') || can(perms, 'setting_referral_pct') || can(perms, 'setting_ercas') || can(perms, 'setting_support_links' as PermissionKey)) && { key: 'settings', label: 'Settings' },
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
                        <div className="p-3 bg-green-50 dark:bg-green-950 rounded-lg text-sm text-green-700 dark:text-green-300">
                          ✓ Added {bulkResult.added} accounts, skipped {bulkResult.skipped} duplicates
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
                            <p className="text-muted-foreground text-xs">{dc.percent_off}% off · {dc.times_used}/{dc.max_uses ?? '∞'} uses</p>
                          </div>
                          <Button
                            size="sm"
                            variant={dc.is_active ? 'outline' : 'default'}
                            onClick={async () => {
                              await setDiscountCodeActive(dc.id, !dc.is_active)
                              const codes = await getDiscountCodes()
                              setDiscountCodes(codes)
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
          {(can(perms, 'setting_rate') || can(perms, 'setting_referral_pct') || can(perms, 'setting_ercas') || can(perms, 'setting_support_links' as PermissionKey)) && (
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
              {can(perms, 'setting_support_links' as PermissionKey) && (
                <Card>
                  <CardHeader>
                    <CardTitle>Support Links</CardTitle>
                    <p className="text-sm text-muted-foreground">Leave a field blank to hide that channel across the site.</p>
                    {!autoApproves(perms, 'setting_support_links' as PermissionKey) && <Badge variant="outline" className="w-fit flex items-center gap-1"><Clock className="h-3 w-3" /> Requires approval</Badge>}
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
                      {savingSupportLinks ? <Loader2 className="h-4 w-4 animate-spin" /> : autoApproves(perms, 'setting_support_links' as PermissionKey) ? 'Save' : 'Submit'}
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
