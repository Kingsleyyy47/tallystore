import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { 
  Wallet, 
  History, 
  Plus, 
  ArrowUpRight, 
  ArrowDownRight, 
  Calendar,
  CheckCircle,
  Clock,
  XCircle
} from 'lucide-react'
import Navbar from '@/components/NavbarAuth'
import Footer from '@/components/Footer'
import { TopUpWallet } from '@/components/TopUpWallet'
import { PaymentVerificationCard } from '@/components/PaymentVerificationCard'
import { useAuth } from '@/contexts/SimpleAuth'
import { useCurrency } from '@/contexts/CurrencyContext'
import { useToast } from '@/hooks/use-toast'
import { getUserTransactions } from '@/lib/supabase'

export default function WalletPage() {
  const { user, walletBalance, walletLoading, refreshWalletBalance } = useAuth()
  const { formatPrice } = useCurrency()
  const { toast } = useToast()
  const [transactions, setTransactions] = useState<any[]>([])
  const [isLoadingTransactions, setIsLoadingTransactions] = useState(false)
  
  // Payment status checking is handled by GlobalPaymentChecker (app-level)

  // Load user transactions
  const loadTransactions = async () => {
    if (!user?.id) return
    
    setIsLoadingTransactions(true)
    try {
      const userTransactions = await getUserTransactions(user.id)
      console.log('📊 Raw transactions from database:', userTransactions);
      console.log('📊 Number of transactions:', userTransactions.length);
      console.log('📊 Transaction types:', userTransactions.map(t => ({ id: t.id, type: t.type, amount: t.amount, status: t.status, created_at: t.created_at })));
      setTransactions(userTransactions)
    } catch (error) {
      console.error('Failed to load transactions:', error)
      toast({
        title: "Error",
        description: "Failed to load transaction history.",
        variant: "destructive",
      })
    } finally {
      setIsLoadingTransactions(false)
    }
  }

  useEffect(() => {
    if (user) {
      refreshWalletBalance()
      loadTransactions()
    }
  }, [user, refreshWalletBalance])

  // Listen for transaction updates
  useEffect(() => {
    const handleTransactionUpdate = () => {
      console.log('🔄 Transaction update detected, reloading...');
      loadTransactions();
    };

    window.addEventListener('transactionAdded', handleTransactionUpdate);
    return () => window.removeEventListener('transactionAdded', handleTransactionUpdate);
  }, [loadTransactions])

  // Calculate totals from real transactions
  const totalTopups = transactions
    .filter(t => t.type === 'topup' && t.status === 'completed')
    .reduce((sum, t) => sum + t.amount, 0)
    
  const totalSpent = Math.abs(transactions
    .filter(t => t.type === 'purchase' && t.status === 'completed')
    .reduce((sum, t) => sum + t.amount, 0))

  console.log('💰 Calculated totals - Topups:', totalTopups, 'Spent:', totalSpent);
  console.log('📋 Current transactions:', transactions);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-500" />
      case 'pending':
        return <Clock className="h-4 w-4 text-yellow-500" />
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />
      default:
        return <Clock className="h-4 w-4 text-gray-400" />
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted/20">
      <Navbar />
      
      <div className="container mx-auto px-6 py-8">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold mb-2">Wallet Management</h1>
            <p className="text-muted-foreground">
              Manage your wallet balance and view transaction history
            </p>
          </div>

          {/* Wallet Overview Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <Card className="bg-gradient-to-br from-primary to-primary/80 text-white">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between">
                  <span>Current Balance</span>
                  <Wallet className="h-5 w-5" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold mb-1">
                  {walletLoading ? (
                    <span className="inline-block h-8 w-32 bg-white/20 rounded animate-pulse" />
                  ) : (
                    <>{formatPrice(walletBalance)}</>
                  )}
                </div>
                <p className="text-white/80 text-sm">
                  Available for purchases
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-green-600">
                  <span>Total Top-ups</span>
                  <ArrowUpRight className="h-5 w-5" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold mb-1">
                  ₦{totalTopups.toLocaleString()}
                </div>
                <p className="text-muted-foreground text-sm">
                  Lifetime deposits
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-blue-600">
                  <span>Total Spent</span>
                  <ArrowDownRight className="h-5 w-5" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold mb-1">
                  {formatPrice(totalSpent)}
                </div>
                <p className="text-muted-foreground text-sm">
                  On purchases
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Payment Verification */}
          <PaymentVerificationCard />

          {/* Main Content */}
          <Tabs defaultValue="topup" className="space-y-6">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="topup">Top Up Wallet</TabsTrigger>
              <TabsTrigger value="history">Transaction History</TabsTrigger>
            </TabsList>

            {/* Top-up Tab */}
            <TabsContent value="topup" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Plus className="h-5 w-5" />
                    Add Money to Wallet
                  </CardTitle>
                  <p className="text-muted-foreground">
                    Minimum top-up amount is ₦100. Payments are processed securely via Ercas Pay.
                  </p>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex flex-col items-center justify-center py-8">
                    <TopUpWallet onSuccess={() => {
                      refreshWalletBalance();
                      loadTransactions(); // Reload transactions after successful payment
                      toast({
                        title: "Wallet Updated",
                        description: "Your wallet balance has been updated successfully!",
                      });
                    }} />
                    <p className="text-sm text-muted-foreground mt-4 text-center">
                      🔒 Secure payments powered by Ercas Pay<br />
                      Supports Cards, Bank Transfer, USSD & QR Code
                    </p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* History Tab */}
            <TabsContent value="history" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <History className="h-5 w-5" />
                    Transaction History
                  </CardTitle>
                  <p className="text-muted-foreground">
                    Complete history of all wallet transactions
                  </p>
                </CardHeader>
                <CardContent>
                  {isLoadingTransactions ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="text-muted-foreground">Loading transactions...</div>
                    </div>
                  ) : transactions.length === 0 ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="text-center">
                        <History className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                        <p className="text-muted-foreground">No transactions yet</p>
                        <p className="text-sm text-muted-foreground">Your wallet activity will appear here</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {transactions.map((transaction) => (
                        <div
                          key={transaction.id}
                          className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                        >
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                              {transaction.type === 'topup' ? (
                                <ArrowUpRight className="h-5 w-5 text-green-600" />
                              ) : (
                                <ArrowDownRight className="h-5 w-5 text-red-600" />
                              )}
                            </div>
                            
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-medium">
                                  {transaction.type === 'topup' ? 'Wallet Top-up' : 'Purchase'}
                                </span>
                                {getStatusIcon(transaction.status)}
                              </div>
                              <p className="text-sm text-muted-foreground">
                                {transaction.type === 'topup' 
                                  ? 'Wallet top-up via Ercas Pay' 
                                  : 'Account purchase'
                                }
                              </p>
                              <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
                                <span className="flex items-center gap-1">
                                  <Calendar className="h-3 w-3" />
                                  {new Date(transaction.created_at).toLocaleDateString()}
                                </span>
                                <span>Ref: {transaction.reference}</span>
                                {transaction.ercas_reference && (
                                  <span>Ercas: {transaction.ercas_reference}</span>
                                )}
                              </div>
                            </div>
                          </div>
                          
                          <div className="text-right">
                            <div className={`text-lg font-semibold ${
                              transaction.amount > 0 ? 'text-green-600' : 'text-red-600'
                            }`}>
                              {transaction.amount > 0 ? '+' : ''}₦{Math.abs(transaction.amount).toLocaleString()}
                            </div>
                            <Badge 
                              variant={
                                transaction.status === 'completed' ? 'default' :
                                transaction.status === 'pending' ? 'secondary' : 'destructive'
                              }
                              className="text-xs"
                            >
                              {transaction.status}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <Footer />
    </div>
  )
}
