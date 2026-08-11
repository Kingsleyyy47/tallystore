import { useAuth } from '@/contexts/SimpleAuth'
import { useCurrency } from '@/contexts/CurrencyContext'
import { Card, CardContent } from '@/components/ui/card'
import { Wallet, RefreshCw, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface WalletBalanceWidgetProps {
  className?: string
  showRefresh?: boolean
  size?: 'sm' | 'md' | 'lg'
}

export default function WalletBalanceWidget({ 
  className = '', 
  showRefresh = false,
  size = 'md' 
}: WalletBalanceWidgetProps) {
  const { walletBalance, walletLoading, refreshWalletBalance, isAdmin } = useAuth()
  const { formatPrice } = useCurrency()

  // Don't show for admin users
  if (isAdmin) return null

  const sizeClasses = {
    sm: 'px-3 py-2 text-sm',
    md: 'px-4 py-3 text-base',
    lg: 'px-6 py-4 text-lg'
  }

  const iconSizes = {
    sm: 'h-4 w-4',
    md: 'h-5 w-5', 
    lg: 'h-6 w-6'
  }

  return (
    <Card className={`bg-gradient-to-r from-primary/10 to-primary/5 border-primary/20 ${className}`}>
      <CardContent className={`${sizeClasses[size]} flex items-center justify-between`}>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Wallet className={`${iconSizes[size]} text-primary`} />
            <span className="font-medium text-foreground">Wallet Balance:</span>
          </div>
          <span className="font-bold text-primary text-lg">
            {walletLoading ? (
              <Loader2 className="h-5 w-5 animate-spin inline" />
            ) : (
              <>{formatPrice(walletBalance || 0)}</>
            )}
          </span>
        </div>
        
        {showRefresh && (
          <Button
            variant="ghost"
            size="sm"
            onClick={refreshWalletBalance}
            className="text-primary hover:text-primary/80"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
