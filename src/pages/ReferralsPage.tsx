import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Gift, Users, Wallet, Copy, Loader2, ArrowDownToLine, Banknote } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import Navbar from '@/components/NavbarAuth'
import Footer from '@/components/Footer'
import { useAuth } from '@/contexts/SimpleAuth'
import { useToast } from '@/hooks/use-toast'
import { getReferralStats, withdrawReferralBalance } from '@/lib/supabase'

export default function ReferralsPage() {
  const { user, refreshWalletBalance } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [withdrawing, setWithdrawing] = useState(false)
  const [stats, setStats] = useState<{
    referralCode: string | null
    referralBalance: number
    totalReferred: number
    earnings: Array<{ id: string; order_amount: number; commission_amount: number; created_at: string }>
  }>({ referralCode: null, referralBalance: 0, totalReferred: 0, earnings: [] })

  const loadStats = async () => {
    if (!user?.id) return
    setLoading(true)
    try {
      const data = await getReferralStats(user.id)
      setStats(data)
    } catch (error) {
      console.error('Failed to load referral stats:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadStats()
  }, [user?.id])

  const referralLink = stats.referralCode
    ? `${window.location.origin}/register?ref=${stats.referralCode}`
    : ''

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    toast({ title: 'Copied!', description: `${label} copied to clipboard` })
  }

  const handleWithdraw = async () => {
    if (!user?.id) return
    setWithdrawing(true)
    try {
      const result = await withdrawReferralBalance(user.id)
      if (result.success) {
        toast({
          title: 'Moved to wallet',
          description: `₦${result.amount?.toLocaleString()} moved to your wallet balance`,
        })
        await refreshWalletBalance()
        await loadStats()
      } else {
        toast({
          title: 'Could not withdraw',
          description: result.error || 'Please try again',
          variant: 'destructive',
        })
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to withdraw referral balance', variant: 'destructive' })
    } finally {
      setWithdrawing(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted/20">
      <Navbar />

      <div className="container mx-auto px-6 pt-24 pb-12 max-w-4xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Gift className="h-7 w-7 text-primary" />
            Referrals
          </h1>
          <p className="text-muted-foreground mt-1">
            Share your code and earn a commission on your friend's first 10 deposits. After that, the reward window closes.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-full bg-primary/10">
                      <Wallet className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Referral Balance</p>
                      <p className="text-xl font-bold">₦{stats.referralBalance.toLocaleString()}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-full bg-primary/10">
                      <Users className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">People Referred</p>
                      <p className="text-xl font-bold">{stats.totalReferred}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6 flex flex-col gap-2">
                  <Button
                    className="w-full"
                    onClick={handleWithdraw}
                    disabled={withdrawing || stats.referralBalance <= 0}
                  >
                    {withdrawing ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <ArrowDownToLine className="h-4 w-4 mr-2" />
                    )}
                    Move to Wallet
                  </Button>
                  <Button
                    className="w-full"
                    variant="outline"
                    onClick={() => navigate('/referral-withdrawal')}
                    disabled={stats.referralBalance <= 0}
                  >
                    <Banknote className="h-4 w-4 mr-2" />
                    Withdraw to Bank
                  </Button>
                </CardContent>
              </Card>
            </div>

            <Card className="mb-8">
              <CardHeader>
                <CardTitle className="text-lg">Your Referral Code</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2">
                  <Input value={stats.referralCode || ''} readOnly className="font-mono" />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => stats.referralCode && handleCopy(stats.referralCode, 'Referral code')}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Input value={referralLink} readOnly className="text-sm" />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => referralLink && handleCopy(referralLink, 'Referral link')}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Earnings History</CardTitle>
              </CardHeader>
              <CardContent>
                {stats.earnings.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">
                    No referral earnings yet. Share your link to start earning.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {stats.earnings.map((earning) => (
                      <div
                        key={earning.id}
                        className="flex items-center justify-between border-b pb-3 last:border-0 last:pb-0"
                      >
                        <div>
                          <p className="text-sm font-medium">
                            Order of ₦{earning.order_amount.toLocaleString()}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(earning.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <Badge variant="secondary">
                          +₦{earning.commission_amount.toLocaleString()}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <Footer />
    </div>
  )
}
