import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { User, Shield, Calendar, Wallet } from 'lucide-react'
import NavbarAuth from '@/components/NavbarAuth'
import Footer from '@/components/Footer'
import WalletBalanceWidget from '@/components/WalletBalanceWidget'
import { useAuth } from '@/contexts/SimpleAuth'
import { useCurrency } from '@/contexts/CurrencyContext'
import { getUserTransactions } from '@/lib/supabase'

export default function ProfilePage() {
  const { user, walletBalance } = useAuth()
  const { formatPrice } = useCurrency()
  const [transactions, setTransactions] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Load user data on component mount
  useEffect(() => {
    const loadUserData = async () => {
      if (!user?.id) return
      
      setIsLoading(true)
      try {
        // Load user transactions to calculate stats
        const userTransactions = await getUserTransactions(user.id)
        setTransactions(userTransactions)
      } catch (error) {
        console.error('Failed to load user data:', error)
      } finally {
        setIsLoading(false)
      }
    }

    if (user) {
      loadUserData()
    }
  }, [user])

  // Calculate user stats from real data
  const totalSpent = Math.abs(transactions
    .filter(t => t.type === 'purchase' && t.status === 'completed')
    .reduce((sum, t) => sum + t.amount, 0))

  const totalTopups = transactions
    .filter(t => t.type === 'topup' && t.status === 'completed')
    .reduce((sum, t) => sum + t.amount, 0)

  const getInitials = (name: string) => {
    if (!name) return 'U'
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background">
        <NavbarAuth />
        <div className="container mx-auto px-6 pt-24 pb-12 max-w-4xl">
          <Alert variant="destructive">
            <AlertDescription>Please log in to view your profile.</AlertDescription>
          </Alert>
        </div>
        <Footer />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <NavbarAuth />
      
      {/* Wallet Balance Widget */}
      <div className="container mx-auto px-6 pt-24 pb-4 max-w-4xl">
        <WalletBalanceWidget showRefresh={true} />
      </div>
      
      <div className="container mx-auto px-6 pb-12 max-w-4xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">My Profile</h1>
          <p className="text-muted-foreground">
            View your account information and transaction history
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-muted-foreground">Loading profile...</div>
          </div>
        ) : (
          <div className="grid lg:grid-cols-3 gap-8">
            {/* Profile Overview */}
            <div className="lg:col-span-1">
              <Card>
                <CardHeader className="text-center">
                  <div className="flex flex-col items-center space-y-4">
                    <Avatar className="h-24 w-24">
                      <AvatarFallback className="text-lg bg-primary text-primary-foreground">
                        {getInitials(user.email || 'User')}
                      </AvatarFallback>
                    </Avatar>
                    
                    <div>
                      <h3 className="font-semibold text-lg">{user.email?.split('@')[0] || 'User'}</h3>
                      <p className="text-muted-foreground text-sm">{user.email}</p>
                      <div className="flex items-center justify-center gap-2 mt-2">
                        <Badge variant="default">
                          <Shield className="h-3 w-3 mr-1" />
                          Active User
                        </Badge>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                
                <CardContent className="space-y-4">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Wallet Balance</span>
                    <span className="font-medium text-green-600">{formatPrice(walletBalance)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Spent</span>
                    <span className="font-medium">{formatPrice(totalSpent)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Top-ups</span>
                    <span className="font-medium text-blue-600">₦{totalTopups.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Transactions</span>
                    <span className="font-medium">{transactions.length}</span>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Profile Details */}
            <div className="lg:col-span-2 space-y-6">
              {/* Account Information */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <User className="h-5 w-5" />
                    Account Information
                  </CardTitle>
                  <CardDescription>
                    Your account details and basic information
                  </CardDescription>
                </CardHeader>
                
                <CardContent className="space-y-4">
                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Display Name</Label>
                      <Input
                        value={user.email?.split('@')[0] || 'Not set'}
                        disabled
                        className="bg-muted"
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label>Email Address</Label>
                      <Input
                        value={user.email}
                        disabled
                        className="bg-muted"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>User ID</Label>
                    <Input
                      value={user.id}
                      disabled
                      className="bg-muted font-mono text-sm"
                    />
                  </div>

                  <Alert>
                    <AlertDescription>
                      Profile editing feature will be available soon. Contact support if you need to update your information.
                    </AlertDescription>
                  </Alert>
                </CardContent>
              </Card>

              {/* Transaction Summary */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Wallet className="h-5 w-5" />
                    Transaction Summary
                  </CardTitle>
                  <CardDescription>
                    Overview of your account activity
                  </CardDescription>
                </CardHeader>
                
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center p-4 bg-green-50 dark:bg-green-950/20 rounded-lg">
                      <div className="text-2xl font-bold text-green-600">
                        {transactions.filter(t => t.type === 'topup').length}
                      </div>
                      <div className="text-sm text-muted-foreground">Top-ups</div>
                    </div>
                    
                    <div className="text-center p-4 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
                      <div className="text-2xl font-bold text-blue-600">
                        {transactions.filter(t => t.type === 'purchase').length}
                      </div>
                      <div className="text-sm text-muted-foreground">Purchases</div>
                    </div>
                  </div>
                  
                  <Separator />
                  
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Account Created</span>
                      <span className="text-sm">
                        {user.created_at ? new Date(user.created_at).toLocaleDateString() : 'N/A'}
                      </span>
                    </div>
                    
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Last Updated</span>
                      <span className="text-sm">
                        {user.updated_at ? new Date(user.updated_at).toLocaleDateString() : 'N/A'}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Quick Actions */}
              <Card>
                <CardHeader>
                  <CardTitle>Quick Actions</CardTitle>
                  <CardDescription>
                    Common account actions and navigation
                  </CardDescription>
                </CardHeader>
                
                <CardContent>
                  <div className="flex flex-wrap gap-3">
                    <Button 
                      onClick={() => window.location.href = '/wallet'}
                      className="flex-1 min-w-[200px]"
                    >
                      <Wallet className="mr-2 h-4 w-4" />
                      Manage Wallet
                    </Button>
                    
                    <Button 
                      variant="outline"
                      onClick={() => window.location.href = '/order-history'}
                      className="flex-1 min-w-[200px]"
                    >
                      <Calendar className="mr-2 h-4 w-4" />
                      Order History
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>

      <Footer />
    </div>
  )
}
