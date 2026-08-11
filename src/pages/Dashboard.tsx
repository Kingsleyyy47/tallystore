import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  ArrowDownRight,
  ArrowUpRight,
  Bitcoin,
  Clock,
  CreditCard,
  Download,
  Gift,
  History,
  MessageSquareText,
  PackageCheck,
  PhoneCall,
  ReceiptText,
  RefreshCw,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Wallet,
  Zap,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/contexts/SimpleAuth'
import { useCurrency } from '@/contexts/CurrencyContext'
import { CryptoBalanceCard } from '@/components/CryptoBalanceCard'
import { PaymentVerificationCard } from '@/components/PaymentVerificationCard'
import NavbarAuth from '@/components/NavbarAuth'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

const NAIRA = '\u20a6'
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

function formatNaira(value: number, decimals = false) {
  return `${NAIRA}${Number(value || 0).toLocaleString('en-NG', {
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  })}`
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
    description: 'Gift cards and eSIMs',
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
  const { user, walletBalance, walletLoading, refreshWalletBalance } = useAuth()
  const { formatPrice } = useCurrency()
  const [transactions, setTransactions] = useState<DashboardTransaction[]>([])
  const [orders, setOrders] = useState<DashboardOrder[]>([])
  const [totalSpent, setTotalSpent] = useState(0)
  const [completedOrders, setCompletedOrders] = useState(0)
  const [statsLoading, setStatsLoading] = useState(true)
  const [activityLoading, setActivityLoading] = useState(true)
  const [installPromptOffset, setInstallPromptOffset] = useState(false)

  const userName = user?.email?.split('@')[0] || 'User'

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
          <section className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)]">
            <div className="min-w-0 space-y-0">
              <div className="relative overflow-hidden rounded-[2rem] bg-[linear-gradient(145deg,#5b3db2_0%,#4d32a3_48%,#7254d6_100%)] px-5 pb-24 pt-7 text-white shadow-[0_28px_70px_rgba(88,64,179,0.34)] sm:px-8 sm:pb-24 lg:min-h-[360px] lg:px-10 lg:pb-10">
                <div className="relative z-10 flex items-center justify-between">
                  <div className="min-w-0 flex-1 overflow-hidden pr-3">
                    <p className="text-sm font-medium text-cyan-100/90">Welcome back</p>
                    <h1 className="mt-1 block max-w-[240px] truncate text-2xl font-bold tracking-tight xs:max-w-[280px] sm:max-w-full sm:text-3xl">
                      {userName}
                    </h1>
                  </div>
                  <button
                    type="button"
                    onClick={refreshWalletBalance}
                    className="grid h-11 w-11 place-items-center rounded-2xl bg-white/12 text-cyan-100 backdrop-blur transition hover:bg-white/20"
                    aria-label="Refresh wallet balance"
                  >
                    <RefreshCw className="h-5 w-5" />
                  </button>
                </div>

                <div className="relative z-10 mt-10 text-center lg:text-left">
                  <p className="text-sm font-semibold uppercase tracking-[0.22em] text-cyan-100/90">
                    Total Balance
                  </p>
                  <div className="mt-2 text-5xl font-black tracking-tight sm:text-6xl lg:text-7xl">
                    {walletLoading ? (
                      <span className="mx-auto block h-14 w-56 rounded-2xl bg-white/20 lg:mx-0" />
                    ) : (
                      formatPrice(walletBalance)
                    )}
                  </div>
                  <div className="mt-6 flex flex-wrap justify-center gap-3 lg:justify-start">
                    <Button asChild className="h-11 rounded-2xl bg-white px-5 text-[#5637aa] hover:bg-cyan-50">
                      <Link to="/wallet">
                        <Wallet className="h-4 w-4" />
                        Top Up
                      </Link>
                    </Button>
                    <Button
                      asChild
                      variant="outline"
                      className="h-11 rounded-2xl border-white/30 bg-white/10 px-5 text-white hover:bg-white/20 hover:text-white"
                    >
                      <Link to="/products">
                        <ShoppingBag className="h-4 w-4" />
                        Buy Accounts
                      </Link>
                    </Button>
                  </div>
                </div>

                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 opacity-30">
                  <div className="absolute bottom-0 left-0 h-16 w-10 bg-[#2d206f]" />
                  <div className="absolute bottom-0 left-[12%] h-24 w-14 rounded-t-[2rem] bg-[#3c2a83]" />
                  <div className="absolute bottom-0 left-[30%] h-20 w-16 bg-[#2e2172]" />
                  <div className="absolute bottom-0 left-[48%] h-28 w-12 rounded-t-[2rem] bg-[#392584]" />
                  <div className="absolute bottom-0 left-[64%] h-16 w-24 rounded-t-[2rem] bg-[#342575]" />
                  <div className="absolute bottom-0 right-0 h-24 w-20 rounded-tl-[2rem] bg-[#2f226e]" />
                </div>
              </div>

              <div className="relative z-20 -mt-10 px-3 sm:px-6 lg:max-w-2xl">
                <Card className="overflow-hidden rounded-[1.5rem] border-0 bg-white shadow-[0_22px_48px_rgba(15,23,42,0.12)] dark:bg-slate-950">
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
                          {formatNaira(totalSpent)}
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
                  <h2 className="mt-7 text-2xl font-black tracking-tight">SMS Numbers</h2>
                  <p className="mt-2 max-w-sm text-sm leading-6 text-slate-300">
                    Buy US numbers for SMS verification directly from your TallyStore wallet.
                  </p>
                  <Button asChild className="mt-6 h-11 rounded-2xl bg-white px-5 text-slate-950 hover:bg-cyan-50">
                    <Link to="/sms-numbers">
                      <MessageSquareText className="h-4 w-4" />
                      Buy SMS Numbers
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
                        If a successful payment is delayed, verify it from your dashboard.
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
                <CardContent className="p-5">
                  <div className="mb-5 flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-black tracking-tight">Recent Activity</h2>
                      <p className="text-sm text-slate-500 dark:text-muted-foreground">Latest wallet movement.</p>
                    </div>
                    <Button asChild variant="ghost" size="sm" className="rounded-xl text-cyan-600 hover:text-cyan-700">
                      <Link to="/wallet">View all</Link>
                    </Button>
                  </div>

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
                                {formatNaira(Math.abs(item.amount))}
                              </p>
                              <p className="text-[11px] capitalize text-slate-400">{item.status}</p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-[1.75rem] border-0 bg-white shadow-card dark:bg-card">
                <CardContent className="p-5">
                  <div className="mb-4 flex items-center gap-3">
                    <div className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-100 text-cyan-700">
                      <Bitcoin className="h-5 w-5" />
                    </div>
                    <div>
                      <h2 className="font-black">SMS Numbers</h2>
                      <p className="text-xs text-slate-500 dark:text-muted-foreground">Ready from your wallet.</p>
                    </div>
                  </div>

                  <Link
                    to="/sms-numbers"
                    className="block rounded-3xl border border-dashed border-cyan-300 bg-cyan-50/70 p-4 transition hover:-translate-y-0.5 hover:bg-cyan-50 dark:border-cyan-500/30 dark:bg-cyan-500/10 dark:hover:bg-cyan-500/15"
                  >
                    <div className="flex items-start gap-3">
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl bg-white text-cyan-700 dark:bg-background">
                        <PhoneCall className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold">US SMS Numbers</p>
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
      </main>

      <nav
        className={cn(
          'fixed inset-x-4 z-40 rounded-[2rem] border border-white/70 bg-white/95 px-4 py-3 shadow-[0_20px_60px_rgba(15,23,42,0.2)] backdrop-blur-xl transition-[bottom] duration-300 dark:border-white/10 dark:bg-card/95 lg:hidden',
          installPromptOffset ? 'bottom-24' : 'bottom-4',
        )}
      >
        <div className="grid grid-cols-5 items-center gap-1 text-[11px] font-semibold text-slate-500">
          <Link to="/wallet" className="flex flex-col items-center gap-1 rounded-2xl p-2 text-violet-700">
            <Wallet className="h-5 w-5" />
            Wallet
          </Link>
          <Link to="/orders" className="flex flex-col items-center gap-1 rounded-2xl p-2">
            <Download className="h-5 w-5" />
            Orders
          </Link>
          <Link
            to="/products"
            className="-mt-8 grid h-16 w-16 place-items-center justify-self-center rounded-full bg-[#5b3db2] text-white shadow-[0_18px_40px_rgba(91,61,178,0.38)]"
            aria-label="Buy accounts"
          >
            <ShoppingBag className="h-7 w-7" />
          </Link>
          <Link to="/bills" className="flex flex-col items-center gap-1 rounded-2xl p-2">
            <ReceiptText className="h-5 w-5" />
            Bills
          </Link>
          <Link
            to="/sms-numbers"
            className="flex flex-col items-center gap-1 rounded-2xl p-2 text-slate-500"
          >
            <PhoneCall className="h-5 w-5" />
            SMS
          </Link>
        </div>
      </nav>
    </div>
  )
}
