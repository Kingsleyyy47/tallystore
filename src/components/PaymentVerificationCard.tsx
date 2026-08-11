import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { CheckCircle2, Loader2, Search } from 'lucide-react'
import { verifyAndCreditWalletSecure } from '@/lib/supabase'
import { useAuth } from '@/contexts/SimpleAuth'
import { useToast } from '@/hooks/use-toast'

interface VerificationResult {
  success: boolean
  error?: string
  amount?: number
  new_balance?: number
  already_processed?: boolean
  status?: string
}

export function PaymentVerificationCard() {
  const [reference, setReference] = useState('')
  const [isVerifying, setIsVerifying] = useState(false)
  const { refreshWalletBalance } = useAuth()
  const { toast } = useToast()

  const handleVerify = async () => {
    if (!reference.trim()) {
      toast({
        title: "Missing Reference",
        description: "Please enter your transaction reference",
        variant: "destructive"
      })
      return
    }

    setIsVerifying(true)
    try {
      const result = await verifyAndCreditWalletSecure(reference.trim()) as VerificationResult

      if (result.success) {
        await refreshWalletBalance()
        
        toast({
          title: result.already_processed ? "Already Credited ✅" : "Payment Verified! 🎉",
          description: result.already_processed
            ? "This payment was already credited to your wallet."
            : `₦${result.amount?.toLocaleString()} has been added to your wallet.`,
        })
        
        setReference('')
        window.dispatchEvent(new CustomEvent('transactionAdded'))
      } else if (result.status === 'pending') {
        toast({
          title: "Payment Pending ⏳",
          description: "Your payment is still being processed. Please check back in a few minutes.",
          variant: "default"
        })
      } else {
        toast({
          title: "Payment Not Found",
          description: result.error || "Unable to verify this payment. Please check your reference and try again.",
          variant: "destructive"
        })
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to verify payment"
      toast({
        title: "Verification Failed",
        description: errorMessage,
        variant: "destructive"
      })
    } finally {
      setIsVerifying(false)
    }
  }

  return (
    <Card className="border-yellow-200 bg-yellow-50/50 dark:bg-yellow-950/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Search className="h-5 w-5 text-yellow-600" />
          Check Payment Status
        </CardTitle>
        <CardDescription>
          If your payment was successful but your wallet wasn't credited, enter your transaction reference below to verify and credit your account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="Enter Ercas reference (e.g., ER|A0F9859768024)"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            disabled={isVerifying}
            className="flex-1"
            onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
          />
          <Button 
            onClick={handleVerify} 
            disabled={isVerifying || !reference.trim()}
            className="min-w-[100px]"
          >
            {isVerifying ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Verifying
              </>
            ) : (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Verify
              </>
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          💡 <strong>Where to find your reference:</strong> Check your payment confirmation page, email receipt, or bank transaction details. It usually starts with "ER|" or "TALLY-".
        </p>
      </CardContent>
    </Card>
  )
}
