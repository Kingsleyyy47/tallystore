import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { CheckCircle, XCircle, Loader2 } from 'lucide-react'
import { verifyAndCreditWalletSecure } from '@/lib/supabase'
import { useAuth } from '@/contexts/SimpleAuth'
import Navbar from '@/components/NavbarAuth'

export default function PaymentCallbackPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { user, refreshWalletBalance } = useAuth()
  const [status, setStatus] = useState<'loading' | 'success' | 'failed' | 'error'>('loading')
  const [paymentData, setPaymentData] = useState<any>(null)

  useEffect(() => {
    const transactionReference = searchParams.get('transactionReference') || 
                                 searchParams.get('transaction_reference') ||
                                 searchParams.get('reference') || 
                                 searchParams.get('trxref')
    
    if (!transactionReference) {
      setStatus('error')
      return
    }

    verifyAndCredit(transactionReference)
  }, [searchParams])

  const verifyAndCredit = async (transactionReference: string) => {
    try {
      // Use the secure Edge Function to verify AND credit the wallet server-side
      const result = await verifyAndCreditWalletSecure(transactionReference)
      
      if (result.success) {
        setStatus('success')
        setPaymentData({
          amount: result.amount,
          reference: transactionReference,
          newBalance: result.new_balance,
          alreadyProcessed: result.already_processed,
        })
        
        // Refresh wallet balance in the auth context
        await refreshWalletBalance()
        
        // Clean up pending topup from localStorage
        localStorage.removeItem('pending_topup')
        
        // Mark as processed to prevent duplicate polling
        const processedTxs = JSON.parse(localStorage.getItem('processed_transactions') || '[]')
        if (!processedTxs.includes(transactionReference)) {
          processedTxs.push(transactionReference)
          localStorage.setItem('processed_transactions', JSON.stringify(processedTxs))
        }
        
        // Notify other components
        window.dispatchEvent(new CustomEvent('transactionAdded'))
      } else if (result.error?.includes('pending') || result.error?.includes('PENDING')) {
        // Payment still pending at Ercas - retry after delay
        setTimeout(() => verifyAndCredit(transactionReference), 5000)
      } else {
        setStatus('failed')
        setPaymentData({ reference: transactionReference, error: result.error })
      }
    } catch (error) {
      console.error('Payment verification failed:', error)
      setStatus('error')
    }
  }

  const getStatusIcon = () => {
    switch (status) {
      case 'loading':
        return <Loader2 className="h-16 w-16 text-blue-500 animate-spin" />
      case 'success':
        return <CheckCircle className="h-16 w-16 text-green-500" />
      case 'failed':
      case 'error':
        return <XCircle className="h-16 w-16 text-red-500" />
    }
  }

  const getStatusMessage = () => {
    switch (status) {
      case 'loading':
        return {
          title: 'Verifying Payment...',
          description: 'Please wait while we confirm your payment.'
        }
      case 'success':
        return {
          title: paymentData?.alreadyProcessed ? 'Payment Already Processed!' : 'Payment Successful!',
          description: paymentData?.alreadyProcessed 
            ? 'Your wallet balance is already up to date.'
            : `₦${paymentData?.amount?.toLocaleString() || '0'} has been added to your wallet.`
        }
      case 'failed':
        return {
          title: 'Payment Failed',
          description: 'Your payment could not be processed. Please try again.'
        }
      case 'error':
        return {
          title: 'Verification Error',
          description: 'Unable to verify payment status. Please contact support if you were charged.'
        }
    }
  }

  const message = getStatusMessage()

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted/20">
      <Navbar />
      
      <div className="container mx-auto px-6 py-16">
        <div className="max-w-md mx-auto">
          <Card className="text-center">
            <CardHeader className="pb-4">
              <div className="flex justify-center mb-4">
                {getStatusIcon()}
              </div>
              <CardTitle className="text-2xl">
                {message.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <p className="text-muted-foreground">
                {message.description}
              </p>

              {paymentData && status === 'success' && (
                <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Amount:</span>
                    <span className="font-medium">₦{paymentData.amount?.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Reference:</span>
                    <span className="font-mono text-xs">{paymentData.reference}</span>
                  </div>
                  {paymentData.paidAt && (
                    <div className="flex justify-between text-sm">
                      <span>Paid At:</span>
                      <span>{new Date(paymentData.paidAt).toLocaleString()}</span>
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-col gap-3">
                {status === 'success' && (
                  <Button 
                    onClick={() => navigate('/wallet')}
                    className="w-full"
                  >
                    View Wallet
                  </Button>
                )}
                
                {status === 'failed' && (
                  <Button 
                    onClick={() => navigate('/wallet')}
                    className="w-full"
                  >
                    Try Again
                  </Button>
                )}
                
                {status === 'error' && (
                  <Button 
                    onClick={() => navigate('/support')}
                    variant="outline"
                    className="w-full"
                  >
                    Contact Support
                  </Button>
                )}

                <Button 
                  variant="outline" 
                  onClick={() => navigate('/dashboard')}
                  className="w-full"
                >
                  Return to Dashboard
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
