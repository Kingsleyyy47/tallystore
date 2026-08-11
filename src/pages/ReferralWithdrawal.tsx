import CryptoWithdrawal from '@/pages/CryptoWithdrawal'

// Reuses the same SageCloud bank-transfer withdrawal flow as crypto withdrawals,
// just pointed at the user's referral_balance instead. See CryptoWithdrawal.tsx
// for the shared implementation and SOURCE_CONFIG for per-source copy/routes.
export default function ReferralWithdrawal() {
  return <CryptoWithdrawal source="referral" />
}
