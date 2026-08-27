import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import NavbarAuth from '@/components/NavbarAuth'
import PageBreadcrumb from '@/components/PageBreadcrumb'
import { trackRevenueEvent } from '@/lib/revenue-os'

export default function ReferralWithdrawal() {
  const navigate = useNavigate()

  useEffect(() => {
    trackRevenueEvent({
      eventType: 'PAGE_VIEWED',
      surface: 'referral_withdrawal_coming_soon',
    })
  }, [])

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted/20">
      <NavbarAuth />

      <div className="container mx-auto max-w-2xl px-4 pt-4 sm:px-6">
        <PageBreadcrumb items={[{ label: 'Referrals', href: '/referrals' }, { label: 'Withdraw to Bank' }]} />
      </div>

      <div className="container mx-auto max-w-md px-4 pt-16 sm:px-6 text-center">
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-8 py-12 space-y-4">
          <div className="flex justify-center">
            <div className="bg-amber-100 rounded-full p-4">
              <Clock size={32} className="text-amber-600" />
            </div>
          </div>
          <h2 className="text-xl font-bold text-gray-800">Coming Soon</h2>
          <p className="text-sm text-gray-600 leading-relaxed">
            Bank withdrawals for referral earnings are not yet available. In the meantime, you can move your referral balance directly to your Naira wallet and use it to buy anything on TallyStore.
          </p>
          <Button
            className="w-full mt-2"
            onClick={() => navigate('/referrals')}
          >
            Back to Referrals
          </Button>
        </div>
      </div>
    </div>
  )
}
