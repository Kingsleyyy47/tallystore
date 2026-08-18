import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  ArrowDownRight,
  ArrowUpRight,
  Calendar,
  CheckCircle,
  Clock,
  CreditCard,
  Download,
  Eye,
  EyeOff,
  Filter,
  Headphones,
  Home,
  Landmark,
  LayoutGrid,
  Plus,
  Receipt,
  RefreshCw,
  Send,
  ShieldCheck,
  PackageCheck,
  User,
  Wallet,
  XCircle,
} from 'lucide-react'
import Navbar from '@/components/NavbarAuth'
import Footer from '@/components/Footer'
import { TopUpWallet } from '@/components/TopUpWallet'
import { PaymentVerificationCard } from '@/components/PaymentVerificationCard'
import { useAuth } from '@/contexts/SimpleAuth'
import { useCurrency } from '@/contexts/CurrencyContext'
import { useToast } from '@/hooks/use-toast'
import { getUserTransactions } from '@/lib/supabase'

type WalletTab = 'all' | 'funding' | 'purchase' | 'withdrawal'

const quickAmounts = [5000, 10000, 20000, 50000, 100000]

const classifyTransaction = (transaction: any): WalletTab => {
  const type = String(transaction.type || '').toLowerCase()
  if (type.includes('withdraw')) return 'withdrawal'
  if (type.includes('purchase') || type.includes('order') || Number(transaction.amount) < 0) return 'purchase'
  return 'funding'
}

const getTransactionTitle = (transaction: any) => {
  const kind = classifyTransaction(transaction)
  if (kind === 'funding') return 'Added funds'
  if (kind === 'withdrawal') return 'Withdrawal'
  return 'Purchase'
}

const getStatusIcon = (status: string) => {
  switch (status) {
    case 'completed':
    case 'success':
      return <CheckCircle className="h-4 w-4 text-emerald-500" />
    case 'pending':
    case 'processing':
      return <Clock className="h-4 w-4 text-amber-500" />
    case 'failed':
    case 'cancelled':
      return <XCircle className="h-4 w-4 text-red-500" />
    default:
      return <Clock className="h-4 w-4 text-slate-400" />
  }
}

const getStatusBadgeClass = (status: string) => {
  switch (status) {
    case 'completed':
    case 'success':
      return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
    case 'pending':
    case 'processing':
      return 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
    case 'failed':
    case 'cancelled':
      return 'bg-red-500/10 text-red-600 dark:text-red-400'
    default:
      return 'bg-slate-500/10 text-slate-600 dark:text-slate-400'
  }
}

const formatDateTime = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown date'
  return date.toLocaleString('en-NG', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function WalletPage() {
  const { user, walletBalance, walletLoading, refreshWalletBalance, showBalances, toggleBalanceVisibility } = useAuth()
  const { formatPrice } = useCurrency()
  const { toast } = useToast()
  const [transactions, setTransactions] = useState<any[]>([])
  const [isLoadingTransactions, setIsLoadingTransactions] = useState(false)
  const [activeTab, setActiveTab] = useState<WalletTab>('all')

  const loadTransactions = useCallback(async () => {
    if (!user?.id) return

    setIsLoadingTransactions(true)
    try {
      const userTransactions = await getUserTransactions(user.id)
      setTransactions(userTransactions)
    } catch (error) {
      console.error('Failed to load transactions:', error)
      toast({
        title: 'Error',
        description: 'Failed to load transaction history.',
        variant: 'destructive',
      })
    } finally {
      setIsLoadingTransactions(false)
    }
  }, [toast, user?.id])

  useEffect(() => {
    if (user) {
      refreshWalletBalance()
      loadTransactions()
    }
  }, [user, refreshWalletBalance, loadTransactions])

  useEffect(() => {
    const handleTransactionUpdate = () => {
      loadTransactions()
      refreshWalletBalance()
    }

    window.addEventListener('transactionAdded', handleTransactionUpdate)
    return () => window.removeEventListener('transactionAdded', handleTransactionUpdate)
  }, [loadTransactions, refreshWalletBalance])

  const totalTopups = useMemo(
    () =>
      transactions
        .filter((transaction) => classifyTransaction(transaction) === 'funding' && ['completed', 'success'].includes(String(transaction.status).toLowerCase()))
        .reduce((sum, transaction) => sum + Math.abs(Number(transaction.amount) || 0), 0),
    [transactions],
  )

  const pendingBalance = useMemo(
    () =>
      transactions
        .filter((transaction) => classifyTransaction(transaction) === 'funding' && ['pending', 'processing'].includes(String(transaction.status).toLowerCase()))
        .reduce((sum, transaction) => sum + Math.abs(Number(transaction.amount) || 0), 0),
    [transactions],
  )

  const totalSpent = useMemo(
    () =>
      transactions
        .filter((transaction) => classifyTransaction(transaction) === 'purchase' && ['completed', 'success'].includes(String(transaction.status).toLowerCase()))
        .reduce((sum, transaction) => sum + Math.abs(Number(transaction.amount) || 0), 0),
    [transactions],
  )

  const filteredTransactions = useMemo(() => {
    if (activeTab === 'all') return transactions
    return transactions.filter((transaction) => classifyTransaction(transaction) === activeTab)
  }, [activeTab, transactions])

  const handleDownload = () => {
    if (transactions.length === 0) return

    const rows = [
      ['Transaction', 'Type', 'Amount', 'Status', 'Reference', 'Date'],
      ...transactions.map((transaction) => [
        getTransactionTitle(transaction),
        classifyTransaction(transaction),
        String(transaction.amount ?? 0),
        String(transaction.status || ''),
        String(transaction.reference || transaction.ercas_reference || transaction.id || ''),
        formatDateTime(transaction.created_at),
      ]),
    ]
    const csv = rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'tallystore-wallet-transactions.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const handleTopUpSuccess = () => {
    refreshWalletBalance()
    loadTransactions()
    toast({
      title: 'Wallet Updated',
      description: 'Your wallet balance has been updated successfully.',
    })
  }

  const walletBalanceDisplay = showBalances ? formatPrice(walletBalance) : '***'
  const pendingBalanceDisplay = showBalances ? formatPrice(pendingBalance) : '***'

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_18%_0%,rgba(168,85,247,0.12),transparent_30rem),linear-gradient(180deg,#f8fafc_0%,#eef2f7_100%)] text-slate-950 dark:bg-[radial-gradient(circle_at_18%_0%,rgba(126,51,231,0.18),transparent_30rem),linear-gradient(180deg,#05070d_0%,#07111d_100%)] dark:text-white">
      <Navbar />

      <main className="mx-auto w-full max-w-7xl px-4 pb-28 pt-5 sm:px-6 md:pb-10 lg:px-8">
        <div className="mb-5 flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
          <Link to="/" className="inline-flex items-center gap-1 transition hover:text-purple-600 dark:hover:text-purple-300">
            <Home className="h-3.5 w-3.5" />
            Home
          </Link>
          <span>/</span>
          <span className="text-slate-800 dark:text-slate-200">Wallet</span>
        </div>

        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-black tracking-normal sm:text-4xl">My Wallet</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
              Manage your balance, payment methods, and transaction history.
            </p>
          </div>
          <Button variant="outline" onClick={() => {
            refreshWalletBalance()
            loadTransactions()
          }}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_310px]">
          <section className="space-y-6">
            <div className="grid gap-4 lg:grid-cols-[1.25fr_0.9fr]">
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
                    ₦
                  </span>
                </div>

                <div className="relative z-10 max-w-[62%] sm:max-w-[58%]">
                    <div className="flex items-center gap-2 text-xs font-black text-purple-100 sm:text-sm">
                      Your Balance
                      <button
                        type="button"
                        onClick={toggleBalanceVisibility}
                        className="grid h-7 w-7 place-items-center rounded-full text-purple-100 transition hover:bg-white/10 hover:text-white"
                        aria-label={showBalances ? 'Hide balances' : 'Show balances'}
                      >
                        {showBalances ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                    <div className="mt-3 text-3xl font-black tracking-normal sm:mt-5 sm:text-5xl">
                      {walletLoading ? (
                        <span className="inline-block h-9 w-40 rounded-lg bg-white/20 animate-pulse" />
                      ) : (
                        walletBalanceDisplay
                      )}
                    </div>
                    <p className="mt-2 text-xs font-bold text-purple-100/85 sm:text-sm">Available Balance</p>
                    <div className="mt-4 max-w-48 sm:mt-5">
                      <TopUpWallet
                        onSuccess={handleTopUpSuccess}
                        triggerClassName="h-10 w-full rounded-lg bg-purple-500 text-sm font-black text-white hover:bg-purple-400 sm:h-11"
                        triggerChildren={(
                          <>
                            Add Funds
                            <Plus className="h-4 w-4" />
                          </>
                        )}
                      />
                    </div>
                </div>
              </article>

              <div className="grid gap-3 sm:grid-cols-2">
                <TopUpWallet
                  onSuccess={handleTopUpSuccess}
                  triggerVariant="outline"
                  triggerSize="default"
                  triggerClassName="h-auto min-h-[86px] justify-start rounded-xl border-slate-200 bg-white/85 p-4 text-left shadow-sm hover:bg-white dark:border-white/10 dark:bg-white/[0.035] dark:hover:bg-white/[0.06]"
                  triggerChildren={(
                    <span className="flex items-center gap-3">
                      <span className="grid h-11 w-11 place-items-center rounded-full border border-purple-300/40 text-purple-600 dark:text-purple-300">
                        <Plus className="h-5 w-5" />
                      </span>
                      <span>
                        <strong className="block text-sm text-slate-950 dark:text-white">Add Funds</strong>
                        <small className="mt-1 block text-slate-500 dark:text-slate-400">Fund your wallet</small>
                      </span>
                    </span>
                  )}
                />

                <Link
                  to="/support"
                  className="flex min-h-[86px] items-center gap-3 rounded-xl border border-slate-200 bg-white/85 p-4 shadow-sm transition hover:bg-white dark:border-white/10 dark:bg-white/[0.035] dark:hover:bg-white/[0.06]"
                >
                  <span className="grid h-11 w-11 place-items-center rounded-full border border-purple-300/40 text-purple-600 dark:text-purple-300">
                    <ArrowUpRight className="h-5 w-5" />
                  </span>
                  <span>
                    <strong className="block text-sm">Withdraw</strong>
                    <small className="mt-1 block text-slate-500 dark:text-slate-400">Request support</small>
                  </span>
                </Link>

                <Link
                  to="/support"
                  className="flex min-h-[86px] items-center gap-3 rounded-xl border border-slate-200 bg-white/85 p-4 shadow-sm transition hover:bg-white dark:border-white/10 dark:bg-white/[0.035] dark:hover:bg-white/[0.06]"
                >
                  <span className="grid h-11 w-11 place-items-center rounded-full border border-purple-300/40 text-purple-600 dark:text-purple-300">
                    <Send className="h-5 w-5" />
                  </span>
                  <span>
                    <strong className="block text-sm">Transfer</strong>
                    <small className="mt-1 block text-slate-500 dark:text-slate-400">Ask support</small>
                  </span>
                </Link>

                <Link
                  to="/profile"
                  className="flex min-h-[86px] items-center gap-3 rounded-xl border border-slate-200 bg-white/85 p-4 shadow-sm transition hover:bg-white dark:border-white/10 dark:bg-white/[0.035] dark:hover:bg-white/[0.06]"
                >
                  <span className="grid h-11 w-11 place-items-center rounded-full border border-purple-300/40 text-purple-600 dark:text-purple-300">
                    <CreditCard className="h-5 w-5" />
                  </span>
                  <span>
                    <strong className="block text-sm">Payment Methods</strong>
                    <small className="mt-1 block text-slate-500 dark:text-slate-400">Manage account</small>
                  </span>
                </Link>
              </div>
            </div>

            <PaymentVerificationCard />

            <article className="overflow-hidden rounded-xl border border-slate-200 bg-white/85 shadow-sm dark:border-white/10 dark:bg-white/[0.035]">
              <div className="flex flex-col gap-4 border-b border-slate-200 p-4 dark:border-white/10 md:flex-row md:items-center md:justify-between">
                <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as WalletTab)}>
                  <TabsList className="grid w-full grid-cols-4 bg-slate-100 dark:bg-white/5 md:w-auto">
                    <TabsTrigger value="all">Transactions</TabsTrigger>
                    <TabsTrigger value="funding">Funding</TabsTrigger>
                    <TabsTrigger value="purchase">Purchases</TabsTrigger>
                    <TabsTrigger value="withdrawal">Withdrawals</TabsTrigger>
                  </TabsList>
                </Tabs>

                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm">
                    <Filter className="h-4 w-4" />
                    Filter
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleDownload} disabled={transactions.length === 0}>
                    <Download className="h-4 w-4" />
                    Download
                  </Button>
                </div>
              </div>

              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-white/10 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-3 font-black">Transaction</th>
                      <th className="px-4 py-3 font-black">Type</th>
                      <th className="px-4 py-3 font-black">Amount</th>
                      <th className="px-4 py-3 font-black">Status</th>
                      <th className="px-4 py-3 font-black">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoadingTransactions ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-12 text-center text-slate-500 dark:text-slate-400">
                          Loading transactions...
                        </td>
                      </tr>
                    ) : filteredTransactions.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-12 text-center text-slate-500 dark:text-slate-400">
                          No wallet transactions found.
                        </td>
                      </tr>
                    ) : (
                      filteredTransactions.slice(0, 12).map((transaction) => {
                        const kind = classifyTransaction(transaction)
                        const amount = Math.abs(Number(transaction.amount) || 0)
                        const isCredit = kind === 'funding'
                        return (
                          <tr key={transaction.id} className="border-b border-slate-200/70 last:border-b-0 dark:border-white/10">
                            <td className="px-4 py-4">
                              <div className="flex items-center gap-3">
                                <span className="grid h-10 w-10 place-items-center rounded-lg bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300">
                                  {isCredit ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                                </span>
                                <span>
                                  <strong className="block text-slate-950 dark:text-white">{getTransactionTitle(transaction)}</strong>
                                  <small className="mt-1 block text-slate-500 dark:text-slate-400">
                                    Ref: {transaction.reference || transaction.ercas_reference || String(transaction.id).slice(0, 10)}
                                  </small>
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-4">
                              <Badge variant="outline" className="capitalize">{kind}</Badge>
                            </td>
                            <td className={`px-4 py-4 font-black ${isCredit ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                              {isCredit ? '+' : '-'}{formatPrice(amount)}
                            </td>
                            <td className="px-4 py-4">
                              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-black capitalize ${getStatusBadgeClass(String(transaction.status).toLowerCase())}`}>
                                {getStatusIcon(String(transaction.status).toLowerCase())}
                                {transaction.status || 'unknown'}
                              </span>
                            </td>
                            <td className="px-4 py-4 text-slate-600 dark:text-slate-400">
                              {formatDateTime(transaction.created_at)}
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div className="grid gap-3 p-4 md:hidden">
                {isLoadingTransactions ? (
                  <div className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">Loading transactions...</div>
                ) : filteredTransactions.length === 0 ? (
                  <div className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">No wallet transactions found.</div>
                ) : (
                  filteredTransactions.slice(0, 8).map((transaction) => {
                    const kind = classifyTransaction(transaction)
                    const amount = Math.abs(Number(transaction.amount) || 0)
                    const isCredit = kind === 'funding'
                    return (
                      <div key={transaction.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/[0.035]">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3">
                            <span className="grid h-10 w-10 place-items-center rounded-lg bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300">
                              {isCredit ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                            </span>
                            <div>
                              <strong className="block text-sm">{getTransactionTitle(transaction)}</strong>
                              <span className="mt-1 flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                                <Calendar className="h-3 w-3" />
                                {formatDateTime(transaction.created_at)}
                              </span>
                            </div>
                          </div>
                          <span className={`text-sm font-black ${isCredit ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                            {isCredit ? '+' : '-'}{formatPrice(amount)}
                          </span>
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-2">
                          <Badge variant="outline" className="capitalize">{kind}</Badge>
                          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-black capitalize ${getStatusBadgeClass(String(transaction.status).toLowerCase())}`}>
                            {getStatusIcon(String(transaction.status).toLowerCase())}
                            {transaction.status || 'unknown'}
                          </span>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </article>
          </section>

          <aside className="space-y-5">
            <article className="rounded-xl border border-slate-200 bg-white/85 p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.035]">
              <h2 className="text-lg font-black">Wallet Overview</h2>
              <div className="mt-5 space-y-4 text-sm">
                <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-white/10">
                  <span className="text-slate-600 dark:text-slate-400">Available Balance</span>
                  <strong className="text-purple-600 dark:text-purple-300">{walletLoading ? '...' : walletBalanceDisplay}</strong>
                </div>
                <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-white/10">
                  <span className="text-slate-600 dark:text-slate-400">Pending Balance</span>
                  <strong className="text-amber-600 dark:text-amber-400">{pendingBalanceDisplay}</strong>
                </div>
                <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-white/10">
                  <span className="text-slate-600 dark:text-slate-400">Total Deposits</span>
                  <strong className="text-emerald-600 dark:text-emerald-400">{formatPrice(totalTopups)}</strong>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600 dark:text-slate-400">Total Spent</span>
                  <strong className="text-red-600 dark:text-red-400">{formatPrice(totalSpent)}</strong>
                </div>
              </div>
            </article>

            <article className="rounded-xl border border-slate-200 bg-white/85 p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.035]">
              <h2 className="text-lg font-black">Quick Top Up</h2>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {quickAmounts.map((amount) => (
                  <TopUpWallet
                    key={amount}
                    initialAmount={amount}
                    onSuccess={handleTopUpSuccess}
                    triggerVariant="outline"
                    triggerSize="sm"
                    triggerClassName="h-11 rounded-lg border-slate-200 bg-slate-50 text-xs font-black hover:bg-white dark:border-white/10 dark:bg-white/[0.035] dark:hover:bg-white/[0.08]"
                    triggerChildren={formatPrice(amount)}
                  />
                ))}
              </div>
              <div className="mt-3">
                <TopUpWallet
                  onSuccess={handleTopUpSuccess}
                  triggerClassName="h-11 w-full rounded-lg bg-gradient-to-r from-purple-500 to-violet-700 text-white shadow-lg hover:from-purple-400 hover:to-violet-600"
                  triggerChildren="Top Up Now"
                />
              </div>
            </article>

            <article className="rounded-xl border border-slate-200 bg-white/85 p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.035]">
              <div className="flex items-start gap-4">
                <span className="grid h-12 w-12 place-items-center rounded-xl bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300">
                  <Headphones className="h-6 w-6" />
                </span>
                <div>
                  <h2 className="text-lg font-black">Need Help?</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
                    Our support team can help with funding delays, transfers, and payment checks.
                  </p>
                </div>
              </div>
              <Link
                to="/support"
                className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-slate-200 text-sm font-black text-purple-700 transition hover:bg-purple-50 dark:border-white/10 dark:text-purple-300 dark:hover:bg-white/[0.06]"
              >
                Contact Support
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </article>

            <article className="rounded-xl border border-slate-200 bg-white/85 p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.035]">
              <div className="grid gap-3 text-sm">
                <div className="flex items-center gap-3">
                  <Landmark className="h-5 w-5 text-purple-600 dark:text-purple-300" />
                  <span>Bank transfer top-ups credit automatically.</span>
                </div>
                <div className="flex items-center gap-3">
                  <ShieldCheck className="h-5 w-5 text-purple-600 dark:text-purple-300" />
                  <span>Payments are checked against gateway records.</span>
                </div>
                <div className="flex items-center gap-3">
                  <Receipt className="h-5 w-5 text-purple-600 dark:text-purple-300" />
                  <span>Every wallet movement stays in your history.</span>
                </div>
              </div>
            </article>
          </aside>
        </div>
      </main>

      <nav className="fixed bottom-3 left-1/2 z-40 grid h-16 w-[min(390px,calc(100%-28px))] -translate-x-1/2 grid-cols-5 rounded-2xl border border-slate-200 bg-white/95 text-[11px] font-bold text-slate-600 shadow-2xl backdrop-blur dark:border-white/10 dark:bg-[#070a12]/95 dark:text-slate-400 md:hidden">
        <Link to="/" className="grid place-items-center hover:text-slate-950 dark:hover:text-white">
          <Home className="h-5 w-5" />
          Home
        </Link>
        <Link to="/products" className="grid place-items-center hover:text-slate-950 dark:hover:text-white">
          <LayoutGrid className="h-5 w-5" />
          Products
        </Link>
        <Link to="/wallet" className="grid place-items-center text-purple-600 dark:text-purple-400">
          <Wallet className="h-5 w-5" />
          Wallet
        </Link>
        <Link to="/orders" className="grid place-items-center hover:text-slate-950 dark:hover:text-white">
          <PackageCheck className="h-5 w-5" />
          Orders
        </Link>
        <Link to="/profile" className="grid place-items-center hover:text-slate-950 dark:hover:text-white">
          <User className="h-5 w-5" />
          Account
        </Link>
      </nav>

      <Footer />
    </div>
  )
}
