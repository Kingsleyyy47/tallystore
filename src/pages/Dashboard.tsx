import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CircleHelp, Eye, EyeOff, MessageSquareText, Package, Plane, Plus, Send, ShoppingBag, TrendingUp, Wallet } from 'lucide-react'
import NavbarAuth from '@/components/NavbarAuth'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/contexts/SimpleAuth'
import { useCurrency } from '@/contexts/CurrencyContext'
import { supabase } from '@/lib/supabase'

type RecentOrder = {
  id: string
  amount: number
  status: string
  created_at: string
  product_name?: string | null
}

const services = [
  { title: 'Products', detail: 'Browse digital accounts', href: '/products', icon: ShoppingBag, tone: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200' },
  { title: 'US & Canada SMS', detail: 'Get a verification number', href: '/us-canada', icon: MessageSquareText, tone: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-200' },
  { title: 'Social Boost', detail: 'Grow your channels', href: '/social-boost', icon: TrendingUp, tone: 'bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-200' },
  { title: 'Telegram', detail: 'Stars and Premium', href: '/telegram-stars', icon: Send, tone: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200' },
  { title: 'Travel & Visa', detail: 'Explore travel services', href: '/travel-visa', icon: Plane, tone: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200' },
  { title: 'Help Centre', detail: 'Get help with an order', href: '/support', icon: CircleHelp, tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200' },
] as const

function orderDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function Dashboard() {
  const { user, walletBalance, walletLoading, walletBalanceUnavailable, showBalances, toggleBalanceVisibility } = useAuth()
  const { formatPrice } = useCurrency()
  const [orders, setOrders] = useState<RecentOrder[]>([])
  const [ordersLoading, setOrdersLoading] = useState(true)
  const [ordersError, setOrdersError] = useState(false)

  useEffect(() => {
    let active = true
    setOrders([])
    setOrdersError(false)
    if (!user?.id) {
      setOrdersLoading(false)
      return () => { active = false }
    }
    setOrdersLoading(true)
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort(); if (active) { setOrdersError(true); setOrdersLoading(false) } }, 12000)
    void supabase.from('orders_safe_history' as any)
      .select('id,amount,status,created_at,product_name:account_details->>product_name')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(4)
      .abortSignal(controller.signal)
      .then(({ data, error }) => {
        if (!active) return
        if (error) { setOrdersError(true); setOrders([]) }
        else setOrders((data || []) as RecentOrder[])
        setOrdersLoading(false)
      }).catch(() => { if (active) { setOrdersError(true); setOrdersLoading(false) } }).finally(() => clearTimeout(timer))
    return () => { active = false; controller.abort(); clearTimeout(timer) }
  }, [user?.id])

  const fullName = typeof user?.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : ''
  const firstName = fullName.split(' ')[0] || user?.email?.split('@')[0] || 'there'
  const balance = walletLoading ? 'Checking…' : walletBalanceUnavailable ? 'Unavailable' : showBalances ? formatPrice(walletBalance) : '••••••'

  return (
    <div className="min-h-screen bg-[#f7f7fb] text-slate-950 dark:bg-background dark:text-foreground">
      <NavbarAuth />
      <main className="mx-auto max-w-6xl space-y-8 px-4 pb-28 pt-7 sm:px-6 sm:pt-10 lg:pb-16">
        <header>
          <p className="text-sm font-semibold text-violet-700 dark:text-violet-300">Welcome back, {firstName}</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">Home</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Your wallet, services and recent orders.</p>
        </header>

        <section aria-label="Your wallet" className="overflow-hidden rounded-3xl bg-gradient-to-br from-[#35146e] via-[#5b21a6] to-[#27104e] p-6 text-white shadow-[0_18px_50px_rgba(74,28,145,0.2)] sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold text-violet-100">
                <Wallet className="h-4 w-4" /> Available wallet balance
                <button type="button" onClick={toggleBalanceVisibility} className="rounded-full p-1 hover:bg-white/15" aria-label={showBalances ? 'Hide balance' : 'Show balance'}>
                  {showBalances ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </button>
              </div>
              <p className="mt-4 break-words text-3xl font-black tracking-tight sm:text-5xl" aria-live="polite">{balance}</p>
              {walletBalanceUnavailable && <p className="mt-2 text-sm text-violet-100">Open Wallet to check your balance again.</p>}
            </div>
            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              <Button asChild className="h-11 flex-1 rounded-xl bg-white px-5 font-bold text-violet-800 hover:bg-violet-50 sm:flex-none">
                <Link to="/wallet"><Plus className="mr-2 h-4 w-4" /> Add funds</Link>
              </Button>
              <Button asChild variant="outline" className="h-11 flex-1 rounded-xl border-white/35 bg-white/10 px-5 font-bold text-white hover:bg-white/20 hover:text-white sm:flex-none">
                <Link to="/wallet">Wallet details</Link>
              </Button>
            </div>
          </div>
        </section>

        <section aria-labelledby="services-heading">
          <h2 id="services-heading" className="text-xl font-black tracking-tight sm:text-2xl">What would you like to do?</h2>
          <p className="mb-4 mt-1 text-sm text-slate-600 dark:text-slate-400">Choose a service to get started.</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {services.map(({ title, detail, href, icon: Icon, tone }) => (
              <Link key={href} to={href} className="group flex min-h-24 items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-violet-300 hover:shadow-md dark:border-white/10 dark:bg-card dark:hover:border-violet-400/40">
                <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${tone}`}><Icon className="h-5 w-5" /></span>
                <span className="min-w-0 flex-1"><span className="block font-bold">{title}</span><span className="mt-0.5 block text-sm text-slate-500 dark:text-slate-400">{detail}</span></span>
                <ArrowRight className="h-4 w-4 shrink-0 text-slate-400 transition group-hover:translate-x-1 group-hover:text-violet-600" />
              </Link>
            ))}
          </div>
        </section>

        <section aria-labelledby="recent-orders-heading" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-card sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div><h2 id="recent-orders-heading" className="text-xl font-black tracking-tight">Recent orders</h2><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Your latest purchases and their status.</p></div>
            <Link to="/orders" className="shrink-0 text-sm font-bold text-violet-700 hover:underline dark:text-violet-300">View all</Link>
          </div>
          <div className="mt-5 divide-y divide-slate-100 dark:divide-white/10">
            {ordersLoading ? <p className="py-5 text-sm text-slate-500">Loading orders…</p>
              : ordersError ? <p className="py-5 text-sm text-slate-500">Orders are unavailable right now. <Link to="/orders" className="font-semibold text-violet-700 underline dark:text-violet-300">Open order history</Link></p>
                : orders.length === 0 ? <div className="flex items-center gap-3 py-5"><Package className="h-8 w-8 text-violet-500" /><p className="text-sm text-slate-600 dark:text-slate-400">No orders yet. <Link to="/products" className="font-semibold text-violet-700 underline dark:text-violet-300">Browse products</Link></p></div>
                  : orders.map((order) => (
                    <Link key={order.id} to="/orders" className="flex items-center gap-3 py-4 transition hover:bg-slate-50 dark:hover:bg-white/5">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200"><Package className="h-5 w-5" /></span>
                      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{order.product_name || 'Order'}</span><span className="block text-xs text-slate-500 dark:text-slate-400">{orderDate(order.created_at)}</span></span>
                      <span className="text-right"><span className="block text-sm font-bold">{showBalances ? formatPrice(Number(order.amount || 0)) : '••••'}</span><span className="block text-xs capitalize text-slate-500 dark:text-slate-400">{order.status}</span></span>
                    </Link>
                  ))}
          </div>
        </section>
      </main>
    </div>
  )
}
