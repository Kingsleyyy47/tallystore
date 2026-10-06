import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { linkRevenueIdentity } from '@/lib/revenue-os'
import { clearPaymentStorage } from '@/lib/paymentStorage'

interface AuthContextType {
  user: User | null
  loading: boolean
  signUp: (email: string, password: string, referralCode?: string) => Promise<{ success: boolean; error?: string }>
  signIn: (email: string, password: string) => Promise<{ success: boolean; error?: string }>
  signInWithGoogle: () => Promise<{ success: boolean; error?: string }>
  signOut: () => Promise<void>
  resendConfirmation: (email: string) => Promise<{ success: boolean; error?: string }>
  isAdmin: boolean
  isStaff: boolean
  roleLookupError: string | null
  retryRoleLookup: () => Promise<void>
  walletBalance: number
  walletLoading: boolean
  walletBalanceUnavailable: boolean
  accountSuspended: boolean
  suspensionReason: string | null
  walletReviewRequired: boolean
  walletReviewReason: string | null
  walletReviewedBy: string | null
  refreshWalletBalance: () => Promise<void>
  showBalances: boolean
  toggleBalanceVisibility: () => void
  setBalanceVisibility: (visible: boolean) => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)
const INTERNAL_REVENUE_USER_KEY = 'tallystore_internal_revenue_user'

function writeInternalRevenueUserFlag(isInternal: boolean) {
  if (typeof window === 'undefined') return
  localStorage.setItem(INTERNAL_REVENUE_USER_KEY, isInternal ? 'true' : 'false')
}

async function readAvailableWalletBalance(): Promise<number> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('wallet balance query timeout')), 6000)
  )
  const { data, error } = await Promise.race([
    supabase.rpc('get_my_wallet_available'),
    timeout,
  ])
  if (error) throw error
  const amount = Number(data)
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('Verified wallet balance is unavailable')
  }
  return amount
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [isStaff, setIsStaff] = useState(false)
  const [roleLookupError, setRoleLookupError] = useState<string | null>(null)
  const [walletBalance, setWalletBalance] = useState(0)
  const [walletLoading, setWalletLoading] = useState(true)
  const [walletBalanceUnavailable, setWalletBalanceUnavailable] = useState(false)
  const [accountSuspended, setAccountSuspended] = useState(false)
  const [suspensionReason, setSuspensionReason] = useState<string | null>(null)
  const [walletReviewRequired, setWalletReviewRequired] = useState(false)
  const [walletReviewReason, setWalletReviewReason] = useState<string | null>(null)
  const [walletReviewedBy, setWalletReviewedBy] = useState<string | null>(null)
  const [showBalances, setShowBalances] = useState(() => {
    if (typeof window === 'undefined') return true
    return localStorage.getItem('show_balances') !== 'false'
  })
  const lastProfileLoadKey = useRef<string | null>(null)
  const roleLookupSequence = useRef(0)
  const lastRoleCheckAt = useRef(0)
  const backgroundRoleCheckInFlight = useRef(false)

  useEffect(() => {
    localStorage.setItem('show_balances', showBalances ? 'true' : 'false')
  }, [showBalances])

  useEffect(() => {
    writeInternalRevenueUserFlag(isAdmin || isStaff)
  }, [isAdmin, isStaff])

  const checkAdminStatus = useCallback(async (userId: string) => {
    const lookupSequence = ++roleLookupSequence.current
    let walletRequestStarted = false
    setWalletLoading(true)
    setWalletBalanceUnavailable(false)
    setRoleLookupError(null)

    try {
      const profilePromise = supabase
        .from('profiles')
        .select('is_admin, is_staff, account_suspended, suspension_reason, wallet_review_required, wallet_review_reason, wallet_reviewed_by')
        .eq('id', userId)
        .single()

      const timeoutPromise = new Promise<{ data: null; error: Error }>(resolve =>
        setTimeout(() => resolve({ data: null, error: new Error('profiles query timeout') }), 8000)
      )

      const { data, error } = await Promise.race([profilePromise, timeoutPromise])
      if (lookupSequence !== roleLookupSequence.current) return { isAdmin: false, isStaff: false }

      if (error) {
        // A failed lookup is not evidence that the account lacks its role.
        setRoleLookupError('Account permissions could not be verified. Please retry.')
        setIsAdmin(false)
        setIsStaff(false)
        writeInternalRevenueUserFlag(false)
        setWalletBalance(0)
        setWalletBalanceUnavailable(true)
        setAccountSuspended(false)
        setSuspensionReason(null)
        setWalletReviewRequired(false)
        setWalletReviewReason(null)
        setWalletReviewedBy(null)

        return { isAdmin: false, isStaff: false }
      }

      const activeAccount = data?.account_suspended === false
      const nextIsAdmin = activeAccount && data?.is_admin === true
      lastRoleCheckAt.current = Date.now()
      setRoleLookupError(null)
      const nextIsStaff = activeAccount && !nextIsAdmin && data?.is_staff === true
      setIsAdmin(nextIsAdmin)
      setIsStaff(nextIsStaff)
      writeInternalRevenueUserFlag(nextIsAdmin || nextIsStaff)
      walletRequestStarted = true
      void readAvailableWalletBalance().then((available) => {
        if (lookupSequence === roleLookupSequence.current) {
          setWalletBalance(available)
          setWalletBalanceUnavailable(false)
        }
      }).catch((balanceError) => {
        console.error('Error checking verified wallet balance:', balanceError)
        if (lookupSequence === roleLookupSequence.current) {
          setWalletBalance(0)
          setWalletBalanceUnavailable(true)
        }
      }).finally(() => {
        if (lookupSequence === roleLookupSequence.current) setWalletLoading(false)
      })
      setAccountSuspended(Boolean(data?.account_suspended))
      setSuspensionReason(data?.suspension_reason || null)
      setWalletReviewRequired(Boolean(data?.wallet_review_required))
      setWalletReviewReason(data?.wallet_review_reason || null)
      setWalletReviewedBy(data?.wallet_reviewed_by || null)
      return { isAdmin: nextIsAdmin, isStaff: nextIsStaff }
    } catch (error) {
      if (lookupSequence !== roleLookupSequence.current) return { isAdmin: false, isStaff: false }
      console.error('Error checking admin status:', error)
      setRoleLookupError('Account permissions could not be verified. Please retry.')
      setIsAdmin(false)
      setIsStaff(false)
      writeInternalRevenueUserFlag(false)
      setWalletBalance(0)
      setWalletBalanceUnavailable(true)
      setAccountSuspended(false)
      setSuspensionReason(null)
      setWalletReviewRequired(false)
      setWalletReviewReason(null)
      setWalletReviewedBy(null)
      return { isAdmin: false, isStaff: false }
    } finally {
      if (!walletRequestStarted && lookupSequence === roleLookupSequence.current) {
        setWalletLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    let disposed = false
    const pendingSessionTimers = new Set<number>()
    const syncSession = async (session: Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session']) => {
      if (disposed) return
      const sessionUser = session?.user ?? null

      if (sessionUser) {
        const profileLoadKey = `${sessionUser.id}:${sessionUser.email ?? ''}`
        if (lastProfileLoadKey.current !== profileLoadKey) {
          lastProfileLoadKey.current = profileLoadKey
          // Hide the previous account's workspace before the new role lookup.
          setLoading(true)
          setIsAdmin(false)
          setIsStaff(false)
          setRoleLookupError(null)
          setWalletBalance(0)
          setWalletBalanceUnavailable(false)
          setUser(sessionUser)
          const roleStatus = await checkAdminStatus(sessionUser.id)
          if (!disposed && lastProfileLoadKey.current === profileLoadKey) {
            linkRevenueIdentity(sessionUser.id, {
              auth_provider: sessionUser.app_metadata?.provider || 'email',
              email_domain: sessionUser.email?.split('@')[1] || null,
              internal_user: roleStatus.isAdmin || roleStatus.isStaff,
              role: roleStatus.isAdmin ? 'admin' : roleStatus.isStaff ? 'staff' : 'customer',
            })
            setLoading(false)
          }
          return
        }
        setUser(sessionUser)
      } else {
        roleLookupSequence.current += 1
        lastProfileLoadKey.current = null
        lastRoleCheckAt.current = 0
        setUser(null)
        setRoleLookupError(null)
        clearPaymentStorage()
        setIsAdmin(false)
        setIsStaff(false)
        setWalletBalance(0)
        setWalletBalanceUnavailable(false)
        setAccountSuspended(false)
        setSuspensionReason(null)
        setWalletReviewRequired(false)
        setWalletReviewReason(null)
        setWalletReviewedBy(null)
        setWalletLoading(false)
        writeInternalRevenueUserFlag(false)
        setLoading(false)
      }
    }

    // INITIAL_SESSION supplies the stored session. The callback itself must
    // return synchronously: a Supabase query inside it can deadlock auth.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        const timer = window.setTimeout(() => {
          pendingSessionTimers.delete(timer)
          if (!disposed) void syncSession(session)
        }, 0)
        pendingSessionTimers.add(timer)
      }
    )

    return () => {
      disposed = true
      roleLookupSequence.current += 1
      pendingSessionTimers.forEach((timer) => window.clearTimeout(timer))
      subscription.unsubscribe()
    }
  }, [checkAdminStatus])

  useEffect(() => {
    if (!user) return
    const recheckOnFocus = async () => {
      if (Date.now() - lastRoleCheckAt.current < 30_000) return
      if (backgroundRoleCheckInFlight.current) return
      const profileLoadKey = `${user.id}:${user.email ?? ''}`
      if (lastProfileLoadKey.current !== profileLoadKey) return
      // Keep the current page mounted during a same-account role refresh.
      // Initial login/account changes still use the global loading guard.
      backgroundRoleCheckInFlight.current = true
      try {
        await checkAdminStatus(user.id)
      } finally {
        backgroundRoleCheckInFlight.current = false
      }
    }
    window.addEventListener('focus', recheckOnFocus)
    const roleTimer = isAdmin || isStaff
      ? window.setInterval(() => {
          if (document.visibilityState === 'visible') void recheckOnFocus()
        }, 30_000)
      : null
    return () => {
      window.removeEventListener('focus', recheckOnFocus)
      if (roleTimer !== null) window.clearInterval(roleTimer)
    }
  }, [user, isAdmin, isStaff, checkAdminStatus])

  const retryRoleLookup = useCallback(async () => {
    if (!user) return
    const profileLoadKey = `${user.id}:${user.email ?? ''}`
    setLoading(true)
    try {
      await checkAdminStatus(user.id)
    } finally {
      if (lastProfileLoadKey.current === profileLoadKey) setLoading(false)
    }
  }, [user, checkAdminStatus])

  // ── Real-time wallet balance subscription ────────────────────────────────────
  // Listens for UPDATE events on the logged-in user's profiles row so the
  // balance refreshes automatically after top-ups, orders, refunds, etc.
  useEffect(() => {
    if (!user) return

    const channel = supabase
      .channel(`profile-balance-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${user.id}`,
        },
        (payload) => {
          const nextProfile = payload.new as {
            wallet_balance?: number
            account_suspended?: boolean
            suspension_reason?: string | null
            wallet_review_required?: boolean
            wallet_review_reason?: string | null
            wallet_reviewed_by?: string | null
          }
          if (typeof nextProfile.wallet_balance === 'number') {
            void readAvailableWalletBalance().then((available) => {
              if (lastProfileLoadKey.current?.startsWith(`${user.id}:`)) {
                setWalletBalance(available)
                setWalletBalanceUnavailable(false)
              }
            }).catch((error) => {
              console.error('Error refreshing verified wallet balance:', error)
              if (lastProfileLoadKey.current?.startsWith(`${user.id}:`)) {
                setWalletBalance(0)
                setWalletBalanceUnavailable(true)
              }
            })
          }
          if (typeof nextProfile.account_suspended === 'boolean') {
            setAccountSuspended(nextProfile.account_suspended)
          }
          if ('suspension_reason' in nextProfile) {
            setSuspensionReason(nextProfile.suspension_reason || null)
          }
          if (typeof nextProfile.wallet_review_required === 'boolean') {
            setWalletReviewRequired(nextProfile.wallet_review_required)
          }
          if ('wallet_review_reason' in nextProfile) {
            setWalletReviewReason(nextProfile.wallet_review_reason || null)
          }
          if ('wallet_reviewed_by' in nextProfile) {
            setWalletReviewedBy(nextProfile.wallet_reviewed_by || null)
          }
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [user])

  const refreshWalletBalance = useCallback(async () => {
    if (!user) {
      setWalletBalance(0)
      setWalletBalanceUnavailable(false)
      setWalletLoading(false)
      return
    }

    setWalletLoading(true)

    try {
      const available = await readAvailableWalletBalance()
      if (lastProfileLoadKey.current?.startsWith(`${user.id}:`)) {
        setWalletBalance(available)
        setWalletBalanceUnavailable(false)
      }
    } catch (error) {
      console.error('Error refreshing wallet balance:', error)
      if (lastProfileLoadKey.current?.startsWith(`${user.id}:`)) {
        setWalletBalance(0)
        setWalletBalanceUnavailable(true)
      }
    } finally {
      if (lastProfileLoadKey.current?.startsWith(`${user.id}:`)) {
        setWalletLoading(false)
      }
    }
  }, [user])

  const signUp = async (email: string, password: string, referralCode?: string) => {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: email.split('@')[0], // Use email prefix as name
            referral_code_input: referralCode?.trim() || null,
          },
          emailRedirectTo: `${window.location.origin}/email-confirmation`
        }
      })

      if (error) {
        // If user already exists but isn't confirmed, offer to resend confirmation
        if (error.message.includes('already registered') || error.message.includes('User already registered')) {
          return {
            success: false,
            error: 'User already exists. Please check your email for the confirmation link, or we can resend it.'
          }
        }
        return { success: false, error: error.message }
      }

      // If Supabase returns a session immediately, apply the referral now.
      // Otherwise EmailConfirmation applies it after the email verification
      // creates an authenticated session.
      if (data.session) {
        supabase.functions.invoke('apply-referral', {
          body: { referralCode },
        }).catch((err) => console.error('apply-referral invoke failed:', err))
      }

      return { success: true }
    } catch (error) {
      return { success: false, error: 'Sign up failed' }
    }
  }

  const signIn = async (email: string, password: string) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      })

      if (error) {
        return { success: false, error: error.message }
      }

      return { success: true }
    } catch (error) {
      return { success: false, error: 'Sign in failed' }
    }
  }

  const signInWithGoogle = async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/login`,
        },
      })

      if (error) {
        return { success: false, error: error.message }
      }

      return { success: true }
    } catch (error) {
      return { success: false, error: 'Google sign in failed' }
    }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    clearPaymentStorage()
    setIsAdmin(false)
    setIsStaff(false)
    setAccountSuspended(false)
    setSuspensionReason(null)
    setWalletReviewRequired(false)
    setWalletReviewReason(null)
    setWalletReviewedBy(null)
  }

  const resendConfirmation = async (email: string) => {
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/email-confirmation`
        }
      })

      if (error) {
        return { success: false, error: error.message }
      }

      return { success: true }
    } catch (error) {
      return { success: false, error: 'Failed to resend confirmation email' }
    }
  }

  const setBalanceVisibility = (visible: boolean) => {
    setShowBalances(visible)
  }

  const toggleBalanceVisibility = () => {
    setShowBalances((visible) => !visible)
  }

  const value = {
    user,
    loading,
    signUp,
    signIn,
    signInWithGoogle,
    signOut,
    resendConfirmation,
    isAdmin,
    isStaff,
    roleLookupError,
    retryRoleLookup,
    walletBalance,
    walletLoading,
    walletBalanceUnavailable,
    accountSuspended,
    suspensionReason,
    walletReviewRequired,
    walletReviewReason,
    walletReviewedBy,
    refreshWalletBalance,
    showBalances,
    toggleBalanceVisibility,
    setBalanceVisibility
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
