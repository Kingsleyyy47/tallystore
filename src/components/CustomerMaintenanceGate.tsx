import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { abortable, verifyMaintenanceAccess, type MaintenanceAccess } from '@/lib/maintenanceAccess'
import MaintenancePage from './MaintenancePage'

const VERIFY_TIMEOUT_MS = 8000

export default function CustomerMaintenanceGate({ children }: { children: ReactNode }) {
  const location = useLocation()
  const staffLogin = location.pathname === '/maintenance-access'
  const [access, setAccess] = useState<MaintenanceAccess | null>(null)
  const accessRef = useRef<MaintenanceAccess | null>(null)
  const [checking, setChecking] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [signingIn, setSigningIn] = useState(false)
  const [message, setMessage] = useState('')
  const sequence = useRef(0)
  const active = useRef<AbortController | null>(null)
  const mounted = useRef(false)

  const verify = useCallback(async (expectedUserId?: string | null) => {
    const version = ++sequence.current
    active.current?.abort()
    const controller = new AbortController()
    active.current = controller
    // A different account must never inherit a previous workspace.
    if (expectedUserId !== undefined && expectedUserId !== accessRef.current?.userId) {
      accessRef.current = null
      setAccess(null)
    }
    setChecking(true)
    const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS)
    try {
      const verified = await verifyMaintenanceAccess(supabase, controller.signal)
      if (!mounted.current || version !== sequence.current) return
      accessRef.current = verified
      setAccess(verified)
      setMessage(verified ? '' : 'Staff access is available only to verified staff and administrators.')
    } catch {
      if (!mounted.current || version !== sequence.current) return
      accessRef.current = null
      setAccess(null)
      setMessage('We could not verify account permissions. Please try again shortly.')
    } finally {
      clearTimeout(timer)
      if (mounted.current && version === sequence.current) setChecking(false)
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    let queued: ReturnType<typeof setTimeout> | undefined
    const queue = (userId?: string | null) => {
      if (queued) clearTimeout(queued)
      // Never await a Supabase call from inside its auth callback.
      queued = setTimeout(() => { if (mounted.current) void verify(userId) }, 0)
    }
    queue()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted.current) return
      // Hide access immediately on sign-out/account changes, before async work.
      const userId = session?.user?.id ?? null
      if (userId !== accessRef.current?.userId) {
        sequence.current++
        active.current?.abort()
        accessRef.current = null
        setAccess(null)
      }
      queue(userId)
    })
    const onFocus = () => { if (accessRef.current) queue(accessRef.current.userId) }
    window.addEventListener('focus', onFocus)
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible' && accessRef.current) queue(accessRef.current.userId)
    }, 30000)
    return () => {
      mounted.current = false
      sequence.current++
      if (queued) clearTimeout(queued)
      clearInterval(interval)
      active.current?.abort()
      subscription.unsubscribe()
      window.removeEventListener('focus', onFocus)
    }
  }, [verify])

  const signIn = async (event: FormEvent) => {
    event.preventDefault()
    setMessage('')
    setSigningIn(true)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10000)
    try {
      const { error } = await abortable(supabase.auth.signInWithPassword({ email: email.trim(), password }), controller.signal)
      if (error) { setMessage('Sign-in was not successful. Check your details and try again.'); return }
      setPassword('')
      void verify()
    } catch {
      setMessage('Sign-in is unavailable right now. Please try again shortly.')
    } finally {
      clearTimeout(timer)
      if (mounted.current) setSigningIn(false)
    }
  }

  if (access) {
    if (staffLogin) return <Navigate to={access.role === 'admin' ? '/admin' : '/staff-admin'} replace />
    return <>{children}</>
  }

  return <MaintenancePage>
    {staffLogin && <section className="mt-7 border-t border-white/10 pt-6 text-left" aria-labelledby="staff-access-title">
      <h2 id="staff-access-title" className="text-lg font-semibold">Staff sign-in</h2>
      <p className="mt-2 text-sm text-slate-300">Staff and administrator access remains available after account verification.</p>
      <form onSubmit={signIn} className="mt-4 space-y-4">
        <label className="block text-sm font-medium">Email
          <input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} disabled={signingIn} className="mt-2 block w-full rounded-xl border border-white/20 bg-slate-950 px-3 py-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-400" />
        </label>
        <label className="block text-sm font-medium">Password
          <input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} disabled={signingIn} className="mt-2 block w-full rounded-xl border border-white/20 bg-slate-950 px-3 py-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-400" />
        </label>
        <button type="submit" disabled={signingIn || checking} className="min-h-11 w-full rounded-xl bg-purple-500 px-4 py-3 font-semibold text-white hover:bg-purple-400 disabled:opacity-60">{signingIn ? 'Signing in…' : checking ? 'Verifying access…' : 'Sign in'}</button>
      </form>
      {message && <p role="alert" className="mt-4 text-sm text-amber-200">{message}</p>}
      {!checking && <button type="button" onClick={() => void verify()} className="mt-3 min-h-11 text-sm font-medium text-purple-200 underline underline-offset-4">Check access again</button>}
    </section>}
  </MaintenancePage>
}
