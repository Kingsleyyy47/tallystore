import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { ArrowLeft, Loader2, Mail, Lock, ShieldCheck, Sparkles } from 'lucide-react'
import { useAuth } from '@/contexts/SimpleAuth'
import { useToast } from '@/hooks/use-toast'

const ADMIN_EMAIL = 'wisdomthedev@gmail.com'

function GoogleIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.3 9.14 5.38 12 5.38z" />
    </svg>
  )
}

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isGoogleLoading, setIsGoogleLoading] = useState(false)
  const { signIn, signInWithGoogle } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!email || !password) {
      toast({
        title: "Missing fields",
        description: "Please enter both email and password",
        variant: "destructive"
      })
      return
    }

    setIsLoading(true)

    try {
      const result = await signIn(email, password)
      
      if (result.success) {
        toast({
          title: "Welcome back!",
          description: "You have been logged in successfully"
        })
        
        navigate(email.trim().toLowerCase() === ADMIN_EMAIL ? '/admin' : '/dashboard')
      } else {
        toast({
          title: "Login failed",
          description: result.error || "Invalid email or password",
          variant: "destructive"
        })
      }
    } catch (error) {
      toast({
        title: "Login error",
        description: "An unexpected error occurred",
        variant: "destructive"
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleGoogleSignIn = async () => {
    setIsGoogleLoading(true)

    try {
      const result = await signInWithGoogle()

      if (!result.success) {
        toast({
          title: "Google sign in failed",
          description: result.error || "Please try again",
          variant: "destructive"
        })
        setIsGoogleLoading(false)
      }
    } catch (error) {
      toast({
        title: "Google sign in error",
        description: "An unexpected error occurred",
        variant: "destructive"
      })
      setIsGoogleLoading(false)
    }
  }

  return (
    <div className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_18%_18%,hsl(var(--primary)/0.16),transparent_28rem),radial-gradient(circle_at_82%_8%,hsl(var(--accent)/0.12),transparent_24rem),linear-gradient(135deg,hsl(var(--background))_0%,hsl(var(--muted)/0.42)_100%)] px-4 py-8">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-6xl items-center justify-center">
        <div className="grid w-full items-center gap-8 lg:grid-cols-[0.9fr_1fr]">
          <section className="hidden lg:block">
            <Link to="/" className="inline-flex items-center gap-2 text-sm font-bold text-muted-foreground transition hover:text-foreground">
              <ArrowLeft className="h-4 w-4" />
              Back to store
            </Link>

            <div className="mt-12 max-w-lg">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-2 text-xs font-black uppercase text-primary">
                <Sparkles className="h-3.5 w-3.5" />
                Secure TallyStore access
              </div>
              <h1 className="mt-6 text-5xl font-black leading-tight tracking-normal text-foreground">
                Sign in and get back to your orders.
              </h1>
              <p className="mt-5 text-base leading-8 text-muted-foreground">
                Access your wallet, product purchases, SMS numbers, referrals, and support history from one account.
              </p>

              <div className="mt-8 grid gap-3">
                {[
                  'Wallet balance stays connected',
                  'Orders and delivery history are protected',
                ].map((item) => (
                  <div key={item} className="flex items-center gap-3 rounded-xl border bg-background/70 p-4 shadow-sm">
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary">
                      <ShieldCheck className="h-5 w-5" />
                    </span>
                    <span className="text-sm font-bold text-foreground">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <Card className="mx-auto w-full max-w-md border-border/70 bg-background/90 shadow-[0_28px_80px_rgba(15,23,42,0.14)] backdrop-blur dark:shadow-[0_28px_80px_rgba(0,0,0,0.45)]">
            <CardHeader className="space-y-2 text-center">
              <Link to="/" className="mx-auto text-3xl font-black tracking-normal">
                Tally<span className="text-primary">Store</span>
              </Link>
              <CardTitle className="text-2xl font-black">Welcome Back</CardTitle>
              <p className="text-sm text-muted-foreground">
                Sign in with Google or your email password.
              </p>
            </CardHeader>
            <CardContent>
              <Button
                type="button"
                variant="outline"
                className="h-12 w-full gap-3 rounded-xl bg-background text-sm font-bold"
                onClick={handleGoogleSignIn}
                disabled={isLoading || isGoogleLoading}
              >
                {isGoogleLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleIcon />}
                Continue with Google
              </Button>

              <div className="my-6 flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs font-bold uppercase text-muted-foreground">or</span>
                <div className="h-px flex-1 bg-border" />
              </div>

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
                  className="h-12 rounded-xl pl-10"
                  disabled={isLoading || isGoogleLoading}
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
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12 rounded-xl pl-10"
                  disabled={isLoading || isGoogleLoading}
                  required
                />
              </div>
            </div>

            <Button 
              type="submit" 
              className="h-12 w-full rounded-xl font-black" 
              disabled={isLoading || isGoogleLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                'Sign In'
              )}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground">
              Don't have an account?{' '}
              <Link 
                to="/register" 
                className="font-medium text-primary hover:underline"
              >
                Sign up
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
    </div>
  )
}
