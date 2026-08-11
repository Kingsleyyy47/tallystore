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
import { Wallet, TrendingDown, Loader2, AlertCircle, CheckCircle2, Building2, Info, Shield, History } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { useNavigate } from "react-router-dom";

interface BankAccount {
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName?: string;
}

const NIGERIAN_BANKS = [
  { code: "058", name: "GTBank" },
  { code: "033", name: "United Bank for Africa (UBA)" },
  { code: "044", name: "Access Bank" },
  { code: "011", name: "First Bank of Nigeria" },
  { code: "057", name: "Zenith Bank" },
  { code: "214", name: "First City Monument Bank (FCMB)" },
  { code: "221", name: "Stanbic IBTC Bank" },
  { code: "232", name: "Sterling Bank" },
  { code: "035", name: "Wema Bank" },
  { code: "082", name: "Keystone Bank" },
  { code: "215", name: "Unity Bank" },
  { code: "032", name: "Union Bank" },
  { code: "301", name: "Jaiz Bank" },
  { code: "050", name: "Ecobank Nigeria" },
  { code: "076", name: "Polaris Bank" },
  { code: "101", name: "Providus Bank" },
  { code: "309", name: "Globus Bank" },
  { code: "102", name: "Titan Trust Bank" },
  { code: "070", name: "Fidelity Bank" },
  { code: "068", name: "Standard Chartered Bank" },
  { code: "039", name: "Stanbic Mobile" },
  { code: "100", name: "Suntrust Bank" },
  { code: "090175", name: "Rubies Microfinance Bank" },
  { code: "090267", name: "Kuda Microfinance Bank" },
  { code: "50211", name: "Kuda Bank" },
  { code: "100004", name: "Opay" },
  { code: "100002", name: "PalmPay" },
  { code: "090110", name: "VFD Microfinance Bank" },
  { code: "090097", name: "Ekondo Microfinance Bank" },
].sort((a, b) => a.name.localeCompare(b.name));

interface CryptoWithdrawalProps {
  // Which balance this withdrawal screen operates on. 'crypto' (default) preserves all
  // existing behavior exactly. 'referral' re-points the same SageCloud bank-transfer flow
  // at the user's referral_balance instead, so referral earnings can be cashed out directly
  // without first moving them into the wallet.
  source?: 'crypto' | 'referral';
}

const SOURCE_CONFIG = {
  crypto: {
    balanceColumn: 'crypto_balance',
    title: 'Withdraw to Bank',
    heading: 'Cash Out to Your Bank',
    subheading: "Powered by SageCloud • Transfer your balance directly to your Nigerian bank account",
    balanceLabel: 'Available Balance',
    emptyBalanceCta: { label: 'Sell Crypto First', route: '/crypto-exchange' },
    backRoute: '/dashboard',
    historyRoute: '/crypto-history',
    successRoute: '/crypto-history',
  },
  referral: {
    balanceColumn: 'referral_balance',
    title: 'Withdraw Referral Earnings',
    heading: 'Cash Out Your Referral Earnings',
    subheading: "Powered by SageCloud • Transfer your referral commission directly to your Nigerian bank account",
    balanceLabel: 'Referral Balance',
    emptyBalanceCta: { label: 'Invite Friends', route: '/referrals' },
    backRoute: '/referrals',
    historyRoute: '/referrals',
    successRoute: '/referrals',
  },
} as const;

export default function CryptoWithdrawal({ source = 'crypto' }: CryptoWithdrawalProps) {
  const config = SOURCE_CONFIG[source];
  const [cryptoBalance, setCryptoBalance] = useState<number>(0);
  const [amount, setAmount] = useState("");
  const [bankCode, setBankCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [narration, setNarration] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingBalance, setLoadingBalance] = useState(true);
  const [validatingAccount, setValidatingAccount] = useState(false);
  const [accountValidated, setAccountValidated] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  // Fetch crypto balance
  useEffect(() => {
    fetchBalance();
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
        .select(config.balanceColumn)
        .eq('id', user.id)
        .single();

      if (error) throw error;

      setCryptoBalance((profile as any)?.[config.balanceColumn] || 0);
    } catch (error) {
      console.error('Error fetching balance:', error);
      toast({
        title: "Error",
        description: `Failed to load ${config.balanceLabel.toLowerCase()}`,
        variant: "destructive",
      });
    } finally {
      setLoadingBalance(false);
    }
  };

  // Auto-validate account when bank + account number are complete
  useEffect(() => {
    if (bankCode && accountNumber.length === 10) {
      validateAccount();
    } else {
      setAccountName("");
      setAccountValidated(false);
    }
  }, [bankCode, accountNumber]);

  const validateAccount = async () => {
    setValidatingAccount(true);
    setAccountName("");
    setAccountValidated(false);

    try {
      // Call Edge Function to validate account via SageCloud
      const { data, error } = await supabase.functions.invoke('validate-bank-account', {
        body: {
          bank_code: bankCode,
          account_number: accountNumber,
        },
      });

      if (error) throw error;

      if (data.success && data.account_name) {
        setAccountName(data.account_name);
        setAccountValidated(true);
        
        toast({
          title: "Account Verified ✓",
          description: data.account_name,
        });
      } else {
        throw new Error(data.error || 'Could not verify account');
      }
    } catch (error: any) {
      console.error('Account validation error:', error);
      
      toast({
        title: "Validation Failed",
        description: error.message || "Could not verify account details. Please check and try again.",
        variant: "destructive",
      });
      
      setAccountName("");
      setAccountValidated(false);
    } finally {
      setValidatingAccount(false);
    }
  };

  const withdrawAmount = parseFloat(amount) || 0;
  const feePercentage = 2;
  const feeAmount = Math.ceil((withdrawAmount * feePercentage) / 100); // Round up fee
  const netAmount = withdrawAmount - feeAmount;

  const handleWithdraw = async () => {
    // Validation
    if (!withdrawAmount || withdrawAmount < 1000) {
      toast({
        title: "Invalid Amount",
        description: "Minimum withdrawal is ₦1,000",
        variant: "destructive",
      });
      return;
    }

    if (withdrawAmount > 2000000) {
      toast({
        title: "Amount Too High",
        description: "Maximum withdrawal is ₦2,000,000 per transaction",
        variant: "destructive",
      });
      return;
    }

    if (withdrawAmount > cryptoBalance) {
      toast({
        title: "Insufficient Balance",
        description: `You only have ₦${cryptoBalance.toLocaleString('en-NG', { minimumFractionDigits: 2 })} available`,
        variant: "destructive",
      });
      return;
    }

    if (!bankCode || !accountNumber || !accountName) {
      toast({
        title: "Incomplete Details",
        description: "Please fill in all bank details and verify your account",
        variant: "destructive",
      });
      return;
    }

    if (!accountValidated) {
      toast({
        title: "Account Not Verified",
        description: "Please wait for account validation to complete",
        variant: "destructive",
      });
      return;
    }

    if (accountNumber.length !== 10) {
      toast({
        title: "Invalid Account Number",
        description: "Account number must be 10 digits",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const bankName = NIGERIAN_BANKS.find(b => b.code === bankCode)?.name || "";

      // Call Edge Function to create withdrawal request
      const { data, error } = await supabase.functions.invoke('create-withdrawal-request', {
        body: {
          amount: withdrawAmount,
          bank_code: bankCode,
          account_number: accountNumber,
          account_name: accountName,
          bank_name: bankName,
          narration: narration || `Withdrawal to ${accountName}`,
          source,
        },
      });

      // Handle FunctionsHttpError - extract message from response body
      if (error) {
        // Try to get the error message from the response context
        let errorMessage = error.message || 'An unexpected error occurred';
        
        // If it's a FunctionsHttpError, the data might contain the actual error
        if (data?.error) {
          errorMessage = data.error;
        }
        
        throw new Error(errorMessage);
      }

      if (!data.success) {
        throw new Error(data.error || 'Failed to create withdrawal request');
      }

      // Show success message
      toast({
        title: "Withdrawal Initiated! 🚀",
        description: `₦${netAmount.toLocaleString('en-NG', { minimumFractionDigits: 2 })} will be sent to your account shortly.`,
        duration: 5000,
      });

      // Clear form
      setAmount("");
      setAccountNumber("");
      setAccountName("");
      setBankCode("");
      setNarration("");
      setAccountValidated(false);
      
      // Refresh balance
      await fetchBalance();

      // Navigate to the relevant history/summary page after 2 seconds
      setTimeout(() => {
        navigate(config.successRoute);
      }, 2000);

    } catch (error: any) {
      console.error('Error creating withdrawal:', error);
      
      // Extract user-friendly message
      let userMessage = error.message || "Please try again";
      
      // If it's a generic Supabase error, provide a friendlier message
      if (userMessage.includes('non-2xx status code') || userMessage.includes('FunctionsHttpError')) {
        userMessage = "We're experiencing a temporary issue. Please try again in a few minutes.";
      }
      
      toast({
        title: "Withdrawal Failed",
        description: userMessage,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleMaxAmount = () => {
    // Set to max withdrawable (balance or 2M limit, whichever is lower)
    const maxWithdrawable = Math.min(cryptoBalance, 2000000);
    setAmount(maxWithdrawable.toFixed(2));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted/20">
      {/* Navigation */}
      <nav className="border-b bg-gradient-to-r from-primary to-primary/90 shadow-lg sticky top-0 z-10">
        <div className="container mx-auto px-4 sm:px-6 py-4 sm:py-5 flex justify-between items-center">
          <Button
            variant="ghost"
            onClick={() => navigate(config.backRoute)}
            className="gap-1 sm:gap-2 text-white hover:bg-white/20 hover:text-white font-medium text-sm sm:text-base"
          >
            ← <span className="hidden sm:inline">Back</span><span className="sm:hidden">Back</span>
          </Button>
          <div className="flex items-center gap-3">
            <Wallet className="w-7 h-7 text-white" />
            <h1 className="text-2xl font-bold text-white">{config.title}</h1>
          </div>
          <Button
            variant="ghost"
            onClick={() => navigate(config.historyRoute)}
            className="gap-1 sm:gap-2 text-white hover:bg-white/20 hover:text-white font-medium text-sm sm:text-base"
          >
            <History className="w-4 h-4" />
            <span className="hidden sm:inline">History</span><span className="sm:hidden">History</span>
          </Button>
        </div>
      </nav>

      {/* Main Content */}
      <div className="container mx-auto p-4 sm:p-6 max-w-2xl">
        {/* Hero Section */}
        <div className="text-center mb-6 sm:mb-8 pt-2 sm:pt-4">
          <h2 className="text-3xl font-bold text-foreground mb-2">
            {config.heading}
          </h2>
          <p className="text-muted-foreground">
            {config.subheading}
          </p>
        </div>

        {/* Balance Display Card */}
        <Card className="mb-6 bg-gradient-to-br from-green-50 to-emerald-50 border-green-200">
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-sm text-green-700 mb-1">{config.balanceLabel}</p>
              {loadingBalance ? (
                <div className="flex items-center justify-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin text-green-700" />
                  <span className="text-xl font-bold text-green-900">Loading...</span>
                </div>
              ) : (
                <div className="text-4xl font-bold text-green-900">
                  ₦{cryptoBalance.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              )}
              {cryptoBalance === 0 && !loadingBalance && (
                <div className="mt-3">
                  <p className="text-xs text-green-700 mb-2">
                    No balance available
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => navigate(config.emptyBalanceCta.route)}
                    className="border-green-600 text-green-700 hover:bg-green-100"
                  >
                    {config.emptyBalanceCta.label}
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Withdrawal Form */}
        <Card className="shadow-xl">
          <CardHeader className="bg-gradient-to-r from-muted/50 to-muted/30 border-b">
            <CardTitle className="flex items-center gap-2 text-2xl">
              <Building2 className="w-7 h-7 text-primary" />
              Bank Withdrawal
            </CardTitle>
            <CardDescription>
              Enter your bank details to receive funds
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pt-6">
            {/* Amount Input */}
            <div className="space-y-2">
              <Label htmlFor="amount-input" className="text-base font-medium">
                Withdrawal Amount
              </Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
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
                    min="1000"
                    max="2000000"
                    step="100"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleMaxAmount}
                  disabled={loadingBalance || cryptoBalance === 0}
                  className="h-14 px-6"
                >
                  Max
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Min: ₦1,000 | Max: ₦2,000,000 per transaction
              </p>
            </div>

            {/* Bank Selection */}
            <div className="space-y-2">
              <Label htmlFor="bank-select" className="text-base font-medium">
                Select Bank
              </Label>
              <Select value={bankCode} onValueChange={setBankCode}>
                <SelectTrigger id="bank-select" className="h-12">
                  <SelectValue placeholder="Choose your bank..." />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {NIGERIAN_BANKS.map((bank) => (
                    <SelectItem key={bank.code} value={bank.code}>
                      {bank.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Supports all Nigerian banks including Opay, PalmPay, Kuda, etc.
              </p>
            </div>

            {/* Account Number */}
            <div className="space-y-2">
              <Label htmlFor="account-input" className="text-base font-medium">
                Account Number
              </Label>
              <Input
                id="account-input"
                type="text"
                placeholder="0123456789"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, '').slice(0, 10))}
                className="h-12 text-lg font-mono"
                maxLength={10}
              />
              {validatingAccount && (
                <div className="flex items-center gap-2 text-sm text-blue-600 p-3 bg-blue-50 rounded-lg border border-blue-200">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Verifying account with SageCloud...</span>
                </div>
              )}
              {accountValidated && accountName && (
                <div className="flex items-center gap-2 text-sm text-green-700 font-medium p-3 bg-green-50 rounded-lg border border-green-300">
                  <CheckCircle2 className="w-5 h-5" />
                  <div className="flex-1">
                    <div className="font-semibold">{accountName}</div>
                    <div className="text-xs text-green-600">Account verified successfully</div>
                  </div>
                </div>
              )}
              {!validatingAccount && !accountValidated && accountNumber.length === 10 && bankCode && (
                <div className="flex items-center gap-2 text-sm text-red-600 p-3 bg-red-50 rounded-lg border border-red-200">
                  <AlertCircle className="w-4 h-4" />
                  <span>Account validation failed. Please check your details.</span>
                </div>
              )}
            </div>

            {/* Narration (Optional) */}
            <div className="space-y-2">
              <Label htmlFor="narration-input" className="text-base font-medium">
                Narration (Optional)
              </Label>
              <Input
                id="narration-input"
                type="text"
                placeholder="e.g., Withdrawal for personal use"
                value={narration}
                onChange={(e) => setNarration(e.target.value.slice(0, 50))}
                className="h-12"
                maxLength={50}
              />
              <p className="text-xs text-muted-foreground">
                This will appear on your bank statement (max 50 characters)
              </p>
            </div>

            {/* Fee Preview Card */}
            {withdrawAmount >= 1000 && (
              <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
                <CardContent className="pt-6">
                  <div className="space-y-3">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground">Withdrawal Amount:</span>
                      <span className="font-semibold">₦{withdrawAmount.toLocaleString('en-NG', { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground">Processing Fee (2%):</span>
                      <span className="font-semibold text-red-600">-₦{feeAmount.toLocaleString('en-NG', { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div className="border-t border-blue-200 pt-3">
                      <div className="flex justify-between items-center">
                        <span className="font-semibold text-base">You'll Receive:</span>
                        <span className="text-3xl font-bold text-green-700">
                          ₦{netAmount.toLocaleString('en-NG', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Security Notice */}
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-start gap-3">
                <Shield className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="font-semibold text-blue-900 text-sm">Secure Transfer</p>
                  <p className="text-xs text-blue-800 mt-1">
                    All withdrawals are processed through SageCloud's secure payment gateway. 
                    Your balance will be deducted immediately and refunded automatically if the transfer fails.
                  </p>
                </div>
              </div>
            </div>

            {/* Withdraw Button */}
            <Button
              onClick={handleWithdraw}
              className="w-full h-14 text-lg"
              size="lg"
              disabled={
                loading ||
                loadingBalance ||
                !withdrawAmount ||
                withdrawAmount < 1000 ||
                withdrawAmount > cryptoBalance ||
                !bankCode ||
                !accountValidated ||
                !accountName ||
                accountNumber.length !== 10
              }
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Processing Withdrawal...
                </>
              ) : (
                <>
                  <TrendingDown className="w-5 h-5 mr-2" />
                  Withdraw ₦{netAmount.toLocaleString('en-NG', { minimumFractionDigits: 0 })}
                </>
              )}
            </Button>

            {/* Info Footer */}
            <div className="pt-4 border-t space-y-2">
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5" />
                Processing time: 5-30 minutes (instant for most banks)
              </p>
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Your balance is deducted immediately and refunded if transfer fails
              </p>
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5" />
                Powered by SageCloud secure payment gateway
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
