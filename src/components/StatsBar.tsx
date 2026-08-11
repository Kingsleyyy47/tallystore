import { useEffect, useState } from 'react'
import { Users, ShoppingBag, LayoutGrid, ShieldCheck } from 'lucide-react'
import { getUserCount, getAdminSalesStats, getCategories, formatCount } from '@/lib/supabase'

interface Stat {
  label: string
  value: string
  icon: typeof Users
}

export default function StatsBar() {
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<Stat[]>([])

  useEffect(() => {
    let isMounted = true

    const loadStats = async () => {
      try {
        const [userCount, salesStats, categories] = await Promise.all([
          getUserCount(),
          getAdminSalesStats(),
          getCategories(),
        ])

        if (!isMounted) return

        setStats([
          { label: 'Active Users', value: formatCount(userCount), icon: Users },
          { label: 'Orders Delivered', value: formatCount(salesStats.totalSales), icon: ShoppingBag },
          { label: 'Categories', value: formatCount(categories.length), icon: LayoutGrid },
          { label: 'Verified Accounts', value: '100%', icon: ShieldCheck },
        ])
      } catch (error) {
        console.error('Error loading stats:', error)
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    loadStats()
    return () => { isMounted = false }
  }, [])

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 rounded-lg bg-muted/50 animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="flex items-center gap-3 rounded-lg border bg-card p-4 shadow-sm"
        >
          <div className="p-2 rounded-full bg-primary/10">
            <stat.icon className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-lg font-bold leading-none">{stat.value}</p>
            <p className="text-xs text-muted-foreground">{stat.label}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
