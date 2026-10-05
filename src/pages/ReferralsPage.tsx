import { useEffect, useState } from 'react'
import { CheckCircle2, Clock, Copy, Gift, Loader2, RefreshCw, Users, Wallet } from 'lucide-react'
import Navbar from '@/components/NavbarAuth'
import Footer from '@/components/Footer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { useAuth } from '@/contexts/SimpleAuth'
import { useCurrency } from '@/contexts/CurrencyContext'
import { useToast } from '@/hooks/use-toast'
import { getReferralStats, supabase } from '@/lib/supabase'
import { trackRevenueEvent } from '@/lib/revenue-os'

type CircleStatus = {
  referral_code: string | null
  total_referred: number
  qualified_referrals: number
  required_referrals: number
  minimum_verified_topup_ngn: number
  discount_percent: number
  is_member: boolean
}

type PastEarnings = Awaited<ReturnType<typeof getReferralStats>>

function isCircleStatus(value: unknown): value is CircleStatus {
  if (!value || typeof value !== 'object') return false
  const status = value as Partial<CircleStatus>
  return (typeof status.referral_code === 'string' || status.referral_code === null)
    && Number.isInteger(status.total_referred)
    && Number.isInteger(status.qualified_referrals)
    && Number.isInteger(status.required_referrals)
    && typeof status.minimum_verified_topup_ngn === 'number'
    && typeof status.discount_percent === 'number'
    && typeof status.is_member === 'boolean'
}

export default function ReferralsPage() {
  const { user, showBalances } = useAuth()
  const { formatPrice } = useCurrency()
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<CircleStatus | null>(null)
  const [statusError, setStatusError] = useState(false)
  const [pastEarnings, setPastEarnings] = useState<PastEarnings | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    if (!user?.id) {
      setLoading(false)
      return
    }

    let active = true
    const load = async () => {
      setLoading(true)
      setStatusError(false)
      const [circleResult, earningsResult] = await Promise.allSettled([
        supabase.rpc('get_my_tally_circle_status'),
        getReferralStats(user.id),
      ])
      if (!active) return

      if (circleResult.status === 'fulfilled'
        && !circleResult.value.error
        && isCircleStatus(circleResult.value.data)) {
        setStatus(circleResult.value.data)
        trackRevenueEvent({
          eventType: 'PAGE_VIEWED',
          userId: user.id,
          surface: 'tally_circle_loaded',
          metadata: {
            qualified_referrals: circleResult.value.data.qualified_referrals,
            is_member: circleResult.value.data.is_member,
          },
        })
      } else {
        setStatus(null)
        setStatusError(true)
        console.error('Failed to load Tally Circle status:',
          circleResult.status === 'rejected' ? circleResult.reason : circleResult.value.error)
      }

      if (earningsResult.status === 'fulfilled') setPastEarnings(earningsResult.value)
      setLoading(false)
    }

    trackRevenueEvent({ eventType: 'PAGE_VIEWED', userId: user.id, surface: 'referrals' })
    void load()
    return () => { active = false }
  }, [user?.id, reloadToken])

  const referralCode = status?.referral_code || pastEarnings?.referralCode || ''
  const referralLink = referralCode
    ? `${window.location.origin}/register?ref=${encodeURIComponent(referralCode)}`
    : ''
  const qualified = status ? Math.min(status.qualified_referrals, status.required_referrals) : 0

  const handleCopy = async (text: string, kind: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(text)
      trackRevenueEvent({
        eventType: 'OFFER_ACCEPTED',
        userId: user?.id || null,
        surface: 'referral_share_copy',
        metadata: { copied: kind, has_referral_code: Boolean(referralCode) },
      })
      toast({ title: 'Copied', description: `Referral ${kind} copied to clipboard.` })
    } catch {
      toast({ title: 'Could not copy', description: 'Please select and copy it manually.', variant: 'destructive' })
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted/20">
      <Navbar />
      <main className="container mx-auto max-w-4xl px-6 pb-12 pt-24">
        <div className="mb-8">
          <div className="mb-2 flex items-center gap-2 text-primary">
            <Gift className="h-7 w-7" />
            <span className="text-sm font-semibold uppercase tracking-widest">Tally Circle</span>
          </div>
          <h1 className="text-3xl font-bold">Invite friends. Unlock 3% off products.</h1>
          <p className="mt-2 text-muted-foreground">
            Five referred people each need at least ₦1,000 in cumulative, verified wallet deposits to qualify.
            Any five can count, so inactive referrals do not block your progress.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20" role="status" aria-label="Loading Tally Circle">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : (
          <>
            {statusError && (
              <div role="alert" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
                <span>Tally Circle progress is unavailable right now. Please try again.</span>
                <Button variant="outline" size="sm" onClick={() => setReloadToken((value) => value + 1)}>
                  <RefreshCw className="mr-2 h-4 w-4" /> Retry
                </Button>
              </div>
            )}

            {status && (
              <div className="mb-8 grid gap-4 md:grid-cols-3">
                <Card><CardContent className="pt-6">
                  <Users className="mb-3 h-5 w-5 text-primary" />
                  <p className="text-sm text-muted-foreground">People referred</p>
                  <p className="text-2xl font-bold">{status.total_referred}</p>
                </CardContent></Card>
                <Card><CardContent className="pt-6">
                  <CheckCircle2 className="mb-3 h-5 w-5 text-primary" />
                  <p className="text-sm text-muted-foreground">Qualified referrals</p>
                  <p className="text-2xl font-bold">{qualified} / {status.required_referrals}</p>
                </CardContent></Card>
                <Card><CardContent className="pt-6">
                  <Gift className="mb-3 h-5 w-5 text-primary" />
                  <p className="text-sm text-muted-foreground">Tally Circle status</p>
                  <p className="text-xl font-bold">{status.is_member ? 'Unlocked' : 'In progress'}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{status.discount_percent}% off products</p>
                </CardContent></Card>
              </div>
            )}

            {status && (
              <Card className="mb-8">
                <CardHeader><CardTitle>Qualification progress</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <Progress value={status.required_referrals > 0 ? (qualified / status.required_referrals) * 100 : 0}
                    aria-label={`${qualified} of ${status.required_referrals} qualified referrals`} />
                  <p className="text-sm text-muted-foreground">
                    {status.is_member
                      ? `You have qualified for the ${status.discount_percent}% product discount.`
                      : `${status.required_referrals - qualified} more qualified ${status.required_referrals - qualified === 1 ? 'referral' : 'referrals'} to unlock ${status.discount_percent}% off products.`}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Each person counts once their cumulative provider-verified deposits reach ₦{status.minimum_verified_topup_ngn.toLocaleString()}.
                    Only successful wallet deposits count.
                  </p>
                </CardContent>
              </Card>
            )}

            <Card className="mb-8">
              <CardHeader><CardTitle>Your referral link</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">Share your code or link with someone creating a new account.</p>
                <div className="flex items-center gap-2">
                  <Input value={referralCode} readOnly aria-label="Referral code" className="font-mono" />
                  <Button variant="outline" size="icon" aria-label="Copy referral code" disabled={!referralCode}
                    onClick={() => void handleCopy(referralCode, 'code')}><Copy className="h-4 w-4" /></Button>
                </div>
                <div className="flex items-center gap-2">
                  <Input value={referralLink} readOnly aria-label="Referral link" className="text-sm" />
                  <Button variant="outline" size="icon" aria-label="Copy referral link" disabled={!referralLink}
                    onClick={() => void handleCopy(referralLink, 'link')}><Copy className="h-4 w-4" /></Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Past referral earnings</CardTitle></CardHeader>
              <CardContent className="space-y-5">
                <p className="text-sm text-muted-foreground">Commissions earned under the earlier referral program remain in your history.</p>
                <div className="flex items-center gap-3 rounded-lg bg-muted/40 p-4">
                  <Wallet className="h-5 w-5 text-primary" />
                  <div>
                    <p className="text-sm text-muted-foreground">Past reward balance</p>
                    <p className="text-xl font-bold">{pastEarnings ? (showBalances ? formatPrice(pastEarnings.referralBalance) : '***') : 'Unavailable'}</p>
                  </div>
                  <Badge variant="outline" className="ml-auto"><Clock className="mr-1 h-3 w-3" /> Movement paused</Badge>
                </div>
                {pastEarnings && (pastEarnings.earnings.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">No past referral earnings.</p>
                ) : (
                  <div className="space-y-3">
                    {pastEarnings.earnings.map((earning) => (
                      <div key={earning.id} className="flex items-center justify-between border-b pb-3 last:border-0 last:pb-0">
                        <div>
                          <p className="text-sm font-medium">Deposit of {showBalances ? formatPrice(earning.order_amount) : '***'}</p>
                          <p className="text-xs text-muted-foreground">{new Date(earning.created_at).toLocaleDateString()}</p>
                        </div>
                        <Badge variant="secondary">+{showBalances ? formatPrice(earning.commission_amount) : '***'}</Badge>
                      </div>
                    ))}
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">Referral balance movement is paused during wallet security review.</p>
              </CardContent>
            </Card>
          </>
        )}
      </main>
      <Footer />
    </div>
  )
}
