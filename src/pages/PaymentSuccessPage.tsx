import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Loader2, XCircle, ArrowLeft, Wallet } from 'lucide-react';
import { useAuth } from '@/contexts/SimpleAuth';
import { useToast } from '@/hooks/use-toast';
import { verifyAndCreditWalletSecure } from '@/lib/supabase';
import { useSupportSettings } from '@/hooks/useSupportSettings';
import NavbarAuth from '@/components/NavbarAuth';
import Footer from '@/components/Footer';
import { trackRevenueEvent } from '@/lib/revenue-os';
import { useCurrency } from '@/contexts/CurrencyContext';
import { RecommendationStrip } from '@/components/RecommendationCard';
import { useRecommendations } from '@/hooks/useRecommendations';

export default function PaymentSuccessPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, refreshWalletBalance, showBalances } = useAuth();
  const { formatPrice } = useCurrency();
  const { toast } = useToast();
  const support = useSupportSettings();
  const supportUrl = support.whatsappUrl || support.telegramUrl || '';

  const [isVerifying, setIsVerifying] = useState(true);
  const [verificationResult, setVerificationResult] = useState<{
    success: boolean;
    status: string;
    amount: number;
    message: string;
  } | null>(null);
  const paymentVerified = verificationResult?.success === true;
  const { recommendations } = useRecommendations({ enabled: paymentVerified, limit: 3 });

  useEffect(() => {
    trackRevenueEvent({
      eventType: 'PAGE_VIEWED',
      userId: user?.id || null,
      surface: 'payment_success',
      metadata: {
        has_reference: Boolean(
          searchParams.get('transactionReference') ||
          searchParams.get('tx_ref') ||
          searchParams.get('reference')
        ),
      },
    });
  }, [searchParams, user?.id]);

  useEffect(() => {
    const verifyPaymentStatus = async () => {
      // Try to get transaction reference from URL params
      const transactionRef = searchParams.get('transactionReference') || 
                            searchParams.get('tx_ref') || 
                            searchParams.get('reference');
      
      // Also check localStorage for pending transaction
      const pendingTopup = localStorage.getItem('pending_topup');
      let storedTransaction = null;
      
      if (pendingTopup) {
        try {
          storedTransaction = JSON.parse(pendingTopup);
        } catch (e) {
          console.error('Error parsing stored transaction:', e);
        }
      }

      const transactionReference = transactionRef || storedTransaction?.transactionReference;

      if (!transactionReference) {
        trackRevenueEvent({
          eventType: 'OFFER_DISMISSED',
          userId: user?.id || null,
          surface: 'payment_success_missing_reference',
        });
        setVerificationResult({
          success: false,
          status: 'error',
          amount: 0,
          message: 'No transaction reference found. Please contact support if you made a payment.'
        });
        setIsVerifying(false);
        return;
      }

      try {
        // SECURE: Use Edge Function to verify payment AND credit wallet server-side
        const result = await verifyAndCreditWalletSecure(transactionReference);

        if (result.success) {
          await refreshWalletBalance();
          trackRevenueEvent({
            eventType: 'OFFER_ACCEPTED',
            userId: user?.id || null,
            surface: 'payment_success_verified',
            metadata: {
              already_processed: Boolean(result.already_processed),
              amount_ngn: result.amount || 0,
            },
          });

          // Clear pending transaction
          localStorage.removeItem('pending_topup');

          const message = result.already_processed 
            ? `Payment already processed. Your wallet balance is up to date.`
            : showBalances
              ? `Payment successful! ${formatPrice(result.amount || 0)} has been added to your wallet.`
              : `Payment successful! Your wallet has been updated.`;

          setVerificationResult({
            success: true,
            status: 'success',
            amount: result.amount || 0,
            message
          });

          toast({
            title: result.already_processed ? "Payment Already Processed" : "Payment Successful!",
            description: message,
          });
        } else {
          // Payment failed or pending
          trackRevenueEvent({
            eventType: 'OFFER_DISMISSED',
            userId: user?.id || null,
            surface: 'payment_success_failed',
            metadata: {
              reason: result.error || 'verification_failed',
              stored_amount_ngn: storedTransaction?.amount || 0,
            },
          });
          setVerificationResult({
            success: false,
            status: 'failed',
            amount: storedTransaction?.amount || 0,
            message: result.error || 'Payment verification failed. Please try again or contact support.'
          });
        }

      } catch (error: any) {
        console.error('❌ Payment verification error:', error);
        trackRevenueEvent({
          eventType: 'OFFER_DISMISSED',
          userId: user?.id || null,
          surface: 'payment_success_error',
          metadata: {
            reason: error?.message || 'unexpected_error',
            stored_amount_ngn: storedTransaction?.amount || 0,
          },
        });
        setVerificationResult({
          success: false,
          status: 'error',
          amount: storedTransaction?.amount || 0,
          message: 'Error verifying payment. Please contact support if you made a payment.'
        });
      } finally {
        setIsVerifying(false);
      }
    };

    verifyPaymentStatus();
  }, [formatPrice, searchParams, refreshWalletBalance, showBalances, toast, user?.id]);

  const handleBackToWallet = () => {
    trackRevenueEvent({
      eventType: 'OFFER_ACCEPTED',
      userId: user?.id || null,
      surface: 'payment_success_wallet_cta',
      metadata: { success: Boolean(verificationResult?.success) },
    });
    navigate('/wallet');
  };

  const handleRetryPayment = () => {
    trackRevenueEvent({
      eventType: 'OFFER_ACCEPTED',
      userId: user?.id || null,
      surface: 'payment_success_retry_cta',
    });
    navigate('/wallet');
  };

  if (isVerifying) {
    return (
      <div className="min-h-screen bg-background">
        <NavbarAuth />
        <main className="mx-auto grid min-h-[60vh] max-w-md place-items-center px-4 py-10">
        <Card className="w-full rounded-2xl border-slate-200 bg-white/85 shadow-sm dark:border-white/10 dark:bg-white/[0.035]">
          <CardContent className="flex flex-col items-center justify-center py-8">
            <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
            <h2 className="text-xl font-semibold mb-2">Verifying Payment</h2>
            <p className="text-muted-foreground text-center">
              Please wait while we confirm your payment...
            </p>
          </CardContent>
        </Card>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <NavbarAuth />
      <main className="mx-auto grid min-h-[60vh] max-w-md place-items-center px-4 py-10">
      <Card className="w-full rounded-2xl border-slate-200 bg-white/85 shadow-sm dark:border-white/10 dark:bg-white/[0.035]">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            {verificationResult?.success ? (
              <CheckCircle2 className="h-16 w-16 text-green-500" />
            ) : (
              <XCircle className="h-16 w-16 text-red-500" />
            )}
          </div>
          <CardTitle className="text-2xl">
            {verificationResult?.success ? 'Payment Successful!' : 'Payment Failed'}
          </CardTitle>
        </CardHeader>
        
        <CardContent className="space-y-6">
          <div className="text-center">
            <Badge 
              variant={verificationResult?.success ? "default" : "destructive"}
              className="mb-3"
            >
              {verificationResult?.status?.toUpperCase()}
            </Badge>
            
            {verificationResult?.amount > 0 && (
              <div className="text-3xl font-bold mb-2">
                {showBalances ? formatPrice(verificationResult.amount) : '***'}
              </div>
            )}
            
            <p className="text-muted-foreground">
              {verificationResult?.message}
            </p>
          </div>

          <div className="space-y-3">
            <Button 
              onClick={handleBackToWallet}
              className="w-full"
              size="lg"
            >
              <Wallet className="mr-2 h-4 w-4" />
              {verificationResult?.success ? 'View Wallet' : 'Back to Wallet'}
            </Button>
            
            {!verificationResult?.success && (
              <Button 
                onClick={handleRetryPayment}
                variant="outline"
                className="w-full"
                size="lg"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Try Again
              </Button>
            )}
          </div>

          <div className="text-center text-xs text-muted-foreground">
            Need help?{' '}
            {supportUrl ? (
              <a
                href={supportUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackRevenueEvent({ eventType: 'SUPPORT_HANDOFF', userId: user?.id || null, surface: 'payment_success_support_link' })}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Message support
              </a>
            ) : (
              <a href="/support" onClick={() => trackRevenueEvent({ eventType: 'SUPPORT_HANDOFF', userId: user?.id || null, surface: 'payment_success_support_link' })} className="font-medium text-primary underline-offset-4 hover:underline">
                Visit support center
              </a>
            )}
          </div>
        </CardContent>
      </Card>
      {/* Post-purchase recommendations */}
      {paymentVerified && recommendations.length > 0 && (
        <div className="mx-auto max-w-md px-4 pb-10">
          <RecommendationStrip
            products={recommendations}
            surface="post_purchase"
            actionType="POST_PURCHASE_RECOMMENDATION"
            userId={user?.id}
            title="Ready to spend your balance?"
          />
        </div>
      )}
      </main>
      <Footer />
    </div>
  );
}
