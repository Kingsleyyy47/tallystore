import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { 
  Smartphone, 
  Wifi, 
  Loader2, 
  AlertCircle, 
  CheckCircle2, 
  Info,
  Clock,
  XCircle,
  Wallet,
  TrendingDown,
  Bitcoin
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";

interface DataPlan {
  code: string;
  name: string;
  price: number;
  validity: string;
}

interface BillTransaction {
  id: string;
  reference: string;
  transaction_type: string;
  amount: number;
  status: string;
  service_provider: string;
  service_code: string | null;
  beneficiary_phone: string;
  created_at: string;
  completed_at: string | null;
}

const SERVICE_PROVIDERS = [
  { code: 'MTN', name: 'MTN', color: 'text-yellow-600' },
  { code: 'GLO', name: 'Glo', color: 'text-green-600' },
  { code: 'AIRTEL', name: 'Airtel', color: 'text-red-600' },
  { code: '9MOBILE', name: '9mobile', color: 'text-emerald-600' },
];

export default function BillsPayment() {
  const [activeTab, setActiveTab] = useState<'airtime' | 'data'>('airtime');
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [cryptoBalance, setCryptoBalance] = useState<number>(0);
  const [paymentSource, setPaymentSource] = useState<'wallet' | 'crypto'>('wallet');
  const [provider, setProvider] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [selectedPlan, setSelectedPlan] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [loadingBalance, setLoadingBalance] = useState(true);
  const [transactions, setTransactions] = useState<BillTransaction[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [dataPlans, setDataPlans] = useState<DataPlan[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    fetchBalance();
    fetchTransactionHistory();
  }, []);

  const fetchBalance = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        setLoadingBalance(false);
        return;
      }

      const { data: profile, error } = await supabase
        .from('profiles')
        .select('wallet_balance, crypto_balance')
        .eq('id', user.id)
        .single();

      if (error) throw error;

      setWalletBalance(profile?.wallet_balance || 0);
      setCryptoBalance(profile?.crypto_balance || 0);
    } catch (error) {
      console.error('Error fetching balance:', error);
      toast({
        title: "Error",
        description: "Failed to load balance",
        variant: "destructive",
      });
    } finally {
      setLoadingBalance(false);
    }
  };

  // Get the currently selected balance
  const selectedBalance = paymentSource === 'wallet' ? walletBalance : cryptoBalance;

  const fetchTransactionHistory = async () => {
    try {
      setLoadingHistory(true);
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) return;

      const { data, error } = await supabase
        .from('bills_transactions')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;

      setTransactions(data || []);
    } catch (error) {
      console.error('Error fetching history:', error);
    } finally {
      setLoadingHistory(false);
    }
  };

  const fetchDataPlans = async (selectedProvider: string) => {
    if (!selectedProvider) return;
    
    setLoadingPlans(true);
    try {
      const response = await supabase.functions.invoke('get-data-plans', {
        body: { provider: selectedProvider },
      });

      console.log('Full response:', response);
      
      if (response.error) {
        console.error('Edge Function error:', response.error);
        console.error('Response data:', response.data);
        throw response.error;
      }

      const { data, error } = response;
      console.log('Data plans response:', data);

      if (data.success) {
        setDataPlans(data.data);
      } else {
        console.error('API returned error:', data.error, data.details);
        throw new Error(data.error || 'Failed to load data plans');
      }
    } catch (error: any) {
      console.error('Error fetching data plans:', error);
      
      setDataPlans([]);
      
      toast({
        title: "Could not fetch live data plans",
        description: "Please try again or contact support if the issue persists.",
        variant: "destructive",
      });
    } finally {
      setLoadingPlans(false);
    }
  };

  const handlePlanSelect = (planCode: string) => {
    setSelectedPlan(planCode);
    const plan = dataPlans.find(p => p.code === planCode);
    if (plan) {
      setAmount(plan.price.toString());
    }
  };

  const handlePurchase = async () => {
    // Validation
    if (!provider) {
      toast({
        title: "Select Network",
        description: "Please select a service provider",
        variant: "destructive",
      });
      return;
    }

    if (!phone || phone.length !== 11) {
      toast({
        title: "Invalid Phone Number",
        description: "Please enter a valid 11-digit Nigerian phone number",
        variant: "destructive",
      });
      return;
    }

    const purchaseAmount = parseFloat(amount);
    if (!purchaseAmount || purchaseAmount < 50) {
      toast({
        title: "Invalid Amount",
        description: activeTab === 'airtime' ? "Minimum airtime is ₦50" : "Please select a data plan",
        variant: "destructive",
      });
      return;
    }

    if (activeTab === 'data' && !selectedPlan) {
      toast({
        title: "Select Data Plan",
        description: "Please select a data plan",
        variant: "destructive",
      });
      return;
    }

    if (purchaseAmount > selectedBalance) {
      toast({
        title: "Insufficient Balance",
        description: `You need ₦${purchaseAmount.toLocaleString()} but only have ₦${selectedBalance.toLocaleString()} in your ${paymentSource === 'wallet' ? 'TallyStore' : 'Crypto'} balance`,
        variant: "destructive",
      });
      return;
    }

    setLoading(true);

    // Generate unique idempotency key for this purchase attempt
    const idempotencyKey = `${Date.now()}-${crypto.randomUUID()}`;

    try {
      const requestBody = {
        transaction_type: activeTab,
        amount: purchaseAmount,
        service_provider: provider,
        phone: phone,
        data_plan_code: activeTab === 'data' ? selectedPlan : null,
        payment_source: paymentSource,
        idempotency_key: idempotencyKey,
      };
      
      console.log('Sending purchase request:', requestBody);
      
      const response = await supabase.functions.invoke('purchase-bills', {
        body: requestBody,
      });

      console.log('Purchase response:', response);

      if (response.error) {
        console.error('Purchase error:', response.error);
        console.error('Error data:', response.data);
        throw new Error(response.data?.error || response.error.message || 'Purchase failed');
      }

      const { data } = response;

      if (!data.success) {
        throw new Error(data.error || 'Purchase failed');
      }

      toast({
        title: "Success! ✅",
        description: `${activeTab === 'airtime' ? 'Airtime' : 'Data'} sent to ${phone}`,
      });

      // Reset form
      setPhone('');
      setAmount('');
      setSelectedPlan('');
      
      // Refresh balance and history
      fetchBalance();
      fetchTransactionHistory();

    } catch (error: any) {
      console.error('Purchase failed:', error);
      toast({
        title: "Purchase Failed",
        description: error.message || 'Please try again',
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { variant: any; icon: any; label: string }> = {
      pending: { 
        variant: "secondary", 
        icon: Clock, 
        label: "Processing" 
      },
      successful: { 
        variant: "default", 
        icon: CheckCircle2, 
        label: "Successful" 
      },
      failed: { 
        variant: "destructive", 
        icon: XCircle, 
        label: "Failed" 
      },
    };

    const config = statusConfig[status] || statusConfig.pending;
    const Icon = config.icon;

    return (
      <Badge variant={config.variant} className="gap-1">
        <Icon className="w-3 h-3" />
        {config.label}
      </Badge>
    );
  };

  // Fetch data plans when provider changes
  useEffect(() => {
    if (provider && activeTab === 'data') {
      fetchDataPlans(provider);
    }
  }, [provider, activeTab]);

  const availablePlans = provider ? dataPlans : [];

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
            <Smartphone className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
            <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-white">Airtime & Data</h1>
          </div>
          <div className="w-40" /> {/* Spacer for centering */}
        </div>
      </nav>

      {/* Main Content */}
      <div className="container mx-auto p-4 sm:p-6 max-w-6xl">
        {/* Hero Section */}
        <div className="text-center mb-6 sm:mb-8 pt-2 sm:pt-4">
          <h2 className="text-xl sm:text-2xl md:text-3xl font-bold text-foreground mb-2">
            Instant Airtime & Data Top-up
          </h2>
          <p className="text-sm sm:text-base text-muted-foreground px-4">
            Powered by SageCloud • All Nigerian networks supported
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Purchase Form */}
          <div className="lg:col-span-2 space-y-6">
            {/* Balance Selection Card */}
            <Card className="border-2">
              <CardContent className="pt-6">
                <p className="text-sm font-medium text-muted-foreground mb-4">Pay with</p>
                <div className="grid grid-cols-2 gap-4">
                  {/* TallyStore Wallet Option */}
                  <div
                    onClick={() => setPaymentSource('wallet')}
                    className={`cursor-pointer p-4 rounded-lg border-2 transition-all ${
                      paymentSource === 'wallet'
                        ? 'border-green-500 bg-green-50 dark:bg-green-950'
                        : 'border-gray-200 hover:border-gray-300 dark:border-gray-700'
                    }`}
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <div className={`p-2 rounded-full ${paymentSource === 'wallet' ? 'bg-green-500' : 'bg-gray-200 dark:bg-gray-700'}`}>
                        <Wallet className={`w-5 h-5 ${paymentSource === 'wallet' ? 'text-white' : 'text-gray-600 dark:text-gray-400'}`} />
                      </div>
                      <div>
                        <p className="font-semibold text-sm">TallyStore Balance</p>
                        <p className="text-xs text-muted-foreground">From card/bank top-up</p>
                      </div>
                    </div>
                    {loadingBalance ? (
                      <p className="text-lg font-bold">Loading...</p>
                    ) : (
                      <p className={`text-xl font-bold ${paymentSource === 'wallet' ? 'text-green-700 dark:text-green-400' : 'text-foreground'}`}>
                        ₦{walletBalance.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                    )}
                  </div>

                  {/* Crypto Balance Option */}
                  <div
                    onClick={() => setPaymentSource('crypto')}
                    className={`cursor-pointer p-4 rounded-lg border-2 transition-all ${
                      paymentSource === 'crypto'
                        ? 'border-orange-500 bg-orange-50 dark:bg-orange-950'
                        : 'border-gray-200 hover:border-gray-300 dark:border-gray-700'
                    }`}
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <div className={`p-2 rounded-full ${paymentSource === 'crypto' ? 'bg-orange-500' : 'bg-gray-200 dark:bg-gray-700'}`}>
                        <Bitcoin className={`w-5 h-5 ${paymentSource === 'crypto' ? 'text-white' : 'text-gray-600 dark:text-gray-400'}`} />
                      </div>
                      <div>
                        <p className="font-semibold text-sm">Crypto Balance</p>
                        <p className="text-xs text-muted-foreground">From crypto deposits</p>
                      </div>
                    </div>
                    {loadingBalance ? (
                      <p className="text-lg font-bold">Loading...</p>
                    ) : (
                      <p className={`text-xl font-bold ${paymentSource === 'crypto' ? 'text-orange-700 dark:text-orange-400' : 'text-foreground'}`}>
                        ₦{cryptoBalance.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                    )}
                  </div>
                </div>
                
                {/* Selected Balance Indicator */}
                <div className={`mt-4 p-3 rounded-lg flex items-center justify-between ${
                  paymentSource === 'wallet' 
                    ? 'bg-green-100 dark:bg-green-900/30' 
                    : 'bg-orange-100 dark:bg-orange-900/30'
                }`}>
                  <div className="flex items-center gap-2">
                    {paymentSource === 'wallet' ? (
                      <Wallet className="w-5 h-5 text-green-700 dark:text-green-400" />
                    ) : (
                      <Bitcoin className="w-5 h-5 text-orange-700 dark:text-orange-400" />
                    )}
                    <span className="text-sm font-medium">
                      Paying with {paymentSource === 'wallet' ? 'TallyStore' : 'Crypto'} Balance
                    </span>
                  </div>
                  <span className={`text-lg font-bold ${
                    paymentSource === 'wallet' 
                      ? 'text-green-700 dark:text-green-400' 
                      : 'text-orange-700 dark:text-orange-400'
                  }`}>
                    ₦{selectedBalance.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>

                {selectedBalance === 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => navigate(paymentSource === 'wallet' ? '/wallet' : '/crypto-exchange')}
                    className="mt-3 w-full"
                  >
                    {paymentSource === 'wallet' ? 'Top Up Wallet' : 'Deposit Crypto'}
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* Purchase Form */}
            <Card className="shadow-xl">
              <CardHeader className="bg-gradient-to-r from-muted/50 to-muted/30 border-b">
                <CardTitle className="flex items-center gap-2 text-2xl">
                  <Smartphone className="w-7 h-7 text-primary" />
                  Purchase
                </CardTitle>
                <CardDescription>
                  Buy airtime or data for any Nigerian network
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-6">
                <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'airtime' | 'data')}>
                  <TabsList className="grid w-full grid-cols-2 h-12 mb-6">
                    <TabsTrigger value="airtime" className="text-base gap-2">
                      <Smartphone className="w-4 h-4" />
                      Airtime
                    </TabsTrigger>
                    <TabsTrigger value="data" className="text-base gap-2">
                      <Wifi className="w-4 h-4" />
                      Data
                    </TabsTrigger>
                  </TabsList>

                  <div className="space-y-6">
                    {/* Network Selection */}
                    <div className="space-y-2">
                      <Label htmlFor="provider-select" className="text-base font-medium">
                        Select Network
                      </Label>
                      <Select value={provider} onValueChange={setProvider}>
                        <SelectTrigger id="provider-select" className="h-12">
                          <SelectValue placeholder="Choose network..." />
                        </SelectTrigger>
                        <SelectContent>
                          {SERVICE_PROVIDERS.map((p) => (
                            <SelectItem key={p.code} value={p.code}>
                              <span className={p.color}>{p.name}</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Phone Number */}
                    <div className="space-y-2">
                      <Label htmlFor="phone-input" className="text-base font-medium">
                        Phone Number
                      </Label>
                      <Input
                        id="phone-input"
                        type="tel"
                        placeholder="08012345678"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
                        className="h-12 text-lg font-mono"
                        maxLength={11}
                      />
                      <p className="text-xs text-muted-foreground">
                        Enter 11-digit Nigerian phone number
                      </p>
                    </div>

                    {/* Airtime Tab Content */}
                    <TabsContent value="airtime" className="space-y-4 mt-0">
                      <div className="space-y-2">
                        <Label htmlFor="amount-input" className="text-base font-medium">
                          Amount
                        </Label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">
                            ₦
                          </span>
                          <Input
                            id="amount-input"
                            type="number"
                            placeholder="0.00"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            className="h-14 text-lg pl-7"
                            min="50"
                            max="50000"
                            step="50"
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Min: ₦50 | Max: ₦50,000
                        </p>
                      </div>

                      {/* Quick Amount Buttons */}
                      <div className="grid grid-cols-4 gap-2">
                        {[100, 200, 500, 1000].map((amt) => (
                          <Button
                            key={amt}
                            type="button"
                            variant="outline"
                            onClick={() => setAmount(amt.toString())}
                            className="h-10"
                          >
                            ₦{amt}
                          </Button>
                        ))}
                      </div>
                    </TabsContent>

                    {/* Data Tab Content */}
                    <TabsContent value="data" className="space-y-4 mt-0">
                      {!provider ? (
                        <div className="p-6 bg-muted/50 rounded-lg border-2 border-dashed text-center">
                          <AlertCircle className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
                          <p className="text-muted-foreground">
                            Select a network to view available data plans
                          </p>
                        </div>
                      ) : loadingPlans ? (
                        <div className="p-6 bg-muted/50 rounded-lg border-2 border-dashed text-center">
                          <Loader2 className="w-12 h-12 mx-auto mb-3 text-muted-foreground animate-spin" />
                          <p className="text-muted-foreground">
                            Loading real data plans from provider...
                          </p>
                        </div>
                      ) : availablePlans.length === 0 ? (
                        <div className="p-6 bg-muted/50 rounded-lg border-2 border-dashed text-center">
                          <AlertCircle className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
                          <p className="text-muted-foreground">
                            No data plans available. Please try again.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <Label className="text-base font-medium">Select Data Plan</Label>
                          <div className="grid grid-cols-2 gap-3 max-h-[400px] overflow-y-auto p-1">
                            {availablePlans.map((plan) => (
                              <Card
                                key={plan.code}
                                className={`cursor-pointer transition-all hover:shadow-md ${
                                  selectedPlan === plan.code
                                    ? 'ring-2 ring-primary bg-primary/5'
                                    : 'hover:border-primary'
                                }`}
                                onClick={() => handlePlanSelect(plan.code)}
                              >
                                <CardContent className="p-4">
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="text-2xl font-bold">{plan.name}</span>
                                    <CheckCircle2
                                      className={`w-5 h-5 ${
                                        selectedPlan === plan.code ? 'text-primary' : 'text-muted-foreground/20'
                                      }`}
                                    />
                                  </div>
                                  <div className="text-lg font-semibold text-green-600 mb-1">
                                    ₦{plan.price.toLocaleString()}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    Valid for {plan.validity}
                                  </div>
                                </CardContent>
                              </Card>
                            ))}
                          </div>
                        </div>
                      )}
                    </TabsContent>

                    {/* Purchase Button */}
                    <Button
                      onClick={handlePurchase}
                      className="w-full h-14 text-lg"
                      size="lg"
                      disabled={
                        loading ||
                        loadingBalance ||
                        !provider ||
                        phone.length !== 11 ||
                        !amount ||
                        parseFloat(amount) < 50 ||
                        parseFloat(amount) > selectedBalance ||
                        (activeTab === 'data' && !selectedPlan)
                      }
                    >
                      {loading ? (
                        <>
                          <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                          Processing...
                        </>
                      ) : (
                        <>
                          <TrendingDown className="w-5 h-5 mr-2" />
                          Buy {activeTab === 'airtime' ? 'Airtime' : 'Data'} ₦{parseFloat(amount || '0').toLocaleString()}
                        </>
                      )}
                    </Button>

                    {/* Info Footer */}
                    <div className="pt-4 border-t space-y-2">
                      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <Info className="w-3.5 h-3.5" />
                        Instant delivery (usually within 1 minute)
                      </p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Works for all Nigerian networks
                      </p>
                    </div>
                  </div>
                </Tabs>
              </CardContent>
            </Card>
          </div>

          {/* Right Column - Transaction History */}
          <div className="lg:col-span-1">
            <Card className="shadow-xl">
              <CardHeader className="bg-gradient-to-r from-muted/50 to-muted/30 border-b">
                <CardTitle className="text-lg">Recent Transactions</CardTitle>
                <CardDescription>Last 10 purchases</CardDescription>
              </CardHeader>
              <CardContent className="pt-6">
                {loadingHistory ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : transactions.length === 0 ? (
                  <div className="text-center py-8">
                    <Smartphone className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">No transactions yet</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {transactions.map((tx) => (
                      <Card key={tx.id} className="border">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-2">
                              {tx.transaction_type === 'airtime' ? (
                                <Smartphone className="w-4 h-4 text-primary" />
                              ) : (
                                <Wifi className="w-4 h-4 text-primary" />
                              )}
                              <span className="font-medium text-sm">
                                {tx.transaction_type === 'airtime' ? 'Airtime' : 'Data'}
                              </span>
                            </div>
                            {getStatusBadge(tx.status)}
                          </div>
                          <div className="space-y-1 text-xs text-muted-foreground">
                            <p className="font-semibold text-foreground">
                              {tx.service_provider} - ₦{tx.amount.toLocaleString()}
                            </p>
                            <p>{tx.beneficiary_phone}</p>
                            <p className="text-xs">
                              {formatDistanceToNow(new Date(tx.created_at), { addSuffix: true })}
                            </p>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
