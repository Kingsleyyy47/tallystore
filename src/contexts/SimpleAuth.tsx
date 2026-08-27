import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { linkRevenueIdentity } from '@/lib/revenue-os'

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
  walletBalance: number
  walletLoading: boolean
  refreshWalletBalance: () => Promise<void>
  showBalances: boolean
  toggleBalanceVisibility: () => void
  setBalanceVisibility: (visible: boolean) => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)
const ADMIN_EMAIL = 'wisdomthedev@gmail.com'
const INTERNAL_REVENUE_USER_KEY = 'tallystore_internal_revenue_user'

function writeInternalRevenueUserFlag(isInternal: boolean) {
  if (typeof window === 'undefined') return
  localStorage.setItem(INTERNAL_REVENUE_USER_KEY, isInternal ? 'true' : 'false')
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [isStaff, setIsStaff] = useState(false)
  const [walletBalance, setWalletBalance] = useState(0)
  const [walletLoading, setWalletLoading] = useState(true)
  const [showBalances, setShowBalances] = useState(() => {
    if (typeof window === 'undefined') return true
    return localStorage.getItem('show_balances') !== 'false'
  })
  const lastProfileLoadKey = useRef<string | null>(null)

  useEffect(() => {
    localStorage.setItem('show_balances', showBalances ? 'true' : 'false')
  }, [showBalances])

  useEffect(() => {
    writeInternalRevenueUserFlag(isAdmin || isStaff)
  }, [isAdmin, isStaff])

  const checkAdminStatus = useCallback(async (userId: string, userEmail?: string) => {
    setWalletLoading(true)
    const isWisdomAdmin = userEmail?.toLowerCase() === ADMIN_EMAIL

    try {
      // Race the profiles query against a 6-second timeout so a slow/hung
      // Supabase connection never freezes the auth spinner indefinitely.
      const timeoutPromise = new Promise<{ data: null; error: Error }>(resolve =>
        setTimeout(() => resolve({ data: null, error: new Error('profiles query timeout') }), 6000)
      )
      const { data, error } = await Promise.race([
        supabase.from('profiles').select('is_staff, wallet_balance').eq('id', userId).single(),
        timeoutPromise,
      ])

      if (error) {
        setIsAdmin(isWisdomAdmin)
        setIsStaff(false)
        writeInternalRevenueUserFlag(isWisdomAdmin)
        setWalletBalance(0)
        return { isAdmin: isWisdomAdmin, isStaff: false }
      }

      const nextIsStaff = !isWisdomAdmin && !!data?.is_staff
      setIsAdmin(isWisdomAdmin)
      setIsStaff(nextIsStaff)
      writeInternalRevenueUserFlag(isWisdomAdmin || nextIsStaff)
      setWalletBalance(data?.wallet_balance || 0)
      return { isAdmin: isWisdomAdmin, isStaff: nextIsStaff }
    } catch (error) {
      console.error('Error checking admin status:', error)
      setIsAdmin(isWisdomAdmin)
      setIsStaff(false)
      writeInternalRevenueUserFlag(isWisdomAdmin)
      setWalletBalance(0)
      return { isAdmin: isWisdomAdmin, isStaff: false }
    } finally {
      setWalletLoading(false)
    }
  }, [])

  useEffect(() => {
    const syncSession = async (session: Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session']) => {
      const sessionUser = session?.user ?? null
      setUser(sessionUser)

      if (sessionUser) {
        const profileLoadKey = `${sessionUser.id}:${sessionUser.email ?? ''}`
        if (lastProfileLoadKey.current !== profileLoadKey) {
          lastProfileLoadKey.current = profileLoadKey
          const roleStatus = await checkAdminStatus(sessionUser.id, sessionUser.email)
          linkRevenueIdentity(sessionUser.id, {
            auth_provider: sessionUser.app_metadata?.provider || 'email',
            email_domain: sessionUser.email?.split('@')[1] || null,
            internal_user: roleStatus.isAdmin || roleStatus.isStaff,
            role: roleStatus.isAdmin ? 'admin' : roleStatus.isStaff ? 'staff' : 'customer',
          })
        }
      } else {
        lastProfileLoadKey.current = null
        setIsAdmin(false)
        setIsStaff(false)
        setWalletBalance(0)
        setWalletLoading(false)
        writeInternalRevenueUserFlag(false)
      }

      setLoading(false)
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      void syncSession(session)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        await syncSession(session)
      }
    )

    return () => subscription.unsubscribe()
  }, [checkAdminStatus])

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
          const newBalance = (payload.new as { wallet_balance?: number }).wallet_balance
          if (typeof newBalance === 'number') {
            setWalletBalance(newBalance)
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
      setWalletLoading(false)
      return
    }

    setWalletLoading(true)

    try {
      const timeoutPromise = new Promise<{ data: null; error: Error }>(resolve =>
        setTimeout(() => resolve({ data: null, error: new Error('wallet balance refresh timeout') }), 6000)
      )
      const { data, error } = await Promise.race([
        supabase.from('profiles').select('wallet_balance').eq('id', user.id).single(),
        timeoutPromise,
      ])

      if (!error && data) {
        setWalletBalance(data.wallet_balance || 0)
      }
    } catch (error) {
      console.error('Error refreshing wallet balance:', error)
    } finally {
      setWalletLoading(false)
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
    setIsAdmin(false)
    setIsStaff(false)
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
    walletBalance,
    walletLoading,
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
