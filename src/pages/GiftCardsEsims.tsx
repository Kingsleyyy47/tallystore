import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Gift,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Info,
  Clock,
  XCircle,
  Wallet,
  Bitcoin,
  Search,
  Copy,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase, getAppSetting } from "@/lib/supabase";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { useAuth } from "@/contexts/SimpleAuth";
import { useExchangeRate } from "@/hooks/useExchangeRate";
import NavbarAuth from "@/components/NavbarAuth";
import PageBreadcrumb from "@/components/PageBreadcrumb";
import { blockStaffPurchase } from "@/lib/staffPurchaseGuard";
import { getRevenueRequestContext, getRevenueVisitorId, trackRevenueEvent } from "@/lib/revenue-os";
import { RecommendationStrip } from "@/components/RecommendationCard";
import { useRecommendations } from "@/hooks/useRecommendations";
import { useCurrency } from "@/contexts/CurrencyContext";

interface BitrefillPackage {
  package_id: string;
  value: number;
}

interface BitrefillRange {
  min: number;
  max: number;
  step: number;
}

interface BitrefillProduct {
  product_id: string;
  name: string;
  currency?: string;
  recipient_type?: string;
  packages?: BitrefillPackage[];
  range?: BitrefillRange;
  _score?: number;
  _personal_buy_count?: number;
}

interface BitrefillOrder {
  id: string;
  reference: string;
  product_name: string;
  quantity: number;
  amount_ngn: number;
  payment_source: string;
  status: string;
  redemption_code: string | null;
  redemption_link: string | null;
  redemption_pin: string | null;
  created_at: string;
}

function GiftCardsComingSoon() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-background">
      <NavbarAuth />
      <div className="container mx-auto max-w-lg px-4 pt-4 sm:px-6">
        <PageBreadcrumb items={[{ label: 'Home', href: '/' }, { label: 'Gift Cards' }]} />
      </div>
      <div className="container mx-auto max-w-lg px-4 py-16 sm:px-6 flex flex-col items-center text-center gap-6">
        <div className="rounded-full bg-amber-100 dark:bg-amber-950/50 p-6">
          <Gift className="h-14 w-14 text-amber-500" />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-center gap-2 mb-1">
            <Clock className="h-4 w-4 text-amber-500" />
            <span className="text-xs font-semibold uppercase tracking-widest text-amber-600 dark:text-amber-400">Coming Soon</span>
          </div>
          <h1 className="text-3xl font-black">Gift Cards</h1>
          <p className="text-muted-foreground max-w-sm">
            Gift cards are being upgraded. Check back soon — we're working on something great.
          </p>
        </div>
        <div className="rounded-2xl border bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 px-6 py-4 max-w-sm w-full">
          <p className="text-sm text-amber-800 dark:text-amber-300 font-medium">
            In the meantime, you can top up your wallet and shop other products.
          </p>
        </div>
        <Button onClick={() => navigate('/dashboard')} className="rounded-xl px-8">
          Back to Dashboard
        </Button>
      </div>
    </div>
  );
}

export default function GiftCardsEsims() {
  return <GiftCardsEsimsInner />;
}

function GiftCardsEsimsInner() {
  const { user, isAdmin, isStaff, showBalances } = useAuth();
  const { recommendations: recs } = useRecommendations({ limit: 3 });
  const { formatPrice } = useCurrency();

  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [cryptoBalance, setCryptoBalance] = useState<number>(0);
  const [paymentSource, setPaymentSource] = useState<'wallet' | 'crypto'>('wallet');
  const [loadingBalance, setLoadingBalance] = useState(true);

  const [searchQuery, setSearchQuery] = useState('');
  const [products, setProducts] = useState<BitrefillProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);

  const [selectedProduct, setSelectedProduct] = useState<BitrefillProduct | null>(null);
  const [selectedPackageId, setSelectedPackageId] = useState<string>('');
  const [customValue, setCustomValue] = useState<string>('');
  const [quantity, setQuantity] = useState<string>('1');
  const [purchasing, setPurchasing] = useState(false);

  const [orders, setOrders] = useState<BitrefillOrder[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Markup % (app_settings.bitrefill_markup_pct, admin-adjustable) applied on
  // top of the live NGN-converted price, mirroring the server-side charge in
  // purchase-bitrefill so customers see the real price before they buy.
  const [markupPct, setMarkupPct] = useState<number>(0);
  const { rate: exchangeRate } = useExchangeRate();

  const { toast } = useToast();
  const navigate = useNavigate();

  const recentGiftSearchTerms = useMemo(() => {
    const seen = new Set<string>();
    return orders
      .filter((order) => ['successful', 'completed', 'success'].includes(String(order.status || '').toLowerCase()))
      .map((order) => String(order.product_name || '').trim())
      .filter((name) => {
        const key = name.toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 6);
  }, [orders]);

  const personalGiftProductCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const order of orders) {
      if (!['successful', 'completed', 'success'].includes(String(order.status || '').toLowerCase())) continue;
      const key = String(order.product_name || '').trim().toLowerCase();
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }, [orders]);

  useEffect(() => {
    fetchBalance();
    fetchOrderHistory();
    getAppSetting('bitrefill_markup_pct').then((value) => {
      const parsed = value ? parseFloat(value) : 0;
      if (!isNaN(parsed) && parsed >= 0) setMarkupPct(parsed);
    });
  }, []);

  useEffect(() => {
    const day = new Date().toISOString().slice(0, 10);
    trackRevenueEvent({
      eventType: 'PAGE_VIEWED',
      userId: user?.id || null,
      surface: 'giftcards_esims',
      eventId: `PAGE_VIEWED:${day}:giftcards_esims:${user?.id || 'anon'}`,
      metadata: { exchange_rate_loaded: !!exchangeRate },
    });
  }, [exchangeRate, user?.id]);

  useEffect(() => {
    if (products.length === 0) return;
    const day = new Date().toISOString().slice(0, 10);
    const actorKey = user?.id || getRevenueVisitorId() || 'anonymous';
    products.slice(0, 24).forEach((product, index) => {
      trackRevenueEvent({
        eventType: 'PRODUCT_IMPRESSION',
        userId: user?.id || null,
        surface: 'giftcards_esims_search',
        eventId: `PRODUCT_IMPRESSION:${day}:${actorKey}:bitrefill:${searchQuery.trim().toLowerCase() || 'browse'}:${product.product_id}`,
        metadata: {
          bitrefill_product_id: product.product_id,
          product_name: product.name,
          product_currency: product.currency || null,
          query: searchQuery.trim(),
          position: index + 1,
          package_count: product.packages?.length || 0,
          has_range: !!product.range,
          recommended_score: product._score || 0,
          personal_buy_count: product._personal_buy_count || 0,
        },
      });
    });
  }, [products, searchQuery, user?.id]);

  // Converts a Bitrefill USD (or other listed currency) price to the NGN
  // amount the customer will actually be charged: live rate + admin markup,
  // same formula as convertToNgn()/chargeNgn in purchase-bitrefill/index.ts.
  const toNgn = (value: number, currency?: string) => {
    if (!value || !exchangeRate) return 0;
    // Bitrefill product currencies are USD-denominated in practice for this
    // catalog; treat anything else as already-USD-equivalent for display.
    const usdEquivalent = !currency || currency === 'USD' ? value : value;
    return Math.ceil(usdEquivalent * exchangeRate * (1 + markupPct / 100));
  };

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
      toast({ title: "Error", description: "Failed to load balance", variant: "destructive" });
    } finally {
      setLoadingBalance(false);
    }
  };

  const selectedBalance = paymentSource === 'wallet' ? walletBalance : cryptoBalance;
  const formatBalance = (value: number) =>
    showBalances ? formatPrice(value) : '***';

  const fetchOrderHistory = async () => {
    try {
      setLoadingHistory(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('bitrefill_orders')
        .select(`
          id, reference, product_name, quantity, amount_ngn, payment_source,
          status, redemption_code, redemption_link, redemption_pin, created_at
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;
      setOrders(data || []);
    } catch (error) {
      console.error('Error fetching order history:', error);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleSearch = async (overrideQuery?: string) => {
    const queryText = String(overrideQuery ?? searchQuery).trim();
    if (!queryText) {
      toast({ title: "Enter a search term", description: "Try a brand name like \"Amazon\" or \"Steam\"", variant: "destructive" });
      return;
    }

    if (overrideQuery != null) setSearchQuery(queryText);
    setLoadingProducts(true);
    setSelectedProduct(null);
    trackRevenueEvent({
      eventType: 'SEARCHED',
      userId: user?.id || null,
      surface: 'giftcards_esims',
      eventId: `SEARCHED:bitrefill:${Date.now()}:${queryText.toLowerCase()}`,
      metadata: {
        query: queryText,
        category: 'gift card',
        source: overrideQuery != null ? 'customer_recent_purchase_chip' : 'manual_search',
      },
    });
    try {
      const response = await supabase.functions.invoke('bitrefill-catalog', {
        body: {
          action: 'search',
          query: queryText,
          category: 'gift card',
          limit: 24,
        },
      });

      if (response.error) throw response.error;
      const { data } = response;

      if (!data.success) throw new Error(data.error || 'Search failed');

      const queryTerms = queryText.toLowerCase().split(/\s+/).filter(Boolean);
      const rankedProducts = [...(data.data?.data || [])].map((product: BitrefillProduct) => {
        const productName = String(product.name || '').trim();
        const normalizedName = productName.toLowerCase();
        const personalBuyCount = personalGiftProductCounts.get(normalizedName) || 0;
        const queryScore = queryTerms.filter((term) => normalizedName.includes(term)).length;
        const packageFit = product.packages?.length ? 20 : 0;
        const rangeFit = product.range ? 15 : 0;
        const _score = personalBuyCount * 1400 + queryScore * 300 + packageFit + rangeFit;
        return { ...product, _score, _personal_buy_count: personalBuyCount };
      }).sort((left, right) =>
        Number(right._score || 0) - Number(left._score || 0) ||
        String(left.name || '').localeCompare(String(right.name || ''))
      );

      setProducts(rankedProducts);
    } catch (error: any) {
      console.error('Error searching products:', error);
      setProducts([]);
      toast({ title: "Search failed", description: error.message || "Please try again", variant: "destructive" });
    } finally {
      setLoadingProducts(false);
    }
  };

  const handleSelectProduct = (product: BitrefillProduct) => {
    setSelectedProduct(product);
    setSelectedPackageId('');
    setCustomValue('');
    trackRevenueEvent({
      eventType: 'PRODUCT_CLICKED',
      userId: user?.id || null,
      surface: 'giftcards_esims',
      eventId: `PRODUCT_CLICKED:bitrefill:${crypto.randomUUID()}:${product.product_id}`,
      metadata: {
        bitrefill_product_id: product.product_id,
        product_name: product.name,
        product_currency: product.currency || null,
        package_count: product.packages?.length || 0,
        has_range: !!product.range,
        recommended_score: product._score || 0,
        personal_buy_count: product._personal_buy_count || 0,
      },
    });
  };

  const selectedUnitPrice = useMemo(() => {
    if (selectedProduct?.packages && selectedPackageId) {
      const pkg = selectedProduct.packages.find(p => p.package_id === selectedPackageId);
      return pkg?.value || 0;
    }
    return parseFloat(customValue) || 0;
  }, [customValue, selectedPackageId, selectedProduct]);

  const selectedQuantity = useMemo(() => parseInt(quantity, 10) || 1, [quantity]);
  const selectedExpectedAmountNgn = useMemo(() => {
    if (!selectedUnitPrice || !exchangeRate) return 0;
    return Math.ceil(selectedUnitPrice * selectedQuantity * exchangeRate * (1 + markupPct / 100));
  }, [exchangeRate, markupPct, selectedQuantity, selectedUnitPrice]);

  const getUnitPrice = (): number => selectedUnitPrice;

  useEffect(() => {
    if (!selectedProduct) return;
    if (!selectedUnitPrice || selectedUnitPrice <= 0) return;
    if (!selectedExpectedAmountNgn || selectedExpectedAmountNgn <= 0) return;

    const day = new Date().toISOString().slice(0, 10);
    trackRevenueEvent({
      eventType: 'PAYMENT_PROVIDER_LOADED',
      userId: user?.id || null,
      surface: 'giftcards_esims',
      eventId: `PAYMENT_PROVIDER_LOADED:${day}:bitrefill:${user?.id || 'anon'}:${selectedProduct.product_id}:${selectedPackageId || 'custom'}:${selectedUnitPrice}:${selectedQuantity}:${paymentSource}`,
      metadata: {
        provider: paymentSource,
        bitrefill_product_id: selectedProduct.product_id,
        product_name: selectedProduct.name,
        package_id: selectedPackageId || null,
        unit_value: selectedUnitPrice,
        quantity: selectedQuantity,
        expected_amount_ngn: selectedExpectedAmountNgn,
        recommended_score: selectedProduct._score || 0,
        personal_buy_count: selectedProduct._personal_buy_count || 0,
      },
    });
  }, [paymentSource, selectedExpectedAmountNgn, selectedPackageId, selectedProduct, selectedQuantity, selectedUnitPrice, user?.id]);

  const handlePurchase = async () => {
    if (blockStaffPurchase(isStaff, isAdmin, toast)) return;

    if (!selectedProduct) {
      toast({ title: "Select a product", description: "Choose a gift card first", variant: "destructive" });
      return;
    }

    const unitPrice = getUnitPrice();
    if (!unitPrice || unitPrice <= 0) {
      toast({ title: "Select an amount", description: "Choose a denomination or enter an amount", variant: "destructive" });
      return;
    }

    const qty = parseInt(quantity, 10) || 1;
    const expectedAmountNgn = toNgn(unitPrice * qty, selectedProduct.currency);
    if (!expectedAmountNgn || expectedAmountNgn <= 0) {
      toast({ title: "Price unavailable", description: "Please wait for the exchange rate to load, then try again.", variant: "destructive" });
      return;
    }

    setPurchasing(true);
    const idempotencyKey = `${Date.now()}-${crypto.randomUUID()}`;
    trackRevenueEvent({
      eventType: 'BUY_CLICKED',
      userId: user?.id || null,
      surface: 'giftcards_esims',
      eventId: `BUY_CLICKED:bitrefill:${idempotencyKey}`,
      metadata: {
        bitrefill_product_id: selectedProduct.product_id,
        product_name: selectedProduct.name,
        package_id: selectedPackageId || null,
        unit_value: unitPrice,
        quantity: qty,
        expected_amount_ngn: expectedAmountNgn,
        payment_source: paymentSource,
        recommended_score: selectedProduct._score || 0,
        personal_buy_count: selectedProduct._personal_buy_count || 0,
      },
    });

    try {
      const requestBody = {
        product_id: selectedProduct.product_id,
        product_name: selectedProduct.name,
        package_id: selectedPackageId || undefined,
        value: selectedPackageId ? undefined : unitPrice,
        quantity: qty,
        payment_source: paymentSource,
        idempotency_key: idempotencyKey,
        expected_amount_ngn: expectedAmountNgn,
        revenue_context: getRevenueRequestContext(),
      };

      const response = await supabase.functions.invoke('purchase-bitrefill', {
        body: requestBody,
      });

      if (response.error) {
        throw new Error(response.data?.error || response.error.message || 'Purchase failed');
      }

      const { data } = response;
      if (!data.success) throw new Error(data.error || 'Purchase failed');

      toast({
        title: "Success! ✅",
        description: data.redemption?.code
          ? `Code: ${data.redemption.code}`
          : `${selectedProduct.name} purchase ${data.status === 'successful' ? 'complete' : 'is being processed'}`,
      });

      setSelectedProduct(null);
      setSelectedPackageId('');
      setCustomValue('');
      setQuantity('1');

      fetchBalance();
      fetchOrderHistory();
    } catch (error: any) {
      console.error('Purchase failed:', error);
      toast({ title: "Purchase Failed", description: error.message || 'Please try again', variant: "destructive" });
    } finally {
      setPurchasing(false);
    }
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast({ title: "Copied", description: "Redemption code copied to clipboard" });
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { variant: any; icon: any; label: string }> = {
      pending: { variant: "secondary", icon: Clock, label: "Processing" },
      successful: { variant: "default", icon: CheckCircle2, label: "Successful" },
      failed: { variant: "destructive", icon: XCircle, label: "Failed" },
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

  const totalPrice = getUnitPrice() * (parseInt(quantity, 10) || 1);

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted/20">
      <NavbarAuth />

      <div className="container mx-auto max-w-6xl px-4 pt-4 sm:px-6">
        <PageBreadcrumb items={[{ label: 'Wallet', href: '/wallet' }, { label: 'Gift Cards' }]} />
      </div>

      <div className="container mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 pt-4 sm:px-6">
        <Button variant="outline" size="sm" onClick={() => navigate('/dashboard')} className="gap-1 rounded-xl font-bold">
          ← Wallet
        </Button>
        <div className="flex min-w-0 items-center gap-2">
          <Gift className="h-5 w-5 shrink-0 text-primary" />
          <h1 className="truncate text-lg font-black">Gift Cards</h1>
        </div>
        <div className="w-[72px]" />
      </div>

      <div className="relative">
        <div
          className="container mx-auto p-4 sm:p-6 max-w-6xl"
        >
        <div className="text-center mb-6 sm:mb-8 pt-2 sm:pt-4">
          <h2 className="text-xl sm:text-2xl md:text-3xl font-bold text-foreground mb-2">
            Gift Cards
          </h2>
          <p className="text-sm sm:text-base text-muted-foreground px-4">
            Thousands of brands worldwide • Priced in Naira
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
                        {formatBalance(walletBalance)}
                      </p>
                    )}
                  </div>

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
                        {formatBalance(cryptoBalance)}
                      </p>
                    )}
                  </div>
                </div>

                <div className={`mt-4 p-3 rounded-lg flex items-center justify-between ${
                  paymentSource === 'wallet' ? 'bg-green-100 dark:bg-green-900/30' : 'bg-orange-100 dark:bg-orange-900/30'
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
                    paymentSource === 'wallet' ? 'text-green-700 dark:text-green-400' : 'text-orange-700 dark:text-orange-400'
                  }`}>
                    {formatBalance(selectedBalance)}
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

            {/* Browse & Purchase */}
            <Card className="shadow-xl">
              <CardHeader className="bg-gradient-to-r from-muted/50 to-muted/30 border-b">
                <CardTitle className="flex items-center gap-2 text-2xl">
                  <Gift className="w-7 h-7 text-primary" />
                  Browse
                </CardTitle>
                <CardDescription>Search gift cards by brand</CardDescription>
              </CardHeader>
              <CardContent className="pt-6 space-y-6">
                {/* Search bar */}
                <div className="flex gap-2">
                  <Input
                    placeholder='Search by brand, e.g. "Amazon"'
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    className="h-12"
                  />
                  <Button onClick={handleSearch} disabled={loadingProducts} className="h-12 px-6">
                    {loadingProducts ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
                  </Button>
                </div>

                {/* Product results */}
                {loadingProducts ? (
                  <div className="p-6 bg-muted/50 rounded-lg border-2 border-dashed text-center">
                    <Loader2 className="w-10 h-10 mx-auto mb-3 text-muted-foreground animate-spin" />
                    <p className="text-muted-foreground">Searching catalog...</p>
                  </div>
                ) : products.length === 0 ? (
                  <div className="p-6 bg-muted/50 rounded-lg border-2 border-dashed text-center">
                    <AlertCircle className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                    <p className="text-muted-foreground">Search for a brand or country to get started</p>
                    {recentGiftSearchTerms.length > 0 && (
                      <div className="mt-4 flex flex-wrap justify-center gap-2">
                        {recentGiftSearchTerms.map((term) => (
                          <Button key={term} type="button" variant="outline" size="sm" onClick={() => handleSearch(term)}>
                            {term}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[300px] overflow-y-auto p-1">
                    {products.map((product) => (
                      <Card
                        key={product.product_id}
                        className={`cursor-pointer transition-all hover:shadow-md ${
                          selectedProduct?.product_id === product.product_id
                            ? 'ring-2 ring-primary bg-primary/5'
                            : 'hover:border-primary'
                        }`}
                        onClick={() => handleSelectProduct(product)}
                      >
                        <CardContent className="p-3">
                          <p className="font-medium text-sm truncate">{product.name}</p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}

                {/* Denomination / amount selection */}
                {selectedProduct && (
                  <div className="space-y-4 pt-2 border-t">
                    <p className="font-semibold">{selectedProduct.name}</p>

                    {selectedProduct.packages && selectedProduct.packages.length > 0 ? (
                      <div className="space-y-2">
                        <Label className="text-base font-medium">Select Denomination</Label>
                        <div className="grid grid-cols-3 gap-2">
                          {selectedProduct.packages.map((pkg) => (
                            <Button
                              key={pkg.package_id}
                              type="button"
                              variant={selectedPackageId === pkg.package_id ? "default" : "outline"}
                              onClick={() => setSelectedPackageId(pkg.package_id)}
                              className="h-auto py-2 flex-col gap-0.5"
                            >
                              <span className="font-semibold">{formatPrice(toNgn(pkg.value, selectedProduct.currency))}</span>
                              <span className="text-xs opacity-70">{pkg.value} {selectedProduct.currency || 'USD'}</span>
                            </Button>
                          ))}
                        </div>
                      </div>
                    ) : selectedProduct.range ? (
                      <div className="space-y-2">
                        <Label htmlFor="custom-amount" className="text-base font-medium">
                          Amount ({selectedProduct.currency || 'USD'})
                        </Label>
                        <Input
                          id="custom-amount"
                          type="number"
                          placeholder={`${selectedProduct.range.min} - ${selectedProduct.range.max}`}
                          value={customValue}
                          onChange={(e) => setCustomValue(e.target.value)}
                          min={selectedProduct.range.min}
                          max={selectedProduct.range.max}
                          step={selectedProduct.range.step}
                          className="h-12"
                        />
                        <p className="text-xs text-muted-foreground">
                          Min: {selectedProduct.range.min} | Max: {selectedProduct.range.max}
                          {customValue && parseFloat(customValue) > 0 && (
                            <> • ≈ {formatPrice(toNgn(parseFloat(customValue), selectedProduct.currency))}</>
                          )}
                        </p>
                      </div>
                    ) : null}

                    <div className="space-y-2">
                      <Label htmlFor="quantity-input" className="text-base font-medium">Quantity</Label>
                      <Input
                        id="quantity-input"
                        type="number"
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                        min={1}
                        max={20}
                        className="h-12 w-32"
                      />
                    </div>

                    {totalPrice > 0 && (
                      <div className="p-3 bg-primary/5 rounded-lg border border-primary/20">
                        <p className="text-sm text-muted-foreground">Total</p>
                        <p className="text-2xl font-bold text-foreground">
                          {formatPrice(toNgn(totalPrice, selectedProduct.currency))}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {totalPrice.toFixed(2)} {selectedProduct.currency || 'USD'} at today's rate
                        </p>
                      </div>
                    )}

                    <Button
                      onClick={handlePurchase}
                      className="w-full h-14 text-lg"
                      size="lg"
                      disabled={purchasing || loadingBalance || !getUnitPrice()}
                    >
                      {purchasing ? (
                        <>
                          <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                          Processing...
                        </>
                      ) : (
                        <>Buy {selectedProduct.name}</>
                      )}
                    </Button>

                    <div className="pt-2 space-y-2">
                      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <Info className="w-3.5 h-3.5" />
                        Redemption codes are delivered instantly to your order history below
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right Column - Order History */}
          <div className="lg:col-span-1">
            <Card className="shadow-xl">
              <CardHeader className="bg-gradient-to-r from-muted/50 to-muted/30 border-b">
                <CardTitle className="text-lg">Recent Orders</CardTitle>
                <CardDescription>Last 10 purchases</CardDescription>
              </CardHeader>
              <CardContent className="pt-6">
                {loadingHistory ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : orders.length === 0 ? (
                  <div className="text-center py-8">
                    <Gift className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">No orders yet</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {orders.map((order) => (
                      <Card key={order.id} className="border">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between mb-2">
                            <span className="font-medium text-sm truncate">{order.product_name}</span>
                            {getStatusBadge(order.status)}
                          </div>
                          <div className="space-y-1 text-xs text-muted-foreground">
                            <p className="font-semibold text-foreground">
                              {formatPrice(order.amount_ngn)} x{order.quantity}
                            </p>
                            {order.redemption_code && (
                              <div className="flex items-center gap-1.5 mt-1">
                                <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{order.redemption_code}</code>
                                <button onClick={() => copyCode(order.redemption_code!)}>
                                  <Copy className="w-3 h-3" />
                                </button>
                              </div>
                            )}
                            {order.redemption_link && (
                              <a href={order.redemption_link} target="_blank" rel="noopener noreferrer" className="text-primary underline text-xs">
                                Open redemption link
                              </a>
                            )}
                            <p className="text-xs">
                              {formatDistanceToNow(new Date(order.created_at), { addSuffix: true })}
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
      {recs.length > 0 && (
        <div className="px-4 pb-10 max-w-7xl mx-auto">
          <RecommendationStrip products={recs} surface="gift_cards_esims_page" actionType="SHOW_ALTERNATIVE" userId={user?.id} title="Explore more products" />
        </div>
      )}
    </div>
  );
}
