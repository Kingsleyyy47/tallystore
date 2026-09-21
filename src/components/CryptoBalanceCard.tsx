import { useCallback, useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bitcoin, TrendingUp, Loader2, History as HistoryIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/SimpleAuth";
import { useCurrency } from "@/contexts/CurrencyContext";

interface CryptoBalanceCardProps {
  onWithdrawClick?: () => void;
}

export function CryptoBalanceCard({ onWithdrawClick }: CryptoBalanceCardProps) {
  const { isAdmin, showBalances } = useAuth();
  const { formatPrice } = useCurrency();
  const [balance, setBalance] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const navigate = useNavigate();

  const fetchBalances = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        setLoading(false);
        return;
      }

      const { data: profile, error } = await supabase
        .from('profiles')
        .select('crypto_balance')
        .eq('id', user.id)
        .single();

      if (error) throw error;

      setBalance(profile?.crypto_balance || 0);
    } catch (error) {
      console.error('Error fetching balances:', error);
      toast({
        title: "Error",
        description: "Failed to load crypto balance",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Fetch user balances
  useEffect(() => {
    fetchBalances();

    // Subscribe to balance changes
    const channel = supabase
      .channel('crypto_balance_changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
        },
        () => {
          fetchBalances();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchBalances]);

  // Calculate percentage of max balance (for visual feedback)
  const balancePercentage = Math.min((balance / 100000) * 100, 100);

  return (
    <>
      <Card className="overflow-hidden bg-gradient-to-br from-orange-500 to-orange-600 text-white border-none shadow-lg hover:shadow-xl transition-shadow">
        <CardHeader className="pb-3">
          <CardTitle className="flex min-w-0 items-center justify-between gap-3 text-lg sm:text-xl">
            <div className="flex min-w-0 items-center gap-2">
              <Bitcoin className="h-6 w-6 shrink-0" />
              <span>Crypto Balance</span>
            </div>
            {loading && (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Balance Display */}
          <div>
            <div className="mb-1 break-words text-3xl font-bold tracking-tight sm:text-4xl">
              {loading ? (
                <span className="text-3xl">Loading...</span>
              ) : (
                <>{showBalances ? formatPrice(balance) : '***'}</>
              )}
            </div>
            <p className="text-sm text-orange-100">
              {balance === 0 
                ? "Sell crypto to get started" 
                : "Earned from selling crypto"}
            </p>
          </div>

          {/* Visual Balance Bar */}
          {balance > 0 && (
            <div className="w-full h-1 bg-orange-400/30 rounded-full overflow-hidden">
              <div 
                className="h-full bg-white rounded-full transition-all duration-500"
                style={{ width: `${balancePercentage}%` }}
              />
            </div>
          )}

          {/* Action Buttons */}
          <div className="grid gap-2 pt-2 sm:grid-cols-2">
            {balance === 0 ? (
              <Button 
                type="button"
                className="w-full bg-white hover:bg-gray-100 text-orange-600 font-semibold shadow-sm sm:col-span-2"
                disabled
              >
                <TrendingUp className="w-4 h-4 mr-2" />
                Crypto Paused
              </Button>
            ) : (
              <Button
                type="button"
                onClick={() => navigate('/support')}
                className="w-full border-2 border-white/50 bg-white/10 font-semibold text-white backdrop-blur-sm transition-all hover:border-white hover:bg-white hover:text-orange-600 sm:col-span-2"
                disabled={loading}
              >
                <TrendingUp className="w-4 h-4 mr-2" />
                Contact Support
              </Button>
            )}
          </div>

          {/* View Transaction History Link */}
          <div className="flex justify-center pt-2">
            <button
              onClick={() => navigate('/crypto-history')}
              className="flex max-w-full items-center justify-center gap-1 text-center text-xs leading-5 text-orange-100 underline underline-offset-2 hover:text-white"
            >
              <HistoryIcon className="h-3 w-3 shrink-0" />
              View Transaction History
            </button>
          </div>

          {/* Info Footer */}
          {balance > 0 && (
            <div className="pt-2 border-t border-orange-400/30">
              <p className="break-words text-xs leading-5 text-orange-100">
                Crypto balance transfers and withdrawals are paused during security review.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
