import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

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

  const checkAdminStatus = useCallback(async (userId: string, userEmail?: string) => {
    setWalletLoading(true)
    const isWisdomAdmin = userEmail?.toLowerCase() === ADMIN_EMAIL

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('is_staff, wallet_balance')
        .eq('id', userId)
        .single()

      if (error) {
        setIsAdmin(isWisdomAdmin)
        setIsStaff(false)
        setWalletBalance(0)
        return
      }

      setIsAdmin(isWisdomAdmin)
      setIsStaff(!isWisdomAdmin && !!data?.is_staff)
      setWalletBalance(data?.wallet_balance || 0)
    } catch (error) {
      console.error('Error checking admin status:', error)
      setIsAdmin(isWisdomAdmin)
      setIsStaff(false)
      setWalletBalance(0)
    } finally {
      setWalletLoading(false)
    }
  }, [])

  useEffect(() => {
    const syncSession = (session: Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session']) => {
      const sessionUser = session?.user ?? null
      setUser(sessionUser)

      if (sessionUser) {
        const profileLoadKey = `${sessionUser.id}:${sessionUser.email ?? ''}`
        if (lastProfileLoadKey.current !== profileLoadKey) {
          lastProfileLoadKey.current = profileLoadKey
          checkAdminStatus(sessionUser.id, sessionUser.email)
        }
      } else {
        lastProfileLoadKey.current = null
        setIsAdmin(false)
        setIsStaff(false)
        setWalletBalance(0)
        setWalletLoading(false)
      }

      setLoading(false)
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      syncSession(session)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        syncSession(session)
      }
    )

    return () => subscription.unsubscribe()
  }, [checkAdminStatus])

  const refreshWalletBalance = useCallback(async () => {
    if (!user) {
      setWalletBalance(0)
      setWalletLoading(false)
      return
    }

    setWalletLoading(true)
    
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('wallet_balance')
        .eq('id', user.id)
        .single()

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

      // Generate this user's own referral code and link them to a referrer
      // if they entered one. Done via the apply-referral edge function
      // (service role) instead of a direct client-side table write, because
      // when email confirmation is required there's no active session yet
      // right after signUp() - RLS would silently block the profiles UPDATE.
      // Non-blocking - shouldn't fail signup.
      if (data.user) {
        supabase.functions.invoke('apply-referral', {
          body: { userId: data.user.id, referralCode },
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
