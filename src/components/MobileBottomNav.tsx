import { Home, LayoutGrid, PackageCheck, User, Wallet } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/SimpleAuth'
import { cn } from '@/lib/utils'

const hiddenPrefixes = ['/admin', '/staff-admin', '/get-ip']

export default function MobileBottomNav() {
  const { pathname } = useLocation()
  const { user } = useAuth()

  if (hiddenPrefixes.some((prefix) => pathname.startsWith(prefix))) return null

  const accountHref = user ? '/profile' : '/login'
  const items = [
    { label: 'Home', href: '/', icon: Home, active: pathname === '/' },
    {
      label: 'Products',
      href: '/products',
      icon: LayoutGrid,
      active: ['/products', '/category', '/product', '/checkout'].some((prefix) => pathname.startsWith(prefix)),
    },
    { label: 'Wallet', href: user ? '/wallet' : '/login', icon: Wallet, active: pathname === '/wallet' },
    { label: 'Orders', href: user ? '/orders' : '/login', icon: PackageCheck, active: pathname.startsWith('/orders') },
    {
      label: 'Account',
      href: accountHref,
      icon: User,
      active: ['/dashboard', '/profile', '/login', '/register'].some((prefix) => pathname.startsWith(prefix)),
    },
  ]

  return (
    <>
      <div className="h-[68px] md:hidden" aria-hidden="true" />
      <nav className="fixed inset-x-0 bottom-0 z-50 mx-auto grid h-[68px] w-full max-w-[430px] grid-cols-5 border-x border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] text-[9px] font-bold text-slate-600 shadow-[0_-16px_45px_rgba(15,23,42,0.18)] backdrop-blur dark:border-white/10 dark:bg-[#070a12]/95 dark:text-slate-400 min-[340px]:text-[11px] md:hidden">
        {items.map((item) => {
          const Icon = item.icon
          return (
            <Link
              key={item.label}
              to={item.href}
              className={cn(
                'grid min-w-0 place-items-center gap-0.5 px-1 py-2 transition hover:text-slate-950 dark:hover:text-white',
                item.active && 'text-purple-600 dark:text-purple-400',
              )}
            >
              <Icon className="h-5 w-5" />
              <span className="max-w-full whitespace-nowrap leading-tight">{item.label}</span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}
