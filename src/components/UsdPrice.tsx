import { useExchangeRate } from '@/hooks/useExchangeRate'

interface UsdPriceProps {
  ngnAmount: number
  className?: string
}

/**
 * Displays the USD equivalent of an NGN amount, e.g. "≈ $3.13"
 * Uses the admin-configured rate override if set, otherwise a live rate.
 */
export default function UsdPrice({ ngnAmount, className }: UsdPriceProps) {
  const { ngnToUsd, loading } = useExchangeRate()

  if (loading) return null

  const usd = ngnToUsd(ngnAmount)

  return (
    <span className={className ?? 'text-xs text-muted-foreground'}>
      ≈ ${usd.toFixed(2)}
    </span>
  )
}
