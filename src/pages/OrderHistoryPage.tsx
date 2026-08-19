import { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
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
  Loader2,
  Package,
  RefreshCw,
  Search,
  ShieldAlert,
  XCircle,
} from 'lucide-react'
import NavbarAuth from '@/components/NavbarAuth'
import Footer from '@/components/Footer'
import WalletBalanceWidget from '@/components/WalletBalanceWidget'
import { useAuth } from '@/contexts/SimpleAuth'
import { useCurrency } from '@/contexts/CurrencyContext'
import { getUserOrders } from '@/lib/supabase'
import { useToast } from '@/hooks/use-toast'
import { RevampCard, RevampHero, RevampPage, RevampVisual } from '@/components/RevampLayout'

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

function getOrderProductName(order: any) {
  return order?.account_details?.product_name || order?.product_groups?.name || 'Purchased account'
}

function getOrderPlatform(order: any) {
  return order?.account_details?.category || order?.product_groups?.categories?.name || 'Social Media'
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
}: {
  order: any
  formatPrice: (amount: number) => string
  formatDate: (value: string) => { date: string; time: string }
  onCopyAll: (order: any) => void
  onDownload: (order: any) => void
  onCopyText: (text: string, label?: string) => void
}) {
  const accounts = getOrderAccounts(order)
  const productName = getOrderProductName(order)
  const platform = getOrderPlatform(order)
  const itemCount = accounts.length || order?.account_details?.quantity || 1
  const { date } = formatDate(order.created_at)
  const canAccessCredentials = order.status === 'completed' && accounts.length > 0

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Button
          type="button"
          variant="outline"
          className="h-11 justify-center rounded-xl border-purple-400/30 bg-purple-500/10 font-black text-purple-700 hover:bg-purple-500/15 dark:text-purple-300"
          onClick={() => onCopyAll(order)}
          disabled={!canAccessCredentials}
        >
          <Copy className="h-4 w-4" />
          Copy All
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11 justify-center rounded-xl font-black"
          onClick={() => onDownload(order)}
          disabled={!canAccessCredentials}
        >
          <Download className="h-4 w-4" />
          Download .txt
        </Button>
        <Button
          asChild
          className="h-11 justify-center rounded-xl bg-amber-500 font-black text-white shadow-[0_12px_32px_rgba(245,158,11,0.24)] hover:bg-amber-400"
        >
          <Link to="/how-it-works">
            <ExternalLink className="h-4 w-4" />
            How to Login
          </Link>
        </Button>
      </div>

      <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-900 dark:text-amber-100">
        <div className="flex gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <p className="text-sm font-bold leading-6">
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
          <div key={label} className="min-w-0 rounded-2xl border border-slate-200 bg-slate-100/80 p-4 dark:border-white/10 dark:bg-slate-900">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{label}</p>
            <p className="mt-2 break-words text-lg font-black text-slate-950 dark:text-white sm:text-xl">{value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-slate-100/80 p-4 dark:border-white/10 dark:bg-slate-900">
        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Product</p>
        <p className="mt-2 whitespace-pre-wrap break-words text-lg font-black leading-7 text-slate-950 dark:text-white">
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
              <div key={`${order.id}-${index}`} className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-white/10 dark:bg-slate-950">
                <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3">
                  <div className="pt-1 text-center text-sm font-black text-slate-400">{index + 1}</div>
                  <div className="min-w-0 space-y-2">
                    {credentialFields.map((field) => {
                      const value = readCredentialValue(account, field.keys)
                      if (!value) return null

                      return (
                        <div key={field.label} className="grid min-w-0 grid-cols-[5.8rem_minmax(0,1fr)_2rem] items-start gap-2 text-sm sm:grid-cols-[7rem_minmax(0,1fr)_2rem]">
                          <span className={`pt-1 text-[11px] font-black uppercase tracking-[0.12em] ${field.tone}`}>
                            {field.label}
                          </span>
                          <span className="min-w-0 whitespace-pre-wrap break-words rounded-lg bg-slate-100 px-2 py-1.5 font-mono text-sm leading-5 text-slate-800 dark:bg-white/[0.06] dark:text-slate-200">
                            {value}
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

  // Check for purchase success message
  useEffect(() => {
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
  }, [location.state, toast])

  // Load real orders from Supabase
  useEffect(() => {
    const loadOrders = async () => {
      if (!user) return
      
      try {
        setLoading(true)
        console.log('🔄 Loading orders for user:', user.id)
        
        const ordersData = await getUserOrders(user.id)
        console.log('✅ Orders loaded:', ordersData)
        
        setOrders(ordersData)
        setFilteredOrders(ordersData)
        setLoading(false)
      } catch (error) {
        console.error('Error loading orders:', error)
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to load order history"
        })
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
      filtered = filtered.filter(order => order.account_details?.category === categoryFilter)
    }

    setFilteredOrders(filtered)
  }, [orders, searchTerm, statusFilter, categoryFilter])

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

  return (
    <div className="min-h-screen bg-background">
      <NavbarAuth />
      
      <div className="mx-auto max-w-7xl px-4 pb-4 pt-8 sm:px-6 lg:px-8">
        <WalletBalanceWidget showRefresh={true} />
      </div>
      
      <RevampPage className="pt-0">
        <RevampHero
          eyebrow="Orders"
          title="Your purchases,"
          accent="credentials and history."
          description="Review completed orders, download credentials, and filter purchases by status or category."
          primaryHref="/products"
          primaryLabel="Browse Products"
          secondaryHref="/wallet"
          secondaryLabel="Open Wallet"
        >
          <RevampVisual title="Order vault" subtitle="Completed purchases stay available from your account." icon={Package} />
        </RevampHero>

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
            />
          </section>
        ) : (
          <>
        {/* Stats */}
        <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
          <RevampCard>
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 bg-green-100 rounded-full flex items-center justify-center">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Completed</p>
                  <p className="text-2xl font-bold">{stats.completed}</p>
                </div>
              </div>
          </RevampCard>
          
          <RevampCard>
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 bg-red-100 rounded-full flex items-center justify-center">
                  <XCircle className="h-4 w-4 text-red-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Failed</p>
                  <p className="text-2xl font-bold">{stats.failed}</p>
                </div>
              </div>
          </RevampCard>
          
          <RevampCard>
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 bg-yellow-100 rounded-full flex items-center justify-center">
                  <RefreshCw className="h-4 w-4 text-yellow-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Processing</p>
                  <p className="text-2xl font-bold">{stats.processing}</p>
                </div>
              </div>
          </RevampCard>
          
          <RevampCard>
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 bg-primary/10 rounded-full flex items-center justify-center">
                  <span className="text-primary font-bold">₦</span>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Spent</p>
                  <p className="text-2xl font-bold">{showBalances ? formatPrice(stats.totalSpent) : '***'}</p>
                </div>
              </div>
          </RevampCard>
        </div>

        {/* Filters */}
        <Card className="my-6 rounded-2xl border-slate-200 bg-white/85 shadow-sm dark:border-white/10 dark:bg-white/[0.035]">
          <CardContent className="p-4 sm:p-6">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search orders by product name, username, or order ID..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
              
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full md:w-[150px]">
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
                <SelectTrigger className="w-full md:w-[150px]">
                  <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  <SelectItem value="Instagram">Instagram</SelectItem>
                  <SelectItem value="TikTok">TikTok</SelectItem>
                  <SelectItem value="Twitter">Twitter</SelectItem>
                  <SelectItem value="Facebook">Facebook</SelectItem>
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
          <div className="space-y-4">
            {filteredOrders.map((order) => {
              const StatusIcon = statusIcons[order.status as keyof typeof statusIcons]
              const { date, time } = formatDate(order.created_at)
              
              return (
                <Card key={order.id} className="rounded-2xl border-slate-200 bg-white/85 shadow-sm dark:border-white/10 dark:bg-white/[0.035]">
                  <CardContent className="p-4 sm:p-6">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="font-semibold text-lg">
                            {order.account_details?.accounts 
                              ? `${order.account_details.accounts.length} Account${order.account_details.accounts.length > 1 ? 's' : ''}`
                              : `@${order.account_details?.username || 'Account'}`
                            }
                          </h3>
                          <Badge variant={statusColors[order.status as keyof typeof statusColors]}>
                            <StatusIcon className="mr-1 h-3 w-3" />
                            {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                          </Badge>
                          <Badge variant="outline">{order.account_details?.category || 'Social Media'}</Badge>
                        </div>
                        
                        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm text-muted-foreground">
                          <div>
                            <span className="font-medium">Order ID:</span> {order.id.slice(0, 8)}...
                          </div>
                          <div>
                            <span className="font-medium">Amount:</span> {formatPrice(order.amount || 0)}
                          </div>
                          <div>
                            <span className="font-medium">Date:</span> {date}
                          </div>
                          <div>
                            <span className="font-medium">Time:</span> {time}
                          </div>
                        </div>

                        {order.account_details && (
                          <div className="mt-4 p-3 bg-muted/50 rounded-lg">
                            <h4 className="font-medium text-sm mb-2">Account Details:</h4>
                            <div className="grid md:grid-cols-2 gap-2 text-sm">
                              <div>
                                <span className="text-muted-foreground">Product:</span> {order.account_details.product_name}
                              </div>
                              <div>
                                <span className="text-muted-foreground">Category:</span> {order.account_details.category}
                              </div>
                              {order.account_details.accounts ? (
                                // Bulk purchase - show account count and first account preview
                                <>
                                  <div>
                                    <span className="text-muted-foreground">Accounts:</span> {order.account_details.accounts.length} purchased
                                  </div>
                                  {order.account_details.accounts[0]?.username && (
                                    <div>
                                      <span className="text-muted-foreground">Sample Username:</span> @{order.account_details.accounts[0].username}
                                    </div>
                                  )}
                                </>
                              ) : (
                                // Single purchase - show individual account details
                                <>
                                  {order.account_details.username && (
                                    <div>
                                      <span className="text-muted-foreground">Username:</span> @{order.account_details.username}
                                    </div>
                                  )}
                                  {order.account_details.email && (
                                    <div>
                                      <span className="text-muted-foreground">Email:</span> {order.account_details.email}
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                      
                      <div className="flex gap-2">
                        <Button
                          variant="default"
                          size="default"
                          onClick={() => setSelectedOrder(order)}
                          className="min-w-[140px]"
                        >
                          <Package className="h-4 w-4 mr-2" />
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
