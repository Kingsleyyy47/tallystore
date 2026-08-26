import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Loader2, Mail, Lock, Gift } from 'lucide-react'
import NavbarAuth from '@/components/NavbarAuth'
import { useAuth } from '@/contexts/SimpleAuth'
import { useToast } from '@/hooks/use-toast'
import { trackRevenueEvent } from '@/lib/revenue-os'

export default function RegisterPage() {
  const [searchParams] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [referralCode, setReferralCode] = useState(searchParams.get('ref') || '')
  const [isLoading, setIsLoading] = useState(false)
  const { signUp } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()

  useEffect(() => {
    trackRevenueEvent({
      eventType: 'PAGE_VIEWED',
      surface: 'register',
      metadata: {
        has_referral_param: Boolean(searchParams.get('ref')),
      },
    })
  }, [searchParams])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!email || !password || !confirmPassword) {
      trackRevenueEvent({
        eventType: 'OFFER_DISMISSED',
        surface: 'register_form',
        metadata: { reason: 'missing_fields', has_referral_code: Boolean(referralCode.trim()) },
      })
      toast({
        title: "Missing fields",
        description: "Please fill in all fields",
        variant: "destructive"
      })
      return
    }

    if (password !== confirmPassword) {
      trackRevenueEvent({
        eventType: 'OFFER_DISMISSED',
        surface: 'register_form',
        metadata: { reason: 'password_mismatch', has_referral_code: Boolean(referralCode.trim()) },
      })
      toast({
        title: "Password mismatch",
        description: "Passwords do not match",
        variant: "destructive"
      })
      return
    }

    if (password.length < 6) {
      trackRevenueEvent({
        eventType: 'OFFER_DISMISSED',
        surface: 'register_form',
        metadata: { reason: 'password_too_short', has_referral_code: Boolean(referralCode.trim()) },
      })
      toast({
        title: "Password too short",
        description: "Password must be at least 6 characters",
        variant: "destructive"
      })
      return
    }

    setIsLoading(true)
    trackRevenueEvent({
      eventType: 'OFFER_ACCEPTED',
      surface: 'register_attempt',
      metadata: {
        email_domain: email.includes('@') ? email.split('@').pop()?.toLowerCase() || null : null,
        has_referral_code: Boolean(referralCode.trim()),
      },
    })

    try {
      const result = await signUp(email, password, referralCode)
      
      if (result.success) {
        trackRevenueEvent({
          eventType: 'OFFER_ACCEPTED',
          surface: 'register_success',
          metadata: {
            has_referral_code: Boolean(referralCode.trim()),
          },
        })
        toast({
          title: "Account created!",
          description: "You can now sign in to your account"
        })
        navigate('/login')
      } else {
        trackRevenueEvent({
          eventType: 'OFFER_DISMISSED',
          surface: 'register_failed',
          metadata: {
            reason: result.error || 'registration_failed',
            has_referral_code: Boolean(referralCode.trim()),
          },
        })
        toast({
          title: "Registration failed",
          description: result.error || "Failed to create account",
          variant: "destructive"
        })
      }
    } catch (error) {
      trackRevenueEvent({
        eventType: 'OFFER_DISMISSED',
        surface: 'register_error',
        metadata: {
          reason: error instanceof Error ? error.message : 'unexpected_error',
          has_referral_code: Boolean(referralCode.trim()),
        },
      })
      toast({
        title: "Registration error",
        description: "An unexpected error occurred",
        variant: "destructive"
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_18%_18%,hsl(var(--primary)/0.16),transparent_28rem),radial-gradient(circle_at_82%_8%,hsl(var(--accent)/0.12),transparent_24rem),linear-gradient(135deg,hsl(var(--background))_0%,hsl(var(--muted)/0.42)_100%)] pb-24">
      <NavbarAuth />
      <div className="flex min-h-[calc(100vh-9rem)] items-center justify-center px-4 py-8">
      <Card className="w-full max-w-md border-border/70 bg-background/90 shadow-[0_28px_80px_rgba(15,23,42,0.14)] backdrop-blur dark:shadow-[0_28px_80px_rgba(0,0,0,0.45)]">
        <CardHeader className="space-y-1 text-center">
          <Link to="/" className="mx-auto text-3xl font-black tracking-normal">
            Tally<span className="text-primary">Store</span>
          </Link>
          <CardTitle className="text-2xl font-bold">Create Account</CardTitle>
          <p className="text-muted-foreground">
            Join TallyStore to start buying accounts
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10"
                  disabled={isLoading}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  placeholder="Create a password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10"
                  disabled={isLoading}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="Confirm your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="pl-10"
                  disabled={isLoading}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="referralCode">Referral Code (optional)</Label>
              <div className="relative">
                <Gift className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="referralCode"
                  type="text"
                  placeholder="Enter a referral code"
                  value={referralCode}
                  onChange={(e) => setReferralCode(e.target.value)}
                  className="pl-10"
                  disabled={isLoading}
                />
              </div>
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating account...
                </>
              ) : (
                'Create Account'
              )}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground">
              Already have an account?{' '}
              <Link 
                to="/login" 
                className="font-medium text-primary hover:underline"
              >
                Sign in
              </Link>
            </p>
          </div>

          <div className="mt-4 text-center">
            <Link 
              to="/" 
              className="text-sm text-muted-foreground hover:underline"
            >
              Back to home
            </Link>
          </div>
        </CardContent>
      </Card>
      </div>
    </div>
  )
}
