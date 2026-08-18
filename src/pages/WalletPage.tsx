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
  Filter,
  Headphones,
  Home,
  Landmark,
  Plus,
  Receipt,
  RefreshCw,
  Send,
  ShieldCheck,
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
  const { user, walletBalance, walletLoading, refreshWalletBalance } = useAuth()
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

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_18%_0%,rgba(168,85,247,0.12),transparent_30rem),linear-gradient(180deg,#f8fafc_0%,#eef2f7_100%)] text-slate-950 dark:bg-[radial-gradient(circle_at_18%_0%,rgba(126,51,231,0.18),transparent_30rem),linear-gradient(180deg,#05070d_0%,#07111d_100%)] dark:text-white">
      <Navbar />

      <main className="mx-auto w-full max-w-7xl px-4 pb-10 pt-5 sm:px-6 lg:px-8">
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
              <article className="relative overflow-hidden rounded-xl border border-purple-200/70 bg-gradient-to-br from-purple-800 via-purple-700 to-violet-950 p-5 text-white shadow-[0_24px_70px_rgba(126,51,231,0.28)] dark:border-purple-300/20">
                <div className="absolute -right-10 -top-10 h-44 w-44 rounded-full bg-purple-300/20 blur-2xl" />
                <div className="relative z-10 flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-black text-purple-100">
                      Your Balance
                      <Eye className="h-4 w-4" />
                    </div>
                    <div className="mt-5 text-4xl font-black tracking-normal sm:text-5xl">
                      {walletLoading ? (
                        <span className="inline-block h-10 w-48 rounded-lg bg-white/20 animate-pulse" />
                      ) : (
                        formatPrice(walletBalance)
                      )}
                    </div>
                    <p className="mt-2 text-sm font-semibold text-purple-100/85">Available Balance</p>
                    <div className="mt-5 max-w-48">
                      <TopUpWallet
                        onSuccess={handleTopUpSuccess}
                        triggerClassName="h-11 w-full rounded-lg bg-white/15 text-white hover:bg-white/25"
                        triggerChildren={(
                          <>
                            Add Funds
                            <Plus className="h-4 w-4" />
                          </>
                        )}
                      />
                    </div>
                  </div>

                  <div className="hidden h-32 w-32 shrink-0 place-items-center rounded-3xl bg-black/15 ring-1 ring-white/10 sm:grid">
                    <div className="relative grid h-24 w-24 place-items-center rounded-2xl bg-gradient-to-br from-purple-300 to-violet-700 shadow-2xl">
                      <Wallet className="h-11 w-11" />
                      <span className="absolute -bottom-3 -right-3 grid h-12 w-12 place-items-center rounded-full bg-purple-500 text-2xl font-black shadow-xl">
                        ₦
                      </span>
                    </div>
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
                  <strong className="text-purple-600 dark:text-purple-300">{walletLoading ? '...' : formatPrice(walletBalance)}</strong>
                </div>
                <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-white/10">
                  <span className="text-slate-600 dark:text-slate-400">Pending Balance</span>
                  <strong className="text-amber-600 dark:text-amber-400">{formatPrice(pendingBalance)}</strong>
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

      <Footer />
    </div>
  )
}
