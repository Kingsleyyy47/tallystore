import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  ArrowDownRight,
  ArrowUpRight,
  Bitcoin,
  ChevronDown,
  Clock,
  CreditCard,
  Download,
  Eye,
  EyeOff,
  Gift,
  History,
  MessageSquareText,
  PackageCheck,
  PhoneCall,
  Plus,
  ReceiptText,
  RefreshCw,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Zap,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/contexts/SimpleAuth'
import { useCurrency } from '@/contexts/CurrencyContext'
import { CryptoBalanceCard } from '@/components/CryptoBalanceCard'
import { PaymentVerificationCard } from '@/components/PaymentVerificationCard'
import NavbarAuth from '@/components/NavbarAuth'
import PageBreadcrumb from '@/components/PageBreadcrumb'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { trackRevenueEvent } from '@/lib/revenue-os'
import { RecommendationStrip } from '@/components/RecommendationCard'
import { useRecommendations } from '@/hooks/useRecommendations'

const INSTALL_PROMPT_STORAGE_KEY = 'pwa-install-prompt-dismissed'

type DashboardTransaction = {
  id: string
  type: string
  amount: number
  status: string
  reference?: string
  description?: string
  created_at: string
}

type DashboardOrder = {
  id: string
  amount: number
  status: string
  created_at: string
  account_details?: {
    product_name?: string
    category?: string
    accounts?: unknown[]
    username?: string
  }
}

type DashboardOrderStatRow = {
  amount: number
}

type ActivityItem = {
  id: string
  title: string
  meta: string
  amount?: number
  status: string
  createdAt: string
  tone: 'credit' | 'debit' | 'neutral'
}

function formatCompactDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Just now'

  return date.toLocaleDateString('en-NG', {
    month: 'short',
    day: 'numeric',
  })
}

const actionItems = [
  {
    title: 'Buy Accounts',
    description: 'Fresh social inventory',
    href: '/products',
    icon: ShoppingBag,
    accent: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200',
  },
  {
    title: 'Top Up',
    description: 'Add wallet funds',
    href: '/wallet',
    icon: CreditCard,
    accent: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-200',
  },
  {
    title: 'My Orders',
    description: 'Download credentials',
    href: '/orders',
    icon: Download,
    accent: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200',
  },
  {
    title: 'Bills',
    description: 'Airtime and data',
    href: '/bills',
    icon: ReceiptText,
    accent: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-200',
  },
  {
    title: 'Gift Cards',
    description: 'Digital gift cards',
    href: '/gift-cards',
    icon: Gift,
    accent: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-200',
  },
  {
    title: 'Social Boost',
    description: 'SMM growth tools',
    href: '/social-boost',
    icon: Zap,
    accent: 'bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-200',
  },
  {
    title: 'Settings',
    description: 'Profile and security',
    href: '/profile',
    icon: Settings,
    accent: 'bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-200',
  },
]

export default function Dashboard() {
  const { user, walletBalance, walletLoading, refreshWalletBalance, showBalances, toggleBalanceVisibility } = useAuth()
  const { recommendations: recs } = useRecommendations({ limit: 3 })
  const { currency, formatPrice } = useCurrency()
  const [transactions, setTransactions] = useState<DashboardTransaction[]>([])
  const [orders, setOrders] = useState<DashboardOrder[]>([])
  const [totalSpent, setTotalSpent] = useState(0)
  const [completedOrders, setCompletedOrders] = useState(0)
  const [statsLoading, setStatsLoading] = useState(true)
  const [activityLoading, setActivityLoading] = useState(true)
  const [installPromptOffset, setInstallPromptOffset] = useState(false)

  const userName = user?.email?.split('@')[0] || 'User'
  const currencySymbol = currency === 'USD' ? '$' : '\u20a6'

  useEffect(() => {
    trackRevenueEvent({
      eventType: 'PAGE_VIEWED',
      userId: user?.id || null,
      surface: 'dashboard',
      metadata: { authenticated: Boolean(user?.id), currency },
    })
  }, [currency, user?.id])

  const loadDashboardStats = useCallback(async () => {
    if (!user?.id) {
      setCompletedOrders(0)
      setTotalSpent(0)
      setStatsLoading(false)
      return
    }

    setStatsLoading(true)
    try {
      const pageSize = 1000
      let from = 0
      let completedCount = 0
      let spentTotal = 0

      while (true) {
        const { data, error, count } = await supabase
          .from('orders')
          .select('amount', { count: from === 0 ? 'exact' : undefined })
          .eq('user_id', user.id)
          .eq('status', 'completed')
          .range(from, from + pageSize - 1)

        if (error) throw error

        const rows = (data || []) as DashboardOrderStatRow[]
        if (from === 0) {
          completedCount = count ?? rows.length
        }

        spentTotal += rows.reduce((sum, order) => sum + Number(order.amount || 0), 0)

        if (rows.length < pageSize || from + rows.length >= completedCount) break
        from += pageSize
      }

      setCompletedOrders(completedCount)
      setTotalSpent(spentTotal)
      trackRevenueEvent({
        eventType: 'PAGE_VIEWED',
        userId: user.id,
        surface: 'dashboard_stats_loaded',
        metadata: {
          completed_orders: completedCount,
          total_spent_ngn: spentTotal,
        },
      })
    } catch (error) {
      console.error('Failed to load dashboard stats:', error)
      setCompletedOrders(0)
      setTotalSpent(0)
    } finally {
      setStatsLoading(false)
    }
  }, [user?.id])

  const loadDashboardActivity = useCallback(async () => {
    if (!user?.id) {
      setActivityLoading(false)
      return
    }

    setActivityLoading(true)
    try {
      const [transactionResult, recentOrderResult] = await Promise.all([
        supabase
          .from('transactions')
          .select('id,type,amount,status,reference,description,created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(5),
        supabase
          .from('orders')
          .select('id,amount,status,created_at,account_details')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(5),
      ])

      if (transactionResult.error) throw transactionResult.error
      if (recentOrderResult.error) throw recentOrderResult.error

      setTransactions((transactionResult.data || []) as DashboardTransaction[])
      setOrders((recentOrderResult.data || []) as DashboardOrder[])
      trackRevenueEvent({
        eventType: 'PAGE_VIEWED',
        userId: user.id,
        surface: 'dashboard_activity_loaded',
        metadata: {
          transaction_count: transactionResult.data?.length || 0,
          order_count: recentOrderResult.data?.length || 0,
        },
      })
    } catch (error) {
      console.error('Failed to load dashboard activity:', error)
      setTransactions([])
      setOrders([])
    } finally {
      setActivityLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    loadDashboardStats()
    loadDashboardActivity()
  }, [loadDashboardActivity, loadDashboardStats])

  useEffect(() => {
    const updateInstallPromptOffset = () => {
      const dismissed = localStorage.getItem(INSTALL_PROMPT_STORAGE_KEY) === 'true'
      const nav = window.navigator as Navigator & { standalone?: boolean }
      const installed = window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true
      setInstallPromptOffset(!dismissed && !installed)
    }

    const timer = window.setTimeout(updateInstallPromptOffset, 3200)
    const interval = window.setInterval(updateInstallPromptOffset, 1000)

    return () => {
      window.clearTimeout(timer)
      window.clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    const handleTransactionUpdate = () => {
      refreshWalletBalance()
      loadDashboardStats()
      loadDashboardActivity()
    }

    window.addEventListener('transactionAdded', handleTransactionUpdate)
    return () => window.removeEventListener('transactionAdded', handleTransactionUpdate)
  }, [loadDashboardActivity, loadDashboardStats, refreshWalletBalance])

  const handleDashboardNavigate = (href: string, surface: string) => {
    trackRevenueEvent({
      eventType: 'OFFER_ACCEPTED',
      userId: user?.id || null,
      surface,
      metadata: { destination: href },
    })
  }

  const handleRefresh = () => {
    trackRevenueEvent({
      eventType: 'OFFER_ACCEPTED',
      userId: user?.id || null,
      surface: 'dashboard_refresh_balance',
    })
    refreshWalletBalance()
  }

  const handleBalanceToggle = () => {
    trackRevenueEvent({
      eventType: showBalances ? 'OFFER_DISMISSED' : 'OFFER_ACCEPTED',
      userId: user?.id || null,
      surface: 'dashboard_balance_visibility',
      metadata: { next_state: showBalances ? 'hidden' : 'visible' },
    })
    toggleBalanceVisibility()
  }

  const recentActivity = useMemo<ActivityItem[]>(() => {
    const transactionActivity = transactions.map((transaction) => {
      const isTopup = transaction.type === 'topup' || Number(transaction.amount) > 0
      const amount = Number(transaction.amount || 0)

      return {
        id: `tx-${transaction.id}`,
        title: isTopup ? 'Wallet Top-up' : transaction.description || 'Purchase',
        meta: `${formatCompactDate(transaction.created_at)}${
          transaction.reference ? ` - ${transaction.reference.slice(0, 12)}` : ''
        }`,
        amount,
        status: transaction.status || 'completed',
        createdAt: transaction.created_at,
        tone: isTopup ? 'credit' : 'debit',
      } satisfies ActivityItem
    })

    const orderActivity = orders.map((order) => ({
      id: `order-${order.id}`,
      title: order.account_details?.product_name || 'Account order',
      meta: `${formatCompactDate(order.created_at)} - ${order.account_details?.category || 'Order'}`,
      amount: -Math.abs(Number(order.amount || 0)),
      status: order.status || 'completed',
      createdAt: order.created_at,
      tone: 'debit' as const,
    }))

    return [...transactionActivity, ...orderActivity]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5)
  }, [orders, transactions])

  return (
    <div className="min-h-screen max-w-full overflow-x-hidden bg-[#f6f7fb] text-slate-950 dark:bg-background dark:text-foreground">
      <NavbarAuth />

      <main
        className={cn(
          'container mx-auto max-w-full overflow-x-hidden px-4 pt-4 sm:px-6 lg:pb-12 lg:pt-8',
          installPromptOffset ? 'pb-44' : 'pb-28',
        )}
      >
        <div className="mx-auto w-full max-w-7xl space-y-6 overflow-x-hidden lg:space-y-8">
          <PageBreadcrumb items={[{ label: 'Wallet Home' }]} />
          <section className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)]">
            <div className="min-w-0 space-y-4">
              <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-purple-600 dark:text-purple-300">Welcome back, {userName}</p>
                  <h1 className="mt-1 text-3xl font-black tracking-normal sm:text-4xl">Wallet</h1>
                  <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
                    Your balance, orders, recovery tools, and services in one place.
                  </p>
                </div>
                <Button variant="outline" onClick={handleRefresh} className="w-full justify-center rounded-xl sm:w-auto">
                  <RefreshCw className="h-4 w-4" />
                  Refresh
                </Button>
              </div>

              <article className="relative min-h-[170px] overflow-hidden rounded-xl border border-purple-200/70 bg-[radial-gradient(circle_at_82%_48%,rgba(216,180,254,0.22),transparent_15rem),linear-gradient(135deg,#2d145c_0%,#4c1d95_48%,#1b103d_100%)] p-4 text-white shadow-[0_24px_70px_rgba(126,51,231,0.28)] dark:border-purple-300/20 sm:min-h-[190px] sm:p-5">
                <div className="absolute -right-12 -top-12 h-48 w-48 rounded-full bg-purple-300/20 blur-2xl" />
                <div className="absolute bottom-0 left-0 h-14 w-full bg-black/10" />

                <div className="pointer-events-none absolute right-2 top-1/2 h-28 w-32 -translate-y-1/2 sm:right-7 sm:h-36 sm:w-40">
                  <div className="absolute left-8 top-0 h-10 w-16 -rotate-6 rounded-md bg-emerald-100 shadow-lg sm:left-10 sm:h-12 sm:w-20" />
                  <div className="absolute left-12 top-2 h-10 w-16 rotate-3 rounded-md bg-slate-200 shadow-lg sm:left-14 sm:h-12 sm:w-20" />
                  <div className="absolute bottom-3 right-6 h-20 w-24 rounded-[1rem] bg-gradient-to-br from-purple-400 via-purple-700 to-violet-950 shadow-[0_16px_35px_rgba(0,0,0,0.35)] ring-1 ring-white/15 sm:h-24 sm:w-32">
                    <div className="absolute -right-2 top-7 h-10 w-10 rounded-l-xl rounded-r-md bg-purple-500 shadow-lg ring-1 ring-white/15 sm:top-8 sm:h-12 sm:w-12" />
                    <div className="absolute inset-x-4 top-5 grid place-items-center text-4xl font-black text-white/90 sm:text-5xl">
                      T
                    </div>
                  </div>
                  <span className="absolute bottom-0 right-2 grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-purple-300 to-purple-700 text-xl font-black text-white shadow-xl ring-2 ring-purple-200/40 sm:h-14 sm:w-14 sm:text-2xl">
                    {currencySymbol}
                  </span>
                </div>

                <div className="relative z-10 max-w-[62%] sm:max-w-[58%]">
                  <div className="flex items-center gap-2 text-xs font-black text-purple-100 sm:text-sm">
                    Your Balance
                    <button
                      type="button"
                      onClick={handleBalanceToggle}
                      className="grid h-7 w-7 place-items-center rounded-full text-purple-100 transition hover:bg-white/10 hover:text-white"
                      aria-label={showBalances ? 'Hide balances' : 'Show balances'}
                    >
                      {showBalances ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <div className="mt-3 text-3xl font-black tracking-normal sm:mt-5 sm:text-5xl">
                    {walletLoading ? (
                      <span className="inline-block h-9 w-40 animate-pulse rounded-lg bg-white/20" />
                    ) : (
                      showBalances ? formatPrice(walletBalance) : '***'
                    )}
                  </div>
                  <p className="mt-2 text-xs font-bold text-purple-100/85 sm:text-sm">Available Balance</p>
                  <div className="mt-4 flex max-w-64 flex-wrap gap-2 sm:mt-5">
                    <Button asChild className="h-10 flex-1 rounded-lg bg-purple-500 px-4 text-sm font-black text-white hover:bg-purple-400">
                      <Link to="/wallet" onClick={() => handleDashboardNavigate('/wallet', 'dashboard_add_funds_cta')}>
                        Add Funds
                        <Plus className="h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                </div>
              </article>

              <Card className="overflow-hidden rounded-xl border border-slate-200 bg-white/85 shadow-sm dark:border-white/10 dark:bg-white/[0.035]">
                <CardContent className="grid grid-cols-2 divide-x divide-slate-100 p-0 dark:divide-white/10">
                    <div className="min-w-0 p-4 sm:p-5">
                      <div className="mb-3 grid h-10 w-10 place-items-center rounded-2xl bg-cyan-100 text-cyan-700 dark:bg-cyan-400/15 dark:text-cyan-200">
                        <ArrowDownRight className="h-5 w-5" />
                      </div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-muted-foreground">
                        Total spent
                      </p>
                      {statsLoading ? (
                        <span className="mt-2 block h-7 w-28 animate-pulse rounded-xl bg-slate-100 dark:bg-white/10" />
                      ) : (
                        <p className="mt-1 break-words text-xl font-black tracking-tight sm:text-3xl">
                          {showBalances ? formatPrice(totalSpent) : '***'}
                        </p>
                      )}
                    </div>

                    <div className="min-w-0 p-4 sm:p-5">
                      <div className="mb-3 grid h-10 w-10 place-items-center rounded-2xl bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-200">
                        <PackageCheck className="h-5 w-5" />
                      </div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-muted-foreground">
                        Orders
                      </p>
                      {statsLoading ? (
                        <span className="mt-2 block h-7 w-14 animate-pulse rounded-xl bg-slate-100 dark:bg-white/10" />
                      ) : (
                        <p className="mt-1 text-xl font-black tracking-tight sm:text-3xl">
                          {completedOrders.toLocaleString()}
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
            </div>

            <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-1">
              <Card className="overflow-hidden rounded-[1.75rem] border-0 bg-slate-950 text-white shadow-[0_24px_60px_rgba(15,23,42,0.22)]">
                <CardContent className="relative p-6">
                  <div className="absolute right-5 top-5 rounded-full bg-emerald-300/15 px-3 py-1 text-xs font-semibold text-emerald-100">
                    Live now
                  </div>
                  <div className="grid h-14 w-14 place-items-center rounded-3xl bg-cyan-300/15 text-cyan-200">
                    <PhoneCall className="h-6 w-6" />
                  </div>
                  <h2 className="mt-7 text-2xl font-black tracking-tight">US & Canada Numbers</h2>
                  <p className="mt-2 max-w-sm text-sm leading-6 text-slate-300">
                    Buy US numbers for SMS verification directly from your TallyStore wallet.
                  </p>
                  <Button asChild className="mt-6 h-11 rounded-2xl bg-white px-5 text-slate-950 hover:bg-cyan-50">
                    <Link to="/us-canada" onClick={() => handleDashboardNavigate('/us-canada', 'dashboard_us_canada_cta')}>
                      <MessageSquareText className="h-4 w-4" />
                      Buy Numbers
                    </Link>
                  </Button>
                </CardContent>
              </Card>

              <Card className="rounded-[1.75rem] border-0 bg-white shadow-card dark:bg-card">
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <div className="grid h-12 w-12 place-items-center rounded-2xl bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200">
                      <ShieldCheck className="h-6 w-6" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold">Payment Recovery</p>
                      <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-muted-foreground">
                        If a successful payment is delayed, verify it from your account.
                      </p>
                    </div>
                  </div>
                  <div className="mt-5 flex items-center gap-3 rounded-2xl bg-slate-100 p-3 text-sm text-slate-600 dark:bg-muted dark:text-muted-foreground">
                    <Clock className="h-4 w-4 text-violet-600" />
                    Auto-checking runs in the background.
                  </div>
                </CardContent>
              </Card>
            </div>
          </section>

          <section className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,0.72fr)_minmax(360px,0.28fr)]">
            <div className="min-w-0 space-y-6">
              <div>
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-black tracking-tight">Quick Actions</h2>
                    <p className="text-sm text-slate-500 dark:text-muted-foreground">Most-used tools in one tap.</p>
                  </div>
                  <Sparkles className="hidden h-5 w-5 text-violet-500 sm:block" />
                </div>

                <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                  {actionItems.map((item) => {
                    const Icon = item.icon

                    return (
                      <Link
                        key={item.title}
                        to={item.href}
                        onClick={() => handleDashboardNavigate(item.href, 'dashboard_quick_action')}
                        className="group flex min-h-[104px] w-full max-w-full flex-row items-center gap-4 overflow-hidden rounded-[1.35rem] bg-white p-4 shadow-card transition duration-300 hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(88,64,179,0.16)] dark:bg-card sm:min-h-[118px] sm:p-5"
                      >
                        <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-2xl', item.accent)}>
                          <Icon className="h-5 w-5" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-base font-black leading-tight text-slate-950 dark:text-foreground">
                            {item.title}
                          </span>
                          <span className="mt-1 block text-sm leading-5 text-slate-500 dark:text-muted-foreground">
                            {item.description}
                          </span>
                        </span>
                      </Link>
                    )
                  })}
                </div>
              </div>

              <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(340px,0.65fr)]">
                <PaymentVerificationCard />
                <CryptoBalanceCard />
              </div>
            </div>

            <aside className="min-w-0 space-y-6">
              <Card className="rounded-[1.75rem] border-0 bg-white shadow-card dark:bg-card">
                <CardContent className="p-0">
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-5 [&::-webkit-details-marker]:hidden">
                      <span className="min-w-0">
                        <span className="block text-lg font-black tracking-tight">Recent Activity</span>
                        <span className="block text-sm text-slate-500 dark:text-muted-foreground">Latest wallet movement.</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <Button asChild variant="ghost" size="sm" className="rounded-xl text-cyan-600 hover:text-cyan-700" onClick={(event) => event.stopPropagation()}>
                          <Link to="/wallet" onClick={() => handleDashboardNavigate('/wallet', 'dashboard_activity_view_all')}>
                            View all
                          </Link>
                        </Button>
                        <ChevronDown className="h-4 w-4 text-slate-400 transition group-open:rotate-180" />
                      </span>
                    </summary>

                    <div className="border-t border-slate-100 p-5 dark:border-white/10">
                      {activityLoading ? (
                        <div className="space-y-4">
                          {[0, 1, 2].map((item) => (
                            <div key={item} className="flex items-center gap-3">
                              <span className="h-11 w-11 rounded-2xl bg-slate-100 dark:bg-muted" />
                              <span className="min-w-0 flex-1 space-y-2">
                                <span className="block h-4 w-2/3 rounded bg-slate-100 dark:bg-muted" />
                                <span className="block h-3 w-1/2 rounded bg-slate-100 dark:bg-muted" />
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : recentActivity.length === 0 ? (
                        <div className="rounded-3xl bg-slate-100 p-6 text-center dark:bg-muted">
                          <History className="mx-auto h-8 w-8 text-slate-400" />
                          <p className="mt-3 text-sm font-semibold">No recent activity</p>
                          <p className="mt-1 text-xs text-slate-500 dark:text-muted-foreground">
                            Top up your wallet or make a purchase to see it here.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {recentActivity.map((item) => (
                            <div key={item.id} className="flex items-center gap-3">
                              <div
                                className={cn(
                                  'grid h-11 w-11 shrink-0 place-items-center rounded-2xl',
                                  item.tone === 'credit'
                                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200'
                                    : 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200',
                                )}
                              >
                                {item.tone === 'credit' ? (
                                  <ArrowUpRight className="h-5 w-5" />
                                ) : (
                                  <ArrowDownRight className="h-5 w-5" />
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-bold">{item.title}</p>
                                <p className="truncate text-xs text-slate-500 dark:text-muted-foreground">
                                  {item.meta}
                                </p>
                              </div>
                              {typeof item.amount === 'number' && (
                                <div className="text-right">
                                  <p
                                    className={cn(
                                      'text-sm font-black',
                                      item.tone === 'credit' ? 'text-emerald-600' : 'text-slate-950 dark:text-foreground',
                                    )}
                                  >
                                    {item.tone === 'credit' ? '+' : '-'}
                                    {formatPrice(Math.abs(item.amount))}
                                  </p>
                                  <p className="text-[11px] capitalize text-slate-400">{item.status}</p>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </details>
                </CardContent>
              </Card>

              <Card className="rounded-[1.75rem] border-0 bg-white shadow-card dark:bg-card">
                <CardContent className="p-5">
                  <div className="mb-4 flex items-center gap-3">
                    <div className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-100 text-cyan-700">
                      <Bitcoin className="h-5 w-5" />
                    </div>
                    <div>
                      <h2 className="font-black">US & Canada Numbers</h2>
                      <p className="text-xs text-slate-500 dark:text-muted-foreground">Ready from your wallet.</p>
                    </div>
                  </div>

                  <Link
                    to="/us-canada"
                    onClick={() => handleDashboardNavigate('/us-canada', 'dashboard_us_canada_card')}
                    className="block rounded-3xl border border-dashed border-cyan-300 bg-cyan-50/70 p-4 transition hover:-translate-y-0.5 hover:bg-cyan-50 dark:border-cyan-500/30 dark:bg-cyan-500/10 dark:hover:bg-cyan-500/15"
                  >
                    <div className="flex items-start gap-3">
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl bg-white text-cyan-700 dark:bg-background">
                        <PhoneCall className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold">US & Canada Numbers</p>
                        <p className="mt-1 text-sm leading-5 text-slate-600 dark:text-muted-foreground">
                          Buy verification numbers directly from your balance.
                        </p>
                      </div>
                    </div>
                  </Link>
                </CardContent>
              </Card>
            </aside>
          </section>
        </div>

        {recs.length > 0 && (
          <div className="mx-auto mt-8 max-w-5xl px-4 pb-10">
            <RecommendationStrip products={recs} surface="dashboard" actionType="SHOW_ALTERNATIVE" userId={user?.id} title="Products you might like" />
          </div>
        )}
      </main>

    </div>
  )
}
