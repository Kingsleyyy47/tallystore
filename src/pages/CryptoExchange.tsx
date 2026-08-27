import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Copy, ExternalLink, Loader2, AlertCircle, CheckCircle2, Clock, History, Wallet } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { useNavigate } from "react-router-dom";
import QRCode from "react-qr-code";
import NavbarAuth from "@/components/NavbarAuth";
import PageBreadcrumb from "@/components/PageBreadcrumb";
import { useAuth } from "@/contexts/SimpleAuth";
import { blockStaffPurchase } from "@/lib/staffPurchaseGuard";
import { getRevenueRequestContext, trackRevenueEvent } from "@/lib/revenue-os";
import { useCurrency } from "@/contexts/CurrencyContext";

// ── Allowed coins only ──────────────────────────────────────────────
const COINS = [
  {
    ticker: "usdttrc20",
    label: "USDT",
    network: "TRC-20",
    networkTag: "TRON",
    symbol: "₮",
    color: "text-emerald-500",
    bg: "bg-emerald-50 dark:bg-emerald-950/40",
    border: "border-emerald-200 dark:border-emerald-800",
    selectedBg: "bg-emerald-500",
  },
  {
    ticker: "usdtbsc",
    label: "USDT",
    network: "BEP-20",
    networkTag: "BNB Chain",
    symbol: "₮",
    color: "text-yellow-500",
    bg: "bg-yellow-50 dark:bg-yellow-950/40",
    border: "border-yellow-200 dark:border-yellow-800",
    selectedBg: "bg-yellow-500",
  },
  {
    ticker: "btc",
    label: "BTC",
    network: "Bitcoin",
    networkTag: "Bitcoin",
    symbol: "₿",
    color: "text-orange-500",
    bg: "bg-orange-50 dark:bg-orange-950/40",
    border: "border-orange-200 dark:border-orange-800",
    selectedBg: "bg-orange-500",
  },
  {
    ticker: "eth",
    label: "ETH",
    network: "ERC-20",
    networkTag: "Ethereum",
    symbol: "Ξ",
    color: "text-blue-500",
    bg: "bg-blue-50 dark:bg-blue-950/40",
    border: "border-blue-200 dark:border-blue-800",
    selectedBg: "bg-blue-500",
  },
  {
    ticker: "sol",
    label: "SOL",
    network: "Solana",
    networkTag: "Solana",
    symbol: "◎",
    color: "text-purple-500",
    bg: "bg-purple-50 dark:bg-purple-950/40",
    border: "border-purple-200 dark:border-purple-800",
    selectedBg: "bg-purple-500",
  },
  {
    ticker: "trx",
    label: "TRX",
    network: "TRON",
    networkTag: "TRON",
    symbol: "⬡",
    color: "text-red-500",
    bg: "bg-red-50 dark:bg-red-950/40",
    border: "border-red-200 dark:border-red-800",
    selectedBg: "bg-red-500",
  },
] as const;

type CoinTicker = (typeof COINS)[number]["ticker"];

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
  const [selectedTicker, setSelectedTicker] = useState<CoinTicker>("usdttrc20");
  const [amount, setAmount] = useState("");
  const [nairaAmount, setNairaAmount] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [loadingEstimate, setLoadingEstimate] = useState(false);
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [depositInfo, setDepositInfo] = useState<DepositInfo | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const [copied, setCopied] = useState(false);
  const [minAmount, setMinAmount] = useState<number>(1);
  const { toast } = useToast();
  const navigate = useNavigate();
  const { user: authUser, isStaff, isAdmin } = useAuth();
  const { formatPrice } = useCurrency();

  const selectedCoin = COINS.find((c) => c.ticker === selectedTicker)!;

  // Min amounts per coin
  useEffect(() => {
    const mins: Record<string, number> = { btc: 0.0001, eth: 0.001, sol: 0.01, trx: 10 };
    setMinAmount(mins[selectedTicker] ?? 1);
    setAmount("");
    setNairaAmount(0);
  }, [selectedTicker]);

  // Countdown timer
  useEffect(() => {
    if (!depositInfo) return;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((new Date(depositInfo.expiresAt).getTime() - Date.now()) / 1000));
      setTimeRemaining(remaining);
      if (remaining === 0) { clearInterval(interval); handleExpiry(); }
    }, 1000);
    return () => clearInterval(interval);
  }, [depositInfo]);

  // Price estimate debounce
  useEffect(() => {
    if (!amount || parseFloat(amount) <= 0) { setNairaAmount(0); return; }
    const t = setTimeout(fetchPriceEstimate, 500);
    return () => clearTimeout(t);
  }, [amount, selectedTicker]);

  // Page view tracking
  useEffect(() => {
    const day = new Date().toISOString().slice(0, 10);
    trackRevenueEvent({
      eventType: "PAGE_VIEWED",
      userId: authUser?.id || null,
      surface: "crypto_topup",
      eventId: `PAGE_VIEWED:${day}:crypto_topup:${authUser?.id || "anon"}`,
      metadata: { selected_crypto: selectedTicker.toUpperCase() },
    });
  }, [authUser?.id, selectedTicker]);

  const fetchPriceEstimate = async () => {
    try {
      setLoadingEstimate(true);
      const cryptoAmt = parseFloat(amount);
      if (!cryptoAmt || cryptoAmt <= 0) return;

      const { data, error } = await supabase.functions.invoke("update-crypto-rates", {
        body: { crypto_amount: cryptoAmt, crypto_currency: selectedTicker },
      });
      if (error) throw error;
      if (!data.success) throw new Error(data.error || "Failed to get estimate");
      setNairaAmount(data.ngn_amount);
    } catch {
      setNairaAmount(0);
      toast({ title: "Rate Unavailable", description: "Could not fetch live rate. Please try again.", variant: "destructive" });
    } finally {
      setLoadingEstimate(false);
    }
  };

  const handleTopUp = async () => {
    if (blockStaffPurchase(isStaff, isAdmin, toast)) return;
    const cryptoAmount = parseFloat(amount);
    if (!cryptoAmount || cryptoAmount <= 0) {
      toast({ title: "Invalid Amount", description: "Please enter a valid amount", variant: "destructive" });
      return;
    }
    if (cryptoAmount < minAmount) {
      toast({ title: "Amount Too Low", description: `Minimum is ${minAmount} ${selectedTicker.toUpperCase()}`, variant: "destructive" });
      return;
    }
    if (!nairaAmount || nairaAmount <= 0) {
      toast({ title: "Invalid Conversion", description: "Could not calculate Naira amount. Please try again.", variant: "destructive" });
      return;
    }

    setLoading(true);
    const clientAttemptId = `crypto-topup-${Date.now()}-${globalThis.crypto.randomUUID()}`;

    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        const { data: { session } } = await supabase.auth.refreshSession();
        if (!session) throw new Error("Your session expired. Please log out and log back in.");
      }

      trackRevenueEvent({
        eventType: "BUY_CLICKED",
        userId: authUser?.id || null,
        surface: "crypto_topup",
        eventId: `BUY_CLICKED:crypto_topup:${clientAttemptId}`,
        metadata: { crypto_type: selectedTicker.toUpperCase(), crypto_amount: cryptoAmount, naira_amount: nairaAmount },
      });

      const { data, error } = await supabase.functions.invoke("create-crypto-sell-order", {
        body: {
          crypto_type: selectedTicker.toUpperCase(),
          crypto_amount: cryptoAmount,
          client_display_naira_amount: nairaAmount,
          idempotency_key: clientAttemptId,
          revenue_context: getRevenueRequestContext(),
        },
      });

      if (error) throw new Error(error.message || "Failed to create order");
      if (!data.success) throw new Error(data.error_details || data.error || "Failed to create order");

      const payment = data.payment_details;
      setDepositInfo({
        transactionId: data.transaction_id,
        cryptoType: selectedTicker.toUpperCase(),
        cryptoAmount: payment.pay_amount,
        nairaAmount: Number(data.naira_amount || nairaAmount),
        depositAddress: payment.pay_address,
        expiresAt: payment.expiration_date,
        network: payment.network || "",
        memo: payment.payin_extra_id,
        smartContract: payment.smart_contract,
      });
      setTimeRemaining(Math.max(0, Math.floor((new Date(payment.expiration_date).getTime() - Date.now()) / 1000)));
      setShowDepositModal(true);
      setAmount("");
      setNairaAmount(0);
      toast({ title: "Address Ready!", description: "Send crypto to the address shown to top up your wallet" });
    } catch (error: any) {
      toast({ title: "Failed to Create Order", description: error.message || "Please try again", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleExpiry = () => {
    toast({ title: "Order Expired", description: "This deposit address is no longer valid. Create a new one.", variant: "destructive" });
    setShowDepositModal(false);
    setDepositInfo(null);
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast({ title: `${label} copied!` });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Copy Failed", description: "Please copy manually", variant: "destructive" });
    }
  };

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div className="min-h-screen bg-background">
      <NavbarAuth />

      <div className="container mx-auto max-w-lg px-4 pt-4 sm:px-6">
        <PageBreadcrumb items={[{ label: "Wallet", href: "/wallet" }, { label: "Pay with Crypto" }]} />
      </div>

      {/* Top bar */}
      <div className="container mx-auto flex max-w-lg items-center justify-between gap-3 px-4 pt-3 sm:px-6">
        <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")} className="gap-1 font-semibold">
          ← Back
        </Button>
        <div className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-black">Pay with Crypto</h1>
        </div>
        <Button variant="ghost" size="sm" onClick={() => navigate("/crypto-history")} className="gap-1 font-semibold">
          <History className="h-4 w-4" />
          History
        </Button>
      </div>

      <div className="container mx-auto max-w-lg px-4 py-6 sm:px-6 space-y-5">

        {/* Coin picker */}
        <div>
          <p className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">Choose Coin</p>
          <div className="grid grid-cols-3 gap-2.5">
            {COINS.map((coin) => {
              const active = coin.ticker === selectedTicker;
              return (
                <button
                  key={coin.ticker}
                  onClick={() => setSelectedTicker(coin.ticker)}
                  className={`relative flex flex-col items-center gap-1 rounded-2xl border-2 px-2 py-3 transition-all ${
                    active
                      ? `${coin.border} ${coin.bg} shadow-md scale-[1.03]`
                      : "border-border bg-card hover:border-muted-foreground/40"
                  }`}
                >
                  {active && (
                    <span className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-primary flex items-center justify-center">
                      <CheckCircle2 className="h-3 w-3 text-primary-foreground" />
                    </span>
                  )}
                  <span className={`text-xl font-bold ${active ? coin.color : "text-muted-foreground"}`}>
                    {coin.symbol}
                  </span>
                  <span className={`text-sm font-bold leading-none ${active ? "text-foreground" : "text-muted-foreground"}`}>
                    {coin.label}
                  </span>
                  <span className={`text-[10px] font-medium rounded-full px-1.5 py-0.5 ${
                    active ? `${coin.bg} ${coin.color} border ${coin.border}` : "bg-muted text-muted-foreground"
                  }`}>
                    {coin.network}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Amount input */}
        <div className="space-y-2">
          <Label className="text-sm font-semibold">Amount to Send</Label>
          <div className="relative">
            <Input
              type="number"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              step={["btc", "eth"].includes(selectedTicker) ? "0.00000001" : "0.01"}
              min="0"
              className="h-14 text-lg pr-24 rounded-xl"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground uppercase">
              {selectedCoin.label} {selectedCoin.network}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Min: {minAmount} {selectedCoin.label} · Network: {selectedCoin.networkTag}
          </p>
        </div>

        {/* Preview */}
        {loadingEstimate ? (
          <div className="flex items-center justify-center gap-2 py-5 rounded-2xl bg-muted/50">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm text-muted-foreground">Fetching live rate…</span>
          </div>
        ) : nairaAmount > 0 ? (
          <div className="rounded-2xl border bg-card p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Live Rate</span>
              <span className="font-medium text-green-600">Updated live ✓</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Fee</span>
              <span className="font-medium text-muted-foreground">5% included</span>
            </div>
            <div className="border-t pt-3 flex justify-between items-center">
              <span className="font-semibold">Wallet Credit</span>
              <span className="text-2xl font-black text-primary">{formatPrice(nairaAmount)}</span>
            </div>
          </div>
        ) : amount && parseFloat(amount) > 0 ? (
          <div className="rounded-2xl border bg-muted/40 py-4 text-center text-sm text-muted-foreground">
            Enter a valid amount to see your wallet credit
          </div>
        ) : null}

        {/* CTA */}
        <Button
          onClick={handleTopUp}
          className="w-full h-14 text-base font-bold rounded-xl"
          disabled={loading || loadingEstimate || !amount || parseFloat(amount) <= 0 || nairaAmount <= 0}
        >
          {loading ? (
            <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> Creating Order…</>
          ) : (
            <>Get Deposit Address</>
          )}
        </Button>

        {/* Info pills */}
        <div className="flex flex-wrap gap-2">
          {[
            { icon: Clock, text: "5–20 min after confirmation" },
            { icon: CheckCircle2, text: "Auto-credited to wallet" },
          ].map(({ icon: Icon, text }) => (
            <div key={text} className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted rounded-full px-3 py-1.5">
              <Icon className="h-3 w-3 flex-shrink-0" />
              {text}
            </div>
          ))}
        </div>
      </div>

      {/* Deposit Modal */}
      <Dialog open={showDepositModal} onOpenChange={setShowDepositModal}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl">Send {depositInfo?.cryptoType} to Top Up</DialogTitle>
            <DialogDescription>
              Send exactly <strong>{depositInfo?.cryptoAmount} {depositInfo?.cryptoType}</strong> to the address below. Funds will be credited automatically.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* QR */}
            <div className="flex justify-center p-4 bg-white rounded-xl border-2 border-dashed">
              {depositInfo && (
                <QRCode
                  value={depositInfo.memo
                    ? `${depositInfo.cryptoType.toLowerCase()}:${depositInfo.depositAddress}?dt=${depositInfo.memo}`
                    : depositInfo.depositAddress}
                  size={180}
                  level="M"
                />
              )}
            </div>

            {/* Address */}
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold">Deposit Address</Label>
              <div className="flex gap-2">
                <Input value={depositInfo?.depositAddress || ""} readOnly className="font-mono text-xs" />
                <Button variant="outline" size="icon" className="flex-shrink-0" onClick={() => copyToClipboard(depositInfo?.depositAddress || "", "Address")}>
                  {copied ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              {depositInfo?.network && (
                <p className="text-xs text-muted-foreground">Network: <strong>{depositInfo.network.toUpperCase()}</strong></p>
              )}
            </div>

            {/* Memo */}
            {depositInfo?.memo && (
              <div className="rounded-xl border-2 border-yellow-400 bg-yellow-50 dark:bg-yellow-950/40 p-3 space-y-2">
                <p className="text-sm font-bold text-yellow-900 dark:text-yellow-300 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" /> MEMO / TAG Required
                </p>
                <div className="flex gap-2">
                  <Input value={depositInfo.memo} readOnly className="font-mono text-xs bg-white" />
                  <Button variant="outline" size="icon" className="flex-shrink-0" onClick={() => copyToClipboard(depositInfo.memo!, "Memo")}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-yellow-800 dark:text-yellow-400">⚠️ Missing memo = permanent loss of funds</p>
              </div>
            )}

            {/* Network warning */}
            <div className="rounded-xl border-2 border-red-400 bg-red-50 dark:bg-red-950/40 p-3">
              <p className="text-sm font-bold text-red-900 dark:text-red-300 flex items-center gap-2">
                <AlertCircle className="h-4 w-4" /> Use Correct Network
              </p>
              <p className="text-xs text-red-800 dark:text-red-400 mt-1">
                Network: <strong>{depositInfo?.network?.toUpperCase() || "CHECK YOUR WALLET"}</strong>
                <br />⚠️ Wrong network = permanent loss of funds
              </p>
            </div>

            {/* Timer */}
            <div className={`rounded-xl border-2 p-3 flex items-center justify-between ${
              timeRemaining < 300 ? "border-red-300 bg-red-50 dark:bg-red-950/40" : "border-amber-300 bg-amber-50 dark:bg-amber-950/40"
            }`}>
              <span className={`text-sm font-medium ${timeRemaining < 300 ? "text-red-800 dark:text-red-300" : "text-amber-800 dark:text-amber-300"}`}>
                Time Remaining
              </span>
              <span className={`text-2xl font-black tabular-nums ${timeRemaining < 300 ? "text-red-700" : "text-amber-700"}`}>
                {formatTime(timeRemaining)}
              </span>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => { setShowDepositModal(false); navigate("/crypto-history"); }}>
                <ExternalLink className="h-4 w-4 mr-2" /> Track Status
              </Button>
              <Button className="flex-1" onClick={() => { setShowDepositModal(false); navigate("/crypto-history"); }}>
                I've Sent It
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
