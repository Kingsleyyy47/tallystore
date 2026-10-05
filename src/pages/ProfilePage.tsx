import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, CircleHelp, KeyRound, LogOut, Mail, Package, ShieldCheck, User, Wallet } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import NavbarAuth from '@/components/NavbarAuth'
import Footer from '@/components/Footer'
import { useAuth } from '@/contexts/SimpleAuth'
import { useCurrency } from '@/contexts/CurrencyContext'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/hooks/use-toast'

type CommunicationPrefs = { email_lifecycle_opt_in: boolean; email_promotions_opt_in: boolean }
const initialPrefs: CommunicationPrefs = { email_lifecycle_opt_in: false, email_promotions_opt_in: false }

const accountLinks = [
  { title: 'Wallet', detail: 'Fund and review your balance', href: '/wallet', icon: Wallet },
  { title: 'Order history', detail: 'Find purchases and credentials', href: '/orders', icon: Package },
  { title: 'Help Centre', detail: 'Get support for your account', href: '/support', icon: CircleHelp },
] as const

export default function ProfilePage() {
  const { user, signOut, walletBalance, walletLoading, walletBalanceUnavailable, showBalances } = useAuth()
  const { formatPrice } = useCurrency()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [prefs, setPrefs] = useState<CommunicationPrefs>(initialPrefs)
  const [prefsLoading, setPrefsLoading] = useState(true)
  const [prefsError, setPrefsError] = useState(false)
  const [prefsSaving, setPrefsSaving] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    let active = true
    setPrefs(initialPrefs)
    setPrefsError(false)
    if (!user?.id) { setPrefsLoading(false); return () => { active = false } }
    setPrefsLoading(true)
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort(); if (active) { setPrefsError(true); setPrefsLoading(false) } }, 12000)
    void supabase.from('customer_communication_preferences' as any)
      .select('email_lifecycle_opt_in,email_promotions_opt_in')
      .eq('user_id', user.id)
      .maybeSingle()
      .abortSignal(controller.signal)
      .then(({ data, error }) => {
        if (!active) return
        if (error) setPrefsError(true)
        else if (data) setPrefs({
          email_lifecycle_opt_in: !!data.email_lifecycle_opt_in,
          email_promotions_opt_in: !!data.email_promotions_opt_in,
        })
        setPrefsLoading(false)
      }).catch(() => { if (active) { setPrefsError(true); setPrefsLoading(false) } }).finally(() => clearTimeout(timer))
    return () => { active = false; controller.abort(); clearTimeout(timer) }
  }, [user?.id])

  if (!user) return (
    <div className="min-h-screen bg-background"><NavbarAuth /><main className="mx-auto max-w-4xl px-4 py-12"><Alert variant="destructive"><AlertDescription>Please log in to view your account.</AlertDescription></Alert></main><Footer /></div>
  )

  const fullName = typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : ''
  const displayName = fullName || user.email?.split('@')[0] || 'Your account'
  const initials = String(displayName).slice(0, 2).toUpperCase()
  const balance = walletLoading ? 'Checking…' : walletBalanceUnavailable ? 'Unavailable' : showBalances ? formatPrice(walletBalance) : '••••••'

  const savePrefs = async () => {
    setPrefsSaving(true)
    try {
      const { error } = await supabase.from('customer_communication_preferences' as any).upsert({
        user_id: user.id,
        ...prefs,
        consent_source: 'profile_page',
        consent_updated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
      if (error) throw error
      toast({ title: 'Communication preferences saved' })
    } catch {
      toast({ title: 'Could not save preferences', description: 'Please try again.', variant: 'destructive' })
    } finally { setPrefsSaving(false) }
  }

  const changePassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (newPassword.length < 8 || newPassword !== confirmPassword) {
      toast({ title: 'Check your new password', description: 'Use at least 8 characters and make both entries match.', variant: 'destructive' })
      return
    }
    setPasswordSaving(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error
      setNewPassword('')
      setConfirmPassword('')
      toast({ title: 'Password updated', description: 'Use your new password the next time you sign in.' })
    } catch {
      toast({ title: 'Password could not be updated', description: 'Please try again or contact support.', variant: 'destructive' })
    } finally { setPasswordSaving(false) }
  }

  const handleSignOut = async () => {
    setSigningOut(true)
    try { await signOut(); navigate('/login', { replace: true }) }
    catch { toast({ title: 'Could not sign out', description: 'Please try again.', variant: 'destructive' }); setSigningOut(false) }
  }

  return (
    <div className="min-h-screen bg-[#f7f7fb] text-slate-950 dark:bg-background dark:text-foreground">
      <NavbarAuth />
      <main className="mx-auto max-w-5xl space-y-7 px-4 pb-20 pt-7 sm:px-6 sm:pt-10">
        <header><p className="text-sm font-semibold text-violet-700 dark:text-violet-300">Account</p><h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">Your profile</h1><p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Manage your account, security and communication choices.</p></header>

        <section className="grid gap-4 md:grid-cols-[1.25fr_0.75fr]" aria-label="Account summary">
          <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-card">
            <Avatar className="h-16 w-16 border-2 border-violet-100 dark:border-violet-400/20"><AvatarFallback className="bg-violet-700 text-lg font-bold text-white">{initials}</AvatarFallback></Avatar>
            <div className="min-w-0"><h2 className="truncate text-xl font-black">{displayName}</h2><p className="mt-1 break-all text-sm text-slate-600 dark:text-slate-400">{user.email}</p><p className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300"><ShieldCheck className="h-3.5 w-3.5" /> Signed in</p></div>
          </div>
          <div className="rounded-2xl bg-violet-900 p-5 text-white shadow-sm"><p className="flex items-center gap-2 text-sm font-semibold text-violet-100"><Wallet className="h-4 w-4" /> Wallet balance</p><p className="mt-3 break-words text-2xl font-black">{balance}</p><Link to="/wallet" className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-white underline underline-offset-4">Add funds <ArrowRight className="h-4 w-4" /></Link></div>
        </section>

        <section aria-labelledby="account-actions-heading"><h2 id="account-actions-heading" className="mb-3 text-xl font-black">Account actions</h2><div className="grid gap-3 md:grid-cols-3">
          {accountLinks.map(({ title, detail, href, icon: Icon }) => <Link key={href} to={href} className="group flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-violet-300 dark:border-white/10 dark:bg-card"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200"><Icon className="h-5 w-5" /></span><span className="min-w-0 flex-1"><span className="block font-bold">{title}</span><span className="block text-xs text-slate-500 dark:text-slate-400">{detail}</span></span><ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-violet-600" /></Link>)}
        </div></section>

        <section className="grid gap-4 lg:grid-cols-2" aria-label="Account settings">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-card sm:p-6">
            <h2 className="flex items-center gap-2 text-lg font-black"><KeyRound className="h-5 w-5 text-violet-600" /> Change password</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Choose a new password for this signed-in account.</p>
            <form onSubmit={changePassword} className="mt-5 space-y-3">
              <div><Label htmlFor="new-password">New password</Label><Input id="new-password" type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={event => setNewPassword(event.target.value)} required className="mt-1" /></div>
              <div><Label htmlFor="confirm-password">Confirm new password</Label><Input id="confirm-password" type="password" autoComplete="new-password" minLength={8} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} required className="mt-1" /></div>
              <Button type="submit" disabled={passwordSaving}>{passwordSaving ? 'Updating…' : 'Update password'}</Button>
            </form>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-card sm:p-6">
            <h2 className="flex items-center gap-2 text-lg font-black"><Mail className="h-5 w-5 text-violet-600" /> Email preferences</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Optional emails are off unless you turn them on.</p>
            <div className="mt-5 space-y-4">
              {prefsError && <p className="text-sm text-amber-700 dark:text-amber-300">Preferences are unavailable. Please reload this page to try again.</p>}
              <label className="flex items-center justify-between gap-3"><span className="text-sm font-medium">Useful purchase follow-ups</span><Switch checked={prefs.email_lifecycle_opt_in} disabled={prefsLoading || prefsSaving || prefsError} onCheckedChange={checked => setPrefs(previous => ({ ...previous, email_lifecycle_opt_in: checked }))} /></label>
              <label className="flex items-center justify-between gap-3"><span className="text-sm font-medium">Offers and product updates</span><Switch checked={prefs.email_promotions_opt_in} disabled={prefsLoading || prefsSaving || prefsError} onCheckedChange={checked => setPrefs(previous => ({ ...previous, email_promotions_opt_in: checked }))} /></label>
              <Button variant="outline" onClick={savePrefs} disabled={prefsLoading || prefsSaving || prefsError}>{prefsSaving ? 'Saving…' : 'Save preferences'}</Button>
            </div>
          </div>
        </section>

        <section aria-label="Upcoming account features" className="rounded-2xl border border-dashed border-slate-300 bg-white/70 p-5 dark:border-white/15 dark:bg-card/50"><h2 className="text-sm font-bold text-slate-700 dark:text-slate-200">Coming soon</h2><div className="mt-2 flex flex-wrap gap-2"><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-white/10 dark:text-slate-300">TallyCircle</span><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-white/10 dark:text-slate-300">API Access</span></div></section>

        <div className="flex items-center justify-between gap-4 border-t border-slate-200 pt-5 dark:border-white/10"><p className="flex items-center gap-2 text-sm text-slate-500"><User className="h-4 w-4" /> Account created {user.created_at ? new Date(user.created_at).toLocaleDateString('en-NG') : 'date unavailable'}</p><Button variant="outline" onClick={handleSignOut} disabled={signingOut} className="text-red-700 dark:text-red-300"><LogOut className="mr-2 h-4 w-4" /> {signingOut ? 'Signing out…' : 'Sign out'}</Button></div>
      </main>
      <Footer />
    </div>
  )
}
