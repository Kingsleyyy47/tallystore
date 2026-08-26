import CryptoWithdrawal from '@/pages/CryptoWithdrawal'
import { useEffect } from 'react'
import { trackRevenueEvent } from '@/lib/revenue-os'

// Reuses the same SageCloud bank-transfer withdrawal flow as crypto withdrawals,
// just pointed at the user's referral_balance instead. See CryptoWithdrawal.tsx
// for the shared implementation and SOURCE_CONFIG for per-source copy/routes.
export default function ReferralWithdrawal() {
  useEffect(() => {
    trackRevenueEvent({
      eventType: 'PAGE_VIEWED',
      surface: 'referral_withdrawal_route',
    })
  }, [])

  return <CryptoWithdrawal source="referral" />
}
