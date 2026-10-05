import { useEffect, useLayoutEffect, useState } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import {
  ChevronRight, CircleUserRound, Download, History, Home, LifeBuoy, LogOut,
  Menu, Plane, Rocket, ShieldCheck, ShoppingBag, Smartphone, Sparkles,
  Star, UsersRound, Wallet, X,
} from 'lucide-react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ThemeToggle } from '@/components/ThemeToggle'
import InstallAppDialog from '@/components/InstallAppDialog'
import { useAuth } from '@/contexts/SimpleAuth'
import { useCurrency } from '@/contexts/CurrencyContext'
import { usePWAInstall } from '@/hooks/usePWAInstall'
import { useToast } from '@/hooks/use-toast'
import { lockNavbarScroll } from '@/lib/navbarScrollLock'

const ANNOUNCEMENT_STORAGE_KEY = 'announcement-banner-dismissed'
const navigation = [
  { label: 'Home', to: '/', icon: Home },
  { label: 'Products', to: '/products', icon: ShoppingBag },
  { label: 'US & Canada (SMS)', to: '/us-canada', icon: Smartphone },
  { label: 'Social Boost', to: '/social-boost', icon: Rocket },
  { label: 'Telegram', to: '/telegram-stars', icon: Star },
  { label: 'Travel & Visa', to: '/travel-visa', icon: Plane },
  { label: 'Tally Circle', to: null, icon: UsersRound },
  { label: 'Help Centre', to: '/support', icon: LifeBuoy },
] as const

const accountItemClass = 'gap-3 rounded-xl px-3 py-2.5 text-sm cursor-pointer'

export default function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [showInstallDialog, setShowInstallDialog] = useState(false)
  const [announcementVisible, setAnnouncementVisible] = useState(true)
  const {
    user, loading, signOut, isAdmin, isStaff, roleLookupError, accountSuspended,
    walletBalance, walletLoading, walletBalanceUnavailable, showBalances,
  } = useAuth()
  const { currency, toggleCurrency, formatPrice } = useCurrency()
  const { canInstall, isInstalled, isAndroid, installApp } = usePWAInstall()
  const { toast } = useToast()
  const location = useLocation()
  const verifiedRole = !!user && !loading && !roleLookupError && !accountSuspended
  const homeRoute = user ? '/dashboard' : '/'
  const primaryNavigation = navigation.map(item => item.label === 'Home' ? { ...item, to: homeRoute } : item)
  const productNavigationSelected = /^\/(?:products(?:\/|$)|category\/|product\/|checkout(?:\/|$))/.test(location.pathname)

  useEffect(() => {
    const checkAnnouncement = () => {
      try {
        setAnnouncementVisible(localStorage.getItem(ANNOUNCEMENT_STORAGE_KEY) !== 'true')
      } catch {
        setAnnouncementVisible(true)
      }
    }
    checkAnnouncement()
    window.addEventListener('storage', checkAnnouncement)
    const interval = window.setInterval(checkAnnouncement, 500)
    return () => {
      window.removeEventListener('storage', checkAnnouncement)
      window.clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 50)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useLayoutEffect(() => {
    if (!isMobileMenuOpen) return
    return lockNavbarScroll(document, window)
  }, [isMobileMenuOpen])

  useEffect(() => {
    setIsMobileMenuOpen(false)
  }, [location.pathname])

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1280px)')
    const closeOnDesktop = () => { if (desktop.matches) setIsMobileMenuOpen(false) }
    desktop.addEventListener('change', closeOnDesktop)
    return () => desktop.removeEventListener('change', closeOnDesktop)
  }, [])

  const handleSignOut = async () => {
    try {
      await signOut()
    } catch {
      toast({ title: 'Unable to sign out', description: 'Please try again.', variant: 'destructive' })
    }
  }

  const handleDownloadClick = async () => {
    if (!isAndroid && !canInstall) {
      setShowInstallDialog(true)
      return
    }
    try {
      const installed = await installApp()
      toast(installed
        ? { title: 'App installing', description: 'TallyStore is being added to your home screen.' }
        : { title: 'Installation cancelled', description: 'You can try again from your account menu.' })
    } catch {
      setShowInstallDialog(true)
    }
  }

  const balanceLabel = !showBalances ? '••••••'
    : walletLoading ? 'Loading…'
      : walletBalanceUnavailable ? 'Unavailable' : formatPrice(walletBalance)

  return (
    <>
      <div className={announcementVisible ? 'h-[72px] md:h-[104px]' : 'h-[72px]'} />
      <DialogPrimitive.Root open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
        <nav
          aria-label="Main navigation"
          className={`fixed inset-x-0 z-50 ${announcementVisible ? 'top-0 md:top-8' : 'top-0'} border-b transition-colors duration-200 ${
            isScrolled
              ? 'border-border/70 bg-background/95 shadow-sm backdrop-blur-xl'
              : 'border-border/40 bg-background/90 backdrop-blur-md'
          }`}
        >
          <div className="container mx-auto grid h-[72px] grid-cols-[40px_minmax(0,1fr)_120px] items-center gap-1 px-3 sm:px-5 xl:flex xl:justify-between xl:gap-5">
            <DialogPrimitive.Trigger asChild>
              <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl xl:hidden" aria-label="Open navigation menu">
                <Menu className="h-5 w-5" />
              </Button>
            </DialogPrimitive.Trigger>

            <Link to={homeRoute} className="justify-self-center text-xl font-extrabold tracking-tight text-primary xl:shrink-0">
              Tally<span className="text-foreground">Store</span><span className="text-primary">.</span>
            </Link>

            <div className="hidden items-center gap-3 xl:flex">
              {primaryNavigation.map(({ label, to, icon: Icon }) => to ? (
                <NavLink
                  key={label} to={to} end={label === 'Home'}
                  className={({ isActive }) => `flex items-center gap-1.5 whitespace-nowrap py-2 text-xs font-semibold transition-colors hover:text-primary ${isActive || (label === 'Products' && productNavigationSelected) ? 'text-primary' : 'text-muted-foreground'}`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{label}
                </NavLink>
              ) : (
                <button key={label} disabled title="Tally Circle referrals are coming soon" className="flex cursor-not-allowed items-center gap-1.5 whitespace-nowrap text-xs font-semibold text-muted-foreground/60">
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />{label}
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px]">Coming soon</span>
                </button>
              ))}
            </div>

            <div className="flex items-center justify-end gap-0.5 xl:shrink-0">
              <Button variant="ghost" onClick={toggleCurrency} className="h-9 w-10 rounded-xl p-0 text-xs font-bold" aria-label={`Currency: ${currency}. Switch currency`}>
                {currency}
              </Button>
              <ThemeToggle className="h-9 w-9" />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full border border-primary/15 bg-primary/5 text-primary" aria-label="Account menu">
                    <CircleUserRound className="h-5 w-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" sideOffset={12} className="z-[110] w-64 max-h-[calc(100dvh-100px)] overflow-y-auto rounded-2xl p-2 shadow-xl">
                  <DropdownMenuLabel className="px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground">Your account</DropdownMenuLabel>
                  {user ? (
                    <>
                      <DropdownMenuItem asChild className={accountItemClass}><Link to="/wallet"><Wallet className="h-4 w-4" />Wallet<span className="ml-auto text-xs text-muted-foreground">{balanceLabel}</span></Link></DropdownMenuItem>
                      <DropdownMenuItem asChild className={accountItemClass}><Link to="/orders"><History className="h-4 w-4" />Order history</Link></DropdownMenuItem>
                      <DropdownMenuItem asChild className={accountItemClass}><Link to="/profile"><CircleUserRound className="h-4 w-4" />Profile</Link></DropdownMenuItem>
                    </>
                  ) : (
                    <>
                      <DropdownMenuItem asChild className={accountItemClass}><Link to="/login"><CircleUserRound className="h-4 w-4" />Sign in</Link></DropdownMenuItem>
                      <DropdownMenuItem asChild className={accountItemClass}><Link to="/register"><Sparkles className="h-4 w-4" />Create account</Link></DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuItem disabled className={accountItemClass}><Rocket className="h-4 w-4" />API Access<span className="ml-auto text-[10px]">Coming soon</span></DropdownMenuItem>
                  {verifiedRole && (isAdmin || isStaff) && (
                    <>
                      <DropdownMenuSeparator />
                      {isAdmin && <DropdownMenuItem asChild className={accountItemClass}><Link to="/admin"><ShieldCheck className="h-4 w-4" />Admin workspace</Link></DropdownMenuItem>}
                      {isStaff && <DropdownMenuItem asChild className={accountItemClass}><Link to="/staff-admin"><ShieldCheck className="h-4 w-4" />Staff workspace</Link></DropdownMenuItem>}
                    </>
                  )}
                  {(!isInstalled || user) && <DropdownMenuSeparator />}
                  {!isInstalled && <DropdownMenuItem className={accountItemClass} onSelect={() => { void handleDownloadClick() }}><Download className="h-4 w-4" />Install app</DropdownMenuItem>}
                  {user && <DropdownMenuItem className={`${accountItemClass} text-destructive focus:text-destructive`} onSelect={() => { void handleSignOut() }}><LogOut className="h-4 w-4" />Sign out</DropdownMenuItem>}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </nav>

        {/* The portal keeps viewport positioning independent of the blurred navbar. */}
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-slate-950/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:!animate-none" />
          <DialogPrimitive.Content
            aria-describedby="navigation-description"
            className="fixed inset-y-0 left-0 z-[101] flex h-[100dvh] max-h-[100dvh] w-[min(90vw,400px)] flex-col overflow-hidden border-r border-border bg-background shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 duration-200 motion-reduce:!animate-none"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-border px-5 pb-5 pt-[max(20px,env(safe-area-inset-top))]">
              <div>
                <DialogPrimitive.Title className="text-2xl font-extrabold tracking-tight text-primary">Tally<span className="text-foreground">Store</span>.</DialogPrimitive.Title>
                <DialogPrimitive.Description id="navigation-description" className="mt-1 text-xs text-muted-foreground">Explore your digital marketplace</DialogPrimitive.Description>
              </div>
              <DialogPrimitive.Close asChild><Button variant="ghost" size="icon" className="rounded-full bg-muted" aria-label="Close navigation menu"><X className="h-5 w-5" /></Button></DialogPrimitive.Close>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 pb-[max(20px,env(safe-area-inset-bottom))]">
              <div className="space-y-1">
                {primaryNavigation.map(({ label, to, icon: Icon }) => to ? (
                  <NavLink
                    key={label} to={to} end={label === 'Home'} onClick={() => setIsMobileMenuOpen(false)}
                    className={({ isActive }) => `group flex min-h-14 items-center gap-3 rounded-2xl px-3 py-3 text-sm font-semibold transition-colors ${isActive || (label === 'Products' && productNavigationSelected) ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted'}`}
                  >
                    {({ isActive }) => (
                      <>
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="h-[18px] w-[18px]" aria-hidden="true" /></span>
                        <span>{label}</span>
                        <span className="ml-auto flex shrink-0 items-center gap-2">
                          {(isActive || (label === 'Products' && productNavigationSelected)) && (
                            <span aria-hidden="true" className="relative h-8 w-8 overflow-hidden rounded-lg border border-primary/20 bg-primary/5">
                              <img src="/TALLYAPPLOGO.png" alt="" data-selected-menu-marker={label} className="absolute -left-[14px] -top-[8px] h-[60px] w-[60px] max-w-none" />
                            </span>
                          )}
                          <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        </span>
                      </>
                    )}
                  </NavLink>
                ) : (
                  <button key={label} disabled className="flex min-h-14 w-full cursor-not-allowed items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-semibold text-muted-foreground">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted"><Icon className="h-[18px] w-[18px]" aria-hidden="true" /></span>
                    <span>{label}</span><span className="ml-auto rounded-full bg-muted px-2 py-1 text-[10px] font-medium">Coming soon</span>
                  </button>
                ))}
              </div>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
      <InstallAppDialog open={showInstallDialog} onOpenChange={setShowInstallDialog} />
    </>
  )
}
