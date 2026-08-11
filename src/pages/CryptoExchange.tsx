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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Bitcoin, TrendingDown, Copy, ExternalLink, Loader2, AlertCircle, CheckCircle2, Clock, Search, Zap, History } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { useNavigate } from "react-router-dom";
import QRCode from "react-qr-code";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface CryptoOption {
  ticker: string;
  name: string;
  logo_url?: string;
  networks: string[];
}

interface DepositInfo {
  transactionId: string;
  cryptoType: string;
  cryptoAmount: number;
  nairaAmount: number;
  depositAddress: string;
  expiresAt: string;
  network: string;
  memo?: string | null;
  smartContract?: string | null;
}

export default function CryptoExchange() {
  const [crypto, setCrypto] = useState<string>("btc");
  const [network, setNetwork] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [nairaAmount, setNairaAmount] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [loadingCryptos, setLoadingCryptos] = useState(true);
  const [loadingEstimate, setLoadingEstimate] = useState(false);
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [depositInfo, setDepositInfo] = useState<DepositInfo | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const [copied, setCopied] = useState(false);
  const [availableCryptos, setAvailableCryptos] = useState<CryptoOption[]>([]);
  const [cryptoSearchOpen, setCryptoSearchOpen] = useState(false);
  const [cryptoSearchQuery, setCryptoSearchQuery] = useState("");
  const [minAmount, setMinAmount] = useState<number>(0);
  const { toast } = useToast();
  const navigate = useNavigate();

  // Popular cryptocurrencies for quick access
  const popularCryptos = ["btc", "eth", "usdt", "usdc", "bnb", "ltc", "trx", "xrp"];

  // Fetch available cryptocurrencies from NowPayments
  useEffect(() => {
    fetchAvailableCryptos();
  }, []);

  // Countdown timer for deposit expiry
  useEffect(() => {
    if (!depositInfo) return;

    const interval = setInterval(() => {
      const expiresAt = new Date(depositInfo.expiresAt).getTime();
      const now = Date.now();
      const remaining = Math.max(0, Math.floor((expiresAt - now) / 1000));
      
      setTimeRemaining(remaining);

      if (remaining === 0) {
        clearInterval(interval);
        handleExpiry();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [depositInfo]);

  // Get price estimate when amount changes
  useEffect(() => {
    if (!amount || parseFloat(amount) <= 0) {
      setNairaAmount(0);
      return;
    }

    const debounce = setTimeout(() => {
      fetchPriceEstimate();
    }, 500);

    return () => clearTimeout(debounce);
  }, [amount, crypto]);

  // Fetch minimum amount when crypto changes
  useEffect(() => {
    if (crypto) {
      fetchMinimumAmount();
    }
  }, [crypto]);

  const fetchAvailableCryptos = async () => {
    try {
      setLoadingCryptos(true);

      // Fetch all available cryptos from NowPayments API
      const { data, error } = await supabase.functions.invoke('get-available-cryptos');

      if (error) {
        throw error;
      }

      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch cryptocurrencies');
      }

      console.log(`✅ Loaded ${data.count} cryptocurrencies from NowPayments`);
      setAvailableCryptos(data.cryptocurrencies);

    } catch (error: any) {
      console.error('Error fetching cryptocurrencies:', error);
      
      toast({
        title: "Error Loading Cryptocurrencies",
        description: "Could not load available cryptos. Please refresh.",
        variant: "destructive",
      });
      
      // Don't set fallback - force user to refresh so they get real data
      setAvailableCryptos([]);
    } finally {
      setLoadingCryptos(false);
    }
  };

  const fetchMinimumAmount = async () => {
    try {
      // Set reasonable defaults based on crypto type
      if (crypto === 'btc') setMinAmount(0.0001);
      else if (['eth', 'bnb', 'ltc'].includes(crypto)) setMinAmount(0.001);
      else setMinAmount(1);
    } catch (error: any) {
      console.error('Error fetching minimum amount:', error);
      setMinAmount(1);
    }
  };

  const fetchPriceEstimate = async () => {
    try {
      setLoadingEstimate(true);

      const cryptoAmt = parseFloat(amount);
      if (!cryptoAmt || cryptoAmt <= 0) return;

      // Call Edge Function to get real-time rates from NowPayments
      const { data, error } = await supabase.functions.invoke('update-crypto-rates', {
        body: {
          crypto_amount: cryptoAmt,
          crypto_currency: crypto,
        },
      });

      if (error) {
        console.error('Error fetching live rate:', error);
        // Fallback to approximate calculation
        throw error;
      }

      if (!data.success) {
        throw new Error(data.error || 'Failed to get estimate');
      }

      setNairaAmount(data.ngn_amount);
      console.log(`Live rate: ${cryptoAmt} ${crypto.toUpperCase()} = ₦${data.ngn_amount.toLocaleString()}`);

    } catch (error: any) {
      console.error('Error fetching price estimate:', error);
      
      // No fallback rates - show error to user
      setNairaAmount(0);
      
      toast({
        title: "Rate Unavailable",
        description: "Could not fetch live rate. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoadingEstimate(false);
    }
  };

  const handleSell = async () => {
    const cryptoAmount = parseFloat(amount);

    // Validation
    if (!cryptoAmount || cryptoAmount <= 0) {
      toast({
        title: "Invalid Amount",
        description: "Please enter a valid amount",
        variant: "destructive",
      });
      return;
    }

    if (cryptoAmount < minAmount) {
      toast({
        title: "Amount Too Low",
        description: `Minimum amount is ${minAmount} ${crypto.toUpperCase()}`,
        variant: "destructive",
      });
      return;
    }

    if (!nairaAmount || nairaAmount <= 0) {
      toast({
        title: "Invalid Conversion",
        description: "Could not calculate Naira amount. Please try again.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);

    try {
      // Get fresh user data from Supabase (not cached session)
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      
      console.log('🔐 Auth check:', {
        hasUser: !!user,
        userId: user?.id,
        userEmail: user?.email,
        authError: authError,
      });

      if (authError || !user) {
        console.error('❌ Not authenticated:', { authError, hasUser: !!user });
        
        // Try to refresh the session
        console.log('🔄 Attempting to refresh session...');
        const { data: { session }, error: refreshError } = await supabase.auth.refreshSession();
        
        if (refreshError || !session) {
          console.error('❌ Session refresh failed:', refreshError);
          throw new Error("Your session expired. Please log out and log back in.");
        }
        
        console.log('✅ Session refreshed, retrying...');
        // Retry getting user after refresh
        const { data: { user: refreshedUser }, error: retryError } = await supabase.auth.getUser();
        
        if (retryError || !refreshedUser) {
          console.error('❌ Still not authenticated after refresh:', retryError);
          throw new Error("Authentication failed. Please log out and log back in.");
        }
        
        console.log('✅ User authenticated after refresh:', refreshedUser.id);
      } else {
        console.log('✅ User authenticated, calling Edge Function...');
      }

      // Get session token for explicit authorization
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session?.access_token) {
        console.error('❌ No access token found in session');
        throw new Error("Session error. Please log out and log back in.");
      }

      console.log('✅ Got access token, length:', session.access_token.length);

      // Call Edge Function to create sell order with explicit auth
      // Using fetch directly to debug 401 errors
      const response = await fetch('https://dssvvswvqnxanyzfhixf.supabase.co/functions/v1/create-crypto-sell-order', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          crypto_type: crypto.toUpperCase(),
          crypto_amount: cryptoAmount,
          naira_amount: nairaAmount,
          network: network && network !== 'auto' ? network : undefined,
        }),
      });

      const responseText = await response.text();
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (e) {
        console.error('❌ Failed to parse response JSON:', responseText);
        throw new Error(`Server returned non-JSON response: ${response.status} ${response.statusText}`);
      }

      if (!response.ok) {
        console.error('❌ Edge function HTTP error:', response.status, response.statusText);
        console.error('❌ Error body:', data);
        throw new Error(data.error || data.error_details || `HTTP Error: ${response.status}`);
      }

      console.log('✅ Edge function response:', data);

      if (!data.success) {
        console.error('❌ Backend error:', data);
        const errorMsg = data.error_details || data.error || 'Failed to create sell order';
        throw new Error(errorMsg);
      }

      const payment = data.payment_details;

      // Set deposit info and open modal
      // IMPORTANT: Use payment.pay_amount from NowPayments (includes their fee) 
      // NOT the user's input cryptoAmount
      setDepositInfo({
        transactionId: data.transaction_id,
        cryptoType: crypto.toUpperCase(),
        cryptoAmount: payment.pay_amount, // Use NowPayments' calculated amount (includes fee)
        nairaAmount: nairaAmount,
        depositAddress: payment.pay_address,
        expiresAt: payment.expiration_date,
        network: payment.network || network,
        memo: payment.payin_extra_id,
        smartContract: payment.smart_contract,
      });

      // Calculate initial time remaining
      const expiresAt = new Date(payment.expiration_date).getTime();
      const now = Date.now();
      setTimeRemaining(Math.max(0, Math.floor((expiresAt - now) / 1000)));

      setShowDepositModal(true);
      setAmount(""); // Clear input
      setNairaAmount(0);

      toast({
        title: "Order Created! 📋",
        description: "Send crypto to the address shown to complete your sale",
      });
    } catch (error: any) {
      console.error('Error creating sell order:', error);
      toast({
        title: "Failed to Create Order",
        description: error.message || "Please try again",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleExpiry = () => {
    toast({
      title: "Order Expired ⏱️",
      description: "This deposit address is no longer valid. Create a new order to continue.",
      variant: "destructive",
    });
    setShowDepositModal(false);
    setDepositInfo(null);
  };

  const copyAddress = async () => {
    if (!depositInfo) return;

    try {
      await navigator.clipboard.writeText(depositInfo.depositAddress);
      setCopied(true);
      toast({
        title: "Copied! ✅",
        description: "Deposit address copied to clipboard",
      });
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast({
        title: "Copy Failed",
        description: "Please copy the address manually",
        variant: "destructive",
      });
    }
  };

  const copyMemo = async () => {
    if (!depositInfo?.memo) return;

    try {
      await navigator.clipboard.writeText(depositInfo.memo);
      toast({
        title: "Memo Copied! ✅",
        description: "Memo/Tag copied to clipboard",
      });
    } catch (error) {
      toast({
        title: "Copy Failed",
        description: "Please copy the memo manually",
        variant: "destructive",
      });
    }
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const selectedCrypto = availableCryptos.find(c => c.ticker === crypto);
  const filteredCryptos = availableCryptos.filter(c => 
    c.ticker.toLowerCase().includes(cryptoSearchQuery.toLowerCase()) ||
    c.name.toLowerCase().includes(cryptoSearchQuery.toLowerCase())
  );

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
            <Bitcoin className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
            <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-white">Sell Crypto</h1>
          </div>
          <Button
            variant="ghost"
            onClick={() => navigate('/crypto-history')}
            className="gap-1 sm:gap-2 text-white hover:bg-white/20 hover:text-white font-medium text-sm sm:text-base"
          >
            <History className="w-4 h-4" />
            <span className="hidden sm:inline">Transaction History</span><span className="sm:hidden">History</span>
          </Button>
        </div>
      </nav>

      {/* Main Content */}
      <div className="container mx-auto p-4 sm:p-6 max-w-2xl">
        {/* Hero Section */}
        <div className="text-center mb-6 sm:mb-8 pt-2 sm:pt-4">
          <div className="flex items-center justify-center gap-2 mb-3">
            <Zap className="w-6 h-6 sm:w-8 sm:h-8 text-primary" />
            <h2 className="text-xl sm:text-2xl md:text-3xl font-bold text-foreground">
              200+ Cryptocurrencies
            </h2>
          </div>
          <p className="text-sm sm:text-base text-muted-foreground px-4">
            Powered by NowPayments • Live rates • Instant conversion
          </p>
        </div>

        <Card className="shadow-xl">
          <CardHeader className="bg-gradient-to-r from-muted/50 to-muted/30 border-b">
            <CardTitle className="flex items-center gap-2 text-2xl">
              <Bitcoin className="w-7 h-7 text-primary" />
              Sell Cryptocurrency
            </CardTitle>
            <CardDescription>
              Convert your crypto to Naira and receive it in your balance
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pt-6">
            {/* Crypto Selection */}
            <div className="space-y-2">
              <Label htmlFor="crypto-select" className="text-base font-medium">
                Select Cryptocurrency
              </Label>
              
              <Popover open={cryptoSearchOpen} onOpenChange={setCryptoSearchOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={cryptoSearchOpen}
                    className="w-full justify-between h-12"
                    disabled={loadingCryptos}
                  >
                    {loadingCryptos ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Loading cryptocurrencies...
                      </span>
                    ) : selectedCrypto ? (
                      <span className="flex items-center gap-2">
                        <Bitcoin className="w-5 h-5" />
                        {selectedCrypto.name}
                      </span>
                    ) : (
                      "Select cryptocurrency..."
                    )}
                    <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[calc(100vw-2rem)] sm:w-[400px] p-0">
                  <Command>
                    <CommandInput 
                      placeholder="Search cryptocurrency..." 
                      value={cryptoSearchQuery}
                      onValueChange={setCryptoSearchQuery}
                    />
                    <CommandList>
                      <CommandEmpty>No cryptocurrency found.</CommandEmpty>
                      <CommandGroup heading="Popular">
                        {filteredCryptos
                          .filter(c => popularCryptos.includes(c.ticker))
                          .map((c) => (
                            <CommandItem
                              key={c.ticker}
                              value={c.ticker}
                              onSelect={(value) => {
                                setCrypto(value);
                                setCryptoSearchOpen(false);
                                setCryptoSearchQuery("");
                              }}
                            >
                              <Bitcoin className="mr-2 h-4 w-4" />
                              <span className="font-medium">{c.name}</span>
                              <span className="ml-2 text-xs text-muted-foreground">({c.ticker.toUpperCase()})</span>
                            </CommandItem>
                          ))}
                      </CommandGroup>
                      <CommandGroup heading="All Cryptocurrencies">
                        {filteredCryptos
                          .filter(c => !popularCryptos.includes(c.ticker))
                          .map((c) => (
                            <CommandItem
                              key={c.ticker}
                              value={c.ticker}
                              onSelect={(value) => {
                                setCrypto(value);
                                setCryptoSearchOpen(false);
                                setCryptoSearchQuery("");
                              }}
                            >
                              <Bitcoin className="mr-2 h-4 w-4" />
                              <span className="font-medium">{c.name}</span>
                              <span className="ml-2 text-xs text-muted-foreground">({c.ticker.toUpperCase()})</span>
                            </CommandItem>
                          ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>

              <p className="text-xs sm:text-sm text-muted-foreground">
                Choose from 200+ supported cryptocurrencies
              </p>
            </div>

            {/* Network Selection (Optional) */}
            {crypto && ['usdt', 'usdc', 'busd'].includes(crypto) && (
              <div className="space-y-2">
                <Label htmlFor="network-select" className="text-base font-medium">
                  Network (Optional)
                </Label>
                <Select value={network} onValueChange={setNetwork}>
                  <SelectTrigger id="network-select" className="h-12">
                    <SelectValue placeholder="Auto-detect best network" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto-detect</SelectItem>
                    <SelectItem value="trc20">TRON (TRC20)</SelectItem>
                    <SelectItem value="erc20">Ethereum (ERC20)</SelectItem>
                    <SelectItem value="bep20">BSC (BEP20)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Leave as auto-detect for cheapest fees
                </p>
              </div>
            )}

            {/* Amount Input */}
            <div className="space-y-2">
              <Label htmlFor="amount-input" className="text-base font-medium">
                Amount to Sell
              </Label>
              <div className="relative">
                <Input
                  id="amount-input"
                  type="number"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  step={['btc', 'eth', 'bnb'].includes(crypto) ? "0.00000001" : "0.01"}
                  min="0"
                  className="h-14 text-lg pr-20"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground font-medium uppercase">
                  {crypto}
                </span>
              </div>
              {minAmount > 0 && (
                <p className="text-xs text-muted-foreground">
                  Minimum: {minAmount} {crypto.toUpperCase()}
                </p>
              )}
            </div>

            {/* Price Preview Card */}
            {loadingEstimate ? (
              <Card className="bg-muted">
                <CardContent className="pt-6 flex items-center justify-center">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                  <span className="text-muted-foreground">Calculating price...</span>
                </CardContent>
              </Card>
            ) : nairaAmount > 0 ? (
              <Card className="bg-gradient-to-br from-green-50 to-emerald-50 border-green-200">
                <CardContent className="pt-6">
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Live Rate:</span>
                      <span className="text-sm font-medium text-green-700">
                        Updated from NowPayments ✓
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Markup:</span>
                      <span className="text-sm text-green-700 font-medium">5% included ✓</span>
                    </div>
                    <div className="border-t border-green-200 pt-3 mt-2">
                      <div className="flex justify-between items-center">
                        <span className="font-semibold text-base">You'll Receive:</span>
                        <span className="text-3xl font-bold text-green-700">
                          ₦{nairaAmount.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="bg-muted/50 border-dashed">
                <CardContent className="pt-6 text-center text-muted-foreground">
                  <p className="text-sm">Enter amount to see price estimate</p>
                </CardContent>
              </Card>
            )}

            {/* Sell Button */}
            <Button
              onClick={handleSell}
              className="w-full h-14 text-lg"
              size="lg"
              disabled={loading || loadingCryptos || loadingEstimate || !amount || parseFloat(amount) <= 0 || nairaAmount <= 0}
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Creating Order...
                </>
              ) : (
                <>
                  <TrendingDown className="w-5 h-5 mr-2" />
                  Sell {crypto.toUpperCase()}
                </>
              )}
            </Button>

            {/* Info Footer */}
            <div className="pt-4 border-t space-y-2">
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                Transaction time: 5-20 minutes after blockchain confirmation
              </p>
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Funds added to your balance automatically
              </p>
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5" />
                Fixed rate locked for 20 minutes
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Deposit Instructions Modal */}
      <Dialog open={showDepositModal} onOpenChange={setShowDepositModal}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl">
              Send {depositInfo?.cryptoType} to Complete Sale
            </DialogTitle>
            <DialogDescription>
              Send exactly <strong>{depositInfo?.cryptoAmount} {depositInfo?.cryptoType}</strong> to the address below
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* QR Code */}
            <div className="flex justify-center p-4 bg-white rounded-lg border-2 border-dashed">
              {depositInfo && (
                <QRCode 
                  value={depositInfo.memo 
                    ? `${depositInfo.cryptoType.toLowerCase()}:${depositInfo.depositAddress}?dt=${depositInfo.memo}`
                    : depositInfo.depositAddress
                  } 
                  size={200}
                  level="M"
                />
              )}
            </div>

            {/* Deposit Address */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Deposit Address</Label>
              
              <div className="flex gap-2">
                <Input
                  value={depositInfo?.depositAddress || ""}
                  readOnly
                  className="font-mono text-sm"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={copyAddress}
                  className="flex-shrink-0"
                >
                  {copied ? (
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </Button>
              </div>
              
              {depositInfo?.network && (
                <p className="text-xs text-muted-foreground">
                  Network: {depositInfo.network.toUpperCase()}
                </p>
              )}

              {depositInfo?.smartContract && (
                <p className="text-xs text-muted-foreground font-mono">
                  Contract: {depositInfo.smartContract.substring(0, 10)}...{depositInfo.smartContract.substring(depositInfo.smartContract.length - 8)}
                </p>
              )}
            </div>

            {/* Memo/Tag (for XRP, XLM, EOS, etc.) */}
            {depositInfo?.memo && (
              <div className="space-y-2">
                <div className="p-3 bg-yellow-50 border-2 border-yellow-400 rounded-lg">
                  <p className="text-sm font-bold text-yellow-900 flex items-center gap-2 mb-2">
                    <AlertCircle className="w-5 h-5" />
                    IMPORTANT: Memo/Tag Required!
                  </p>
                  <Label className="text-xs text-yellow-800">
                    You MUST include this memo/tag in your transaction:
                  </Label>
                  <div className="flex gap-2 mt-2">
                    <Input
                      value={depositInfo.memo}
                      readOnly
                      className="font-mono text-sm bg-white"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={copyMemo}
                      className="flex-shrink-0"
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-yellow-800 mt-2">
                    ⚠️ Missing memo = PERMANENT LOSS of funds!
                  </p>
                </div>
              </div>
            )}

            {/* Network Warning */}
            <div className="p-3 bg-red-50 border-2 border-red-400 rounded-lg">
              <p className="text-sm font-bold text-red-900 flex items-center gap-2">
                <AlertCircle className="w-5 h-5" />
                CRITICAL: Use Correct Network!
              </p>
              <p className="text-xs text-red-800 mt-2">
                Network: <strong>{depositInfo?.network?.toUpperCase() || 'CHECK YOUR WALLET'}</strong>
                <br />
                ⚠️ Sending from wrong network = PERMANENT LOSS of funds
              </p>
            </div>

            {/* Countdown Timer */}
            <div className={`p-4 rounded-lg border-2 ${
              timeRemaining < 300 ? 'bg-red-50 border-red-300' : 'bg-yellow-50 border-yellow-300'
            }`}>
              <div className="flex items-center justify-between">
                <span className={`font-medium text-sm ${
                  timeRemaining < 300 ? 'text-red-900' : 'text-yellow-900'
                }`}>Time Remaining:</span>
                <span className={`text-2xl font-bold tabular-nums ${
                  timeRemaining < 300 ? 'text-red-700' : 'text-yellow-700'
                }`}>
                  {formatTime(timeRemaining)}
                </span>
              </div>
              {timeRemaining < 300 && (
                <p className="text-xs text-red-700 mt-2">
                  ⚠️ Order expires soon! Complete payment now.
                </p>
              )}
            </div>

            {/* Important Warnings */}
            <div className="space-y-2 p-4 bg-orange-50 border border-orange-200 rounded-lg">
              <p className="text-sm font-semibold text-orange-900">⚠️ Important Instructions:</p>
              <ul className="text-xs text-orange-800 space-y-1 list-disc list-inside">
                <li>Send <strong>exactly {depositInfo?.cryptoAmount} {depositInfo?.cryptoType}</strong></li>
                <li>Use <strong>{depositInfo?.network?.toUpperCase() || 'correct'}</strong> network</li>
                {depositInfo?.memo && (
                  <li className="text-red-700 font-bold">Include memo/tag: {depositInfo.memo}</li>
                )}
                <li>Funds credited after 3-6 confirmations (~5-20 minutes)</li>
                <li>Wrong network/missing memo = <strong className="text-red-700">PERMANENT LOSS</strong></li>
              </ul>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setShowDepositModal(false);
                  navigate('/crypto-history');
                }}
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                View Status
              </Button>
              <Button
                variant="default"
                className="flex-1"
                onClick={() => {
                  toast({
                    title: "Great! 👍",
                    description: "Redirecting to transaction history...",
                  });
                  setTimeout(() => {
                    setShowDepositModal(false);
                    navigate('/crypto-history');
                  }, 1000);
                }}
              >
                I've Sent Payment
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
