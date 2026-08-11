import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Bitcoin, 
  ArrowDownCircle, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  AlertCircle,
  Copy,
  ExternalLink,
  Loader2,
  History,
  TrendingDown,
  Banknote,
  RefreshCw,
  Zap
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import QRCode from "react-qr-code";

interface CryptoTransaction {
  id: string;
  crypto_type: string;
  crypto_amount: number;
  naira_amount: number;
  rate: number;
  status: string; // pending, processing, completed, failed, expired, refunded, partially_paid
  transaction_type: string;
  payment_provider: string;
  
  // NowPayments fields
  nowpayments_payment_id?: string;
  nowpayments_purchase_id?: string;
  nowpayments_pay_address?: string;
  nowpayments_payin_extra_id?: string | null; // Memo/Tag for XRP, XLM, EOS
  nowpayments_network?: string;
  nowpayments_smart_contract?: string | null;
  nowpayments_amount_received?: number | null;
  actually_paid?: number;
  outcome_amount?: number;
  outcome_currency?: string;
  payment_type?: string;
  burning_percent?: number | null;
  expiration_date?: string;
  fixed_rate_valid_until?: string;
  payout_hash?: string | null;
  payment_extra_ids?: string | null; // JSON array of child payment IDs
  parent_payment_id?: number | null;
  origin_type?: string | null;
  
  payment_reference?: string;
  created_at: string;
  updated_at?: string;
}

interface CryptoWithdrawal {
  id: string;
  amount: number;
  fee: number;
  net_amount: number;
  bank_name: string;
  account_number: string;
  account_name: string;
  status: string; // pending, processing, completed, failed
  payment_reference: string | null;
  
  // SageCloud fields
  sagecloud_reference?: string | null;
  sagecloud_session_id?: string | null;
  sagecloud_response?: any;
  
  created_at: string;
  processed_at: string | null;
}

export default function CryptoHistory() {
  const [transactions, setTransactions] = useState<CryptoTransaction[]>([]);
  const [withdrawals, setWithdrawals] = useState<CryptoWithdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<CryptoTransaction | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    fetchHistory();
    
    // Auto-refresh every 30 seconds for pending transactions
    const interval = setInterval(() => {
      fetchHistory(true);
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  const fetchHistory = async (silent = false) => {
    try {
      if (!silent) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate('/login');
        return;
      }

      // Fetch crypto transactions
      const { data: txData, error: txError } = await supabase
        .from('crypto_transactions')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (txError) throw txError;
      setTransactions(txData || []);

      // Fetch withdrawals
      const { data: wdData, error: wdError } = await supabase
        .from('crypto_withdrawals')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (wdError) throw wdError;
      setWithdrawals(wdData || []);

    } catch (error: any) {
      console.error('Error fetching history:', error);
      if (!silent) {
        toast({
          title: "Error",
          description: "Failed to load transaction history",
          variant: "destructive",
        });
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { variant: any; icon: any; label: string; color?: string }> = {
      pending: { 
        variant: "secondary", 
        icon: Clock, 
        label: "Awaiting Payment",
        color: "text-yellow-700"
      },
      processing: { 
        variant: "default", 
        icon: Loader2, 
        label: "Confirming",
        color: "text-blue-700"
      },
      completed: { 
        variant: "default", 
        icon: CheckCircle2, 
        label: "Completed",
        color: "text-green-700"
      },
      failed: { 
        variant: "destructive", 
        icon: XCircle, 
        label: "Failed"
      },
      expired: { 
        variant: "destructive", 
        icon: XCircle, 
        label: "Expired"
      },
      refunded: { 
        variant: "secondary", 
        icon: AlertCircle, 
        label: "Refunded",
        color: "text-orange-700"
      },
      partially_paid: { 
        variant: "secondary", 
        icon: AlertCircle, 
        label: "Partial Payment",
        color: "text-orange-700"
      },
    };

    const config = statusConfig[status] || { 
      variant: "secondary", 
      icon: Clock, 
      label: status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ')
    };
    const Icon = config.icon;

    return (
      <Badge variant={config.variant} className={`gap-1 ${config.color || ''}`}>
        <Icon className={`w-3 h-3 ${status === 'processing' ? 'animate-spin' : ''}`} />
        {config.label}
      </Badge>
    );
  };

  const getCryptoIcon = (crypto: string) => {
    return <Bitcoin className="w-4 h-4 text-primary" />;
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: "Copied! ✅",
        description: `${label} copied to clipboard`,
      });
    } catch (error) {
      toast({
        title: "Copy Failed",
        description: "Please copy manually",
        variant: "destructive",
      });
    }
  };

  const getExplorerUrl = (network: string, hash: string): string => {
    const explorers: Record<string, string> = {
      btc: `https://mempool.space/tx/${hash}`,
      bitcoin: `https://mempool.space/tx/${hash}`,
      trc20: `https://tronscan.org/#/transaction/${hash}`,
      tron: `https://tronscan.org/#/transaction/${hash}`,
      erc20: `https://etherscan.io/tx/${hash}`,
      ethereum: `https://etherscan.io/tx/${hash}`,
      bep20: `https://bscscan.com/tx/${hash}`,
      bsc: `https://bscscan.com/tx/${hash}`,
      polygon: `https://polygonscan.com/tx/${hash}`,
      sol: `https://solscan.io/tx/${hash}`,
      solana: `https://solscan.io/tx/${hash}`,
      xrp: `https://xrpscan.com/tx/${hash}`,
      ripple: `https://xrpscan.com/tx/${hash}`,
    };
    return explorers[network.toLowerCase()] || `https://blockchain.info/tx/${hash}`;
  };

  const getNetworkName = (network: string): string => {
    if (!network) return 'Unknown';
    
    const names: Record<string, string> = {
      btc: "Bitcoin",
      bitcoin: "Bitcoin",
      trc20: "TRON (TRC20)",
      tron: "TRON",
      erc20: "Ethereum (ERC20)",
      ethereum: "Ethereum",
      bep20: "BSC (BEP20)",
      bsc: "BSC",
      polygon: "Polygon",
      sol: "Solana",
      solana: "Solana",
      xrp: "Ripple",
      ripple: "Ripple",
      ada: "Cardano",
      cardano: "Cardano",
      ltc: "Litecoin",
      litecoin: "Litecoin",
    };
    return names[network.toLowerCase()] || network.toUpperCase();
  };

  const getTimeRemaining = (expiresAt: string): string => {
    if (!expiresAt) return "N/A";
    
    const now = new Date().getTime();
    const expires = new Date(expiresAt).getTime();
    const remaining = Math.max(0, Math.floor((expires - now) / 1000));
    
    if (remaining === 0) return "Expired";
    
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const viewTransactionDetails = (tx: CryptoTransaction) => {
    setSelectedTransaction(tx);
    setShowDetailsModal(true);
  };

  const hasChildPayments = (tx: CryptoTransaction): boolean => {
    return !!(tx.payment_extra_ids && tx.payment_extra_ids !== 'null');
  };

  const isChildPayment = (tx: CryptoTransaction): boolean => {
    return !!(tx.parent_payment_id && tx.origin_type === 'REPEATED');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background to-muted/20 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Loading transaction history...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted/20">
      {/* Navigation */}
      <nav className="border-b bg-gradient-to-r from-primary to-primary/90 shadow-lg sticky top-0 z-10">
        <div className="container mx-auto px-4 sm:px-6 py-4 sm:py-5 flex justify-between items-center">
          <Button
            variant="ghost"
            onClick={() => navigate('/dashboard')}
            className="gap-1 sm:gap-2 text-white hover:bg-white/20 hover:text-white font-medium text-sm sm:text-base"
          >
            ← <span className="hidden sm:inline">Back to Dashboard</span><span className="sm:hidden">Back</span>
          </Button>
          <div className="flex items-center gap-2 sm:gap-3">
            <History className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
            <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-white">History</h1>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => fetchHistory()}
            disabled={refreshing}
            className="text-white hover:bg-white/20"
          >
            <RefreshCw className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </nav>

      {/* Main Content */}
      <div className="container mx-auto p-4 sm:p-6 max-w-7xl">
        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <Button
            onClick={() => navigate('/crypto-exchange')}
            className="h-16 text-lg gap-3"
            size="lg"
          >
            <TrendingDown className="w-6 h-6" />
            Sell More Crypto
          </Button>
          <Button
            onClick={() => navigate('/crypto-withdrawal')}
            variant="outline"
            className="h-16 text-lg gap-3"
            size="lg"
          >
            <Banknote className="w-6 h-6" />
            Withdraw to Bank
          </Button>
        </div>

        <Tabs defaultValue="transactions" className="space-y-6">
          <TabsList className="grid w-full grid-cols-2 h-12">
            <TabsTrigger value="transactions" className="text-base gap-2">
              <ArrowDownCircle className="w-4 h-4" />
              Crypto Sales ({transactions.length})
            </TabsTrigger>
            <TabsTrigger value="withdrawals" className="text-base gap-2">
              <Banknote className="w-4 h-4" />
              Withdrawals ({withdrawals.length})
            </TabsTrigger>
          </TabsList>

          {/* Crypto Transactions Tab */}
          <TabsContent value="transactions" className="space-y-4">
            {transactions.length === 0 ? (
              <Card>
                <CardContent className="py-16 text-center">
                  <Bitcoin className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
                  <p className="text-lg font-medium mb-2">No crypto transactions yet</p>
                  <p className="text-muted-foreground mb-6">
                    Start selling your crypto to get Naira instantly
                  </p>
                  <Button onClick={() => navigate('/crypto-exchange')} size="lg">
                    <Zap className="w-4 h-4 mr-2" />
                    Sell Crypto Now
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Zap className="w-5 h-5" />
                    Crypto Sale Transactions
                  </CardTitle>
                  <CardDescription>
                    Powered by NowPayments • Track your crypto-to-Naira conversions
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Crypto</TableHead>
                          <TableHead>Amount</TableHead>
                          <TableHead>Naira Value</TableHead>
                          <TableHead>Network</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {transactions.map((tx) => (
                          <TableRow 
                            key={tx.id}
                            className={isChildPayment(tx) ? 'bg-blue-50/50' : ''}
                          >
                            <TableCell>
                              <div className="text-sm">
                                {new Date(tx.created_at).toLocaleDateString()}
                                <br />
                                <span className="text-xs text-muted-foreground">
                                  {formatDistanceToNow(new Date(tx.created_at), { addSuffix: true })}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                {getCryptoIcon(tx.crypto_type)}
                                <span className="font-medium">{tx.crypto_type.toUpperCase()}</span>
                              </div>
                            </TableCell>
                            <TableCell className="font-mono">
                              <div>
                                {tx.crypto_amount} {tx.crypto_type.toUpperCase()}
                              </div>
                              {tx.actually_paid > 0 && tx.actually_paid !== tx.crypto_amount && (
                                <div className="text-xs text-muted-foreground">
                                  Received: {tx.actually_paid}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="font-semibold text-green-600">
                              ₦{tx.naira_amount.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell>
                              <span className="text-xs text-muted-foreground">
                                {getNetworkName(tx.nowpayments_network || '')}
                              </span>
                            </TableCell>
                            <TableCell>
                              {getStatusBadge(tx.status)}
                              {hasChildPayments(tx) && (
                                <div className="mt-1">
                                  <Badge variant="outline" className="text-xs">
                                    +{JSON.parse(tx.payment_extra_ids!).length} more
                                  </Badge>
                                </div>
                              )}
                              {isChildPayment(tx) && (
                                <div className="mt-1">
                                  <Badge variant="outline" className="text-xs bg-blue-50">
                                    Repeated
                                  </Badge>
                                </div>
                              )}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => viewTransactionDetails(tx)}
                              >
                                View Details
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Withdrawals Tab */}
          <TabsContent value="withdrawals" className="space-y-4">
            {withdrawals.length === 0 ? (
              <Card>
                <CardContent className="py-16 text-center">
                  <Banknote className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
                  <p className="text-lg font-medium mb-2">No withdrawals yet</p>
                  <p className="text-muted-foreground mb-6">
                    Withdraw your crypto balance to your bank account
                  </p>
                  <Button onClick={() => navigate('/crypto-withdrawal')} size="lg">
                    Withdraw Now
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Bank Withdrawals</CardTitle>
                  <CardDescription>
                    Powered by SageCloud • Track your bank withdrawal requests
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Bank Account</TableHead>
                          <TableHead>Amount</TableHead>
                          <TableHead>Fee</TableHead>
                          <TableHead>Net Amount</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {withdrawals.map((wd) => (
                          <TableRow key={wd.id}>
                            <TableCell>
                              <div className="text-sm">
                                {new Date(wd.created_at).toLocaleDateString()}
                                <br />
                                <span className="text-xs text-muted-foreground">
                                  {formatDistanceToNow(new Date(wd.created_at), { addSuffix: true })}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="text-sm">
                                <div className="font-medium">{wd.account_name}</div>
                                <div className="text-muted-foreground">
                                  {wd.bank_name}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {wd.account_number}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="font-mono">
                              ₦{wd.amount.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell className="text-red-600 font-mono">
                              -₦{wd.fee.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell className="font-semibold text-green-600">
                              ₦{wd.net_amount.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell>{getStatusBadge(wd.status)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Transaction Details Modal */}
      <Dialog open={showDetailsModal} onOpenChange={setShowDetailsModal}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedTransaction && getCryptoIcon(selectedTransaction.crypto_type)}
              Transaction Details
            </DialogTitle>
            <DialogDescription>
              Complete information about this transaction
            </DialogDescription>
          </DialogHeader>

          {selectedTransaction && (
            <div className="space-y-4 py-4">
              {/* Status Banner */}
              <div className={`p-4 rounded-lg border-2 ${
                selectedTransaction.status === 'completed' 
                  ? 'bg-green-50 border-green-300' 
                  : selectedTransaction.status === 'pending'
                  ? 'bg-yellow-50 border-yellow-300'
                  : selectedTransaction.status === 'processing'
                  ? 'bg-blue-50 border-blue-300'
                  : selectedTransaction.status === 'partially_paid'
                  ? 'bg-orange-50 border-orange-300'
                  : 'bg-red-50 border-red-300'
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium">Status:</span>
                  {getStatusBadge(selectedTransaction.status)}
                </div>
                {selectedTransaction.status === 'pending' && selectedTransaction.expiration_date && (
                  <p className="text-xs text-yellow-700">
                    ⏳ Time remaining: {getTimeRemaining(selectedTransaction.expiration_date)}
                  </p>
                )}
                {selectedTransaction.status === 'processing' && (
                  <p className="text-xs text-blue-700">
                    🔄 Payment received, waiting for confirmations...
                  </p>
                )}
                {selectedTransaction.status === 'completed' && (
                  <p className="text-xs text-green-700">
                    ✅ Funds credited to your balance!
                  </p>
                )}
                {selectedTransaction.status === 'partially_paid' && (
                  <p className="text-xs text-orange-700">
                    ⚠️ Partial payment received. Expected: {selectedTransaction.crypto_amount}, Received: {selectedTransaction.actually_paid}
                  </p>
                )}
              </div>

              {/* QR Code (for pending transactions) */}
              {selectedTransaction.status === 'pending' && selectedTransaction.nowpayments_pay_address && (
                <div className="space-y-2">
                  <div className="flex justify-center p-4 bg-white rounded-lg border-2 border-dashed">
                    <QRCode 
                      value={selectedTransaction.nowpayments_payin_extra_id 
                        ? `${selectedTransaction.crypto_type.toLowerCase()}:${selectedTransaction.nowpayments_pay_address}?dt=${selectedTransaction.nowpayments_payin_extra_id}`
                        : selectedTransaction.nowpayments_pay_address
                      } 
                      size={180}
                      level="M"
                    />
                  </div>
                  <p className="text-xs text-center text-muted-foreground">
                    Scan to pay with your wallet
                  </p>
                </div>
              )}

              {/* Transaction Info */}
              <div className="space-y-3">
                <div className="flex justify-between py-2 border-b">
                  <span className="text-muted-foreground">Transaction ID:</span>
                  <span className="font-mono text-sm">{selectedTransaction.id.slice(0, 8)}...</span>
                </div>

                {selectedTransaction.nowpayments_payment_id && (
                  <div className="flex justify-between py-2 border-b">
                    <span className="text-muted-foreground">Payment ID:</span>
                    <span className="font-mono text-sm">{selectedTransaction.nowpayments_payment_id}</span>
                  </div>
                )}

                <div className="flex justify-between py-2 border-b">
                  <span className="text-muted-foreground">Cryptocurrency:</span>
                  <span className="font-medium">{selectedTransaction.crypto_amount} {selectedTransaction.crypto_type.toUpperCase()}</span>
                </div>

                {selectedTransaction.actually_paid > 0 && selectedTransaction.actually_paid !== selectedTransaction.crypto_amount && (
                  <div className="flex justify-between py-2 border-b">
                    <span className="text-muted-foreground">Actually Paid:</span>
                    <span className="font-medium text-orange-600">
                      {selectedTransaction.actually_paid} {selectedTransaction.crypto_type.toUpperCase()}
                    </span>
                  </div>
                )}

                <div className="flex justify-between py-2 border-b">
                  <span className="text-muted-foreground">Naira Value:</span>
                  <span className="font-semibold text-green-600">
                    ₦{selectedTransaction.naira_amount.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>

                <div className="flex justify-between py-2 border-b">
                  <span className="text-muted-foreground">Exchange Rate:</span>
                  <span className="font-mono">₦{selectedTransaction.rate.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>

                {selectedTransaction.nowpayments_network && (
                  <div className="flex justify-between py-2 border-b">
                    <span className="text-muted-foreground">Network:</span>
                    <span className="font-medium">{getNetworkName(selectedTransaction.nowpayments_network)}</span>
                  </div>
                )}

                {selectedTransaction.nowpayments_pay_address && (
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-muted-foreground">Payment Address:</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs">
                        {selectedTransaction.nowpayments_pay_address.slice(0, 12)}...
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => copyToClipboard(selectedTransaction.nowpayments_pay_address!, 'Address')}
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}

                {selectedTransaction.nowpayments_payin_extra_id && (
                  <div className="flex justify-between items-center py-2 border-b bg-yellow-50 px-2 rounded">
                    <span className="text-muted-foreground font-semibold">Memo/Tag:</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-red-600">
                        {selectedTransaction.nowpayments_payin_extra_id}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => copyToClipboard(selectedTransaction.nowpayments_payin_extra_id!, 'Memo/Tag')}
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}

                {selectedTransaction.nowpayments_smart_contract && (
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-muted-foreground">Smart Contract:</span>
                    <span className="font-mono text-xs">
                      {selectedTransaction.nowpayments_smart_contract.slice(0, 10)}...{selectedTransaction.nowpayments_smart_contract.slice(-8)}
                    </span>
                  </div>
                )}

                {selectedTransaction.payout_hash && (
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-muted-foreground">Transaction Hash:</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs">
                        {selectedTransaction.payout_hash.slice(0, 12)}...
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => window.open(
                          getExplorerUrl(selectedTransaction.nowpayments_network || '', selectedTransaction.payout_hash!), 
                          '_blank'
                        )}
                      >
                        <ExternalLink className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}

                {isChildPayment(selectedTransaction) && (
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-xs text-blue-700">
                      ℹ️ This is a repeated payment to the same address. Parent Payment ID: {selectedTransaction.parent_payment_id}
                    </p>
                  </div>
                )}

                {hasChildPayments(selectedTransaction) && (
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-xs text-blue-700">
                      ℹ️ This payment has {JSON.parse(selectedTransaction.payment_extra_ids!).length} additional payment(s) to the same address.
                    </p>
                  </div>
                )}

                <div className="flex justify-between py-2 border-b">
                  <span className="text-muted-foreground">Created:</span>
                  <span className="text-sm">
                    {new Date(selectedTransaction.created_at).toLocaleString()}
                  </span>
                </div>

                {selectedTransaction.updated_at && selectedTransaction.updated_at !== selectedTransaction.created_at && (
                  <div className="flex justify-between py-2 border-b">
                    <span className="text-muted-foreground">Last Updated:</span>
                    <span className="text-sm">
                      {new Date(selectedTransaction.updated_at).toLocaleString()}
                    </span>
                  </div>
                )}

                {selectedTransaction.payment_reference && (
                  <div className="flex justify-between py-2 border-b">
                    <span className="text-muted-foreground">Reference:</span>
                    <span className="font-mono text-xs">{selectedTransaction.payment_reference}</span>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="pt-4 space-y-2">
                {selectedTransaction.status === 'pending' && selectedTransaction.nowpayments_pay_address && (
                  <Button
                    onClick={() => copyToClipboard(selectedTransaction.nowpayments_pay_address!, 'Payment Address')}
                    className="w-full"
                    variant="outline"
                  >
                    <Copy className="w-4 h-4 mr-2" />
                    Copy Payment Address
                  </Button>
                )}
                <Button
                  onClick={() => setShowDetailsModal(false)}
                  className="w-full"
                >
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
