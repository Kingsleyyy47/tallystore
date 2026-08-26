import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell, Calendar, CreditCard, KeyRound, Mail, PackageCheck, ShieldCheck, User, Wallet } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import NavbarAuth from '@/components/NavbarAuth'
import Footer from '@/components/Footer'
import { useAuth } from '@/contexts/SimpleAuth'
import { useCurrency } from '@/contexts/CurrencyContext'
import { getUserTransactions, supabase } from '@/lib/supabase'
import { useToast } from '@/hooks/use-toast'
import { trackRevenueEvent } from '@/lib/revenue-os'
import {
  RevampCard,
  RevampFeature,
  RevampHero,
  RevampPage,
  RevampSectionTitle,
  RevampVisual,
} from '@/components/RevampLayout'

export default function ProfilePage() {
  const { user, walletBalance, showBalances } = useAuth()
  const { formatPrice } = useCurrency()
  const { toast } = useToast()
  const [transactions, setTransactions] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [communicationPrefs, setCommunicationPrefs] = useState({
    email_lifecycle_opt_in: false,
    email_promotions_opt_in: false,
  })
  const [prefsSaving, setPrefsSaving] = useState(false)

  useEffect(() => {
    const loadUserData = async () => {
      if (!user?.id) return

      setIsLoading(true)
      try {
        const userTransactions = await getUserTransactions(user.id)
        setTransactions(userTransactions)
        const { data: prefs } = await supabase
          .from('customer_communication_preferences' as any)
          .select('email_lifecycle_opt_in,email_promotions_opt_in')
          .eq('user_id', user.id)
          .maybeSingle()
        if (prefs) {
          setCommunicationPrefs({
            email_lifecycle_opt_in: !!prefs.email_lifecycle_opt_in,
            email_promotions_opt_in: !!prefs.email_promotions_opt_in,
          })
        }
      } catch (error) {
        console.error('Failed to load user data:', error)
      } finally {
        setIsLoading(false)
      }
    }

    if (user) {
      trackRevenueEvent({
        eventType: 'PAGE_VIEWED',
        userId: user.id,
        surface: 'profile',
      })
      loadUserData()
    }
  }, [user])

  const totalSpent = Math.abs(transactions
    .filter((transaction) => transaction.type === 'purchase' && transaction.status === 'completed')
    .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0))

  const totalTopups = transactions
    .filter((transaction) => transaction.type === 'topup' && transaction.status === 'completed')
    .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0)

  const purchaseCount = transactions.filter((transaction) => transaction.type === 'purchase').length
  const topupCount = transactions.filter((transaction) => transaction.type === 'topup').length

  const getInitials = (name: string) => {
    if (!name) return 'U'
    return name.split('@')[0].slice(0, 2).toUpperCase()
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background">
        <NavbarAuth />
        <RevampPage className="max-w-4xl">
          <Alert variant="destructive">
            <AlertDescription>Please log in to view your profile.</AlertDescription>
          </Alert>
        </RevampPage>
        <Footer />
      </div>
    )
  }

  const username = user.email?.split('@')[0] || 'User'

  const saveCommunicationPrefs = async () => {
    setPrefsSaving(true)
    try {
      const { error } = await supabase
        .from('customer_communication_preferences' as any)
        .upsert({
          user_id: user.id,
          email_lifecycle_opt_in: communicationPrefs.email_lifecycle_opt_in,
          email_promotions_opt_in: communicationPrefs.email_promotions_opt_in,
          consent_source: 'profile_page',
          consent_updated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' })
      if (error) throw error
      trackRevenueEvent({
        eventType: communicationPrefs.email_lifecycle_opt_in || communicationPrefs.email_promotions_opt_in ? 'OFFER_ACCEPTED' : 'OFFER_DISMISSED',
        userId: user.id,
        surface: 'profile_communication_preferences',
        metadata: {
          email_lifecycle_opt_in: communicationPrefs.email_lifecycle_opt_in,
          email_promotions_opt_in: communicationPrefs.email_promotions_opt_in,
        },
      })
      toast({
        title: 'Preferences saved',
        description: communicationPrefs.email_lifecycle_opt_in
          ? 'You can receive useful follow-up and repeat-purchase emails.'
          : 'Lifecycle follow-up emails are off.',
      })
    } catch (error: any) {
      toast({
        title: 'Could not save preferences',
        description: error?.message || 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setPrefsSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <NavbarAuth />
      <RevampPage>
        <RevampHero
          eyebrow="Account"
          title="Your TallyStore profile,"
          accent="wallet and activity."
          description="Manage the account identity connected to your wallet, orders, support messages, and purchase history."
          primaryHref="/wallet"
          primaryLabel="Open Wallet"
          secondaryHref="/orders"
          secondaryLabel="Order History"
        >
          <RevampVisual
            title={username}
            subtitle="One profile for wallet, orders, rewards, and secure access."
            icon={User}
          />
        </RevampHero>

        <section className="mt-10 grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
          <RevampCard>
            <div className="flex flex-col items-center text-center">
              <Avatar className="h-24 w-24 border-4 border-purple-200 dark:border-purple-400/20">
                <AvatarFallback className="bg-gradient-to-br from-purple-500 to-violet-800 text-xl font-black text-white">
                  {getInitials(user.email || 'User')}
                </AvatarFallback>
              </Avatar>
              <h2 className="mt-4 text-2xl font-black text-slate-950 dark:text-white">{username}</h2>
              <p className="mt-1 max-w-full break-words text-sm text-slate-600 dark:text-slate-400">{user.email}</p>
              <Badge className="mt-3 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300">
                <ShieldCheck className="mr-1 h-3.5 w-3.5" />
                Active account
              </Badge>
            </div>

            <div className="mt-6 grid gap-3 text-sm">
              <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3 dark:bg-white/[0.035]">
                <span className="text-slate-600 dark:text-slate-400">Wallet Balance</span>
                <strong className="text-purple-700 dark:text-purple-300">{showBalances ? formatPrice(walletBalance) : '***'}</strong>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3 dark:bg-white/[0.035]">
                <span className="text-slate-600 dark:text-slate-400">Total Spent</span>
                <strong>{showBalances ? formatPrice(totalSpent) : '***'}</strong>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3 dark:bg-white/[0.035]">
                <span className="text-slate-600 dark:text-slate-400">Total Top-ups</span>
                <strong>{showBalances ? formatPrice(totalTopups) : '***'}</strong>
              </div>
            </div>
          </RevampCard>

          <div className="grid gap-4 sm:grid-cols-2">
            <RevampFeature
              icon={Wallet}
              title="Wallet"
              description="Top up, review payment movement, and keep balances private when needed."
              tone="purple"
            />
            <RevampFeature
              icon={PackageCheck}
              title="Orders"
              description="Find completed purchases and return to credentials from Order History."
              tone="emerald"
            />
            <RevampFeature
              icon={CreditCard}
              title="Payments"
              description="Payment recovery and funding history stay connected to this account."
              tone="sky"
            />
            <RevampFeature
              icon={KeyRound}
              title="Access"
              description="Your sign-in keeps staff/admin privileges separated from customer access."
              tone="amber"
            />
          </div>
        </section>

        <section className="mt-10">
          <RevampSectionTitle
            eyebrow="Account details"
            title="Profile information"
            description="These details identify your account for support, wallet records, and order history."
          />
          <div className="grid gap-4 lg:grid-cols-3">
            <RevampCard>
              <Mail className="mb-4 h-5 w-5 text-purple-600 dark:text-purple-300" />
              <p className="text-xs font-black uppercase text-slate-500">Email address</p>
              <p className="mt-2 break-words text-sm font-bold text-slate-950 dark:text-white">{user.email}</p>
            </RevampCard>
            <RevampCard>
              <Calendar className="mb-4 h-5 w-5 text-purple-600 dark:text-purple-300" />
              <p className="text-xs font-black uppercase text-slate-500">Account created</p>
              <p className="mt-2 text-sm font-bold text-slate-950 dark:text-white">
                {user.created_at ? new Date(user.created_at).toLocaleDateString() : 'N/A'}
              </p>
            </RevampCard>
            <RevampCard>
              <PackageCheck className="mb-4 h-5 w-5 text-purple-600 dark:text-purple-300" />
              <p className="text-xs font-black uppercase text-slate-500">Activity</p>
              <p className="mt-2 text-sm font-bold text-slate-950 dark:text-white">
                {isLoading ? 'Loading...' : `${purchaseCount} purchases, ${topupCount} top-ups`}
              </p>
            </RevampCard>
          </div>
        </section>

        <section className="mt-10">
          <RevampSectionTitle
            eyebrow="Preferences"
            title="Communication choices"
            description="Control whether TallyStore can send useful purchase follow-ups or promotional emails. These are off unless you opt in."
          />
          <RevampCard>
            <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
              <div className="space-y-4">
                <label className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 p-4 dark:bg-white/[0.035]">
                  <span>
                    <span className="flex items-center gap-2 font-black text-slate-950 dark:text-white">
                      <Bell className="h-4 w-4 text-purple-600 dark:text-purple-300" />
                      Helpful follow-up emails
                    </span>
                    <span className="mt-1 block text-sm text-slate-600 dark:text-slate-400">
                      Product follow-ups, repeat-purchase suggestions, and account-use reminders based on your own activity.
                    </span>
                  </span>
                  <Switch
                    checked={communicationPrefs.email_lifecycle_opt_in}
                    onCheckedChange={(checked) => setCommunicationPrefs((prev) => ({ ...prev, email_lifecycle_opt_in: checked }))}
                  />
                </label>
                <label className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 p-4 dark:bg-white/[0.035]">
                  <span>
                    <span className="flex items-center gap-2 font-black text-slate-950 dark:text-white">
                      <Mail className="h-4 w-4 text-purple-600 dark:text-purple-300" />
                      Promotions and offers
                    </span>
                    <span className="mt-1 block text-sm text-slate-600 dark:text-slate-400">
                      Occasional offers or product drops. No fake urgency, and you can turn this off anytime.
                    </span>
                  </span>
                  <Switch
                    checked={communicationPrefs.email_promotions_opt_in}
                    onCheckedChange={(checked) => setCommunicationPrefs((prev) => ({ ...prev, email_promotions_opt_in: checked }))}
                  />
                </label>
              </div>
              <Button onClick={saveCommunicationPrefs} disabled={prefsSaving}>
                {prefsSaving ? 'Saving...' : 'Save preferences'}
              </Button>
            </div>
          </RevampCard>
        </section>

        <section className="mt-10 rounded-2xl border border-slate-200 bg-white/85 p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.035]">
          <div className="grid gap-3 sm:grid-cols-3">
            <Link
              to="/wallet"
              onClick={() => trackRevenueEvent({ eventType: 'OFFER_ACCEPTED', userId: user.id, surface: 'profile_quick_link', metadata: { destination: 'wallet' } })}
              className="rounded-xl border border-slate-200 p-4 text-sm font-black transition hover:border-purple-300 hover:text-purple-700 dark:border-white/10 dark:hover:text-purple-300"
            >
              Manage Wallet
            </Link>
            <Link
              to="/orders"
              onClick={() => trackRevenueEvent({ eventType: 'OFFER_ACCEPTED', userId: user.id, surface: 'profile_quick_link', metadata: { destination: 'orders' } })}
              className="rounded-xl border border-slate-200 p-4 text-sm font-black transition hover:border-purple-300 hover:text-purple-700 dark:border-white/10 dark:hover:text-purple-300"
            >
              View Orders
            </Link>
            <Link
              to="/support"
              onClick={() => trackRevenueEvent({ eventType: 'SUPPORT_HANDOFF', userId: user.id, surface: 'profile_quick_link', metadata: { destination: 'support' } })}
              className="rounded-xl border border-slate-200 p-4 text-sm font-black transition hover:border-purple-300 hover:text-purple-700 dark:border-white/10 dark:hover:text-purple-300"
            >
              Get Support
            </Link>
          </div>
        </section>
      </RevampPage>
      <Footer />
    </div>
  )
}
